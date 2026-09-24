/**
 * ServiceDesk Pro — ticket suggestions.
 *
 * One endpoint, called while somebody is still typing a ticket, that answers three
 * questions: which category is this, how urgent does it sound, and has the knowledge
 * base already got an answer. It **suggests and never applies** — the response is a
 * DTO, nothing is written, and the user submits whatever they actually want.
 *
 * ## What produces the answer
 *
 * `suggestion.classifier.ts` scores the ticket text against the keywords an admin
 * put on each category. That is the whole feature with no configuration, and it is
 * what runs in this build unless an operator sets `AI_API_KEY`. When a key is set,
 * `suggestion.llm.ts` is tried first and the classifier catches every failure, so
 * the endpoint has no dependency on the network being up or a provider being
 * healthy. `source` on the response says which one answered, so the UI can label a
 * suggestion instead of presenting it as a fact.
 *
 * ## The related articles are ours, not the model's
 *
 * `article.search()` is PUBLISHED-only for every caller — see its docblock — so a
 * suggested article always exists and has been through review. Nothing here lets a
 * model name an article, which is the only way to be sure a suggestion cannot point
 * at a draft or at a page that was never written.
 *
 * ## Authorization
 *
 * There is nothing to scope. Categories are global reference data every role can
 * already read from `GET /api/categories`, published articles are readable by
 * everyone, and no ticket is touched or read. The route requires `ticket:create`,
 * which is the honest gate: this exists to help somebody file a ticket.
 */
import { Category } from '@/models';
import { ForbiddenError } from '@/utils/errors';
import { search as searchArticles } from '@/modules/articles/article.service';
import { suggestionsEnabled } from '@/modules/settings/settings.service';
import { classify } from '@/modules/suggestions/suggestion.classifier';
import { suggestWithLlm } from '@/modules/suggestions/suggestion.llm';
import { env } from '@/config/env';
import { moduleLogger } from '@/config/logger';
const log = moduleLogger('ai');
/** A side panel, not a search page. */
const RELATED_LIMIT = 3;
/** Beyond this the keyword scan stops earning its keep, and so does the prompt. */
const CANDIDATE_LIMIT = 40;
/**
 * Active categories, in the order an admin arranged them.
 *
 * `sortOrder` matters more than it looks: the classifier breaks a scoring tie by
 * keeping the incoming order, so this query is what decides between two equally
 * plausible categories. Inactive ones are excluded because suggesting a category
 * that is missing from the picker would be a dead end.
 */
async function loadCandidates() {
    const rows = await Category.find({ active: true })
        .select('name defaultPriority keywords')
        .sort({ sortOrder: 1, name: 1 })
        .limit(CANDIDATE_LIMIT)
        .lean();
    return rows.map((row) => ({
        id: row._id.toString(),
        name: row.name,
        defaultPriority: row.defaultPriority,
        keywords: row.keywords ?? [],
    }));
}
/**
 * Turn a half-written ticket into something safe to hand to `$text`.
 *
 * Two of Mongo's text-search operators hide inside ordinary prose, and both fail
 * *silently* — they return the wrong articles rather than an error, which is the
 * worst way for this to be wrong:
 *
 *  - **A hyphen at the start of a term excludes that term.** The exact rule was
 *    measured rather than assumed, because it decides what to strip: `email -client`
 *    finds nothing, while `E-mail client` and `email - client` both match normally.
 *    So only a term-initial hyphen is dropped and an intra-word one is left alone,
 *    since Mongo already splits on it. Somebody pasting a tight bullet list —
 *    `-cannot send` — is how this arrives in practice.
 *  - **A balanced pair of double quotes makes the query a phrase search.** A whole
 *    ticket title as one phrase matches almost nothing, so the quotes come out.
 *
 * The other `$text` callers pass a `q` that a user typed deliberately, where a
 * negation may well be meant. This one assembles the query itself, so it has no
 * such excuse.
 */
function textQueryFrom(title, description) {
    return `${title} ${description ?? ''}`
        .replace(/["\u201c\u201d]/g, ' ')
        .replace(/(^|\s)-+/g, '$1')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
}
/**
 * Never let the article lookup fail the suggestion.
 *
 * A missing text index or a malformed query would otherwise turn a helpful panel
 * into a 500 on the create form. An empty "related articles" list is a fine answer;
 * no answer at all is not.
 */
async function relatedArticles(query) {
    if (query.length < 3)
        return [];
    try {
        return await searchArticles({ q: query, limit: RELATED_LIMIT });
    }
    catch (error) {
        log.warn({ err: error }, 'Related-article lookup failed; returning no articles.');
        return [];
    }
}
/**
 * Suggest a category, a priority and some reading, for a ticket that does not exist
 * yet.
 *
 * The offline answer is computed unconditionally. It costs microseconds, and making
 * it the fallback rather than a rescue path means there is one code path here
 * instead of a happy one and an error one — the provider being down is then an
 * ordinary Tuesday rather than a branch nobody ever exercises.
 */
export async function suggestTicket(actor, input) {
    if (!(await suggestionsEnabled())) {
        throw new ForbiddenError('Ticket suggestions are switched off for this deployment.');
    }
    const candidates = await loadCandidates();
    const heuristic = classify(input, candidates);
    /* Independent of each other: which classifier wins does not change the search. */
    const [fromModel, articles] = await Promise.all([
        suggestWithLlm(input, candidates),
        relatedArticles(textQueryFrom(input.title, input.description)),
    ]);
    const chosen = fromModel ?? heuristic;
    /* Enough to answer "is the model actually being used, and is it falling back?"
     * without putting a word of the ticket in the log. */
    log.debug({
        requestId: actor.requestId,
        provider: env.aiProvider,
        source: fromModel ? 'llm' : 'heuristic',
        matchedCategory: chosen.categoryId !== null,
    }, 'Ticket suggestion produced.');
    return {
        ...chosen,
        source: fromModel ? 'llm' : 'heuristic',
        relatedArticles: articles,
    };
}
