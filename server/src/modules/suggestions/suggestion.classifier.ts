/**
 * ServiceDesk Pro — the offline ticket classifier.
 *
 * This is the whole of the "AI" that ships with no configuration: a keyword score
 * over the categories an admin has already defined. It runs in a fraction of a
 * millisecond, costs nothing, works with the network unplugged, and — the property
 * that actually matters — it is *deterministic*, so a suggestion that looks wrong
 * can be reproduced and argued with instead of shrugged at.
 *
 * Three deliberate limits:
 *
 *  - **No I/O and no Mongoose here.** Categories arrive as plain `CategoryCandidate`
 *    objects. That keeps the interesting logic testable without a database, and it
 *    means the LLM path can reuse the same candidate list and the same validation.
 *  - **Confidence never reaches 1.** A keyword count is evidence, not proof. The
 *    ceiling is 0.95 so the UI never renders "100% sure" next to a guess.
 *  - **Nothing here decides anything.** The output pre-selects a category and a
 *    priority in a form the user is about to submit. The priority in particular is
 *    a *suggestion about urgency*, not an SLA ruling: the engine computes deadlines
 *    from whatever priority the ticket is finally created with.
 */

import { PRIORITY_RANK, Priority } from '@shared/enums';

/** A category as the classifier needs it: no document, so this stays pure. */
export interface CategoryCandidate {
  id: string;
  name: string;
  defaultPriority: Priority;
  keywords: readonly string[];
}

export interface Classification {
  categoryId: string | null;
  categoryName: string | null;
  priority: Priority;
  /** 0–1, capped at 0.95. See the header. */
  confidence: number;
  reason: string;
}

/**
 * Lower-cased, punctuation stripped, and **padded with a space at each end**.
 *
 * The padding is what makes `includes(' vpn ')` a whole-word test: without it,
 * "vpn" would match "vpnclient" and, worse, "port" would match "support" — which
 * is how a printer keyword ends up classifying a payroll question. Because both
 * sides of the comparison go through this, a multi-word keyword like "blue screen"
 * needs no special case; it is matched exactly like a single-word one.
 */
function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

/** Whole-word or whole-phrase containment, on already-normalised text. */
function mentions(haystack: string, phrase: string): boolean {
  const needle = normalize(phrase);
  return needle !== '  ' && needle !== ' ' && haystack.includes(needle);
}

/**
 * Urgency vocabulary.
 *
 * These are *not* policy and they are not SLA rules — they only pre-select the
 * priority dropdown. They are kept here rather than in the database because they
 * describe how people write, not how this organisation works: an admin tunes
 * urgency by editing a category's `defaultPriority`, which the scoring below
 * respects as the starting point.
 */
const URGENT_SIGNALS = [
  'outage', 'entire office', 'whole office', 'everyone is affected', 'all users',
  'company wide', 'production is down', 'cannot work', 'unable to work',
  'ransomware', 'data loss', 'security breach', 'lost all',
] as const;

const HIGH_SIGNALS = [
  'urgent', 'urgently', 'asap', 'immediately', 'critical', 'blocked',
  'cannot access', 'locked out', 'nothing works', 'completely down',
  'deadline today', 'client meeting',
] as const;

const CALM_SIGNALS = [
  'no rush', 'whenever', 'when you get a chance', 'not urgent', 'low priority',
  'minor', 'cosmetic', 'just wondering', 'nice to have', 'at your convenience',
] as const;

const TITLE_WEIGHT = 3;
const BODY_WEIGHT = 1;

/** Confidence is clamped into this band — never certain, never quite nothing. */
const MIN_CONFIDENCE = 0.35;
const MAX_CONFIDENCE = 0.95;
/** Distinct keyword hits that count as a thorough match. */
const DEPTH_TARGET = 3;

interface Scored {
  candidate: CategoryCandidate;
  score: number;
  matched: string[];
}

/**
 * Words that flip the meaning of the urgency phrase after them.
 *
 * Apostrophes are already gone by the time `normalize()` is done, so the contracted
 * forms are spelled without them.
 */
const NEGATORS = new Set([
  'not', 'no', 'never', 'nothing', 'isnt', 'arent', 'wasnt', 'dont', 'doesnt', 'cant',
]);

/**
 * Whole-phrase containment that ignores a negated occurrence.
 *
 * "not urgent" contains "urgent", and a plain `includes` therefore reads a request
 * that says *please do not rush* as a demand to rush — which is the single most
 * embarrassing thing a feature like this can do. So each occurrence is checked
 * against the word in front of it, and a negated one keeps searching rather than
 * matching.
 *
 * This applies to the urgency vocabulary only, not to category keywords. Negating a
 * topic is rare and harmless when missed ("this is not a VPN problem" still belongs
 * with Network more than with anything else), whereas negating urgency is a stock
 * phrase in every second ticket.
 */
function mentionsUnnegated(haystack: string, phrase: string): boolean {
  const needle = normalize(phrase);
  if (needle === ' ' || needle === '  ') return false;

  let from = 0;
  while (from <= haystack.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    /* The needle is space-padded, so `at + 1` ends the slice on that leading space
     * and the last token of what remains is the word immediately before it. */
    const words = haystack.slice(0, at + 1).trim().split(' ');
    if (!NEGATORS.has(words[words.length - 1] ?? '')) return true;
    from = at + 1;
  }
  return false;
}

