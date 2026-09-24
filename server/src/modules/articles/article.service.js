/**
 * ServiceDesk Pro — knowledge base.
 *
 * ## Who can see a draft
 *
 * `ARTICLE_READ` is held by every role, so the scope filter does the real work:
 * everyone sees published articles, an author additionally sees their own drafts, and
 * a reviewer sees everything. "Reviewer" is not a role check — it is
 * `ARTICLE_PUBLISH`, which is the whole point: the person who has to approve drafts is
 * exactly the person who has to be able to read them. Deriving the read scope from the
 * publish permission means the two can never drift apart.
 *
 * As everywhere else, the scope is a **filter** combined under `$and`, so a caller's
 * `?status=DRAFT` can only narrow it. An unseeable draft answers **404**, not 403.
 *
 * ## Who can publish, and who can edit what has been published
 *
 * A technician holds `ARTICLE_WRITE`; only an admin holds `ARTICLE_PUBLISH`. So an
 * author writes drafts and somebody else approves them, and `status` appears in no
 * request body anywhere — publishing is its own route (see `article.schema.ts`).
 *
 * The less obvious half: **editing a published article also needs `ARTICLE_PUBLISH`.**
 * Without that rule the review boundary is decorative, because an author could get a
 * two-line draft approved and then rewrite the body afterwards. Editing a *published*
 * article is refused with 403 rather than 404, because that article is not a secret —
 * the caller can already read it, so there is nothing left to withhold.
 *
 * ## `viewCount`
 *
 * Incremented with `$inc` on a successful read of a published article, and drafts are
 * not counted — an author reloading their own work in progress is not readership. The
 * update deliberately names `version` in its `$inc` so that `versioned()` leaves the
 * concurrency token alone: reading an article is not editing it, and bumping the token
 * would make every open edit form stale every time a passer-by opened the page.
 */
import { ArticleStatus, AuditAction, AuditEntity, Permission } from '@shared/enums';
import { logger } from '@/config/logger';
import { can } from '@/core/actor';
import { Category, KnowledgeArticle, toObjectId, } from '@/models';
import { diff, record } from '@/modules/audit/audit.service';
import { toUserRefDtoOrNull } from '@/modules/users/user.mapper';
import { slugify } from '@/modules/categories/category.service';
import { ConflictError, ForbiddenError, ValidationError, assertFound, assertVersion, } from '@/utils/errors';
import { populatedDoc } from '@/utils/populate';
import { resolvePaging, toPaginated } from '@/utils/respond';
const log = logger.child({ module: 'article.service' });
function toCategoryOption(value) {
    const category = populatedDoc(value, 'name');
    return category ? { id: String(category._id), label: category.name } : null;
}
export function toArticleDto(article) {
    return {
        id: String(article._id),
        title: article.title,
        slug: article.slug,
        summary: article.summary,
        body: article.body,
        status: article.status,
        category: toCategoryOption(article.categoryId),
        tags: article.tags,
        author: toUserRefDtoOrNull(populatedDoc(article.authorId, 'name')),
        viewCount: article.viewCount,
        publishedAt: article.publishedAt?.toISOString() ?? null,
        createdAt: article.createdAt.toISOString(),
        updatedAt: article.updatedAt.toISOString(),
        version: article.version,
    };
}
/**
 * `score` comes from `$meta: 'textScore'`, which Mongoose puts on the document rather
 * than in the schema, so it is read off a widened shape instead of the typed document.
 * It is meaningful only within one result set — see `ArticleSearchHitDto`.
 */
function toSearchHit(article) {
    return {
        id: String(article._id),
        title: article.title,
        slug: article.slug,
        summary: article.summary,
        tags: article.tags,
        score: article.score ?? 0,
    };
}
/* ──────────────────────────────── reading ───────────────────────────────── */
/** See the header: the publish permission is what makes someone a reviewer. */
function isReviewer(actor) {
    return can(actor, Permission.ARTICLE_PUBLISH);
}
function scopeFilter(actor) {
    if (isReviewer(actor))
        return {};
    return {
        $or: [{ status: ArticleStatus.PUBLISHED }, { authorId: toObjectId(actor.user.id) }],
    };
}
const ARTICLE_POPULATE = [
    { path: 'categoryId', select: 'name' },
    { path: 'authorId', select: 'name email role status' },
];
const SORT_FIELDS = {
    updatedAt: 'updatedAt',
    publishedAt: 'publishedAt',
    viewCount: 'viewCount',
    title: 'title',
};
/**
 * Every clause goes into `$and`, including the scope. Assigning onto one filter object
 * would let `?status=` or `?categoryId=` overwrite the scope clause, and a read filter
 * that a caller can overwrite is not a read filter.
 */
