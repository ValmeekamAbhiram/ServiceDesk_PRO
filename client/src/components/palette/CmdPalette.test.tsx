import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CmdPalette } from './CmdPalette';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useUiStore } from '@/stores/ui.store';

vi.mock('@/api/tickets', () => ({
  useTickets: () => ({
    data: { items: [{ id: 'ticket-1', number: 'INC-1042', title: 'Printer offline', status: 'OPEN', priority: 'HIGH' }] },
    isFetching: false,
  }),
}));
vi.mock('@/api/assets', () => ({ useAssets: () => ({ data: { items: [] }, isFetching: false }) }));
vi.mock('@/api/articles', () => ({ useArticleSearch: () => ({ data: [], isFetching: false }) }));
vi.mock('@/api/users', () => ({ useUsers: () => ({ data: { items: [] }, isFetching: false }) }));

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function ShortcutProbe() {
  useKeyboardShortcuts();
  return <LocationProbe />;
}

describe('global productivity controls', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useUiStore.setState({ commandOpen: false, shortcutHelpOpen: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens command search with Ctrl+K', () => {
    render(<MemoryRouter><ShortcutProbe /></MemoryRouter>);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(useUiStore.getState().commandOpen).toBe(true);
  });

  it('does not run single-letter shortcuts while typing', () => {
    render(<MemoryRouter><ShortcutProbe /><input aria-label="Ticket title" /></MemoryRouter>);
    fireEvent.keyDown(screen.getByLabelText('Ticket title'), { key: 'n' });
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });

  it('navigates to the active result with Enter', () => {
    render(
      <MemoryRouter>
        <CmdPalette />
        <LocationProbe />
      </MemoryRouter>
    );
    act(() => useUiStore.getState().setCommandOpen(true));
    const input = screen.getByRole('searchbox', { name: 'Search the service desk' });
    fireEvent.change(input, { target: { value: 'printer' } });
    act(() => vi.advanceTimersByTime(250));
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('location')).toHaveTextContent('/tickets/ticket-1');
    expect(useUiStore.getState().commandOpen).toBe(false);
  });

  it('closes with Escape and restores focus', () => {
    render(
      <MemoryRouter>
        <button type="button">Search trigger</button>
        <CmdPalette />
      </MemoryRouter>
    );
    const trigger = screen.getByRole('button', { name: 'Search trigger' });
    trigger.focus();
    act(() => useUiStore.getState().setCommandOpen(true));
    act(() => vi.runOnlyPendingTimers());
    const input = screen.getByRole('searchbox', { name: 'Search the service desk' });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Command search' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