/** First signal found in the text, so the reason can quote the actual evidence. */
function firstSignal(text: string, signals: readonly string[]): string | null {
  for (const signal of signals) if (mentionsUnnegated(text, signal)) return signal;
  return null;
}

const byRank = (a: Priority, b: Priority): Priority =>
  PRIORITY_RANK[a] >= PRIORITY_RANK[b] ? a : b;

/** With nothing matched at all, say so with a number the UI can render honestly. */
const NO_MATCH_CONFIDENCE = 0.2;

/**
 * One step gentler, and never below `LOW`.
 *
 * `URGENT` is deliberately absent: an admin who set a category's default to urgent
 * has made a policy call, and a requester writing "whenever you get a chance"
 * should not quietly undo it.
 */
const SOFTER: Partial<Record<Priority, Priority>> = {
  [Priority.HIGH]: Priority.MEDIUM,
  [Priority.MEDIUM]: Priority.LOW,
};

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));
const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Score every candidate, drop the ones with no evidence, best first.
 *
 * A category's **name** is scored like a keyword, so "printer is jammed" finds
 * Printers on a fresh install where nobody has typed keywords in yet. Ties keep the
 * order they arrived in — the caller passes categories in the admin's own
 * `sortOrder`, which is a better tie-break than anything this file could invent,
 * and `Array.prototype.sort` is stable, so it survives.
 */
function scoreCategories(
  title: string,
  body: string,
  candidates: readonly CategoryCandidate[]
): Scored[] {
  const scored = candidates.map((candidate) => {
    let score = 0;
    const matched: string[] = [];
    const seen = new Set<string>();

    for (const phrase of [candidate.name, ...candidate.keywords]) {
      const key = phrase.trim().toLowerCase();
      if (key === '' || seen.has(key)) continue;
      seen.add(key);

      /* Title beats body: a word someone chose for the one-line summary is a
       * stronger signal than the same word buried in paragraph three. */
      if (mentions(title, phrase)) {
        score += TITLE_WEIGHT;
        matched.push(key);
      } else if (mentions(body, phrase)) {
        score += BODY_WEIGHT;
        matched.push(key);
      }
    }
    return { candidate, score, matched };
  });

  return scored.filter((row) => row.score > 0).sort((a, b) => b.score - a.score);
}

/**
 * The classifier proper: text in, a pre-selection out.
 *
 * Note what the urgency signals do *not* do — they never lower a suggestion below
 * the category's own default by more than one step, and an urgent signal only ever
 * raises. The organisation's setting is the floor; the requester's wording moves it.
 */
export function classify(
  input: { title: string; description?: string | null },
  candidates: readonly CategoryCandidate[]
): Classification {
  const title = normalize(input.title ?? '');
  const body = normalize(input.description ?? '');
  const whole = `${title}${body}`;

  /* At most one urgency signal is reported, strongest first, so the reason names
   * the word that actually moved the priority rather than a list of near-misses. */
  const urgent = firstSignal(whole, URGENT_SIGNALS);
  const high = urgent ? null : firstSignal(whole, HIGH_SIGNALS);
  const calm = urgent === null && high === null ? firstSignal(whole, CALM_SIGNALS) : null;

  const ranked = scoreCategories(title, body, candidates);
  const winner = ranked[0] ?? null;
  const base = winner?.candidate.defaultPriority ?? Priority.MEDIUM;

  let priority = base;
  if (urgent) priority = byRank(base, Priority.URGENT);
  else if (high) priority = byRank(base, Priority.HIGH);
  else if (calm) priority = SOFTER[base] ?? base;

  const notes: string[] = [];
  if (urgent) notes.push(`"${urgent}" reads as an emergency.`);
  else if (high) notes.push(`"${high}" reads as time-critical.`);
  else if (calm && priority !== base) notes.push(`"${calm}" reads as low priority.`);

  if (!winner) {
    return {
      categoryId: null,
      categoryName: null,
      priority,
      confidence: NO_MATCH_CONFIDENCE,
      reason: ['No category keywords matched, so this is a guess.', ...notes].join(' '),
    };
  }

  /* Two independent components: `share` is how much of the total evidence went to
   * the winner (1.0 when it was the only category to match at all), and `depth` is
   * how many distinct phrases it matched. One word in an uncontested category is a
   * decent guess; three words is about as sure as counting words can make anyone. */
  const total = ranked.reduce((sum, row) => sum + row.score, 0);
  const share = winner.score / total;
  const depth = Math.min(1, winner.matched.length / DEPTH_TARGET);
  const confidence = round2(
    clamp(MIN_CONFIDENCE + 0.4 * share + 0.2 * depth, MIN_CONFIDENCE, MAX_CONFIDENCE)
  );

  const quoted = winner.matched.slice(0, 3).map((word) => `"${word}"`).join(', ');
  return {
    categoryId: winner.candidate.id,
    categoryName: winner.candidate.name,
    priority,
    confidence,
    reason: [`Matched ${quoted} in ${winner.candidate.name}.`, ...notes].join(' '),
  };
}
