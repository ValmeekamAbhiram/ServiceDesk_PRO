/**
 * ServiceDesk Pro — an unrecognised route.
 *
 * Inside the app shell, not a bare page, because it is reached by a mistyped or stale
 * in-app link and the person is still signed in: taking the navigation away would strand
 * them. The offer is "go somewhere real", not a browser back button they already have.
 *
 * It says nothing about *why* the address failed. A 404 here and a 404 from a ticket the
 * caller may not read look identical on purpose — the server answers both the same way,
 * and a friendlier message on this page would undo that.
 */

import { Link, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export default function NotFound() {
  const location = useLocation();

  return (
    <Card>
      <EmptyState
        icon={<Compass className="h-5 w-5" aria-hidden="true" />}
        title="There is nothing at this address"
        message="The link may be out of date, or the page may never have existed."
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link to="/" className="btn btn-primary btn-sm">
              Go to the dashboard
            </Link>
            <Link to="/tickets" className="btn btn-secondary btn-sm">
              Go to tickets
            </Link>
          </div>
        }
      />
      {/* Echoed so a bug report can say which link was broken. `pathname` only — a query
        * string can carry a search term somebody typed, and there is no reason to repeat
        * it back onto the screen. */}
      <p className="border-t border-line px-4 py-2.5 text-center font-mono text-2xs text-ink-subtle">
        {location.pathname}
      </p>
    </Card>
  );
}
