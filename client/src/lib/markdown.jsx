/**
 * ServiceDesk Pro — a small Markdown renderer for knowledge-base articles.
 *
 * It returns React elements and never an HTML string, so there is no
 * `dangerouslySetInnerHTML` anywhere in the app and nothing to sanitise: an article
 * body containing `<script>alert(1)</script>` renders as those twenty-eight characters,
 * because React escapes text children by construction. That is the whole reason this
 * exists rather than `marked` plus a sanitiser — a sanitiser is a filter you have to
 * keep correct, and this is a design that cannot produce markup in the first place.
 *
 * The supported subset is deliberately small and documented in `SUPPORTED` below, which
 * the editor shows as a hint. Anything outside it renders as plain text, which is a
 * readable failure rather than a broken one.
 *
 * Link hrefs are checked against a scheme allow-list. `[click](javascript:…)` is the one
 * way a text-only renderer could still execute something, so it is refused and rendered
 * as text.
 */
export const SUPPORTED = '# heading · **bold** · *italic* · `code` · - list · 1. list · > quote · ```fenced``` · [link](https://…)';
const SAFE_SCHEME = /^(https?:|mailto:|\/)/i;
/** Inline spans, innermost-first so `**a `b`**` still finds the code span. */
const INLINE = [
    { pattern: /`([^`]+)`/, render: (text, key) => <code key={key} className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-[0.85em]">{text}</code> },
    { pattern: /\*\*([^*]+)\*\*/, render: (text, key) => <strong key={key} className="font-semibold">{text}</strong> },
    { pattern: /\*([^*]+)\*/, render: (text, key) => <em key={key}>{text}</em> },
];
function renderInline(source, keyPrefix) {
    /* Links first: their label may itself contain bold or code. */
    const link = /\[([^\]]+)\]\(([^)\s]+)\)/.exec(source);
    if (link) {
        const [match, label, href] = link;
        const before = source.slice(0, link.index);
        const after = source.slice(link.index + match.length);
        const safe = SAFE_SCHEME.test(href);
        return [
            ...renderInline(before, `${keyPrefix}b`),
            safe ? (<a key={`${keyPrefix}l`} href={href} className="link" 
            /* External links get `noreferrer` as well as `noopener`; the article author is
             * not necessarily the person who should learn where our staff read this. */
            {...(href.startsWith('/') ? {} : { target: '_blank', rel: 'noreferrer' })}>
          {renderInline(label, `${keyPrefix}t`)}
        </a>) : (
            /* Rendered as the literal Markdown, so a reader can see what was refused. */
            <span key={`${keyPrefix}l`}>{match}</span>),
            ...renderInline(after, `${keyPrefix}a`),
        ];
    }
    for (const [index, rule] of INLINE.entries()) {
        const found = rule.pattern.exec(source);
        if (!found)
            continue;
        return [
            ...renderInline(source.slice(0, found.index), `${keyPrefix}b${index}`),
            rule.render(found[1], `${keyPrefix}m${index}`),
            ...renderInline(source.slice(found.index + found[0].length), `${keyPrefix}a${index}`),
        ];
    }
    return source ? [source] : [];
}
const HEADING_CLASS = ['text-xl', 'text-lg', 'text-base'];
/**
 * Blocks, line by line. A hand-rolled loop rather than a grammar, because the subset is
 * small enough that a loop is the readable option and a grammar would not be.
 */
export function renderMarkdown(source) {
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let index = 0;
    const key = () => `b${index}`;
    while (index < lines.length) {
        const line = lines[index] ?? '';
        if (line.trim() === '') {
            index += 1;
            continue;
        }
        /* Fenced code. An unterminated fence runs to the end of the article rather than
         * discarding the rest of it. */
        if (line.trimStart().startsWith('```')) {
            const start = index;
            index += 1;
            const body = [];
            while (index < lines.length && !(lines[index] ?? '').trimStart().startsWith('```')) {
                body.push(lines[index] ?? '');
                index += 1;
            }
            index += 1;
            blocks.push(<pre key={`b${start}`} className="overflow-x-auto rounded-md border border-line bg-surface-sunken p-3 font-mono text-xs text-ink">
          <code>{body.join('\n')}</code>
        </pre>);
            continue;
        }
        const heading = /^(#{1,3})\s+(.*)$/.exec(line);
        if (heading) {
            const level = heading[1].length;
            const Tag = ['h2', 'h3', 'h4'][level - 1];
            blocks.push(<Tag key={key()} className={`mt-5 font-semibold text-ink ${HEADING_CLASS[level - 1]}`}>
          {renderInline(heading[2], `${key()}i`)}
        </Tag>);
            index += 1;
            continue;
        }
        if (/^\s*>\s?/.test(line)) {
            const start = index;
            const quoted = [];
            while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? '')) {
                quoted.push((lines[index] ?? '').replace(/^\s*>\s?/, ''));
                index += 1;
            }
            blocks.push(<blockquote key={`b${start}`} className="border-l-2 border-brand-300 pl-3 text-sm italic text-ink-muted">
          {renderInline(quoted.join(' '), `b${start}i`)}
        </blockquote>);
            continue;
        }
        const bullet = /^\s*[-*]\s+(.*)$/;
        const numbered = /^\s*\d+[.)]\s+(.*)$/;
        const listPattern = bullet.test(line) ? bullet : numbered.test(line) ? numbered : null;
        if (listPattern) {
            const start = index;
            const items = [];
            let found = listPattern.exec(lines[index] ?? '');
            while (found) {
                items.push(found[1]);
                index += 1;
                found = index < lines.length ? listPattern.exec(lines[index] ?? '') : null;
            }
            const ordered = listPattern === numbered;
            const Tag = ordered ? 'ol' : 'ul';
            blocks.push(<Tag key={`b${start}`} className={`ml-5 space-y-1 text-sm text-ink ${ordered ? 'list-decimal' : 'list-disc'}`}>
          {items.map((item, offset) => (<li key={`b${start}-${offset}`}>{renderInline(item, `b${start}-${offset}i`)}</li>))}
        </Tag>);
            continue;
        }
        /* Anything else is a paragraph, and consecutive lines join into one — a hard wrap in
         * the source should not become a line break on the page. */
        const start = index;
        const paragraph = [];
        while (index < lines.length &&
            (lines[index] ?? '').trim() !== '' &&
            !/^(#{1,3}\s|\s*[-*]\s|\s*\d+[.)]\s|\s*>|\s*```)/.test(lines[index] ?? '')) {
            paragraph.push((lines[index] ?? '').trim());
            index += 1;
        }
        blocks.push(<p key={`b${start}`} className="text-sm leading-relaxed text-ink">
        {renderInline(paragraph.join(' '), `b${start}i`)}
      </p>);
    }
    return blocks;
}
/** The wrapper the article pages use, so spacing is decided in one place. */
export function Markdown({ source }) {
    return <div className="space-y-3">{renderMarkdown(source)}</div>;
}
