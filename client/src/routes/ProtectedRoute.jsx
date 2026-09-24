/**
 * ServiceDesk Pro — route guards.
 *
 * These decide what is *rendered*, never what is *allowed*. Every endpoint behind
 * every route checks the caller again, so a guard here is there to avoid showing
 * somebody a page that would only answer 403 — a courtesy, not a boundary. Deleting
 * this file would make the app uglier and no less secure.
 *
 * The `loading` state is why this is a component rather than a redirect in the route
 * table: on a refresh the stored token has not been verified yet, and redirecting
 * during that window logs the user out of their own session on every reload.
 */
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';

export function ProtectedRoute({ children }) {
    const status = useAuthStore((state) => state.status);
    const location = useLocation();
    if (status === 'loading')
        return null;
    if (status === 'anonymous') {
        /* Carry the attempted path so signing in returns here instead of the dashboard. */
        return <Navigate to="/login" replace state={{ from: location.pathname + location.search }}/>;
    }
    return <>{children}</>;
}
/** Already signed in? The sign-in and register pages are not useful. */
export function AnonymousRoute({ children }) {
    const status = useAuthStore((state) => state.status);
    if (status === 'loading')
        return null;
    if (status === 'authenticated')
        return <Navigate to="/dashboard" replace/>;
    return <>{children}</>;
}
/**
 * A permission gate for whole pages. It renders a plain explanation rather than
 * redirecting, because bouncing somebody to the dashboard from a link they were sent
 * looks like the link was broken.
 */
export function RequirePermission({ permission, children, }) {
    const can = useAuthStore((state) => state.can);
    if (!can(permission)) {
        return (<div className="mx-auto max-w-md py-20 text-center">
        <h1 className="text-lg font-semibold text-ink">Not available to your account</h1>
        <p className="mt-2 text-sm text-ink-muted">
          This area is restricted. If you think you should have access, ask an administrator to
          check your role.
        </p>
      </div>);
    }
    return <>{children}</>;
}
