/**
 * ServiceDesk Pro — auth controllers.
 *
 * Thin by design: read the *validated* input, build a context, call the service,
 * put the result in the standard envelope. No business rules, no database access,
 * no error handling — a thrown `AppError` is `middleware/error.ts`'s job.
 *
 * `register`, `login` and `refresh` run before anyone is authenticated, so they
 * build an `AuthContext` from the request rather than reading `req.actor`. The
 * three authenticated handlers use `requireActor(req)`, which throws a 401 if the
 * route was mounted without `authenticate()` in front of it instead of silently
 * dereferencing `undefined`.
 */
import { getClock } from '@/config/clock';
import { requireActor } from '@/middleware';
import * as authService from '@/modules/auth/auth.service';
import { handler } from '@/utils/handler';
import { bodyOf } from '@/utils/input';
import { created, noContent, ok } from '@/utils/respond';
/** Pre-authentication context: the same fields `buildActor()` reads, minus a user. */
function contextOf(req) {
    return {
        clock: getClock(),
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
        requestId: req.requestId,
    };
}
export const register = handler(async (req, res) => {
    const result = await authService.register(bodyOf(req), contextOf(req));
    return created(res, result);
});
export const login = handler(async (req, res) => {
    const result = await authService.login(bodyOf(req), contextOf(req));
    return ok(res, result);
});
export const refresh = handler(async (req, res) => {
    const result = await authService.refresh(bodyOf(req), contextOf(req));
    return ok(res, result);
});
export const logout = handler(async (req, res) => {
    await authService.logout(requireActor(req));
    return noContent(res);
});
export const me = handler(async (req, res) => {
    return ok(res, await authService.currentUser(requireActor(req)));
});
export const changePassword = handler(async (req, res) => {
    const result = await authService.changePassword(requireActor(req), bodyOf(req));
    return ok(res, result);
});
