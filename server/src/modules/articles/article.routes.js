/**
 * ServiceDesk Pro — knowledge base routes.
 *
 * The permission on each route is the whole authorization story for the knowledge base,
 * which is why it is worth reading as a table:
 *
 *  - `GET` needs `ARTICLE_READ`, which every role holds. *What* you see is narrowed in
 *    the service by filter — published articles, plus your own drafts, plus everything
 *    if you can publish. Never here.
 *  - `POST` / `PATCH` need `ARTICLE_WRITE`: technicians and admins.
 *  - `POST /:id/publish` and `/retract` need `ARTICLE_PUBLISH`: admins only. This is the
 *    review boundary, and it is a separate route rather than a status field precisely so
 *    that holding `ARTICLE_WRITE` cannot be turned into publishing by editing a payload.
 *
 * `/search` is declared before `/:id`. Express matches in order, so the other way round
 * would send `GET /api/articles/search` into the id route, where it would fail id
 * validation and answer 400 for a request that is perfectly well formed.
 *
 * There is no `DELETE`. An article that should not be live is retracted to DRAFT, the
 * same "take it out of circulation, keep the history" rule as categories and assets.
 */
import { Router } from 'express';
import { Permission } from '@shared/enums';
import { authenticate, requireActor, requirePermission, validate } from '@/middleware';
import * as articleService from '@/modules/articles/article.service';
import { articleIdSchema, createArticleSchema, listArticlesSchema, publishArticleSchema, searchArticlesSchema, updateArticleSchema, } from '@/modules/articles/article.schema';
import { handler } from '@/utils/handler';
import { bodyOf, paramsOf, queryOf } from '@/utils/input';
import { created, ok, paginated } from '@/utils/respond';
export const articleRouter = Router();
articleRouter.use(authenticate());
articleRouter.get('/', requirePermission(Permission.ARTICLE_READ), validate(listArticlesSchema), handler(async (req, res) => paginated(res, await articleService.list(queryOf(req), requireActor(req)))));
articleRouter.get('/search', requirePermission(Permission.ARTICLE_READ), validate(searchArticlesSchema), handler(async (req, res) => ok(res, await articleService.search(queryOf(req)))));
articleRouter.get('/:id', requirePermission(Permission.ARTICLE_READ), validate(articleIdSchema), handler(async (req, res) => ok(res, await articleService.getById(paramsOf(req).id, requireActor(req)))));
articleRouter.post('/', requirePermission(Permission.ARTICLE_WRITE), validate(createArticleSchema), handler(async (req, res) => {
    const article = await articleService.create(bodyOf(req), requireActor(req));
    return created(res, article, `/api/articles/${article.id}`);
}));
articleRouter.patch('/:id', requirePermission(Permission.ARTICLE_WRITE), validate(updateArticleSchema), handler(async (req, res) => ok(res, await articleService.update(paramsOf(req).id, bodyOf(req), requireActor(req)))));
articleRouter.post('/:id/publish', requirePermission(Permission.ARTICLE_PUBLISH), validate(publishArticleSchema), handler(async (req, res) => ok(res, await articleService.setPublished(paramsOf(req).id, true, requireActor(req), bodyOf(req).version))));
articleRouter.post('/:id/retract', requirePermission(Permission.ARTICLE_PUBLISH), validate(articleIdSchema), handler(async (req, res) => ok(res, await articleService.setPublished(paramsOf(req).id, false, requireActor(req)))));
