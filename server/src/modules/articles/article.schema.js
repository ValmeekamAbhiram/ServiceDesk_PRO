/**
 * ServiceDesk Pro — knowledge base request schemas.
 *
 * Two decisions here are security decisions rather than validation ones:
 *
 *  - **`status` is not accepted in any body.** A technician holds `ARTICLE_WRITE` but
 *    not `ARTICLE_PUBLISH`, and if the write shape carried a status the author could
 *    hand themselves the second permission by typing `"status": "PUBLISHED"` into the
 *    payload. Publishing is `POST /:id/publish`, a separate route behind a separate
 *    permission, so the review boundary is a routing fact and not a per-field check
 *    somebody has to remember to write. `slug`, `viewCount`, `publishedAt` and
 *    `authorId` are absent for the same family of reasons: all four are derived by the
 *    server and none is the client's to state.
 *  - **`tags` are normalised, not just validated.** Lower-cased, trimmed, de-duplicated
 *    and capped. The tag list feeds both the text index and the `?tag=` filter, and
 *    "Printer", "printer" and " printer" arriving as three different tags makes both of
 *    those quietly useless.
 *
 * The list defaults to `updatedAt` descending. Sorting by `publishedAt` would read
 * better for the public shelf, but a draft's `publishedAt` is `null` and would sort to
 * the very end — burying exactly the rows an author opening the page is looking for.
 */
import { z } from 'zod';
import { ArticleStatus } from '@shared/enums';
import { objectIdField, queryLimit, queryPage, querySearch, textField, } from '@/utils/zod';
const MAX_TAGS = 10;
/** See the header: this normalises as well as validates, and both matter. */
const tagList = z
    .array(z.string().trim().min(1).max(30))
    .max(MAX_TAGS)
    .transform((tags) => [...new Set(tags.map((tag) => tag.toLowerCase()))])
    .optional();
const articleBody = z.object({
    title: textField(4, 200, 'Give the article a title.'),
    summary: textField(10, 500, 'Summarise the article in a sentence or two.'),
    /* 50_000 mirrors `maxlength` on the model. A limit enforced only by Mongoose
     * surfaces as a 500 rather than a field error. */
    body: textField(20, 50_000, 'The article needs a body.'),
    categoryId: objectIdField.nullable().optional(),
    tags: tagList,
});
export const createArticleSchema = { body: articleBody };
export const updateArticleSchema = {
    params: z.object({ id: objectIdField }),
    body: articleBody
        .partial()
        .extend({ version: z.coerce.number().int().min(0) })
        .refine((value) => Object.keys(value).some((key) => key !== 'version'), {
        message: 'Nothing to update.',
    }),
};
export const articleIdSchema = { params: z.object({ id: objectIdField }) };
const ARTICLE_SORT_FIELDS = ['updatedAt', 'publishedAt', 'viewCount', 'title'];
export const listArticlesSchema = {
    query: z.object({
        page: queryPage,
        limit: queryLimit,
        q: querySearch,
        /* A single status, not a list: there are only two, so "both" is what you get by
         * leaving the filter off. */
        status: z.nativeEnum(ArticleStatus).optional(),
        categoryId: objectIdField.optional(),
        tag: z.string().trim().min(1).max(30).toLowerCase().optional(),
        sortBy: z.enum(ARTICLE_SORT_FIELDS).default('updatedAt'),
        sortOrder: z.enum(['asc', 'desc']).default('desc'),
    }),
};
/**
 * Search is deliberately its own shape rather than a mode of the list. It answers with
 * `ArticleSearchHitDto` — no `body` — because its callers are a typeahead and the
 * "related articles" panel on the ticket form, and shipping fifty kilobytes of Markdown
 * to draw five links is the kind of thing that makes a page feel slow for no reason.
 * `q` is required here; an empty search is a client bug, not an empty query.
 */
export const searchArticlesSchema = {
    query: z.object({
        q: z.string().trim().min(2, 'Type at least two characters.').max(200),
        limit: z.coerce.number().int().min(1).max(20).default(5),
    }),
};
/**
 * `version` is required to publish and is absent from the retract route. That asymmetry
 * is deliberate — see `setPublished()` in the service.
 */
export const publishArticleSchema = {
    params: z.object({ id: objectIdField }),
    body: z.object({ version: z.coerce.number().int().min(0) }),
};