function buildListFilter(query, actor) {
    const clauses = [scopeFilter(actor)];
    if (query.status)
        clauses.push({ status: query.status });
    if (query.categoryId)
        clauses.push({ categoryId: toObjectId(query.categoryId) });
    if (query.tag)
        clauses.push({ tags: query.tag });
    if (query.q)
        clauses.push({ $text: { $search: query.q } });
    return { $and: clauses };
}
export async function list(query, actor) {
    const { page, limit, skip } = resolvePaging(query);
    const filter = buildListFilter(query, actor);
    const direction = query.sortOrder === 'asc' ? 1 : -1;
    /* `_id` breaks ties so two articles updated in the same millisecond cannot swap
     * places between page 1 and page 2, showing one twice and the other never. */
    const sort = query.q
        ? { score: { $meta: 'textScore' }, _id: -1 }
        : { [SORT_FIELDS[query.sortBy]]: direction, _id: direction };
    const cursor = KnowledgeArticle.find(filter)
        .populate(ARTICLE_POPULATE)
        .sort(sort)
        .skip(skip)
        .limit(limit);
    if (query.q)
        cursor.select({ score: { $meta: 'textScore' } });
    const [rows, total] = await Promise.all([
        cursor.exec(),
        KnowledgeArticle.countDocuments(filter),
    ]);
    return toPaginated(rows.map((row) => toArticleDto(row)), page, limit, total);
}
/**
 * Search only ever returns **published** articles, for every caller including a
 * reviewer. It is not a narrower `list()`: its callers are a typeahead and the "related
 * articles" panel beside a half-written ticket, and both exist to point somebody at an
 * answer. An unapproved draft is not an answer yet, so it does not belong in a list of
 * suggestions — least of all in one assembled for a user by the ticket assistant.
 */
