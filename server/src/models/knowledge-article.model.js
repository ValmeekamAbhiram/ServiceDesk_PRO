/**
 * ServiceDesk Pro — knowledge base articles.
 *
 * Two states, DRAFT and PUBLISHED, and the distinction is an access-control
 * boundary rather than a label: a draft is visible to its author and to admins,
 * a published article is visible to everyone. Anything more elaborate — review
 * queues, approval chains — would be workflow for its own sake here.
 *
 * ## Search is a MongoDB text index
 *
 * One weighted text index over title, summary, body and tags. No embeddings, no
 * vector store: for a knowledge base of this size, `$text` with sensible weights
 * finds "printer offline" as well as anything more elaborate would, and it needs
 * no second datastore, no background indexing job and no API key. The weights are
 * the interesting part — a phrase in the title means far more than the same
 * phrase somewhere in a two-thousand-word body.
 *
 * ## `viewCount`
 *
 * Incremented with `$inc` on read, never by reading-then-writing. Two people
 * opening the same article in the same second would otherwise both write the same
 * number and one view would vanish.
 */
import { Schema } from 'mongoose';
import { ARTICLE_STATUSES, ArticleStatus } from '@shared/enums';
import { BASE_SCHEMA_OPTIONS, defineModel, enumField, ref, requiredRef, versioned, } from '@/models/helpers';
const knowledgeArticleSchema = new Schema({
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        maxlength: 220,
        index: false,
    },
    summary: { type: String, required: true, trim: true, maxlength: 500 },
    body: { type: String, required: true, maxlength: 50_000 },
    status: enumField(ARTICLE_STATUSES, { required: true, default: ArticleStatus.DRAFT }),
    categoryId: ref('Category', { index: false }),
    tags: { type: [String], default: [] },
    authorId: requiredRef('User', { index: false }),
    viewCount: { type: Number, default: 0, min: 0 },
    publishedAt: { type: Date, default: null },
}, BASE_SCHEMA_OPTIONS);
versioned(knowledgeArticleSchema);
knowledgeArticleSchema.index({ slug: 1 }, { unique: true });
/** The public list: published articles, newest first. */
knowledgeArticleSchema.index({ status: 1, publishedAt: -1 });
/** "My drafts". */
knowledgeArticleSchema.index({ authorId: 1, status: 1, updatedAt: -1 });
knowledgeArticleSchema.index({ categoryId: 1, status: 1 });
knowledgeArticleSchema.index({ tags: 1 });
/** Most-read articles, for the dashboard panel. */
knowledgeArticleSchema.index({ viewCount: -1 });
/** See the header for why the weights matter more than the index itself. */
knowledgeArticleSchema.index({ title: 'text', summary: 'text', tags: 'text', body: 'text' }, { name: 'article_search', weights: { title: 20, tags: 12, summary: 8, body: 2 } });
export const KnowledgeArticle = defineModel('KnowledgeArticle', knowledgeArticleSchema);
