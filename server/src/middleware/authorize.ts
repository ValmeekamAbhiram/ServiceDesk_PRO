/**
 * ServiceDesk Pro — authorization (§3).
 *
 * ## Three layers, and why none of them is sufficient alone
 *
 * §3 asks for role checks, permission checks and resource-level ownership. This file
 * provides the first two as route middleware; the third is only partly here, and the
 * distinction is the important part of this comment.
 *
 *  1. **`requireRole(...)`** — coarse. "Only staff can reach the technician queue."
 *     Cheap, readable at the route table, and useful as a blunt outer gate.
 *  2. **`requirePermission(...)`** — fine-grained, and the one that should be reached
 *     for by default. Routes state the capability they need (`ticket:assign`), not
 *     the job titles that happen to have it today, so granting a single technician
 *     the ability to approve KB articles is a permission grant on their user record
 *     rather than an edit to a route file.
 *  3. **Resource scope** — enforced in the *services*, not here. A middleware cannot
 *     decide whether an employee may read ticket X without loading ticket X, and
 *     once it has loaded it, the handler will load it again. So scope lives in the
 *     query: `ticketService.findForActor()` builds a filter that already excludes
 *     what the actor may not see. This is deliberate and it is the layer that
 *     actually satisfies "users must never be able to access data they are not
 *     authorized to see", because it is impossible to forget a filter you did not
 *     write — there is no unscoped read path to forget.
 *
 * `requireResourceOwnership()` below covers the narrow case where the resource *is*
 * the URL: `/api/users/:id/sessions`, where ownership is `params.id === actor.id`
 * and no database read is needed.
 *
 * ## Absence is a 404, not a 403
 *
 * When an actor is denied because a record is outside their scope, the services
 * return **NOT_FOUND**. A 403 on `/api/tickets/:id` confirms that the ticket exists —
 * an employee could enumerate ids and learn how many tickets the company has, and
 * which ids belong to sensitive departments. The rule: 403 means "you may not do
 * this kind of thing", which is safe to admit; a scoping failure is reported as
 * absence, because from inside that actor's world the record genuinely is absent.
 *
 * A route-level `requirePermission()` failure *is* a 403, and that is correct: it
 * reveals nothing about data, only that the caller lacks a capability they already
 * know they lack, because the client hides the button.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Role, type Permission } from '@shared/enums';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { hasAllPermissions, hasAnyPermission } from '@/core/authz/permissions';
import { ForbiddenError, NotFoundError, UnauthenticatedError } from '@/utils/errors';

/** Every guard here presumes `authenticate()` ran; this is what says so out loud. */
function actorOf(req: Request) {
  if (!req.actor) throw new UnauthenticatedError('Sign in to continue.');
  return req.actor;
}

function denied(req: Request, detail: Record<string, unknown>): void {
  logger.warn(
    {
      requestId: req.requestId,
      userId: req.user?.id,
      role: req.user?.role,
      method: req.method,
      path: req.path,
      ...detail,
    },
    'Authorization denied.'
  );
}

/* ────────────────────────────────── roles ───────────────────────────────── */

/**
 * Allow any of the listed roles.
 *
 * SYSTEM_ADMIN is **not** implicitly allowed. Making one role a universal bypass
 * means the role list on a route no longer describes who can reach it, and an
 * admin-only bypass is exactly the path that never gets tested. Where an
 * administrator should have access, the route says so.
 */
export function requireRole(...roles: Role[]): RequestHandler {
  return function requireRoleMiddleware(req: Request, _res: Response, next: NextFunction): void {
    try {
      const actor = actorOf(req);
      if (!roles.includes(actor.user.role)) {
        denied(req, { requiredRoles: roles });
        throw new ForbiddenError('Your role does not have access to this.');
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/* ─────────────────────────────── permissions ────────────────────────────── */

/** Allow if the actor holds **any** of the listed permissions (OR). */
export function requirePermission(...permissions: Permission[]): RequestHandler {
  return function requirePermissionMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction
  ): void {
    try {
      const actor = actorOf(req);
      if (!hasAnyPermission(actor.user.permissions, permissions)) {
        denied(req, { requiredPermissions: permissions, mode: 'any' });
        throw new ForbiddenError('You do not have permission to do that.');
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Allow only if the actor holds **every** listed permission (AND).
 *
 * For operations that genuinely combine two capabilities — bulk-resolving an
 * incident's children needs both `incident:manage` and `ticket:resolve`, because it
 * writes resolutions to tickets the actor never opened.
 */
export function requireAllPermissions(...permissions: Permission[]): RequestHandler {
  return function requireAllPermissionsMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction
  ): void {
    try {
      const actor = actorOf(req);
      if (!hasAllPermissions(actor.user.permissions, permissions)) {
        denied(req, { requiredPermissions: permissions, mode: 'all' });
        throw new ForbiddenError('You do not have permission to do that.');
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/* ──────────────────────────── ownership & scope ─────────────────────────── */

export interface ResourceOwnershipOptions {
  /** Route parameter holding the owning user's id. Defaults to `id`. */
  param?: string;
  /** Permissions that grant access to *anyone's* copy of this resource. */
  overridePermissions?: Permission[];
}

/**
 * Self-or-privileged access, for routes where the owner is named in the URL.
 *
 * Used by `/api/users/:id` and `/api/users/:id/sessions` — cases where ownership is
 * a string comparison against a user id in the URL. Anything requiring a database
 * read to establish ownership belongs in the service instead; see the header. The
 * notification routes are the example of that: `/api/notifications/:id` names the
 * notification, not its recipient, so ownership is a clause in the update filter
 * there and this middleware cannot help.
 *
 * Denials are `NotFoundError` rather than `ForbiddenError`: telling an employee that
 * user id `65f…` exists but is not theirs is an enumeration oracle for the staff
 * directory.
 */
export function requireResourceOwnership(
  options: ResourceOwnershipOptions = {}
): RequestHandler {
  const param = options.param ?? 'id';
  const overrides = options.overridePermissions ?? [];

  return function requireOwnershipMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction
  ): void {
    try {
      const actor = actorOf(req);
      const targetId = req.params[param];

      if (targetId && targetId === actor.user.id) {
        next();
        return;
      }
      if (overrides.length && hasAnyPermission(actor.user.permissions, overrides)) {
        next();
        return;
      }

      denied(req, { ownershipParam: param, targetId, overridePermissions: overrides });
      throw new NotFoundError('Resource');
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Gate for destructive demo controls: the Time Machine and the reseed endpoints.
 *
 * Two independent conditions, and the ordering is the point. `env.demoMode` is
 * already forced false in production by `config/env.ts`, so the first check cannot be
 * satisfied there by any request, header, database row or configuration mistake. The
 * permission check is second, so even in a demo build an ordinary employee cannot
 * move the clock out from under everyone else's SLAs.
 *
 * This is the middleware form of "never expose destructive demo controls to ordinary
 * users", and it is applied at the router level so a new demo endpoint inherits it
 * rather than having to remember it.
 */
export function requireDemoMode(...permissions: Permission[]): RequestHandler {
  return function requireDemoModeMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction
  ): void {
    try {
      if (!env.demoMode) {
        denied(req, { reason: 'demo mode disabled' });
        throw new NotFoundError('Endpoint');
      }
      if (permissions.length) {
        const actor = actorOf(req);
        if (!hasAnyPermission(actor.user.permissions, permissions)) {
          denied(req, { requiredPermissions: permissions, reason: 'demo control' });
          throw new ForbiddenError('You do not have permission to use demo controls.');
        }
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
