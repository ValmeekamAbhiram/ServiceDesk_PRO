/**
 * ServiceDesk Pro — ticket controllers.
 *
 * Thin by design, in the same shape as the auth controllers: read the *validated*
 * input, hand it to the service with the actor, wrap the result in the standard
 * envelope. Every handler here is one expression, and that is the point — there is
 * nowhere for a business rule to hide, and nowhere for an authorization check to be
 * quietly omitted.
 *
 * `bodyOf` / `queryOf` / `paramsOf` read `req.validated`, which only `validate()`
 * writes. A route that forgot its schema throws a 500 naming the missing section
 * rather than passing unvalidated input to a service.
 */

import { requireActor } from '@/middleware';
import * as ticketService from '@/modules/tickets/ticket.service';
import type {
  AddCommentInput,
  AssignTicketInput,
  ChangeStatusInput,
  CreateTicketInput,
  IdParams,
  ListTicketsInput,
  UpdateTicketInput,
} from '@/modules/tickets/ticket.schema';
import { handler } from '@/utils/handler';
import { bodyOf, paramsOf, queryOf } from '@/utils/input';
import { created, ok, paginated } from '@/utils/respond';
import { uploadedFiles } from '@/modules/attachments/upload.middleware';

export const list = handler(async (req, res) =>
  paginated(res, await ticketService.list(queryOf<ListTicketsInput>(req), requireActor(req)))
);

export const create = handler(async (req, res) => {
  const ticket = await ticketService.create(
    bodyOf<CreateTicketInput>(req),
    requireActor(req),
    uploadedFiles(req)
  );
  /* `Location` points at the canonical URL, so a client that wants the fresh copy
   * after a reload knows where to look without string-building it. */
  return created(res, ticket, `/api/tickets/${ticket.id}`);
});

export const getById = handler(async (req, res) =>
  ok(res, await ticketService.getById(paramsOf<IdParams>(req).id, requireActor(req)))
);

export const update = handler(async (req, res) =>
  ok(
    res,
    await ticketService.update(
      paramsOf<IdParams>(req).id,
      bodyOf<UpdateTicketInput>(req),
      requireActor(req)
    )
  )
);

export const changeStatus = handler(async (req, res) =>
  ok(
    res,
    await ticketService.changeStatus(
      paramsOf<IdParams>(req).id,
      bodyOf<ChangeStatusInput>(req),
      requireActor(req)
    )
  )
);

export const assign = handler(async (req, res) =>
  ok(
    res,
    await ticketService.assign(
      paramsOf<IdParams>(req).id,
      bodyOf<AssignTicketInput>(req),
      requireActor(req)
    )
  )
);

export const reopen = handler(async (req, res) =>
  ok(
    res,
    await ticketService.reopen(
      paramsOf<IdParams>(req).id,
      bodyOf<{ note?: string; version: number }>(req),
      requireActor(req)
    )
  )
);

export const listComments = handler(async (req, res) =>
  paginated(
    res,
    await ticketService.listComments(
      paramsOf<IdParams>(req).id,
      queryOf<{ page?: number; limit?: number }>(req),
      requireActor(req)
    )
  )
);

export const addComment = handler(async (req, res) =>
  created(
    res,
    await ticketService.addComment(
      paramsOf<IdParams>(req).id,
      bodyOf<AddCommentInput>(req),
      requireActor(req),
      uploadedFiles(req)
    )
  )
);
