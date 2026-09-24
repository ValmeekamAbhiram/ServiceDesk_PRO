/**
 * ServiceDesk Pro — audit routes.
 *
 * One endpoint, one verb. There is no POST, PATCH or DELETE anywhere in this router:
 * entries are written by the services that did the thing, never by a client, and the
 * model rejects modification outright. `audit:read` belongs to administrators alone,
 * which is the whole of the authorization — see `audit.service.ts`.
 */
import { Router } from 'express';
import { Permission } from '@shared/enums';
import { authenticate, requirePermission, validate } from '@/middleware';
import * as auditService from '@/modules/audit/audit.service';
import { listAuditSchema } from '@/modules/audit/audit.schema';
import { handler } from '@/utils/handler';
import { queryOf } from '@/utils/input';
import { paginated } from '@/utils/respond';
export const auditRouter = Router();
auditRouter.use(authenticate(), requirePermission(Permission.AUDIT_READ));
auditRouter.get('/', validate(listAuditSchema), handler(async (req, res) => paginated(res, await auditService.list(queryOf(req)))));
