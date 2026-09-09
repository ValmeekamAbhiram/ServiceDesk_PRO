import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { Permission } from '@shared/enums';
import { useNavigate } from 'react-router-dom';
import { useTickets } from '@/api/tickets';
import { useAssets } from '@/api/assets';
import { useArticleSearch } from '@/api/articles';
import { useUsers } from '@/api/users';
import { PaletteResults, type PaletteResult } from './PaletteResults';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';

function useDebouncedValue(value: string, delay = 220): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

export function CmdPalette() {
  const open = useUiStore((state) => state.commandOpen);
  const setOpen = useUiStore((state) => state.setCommandOpen);
  const can = useAuthStore((state) => state.can);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const term = useDebouncedValue(query.trim());
  const enabled = open && term.length >= 2;

  const tickets = useTickets({ q: term, page: 1, limit: 5, sortBy: 'updatedAt', sortOrder: 'desc' }, enabled);
  const assets = useAssets({ q: term, page: 1, limit: 5, sortBy: 'name', sortOrder: 'asc' }, enabled && can(Permission.ASSET_READ));
  const articles = useArticleSearch(term, 5, enabled && can(Permission.ARTICLE_READ));
  const people = useUsers({ q: term, page: 1, limit: 4, sortBy: 'name', sortOrder: 'asc' }, enabled && can(Permission.USER_MANAGE));

  const results = useMemo<PaletteResult[]>(() => [
    ...(tickets.data?.items ?? []).map((ticket) => ({
      id: ticket.id,
      group: 'Tickets' as const,
      label: `${ticket.number} · ${ticket.title}`,
      description: `${ticket.status.replaceAll('_', ' ')} · ${ticket.priority}`,
      to: `/tickets/${ticket.id}`,
    })),
    ...(assets.data?.items ?? []).map((asset) => ({
      id: asset.id,
      group: 'Assets' as const,
      label: `${asset.tag} · ${asset.name}`,
      description: `${asset.type.replaceAll('_', ' ')} · ${asset.status.replaceAll('_', ' ')}`,
      to: `/assets/${asset.id}`,
    })),
    ...(articles.data ?? []).map((article) => ({
      id: article.id,
      group: 'Knowledge' as const,
      label: article.title,
      description: article.summary,
      to: `/knowledge/${article.id}`,
    })),
    ...(people.data?.items ?? []).map((person) => ({
      id: person.id,
      group: 'People' as const,
      label: person.name,
      description: person.jobTitle ? `${person.jobTitle} · ${person.email}` : person.email,
      to: `/admin/users?q=${encodeURIComponent(person.email)}`,
    })),
  ], [articles.data, assets.data?.items, people.data?.items, tickets.data?.items]);

  const close = () => setOpen(false);
  const select = (result: PaletteResult) => {
    close();
    navigate(result.to);
  };

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [term]);

  useEffect(() => {
    if (results.length === 0) setActiveIndex(0);
    else if (activeIndex >= results.length) setActiveIndex(results.length - 1);
  }, [activeIndex, results.length]);

  if (!open) return null;
  const loading = tickets.isFetching || assets.isFetching || articles.isFetching || people.isFetching;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/60 p-3 pt-[8vh] backdrop-blur-sm sm:p-6 sm:pt-[12vh]" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <section role="dialog" aria-modal="true" aria-label="Command search" className="w-full max-w-2xl overflow-hidden rounded-panel border border-line bg-surface-raised shadow-pop">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="h-5 w-5 shrink-0 text-ink-subtle" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') close();
              if (event.key === 'ArrowDown' && results.length > 0) {
                event.preventDefault();
                setActiveIndex((current) => (current + 1) % results.length);
              }
              if (event.key === 'ArrowUp' && results.length > 0) {
                event.preventDefault();
                setActiveIndex((current) => (current - 1 + results.length) % results.length);
              }
              if (event.key === 'Enter' && results[activeIndex]) {
                event.preventDefault();
                select(results[activeIndex]);
              }
            }}
            placeholder="Search tickets, assets, knowledge, or people…"
            aria-label="Search the service desk"
            aria-controls="command-results"
            aria-activedescendant={results[activeIndex] ? `command-result-${activeIndex}` : undefined}
            className="h-14 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-subtle"
          />
          {query && <button type="button" className="btn btn-ghost btn-icon-sm" onClick={() => setQuery('')} aria-label="Clear search"><X className="h-4 w-4" aria-hidden="true" /></button>}
          <kbd className="kbd hidden sm:inline-flex">Esc</kbd>
        </div>
        <PaletteResults results={results} activeIndex={activeIndex} loading={loading} query={query} onSelect={select} onActiveChange={setActiveIndex} />
        <footer className="flex items-center gap-3 border-t border-line bg-surface-sunken/65 px-4 py-2 text-2xs text-ink-subtle">
          <span><kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> navigate</span>
          <span><kbd className="kbd">↵</kbd> open</span>
          {loading && <span className="ml-auto">Updating results…</span>}
        </footer>
      </section>
    </div>,
    document.body
  );
}
