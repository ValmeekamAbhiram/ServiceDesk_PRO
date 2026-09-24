import { BookOpen, Boxes, Search, Ticket, Users } from 'lucide-react';
import { cn } from '@/lib/cn';
const GROUP_ICON = {
    Tickets: <Ticket className="h-4 w-4" aria-hidden="true"/>,
    Assets: <Boxes className="h-4 w-4" aria-hidden="true"/>,
    Knowledge: <BookOpen className="h-4 w-4" aria-hidden="true"/>,
    People: <Users className="h-4 w-4" aria-hidden="true"/>,
};
export function PaletteResults({ results, activeIndex, loading, query, onSelect, onActiveChange, }) {
    if (query.trim().length < 2) {
        return (<div className="grid min-h-52 place-items-center px-6 text-center">
        <div>
          <Search className="mx-auto h-5 w-5 text-ink-subtle" aria-hidden="true"/>
          <p className="mt-2 text-sm font-medium text-ink">Search the service desk</p>
          <p className="mt-1 max-w-sm text-xs leading-5 text-ink-subtle">
            Find tickets, assets, and knowledge. People appear for administrators.
          </p>
        </div>
      </div>);
    }
    if (loading && results.length === 0) {
        return <p className="px-4 py-10 text-center text-xs text-ink-subtle">Searching…</p>;
    }
    if (results.length === 0) {
        return (<div className="px-4 py-10 text-center">
        <p className="text-sm font-medium text-ink">No matching records</p>
        <p className="mt-1 text-xs text-ink-subtle">Try a ticket number, asset tag, or broader phrase.</p>
      </div>);
    }
    let previousGroup = null;
    return (<div id="command-results" role="listbox" aria-label="Search results" className="max-h-[24rem] overflow-y-auto p-2">
      {results.map((result, index) => {
            const showGroup = result.group !== previousGroup;
            previousGroup = result.group;
            return (<div key={`${result.group}-${result.id}`}>
            {showGroup && (<p className="px-2.5 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-ink-subtle">
                {result.group}
              </p>)}
            <button id={`command-result-${index}`} type="button" role="option" aria-selected={index === activeIndex} className={cn('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors', index === activeIndex ? 'bg-brand-50 text-brand-700' : 'text-ink hover:bg-surface-sunken')} onMouseEnter={() => onActiveChange(index)} onClick={() => onSelect(result)}>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-surface-sunken text-ink-muted">
                {GROUP_ICON[result.group]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{result.label}</span>
                <span className="block truncate text-xs text-ink-subtle">{result.description}</span>
              </span>
              <span className="kbd hidden sm:inline-flex">↵</span>
            </button>
          </div>);
        })}
    </div>);
}