export async function search(query) {
    const rows = await KnowledgeArticle.find({
        status: ArticleStatus.PUBLISHED,
        $text: { $search: query.q },
    })
        .select({ title: 1, slug: 1, summary: 1, tags: 1, score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' }, _id: -1 })
        .limit(query.limit)
        .lean();
    return rows.map((row) => toSearchHit(row));
}
/** The one place an article is fetched by id, so the scope cannot be forgotten. */
async function loadScoped(id, actor) {
    const found = await KnowledgeArticle.findOne({
        $and: [{ _id: toObjectId(id) }, scopeFilter(actor)],
    }).populate(ARTICLE_POPULATE);
    return assertFound(found, 'Article');
}
export async function getById(id, actor) {
    const article = await loadScoped(id, actor);
    if (article.status === ArticleStatus.PUBLISHED) {
        /* `version: 0` is not a typo — see the header. It stops `versioned()` from adding
         * `$inc: { version: 1 }` to this update, because a page view is not an edit. */
        await KnowledgeArticle.updateOne({ _id: article._id }, { $inc: { viewCount: 1, version: 0 } });
        /* Reflected locally so the response reports the count that was just stored, rather
         * than the one from a moment before. */
        article.viewCount += 1;
    }
    return toArticleDto(article);
}
/* ──────────────────────────────── writing ───────────────────────────────── */
/**
 * Slugs are unique, and a repeated title is a plausible thing for two authors to do
 * years apart, so a collision appends `-2`, `-3` rather than refusing the save. The slug
 * is an identifier and `title` is what anybody reads; failing to file a draft because
 * somebody once used the same heading would be a strange thing to explain.
 */
async function uniqueSlug(title, excludeId) {
    /* A title of nothing but punctuation slugifies to an empty string, which would be an
     * invalid (and, worse, silently shared) identifier. */
    const base = slugify(title) || 'article';
    for (let attempt = 1; attempt <= 50; attempt += 1) {
        const slug = attempt === 1 ? base : `${base}-${attempt}`;
        const clash = await KnowledgeArticle.exists({
            slug,
            ...(excludeId ? { _id: { $ne: excludeId } } : {}),
        });
        if (!clash)
            return slug;
    }
    throw new ConflictError('Too many articles share that title. Change the title.');
}
async function assertCategoryExists(categoryId) {
    if (!(await Category.exists({ _id: toObjectId(categoryId) }))) {
        throw new ValidationError('That category does not exist.', [
            { path: 'categoryId', message: 'Unknown category.' },
        ]);
    }
}
export async function create(input, actor) {
    if (input.categoryId)
        await assertCategoryExists(input.categoryId);
    const article = await KnowledgeArticle.create({
        title: input.title,
        slug: await uniqueSlug(input.title),
        summary: input.summary,
        body: input.body,
        /* Always a draft, never what the client asked for — the body cannot ask (see
         * `article.schema.ts`), and this is the second half of that guarantee for the
         * seed script and anything else that calls the service directly. */
        status: ArticleStatus.DRAFT,
        categoryId: input.categoryId ? toObjectId(input.categoryId) : null,
        tags: input.tags ?? [],
        authorId: toObjectId(actor.user.id),
        publishedAt: null,
    });
    /* Populated before mapping so a 201 body matches what a later GET returns. Without
     * this the response would name no author, which reads as a bug. */
    await article.populate(ARTICLE_POPULATE);
    log.info({ requestId: actor.requestId, articleId: String(article._id), slug: article.slug }, 'article created');
    await record({
        action: AuditAction.ARTICLE_CREATED,
        entityType: AuditEntity.ARTICLE,
        entityId: String(article._id),
        entityLabel: article.title,
        summary: `Drafted "${article.title}"`,
    }, actor);
    return toArticleDto(article);
}
/**
 * Read scope first, so somebody else's draft is a 404, then the published-article rule
 * from the header. The order matters: 403 on a draft would confirm it exists.
 */
async function loadForEdit(id, actor) {
    const article = await loadScoped(id, actor);
    if (article.status === ArticleStatus.PUBLISHED && !isReviewer(actor)) {
        throw new ForbiddenError('A published article can only be edited by someone who can publish it.');
    }
    return article;
}
/**
 * `body` and `summary` are previewed rather than copied: an article body is the longest
 * text in the product, and two full copies of it per edit would make the audit
 * collection larger than the articles themselves. The trail's job is to show that the
 * wording moved and who moved it; the article holds the wording.
 *
 * `slug` is on the list because it is the public URL — a change there is the one that
 * breaks other people's links.
 */
const AUDITED_ARTICLE_FIELDS = ['title', 'slug', 'summary', 'body', 'categoryId', 'tags'];
function auditSnapshot(article) {
    return {
        title: article.title,
        slug: article.slug,
        summary: preview(article.summary),
        body: preview(article.body),
        categoryId: article.categoryId,
        tags: article.tags.join(', '),
    };
}
function preview(text) {
    return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}
export async function update(id, input, actor) {
    const article = await loadForEdit(id, actor);
    assertVersion(input.version, article.version, 'Article');
    const before = auditSnapshot(article);
    if (input.categoryId)
        await assertCategoryExists(input.categoryId);
    if (input.title !== undefined && input.title !== article.title) {
        article.title = input.title;
        /* The slug follows the title only until the article first goes live; after that it
         * is in bookmarks and shared links, and rewriting it to fix a typo in the heading
         * would break every one of them.
         *
         * The test is `publishedAt`, not `status === DRAFT`: a retracted article is a draft
         * again, but its old URL is still out in the world, so retract-rename-republish must
         * not be a way to move it. */
        if (article.publishedAt === null) {
            article.slug = await uniqueSlug(input.title, article._id);
        }
    }
    if (input.summary !== undefined)
        article.summary = input.summary;
    if (input.body !== undefined)
        article.body = input.body;
    if (input.tags !== undefined)
        article.tags = input.tags;
    if (input.categoryId !== undefined) {
        article.categoryId = input.categoryId ? toObjectId(input.categoryId) : null;
    }
    await article.save();
    log.info({ requestId: actor.requestId, articleId: id, version: article.version }, 'article updated');
    await record({
        action: AuditAction.ARTICLE_UPDATED,
        entityType: AuditEntity.ARTICLE,
        entityId: id,
        entityLabel: article.title,
        summary: `Edited "${article.title}"`,
        changes: diff(before, auditSnapshot(article), AUDITED_ARTICLE_FIELDS),
    }, actor);
    return toArticleDto(article);
}
/**
 * Publishing and retracting, both behind `ARTICLE_PUBLISH` at the route.
 *
 * `expectedVersion` is required to publish and deliberately not required to retract.
 * Approving is a statement about a specific piece of text, so if the draft has changed
 * since the reviewer read it the publish must fail rather than approve words nobody
 * looked at. Retracting is the safety valve for an article that should not be live, and
 * a stale token must never be the reason somebody cannot pull it down.
 *
 * Already in the requested state is a no-op rather than a 409: the caller wanted the
 * article published and it is published. Writing anyway would bump `version` and move
 * `publishedAt` for nothing.
 */
export async function setPublished(id, publish, actor, expectedVersion) {
    const article = await loadScoped(id, actor);
    const target = publish ? ArticleStatus.PUBLISHED : ArticleStatus.DRAFT;
    if (article.status === target)
        return toArticleDto(article);
    if (publish)
        assertVersion(expectedVersion, article.version, 'Article');
    article.status = target;
    /* `??` and not an assignment: `publishedAt` records when the article first went live.
     * Retracting an article to fix a typo should not reshuffle the shelf when it returns,
     * so a retraction leaves the date alone and a re-publish keeps the original. */
    if (publish)
        article.publishedAt = article.publishedAt ?? actor.clock.now();
    await article.save();
    log.info({ requestId: actor.requestId, articleId: id, status: target }, publish ? 'article published' : 'article retracted');
    /* Both directions are `ARTICLE_PUBLISHED`, with the summary carrying which way it
     * went. A retraction is the same reviewer decision read backwards, and the question
     * an administrator asks of the trail — "who put this in front of employees, and when
     * did it come down" — is answered by one action with a `status` change beside it. */
    await record({
        action: AuditAction.ARTICLE_PUBLISHED,
        entityType: AuditEntity.ARTICLE,
        entityId: id,
        entityLabel: article.title,
        summary: publish ? `Published "${article.title}"` : `Retracted "${article.title}"`,
        changes: [
            {
                field: 'status',
                from: publish ? ArticleStatus.DRAFT : ArticleStatus.PUBLISHED,
                to: target,
            },
        ],
    }, actor);
    return toArticleDto(article);
}
