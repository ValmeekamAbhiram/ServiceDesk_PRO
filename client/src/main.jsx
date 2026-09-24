/**
 * ServiceDesk Pro — entry point.
 *
 * One thing happens before React renders: the stored session is verified against the
 * server, so the app knows whether it is signed in before it decides which route to
 * show. The theme needs nothing here — the inline script in `index.html` resolved it
 * before first paint and `ui.store` reads the same key with the same rule, so the two
 * already agree.
 *
 * `bootstrap()` is fired here rather than awaited: the router renders immediately and
 * `ProtectedRoute` shows a splash while `status` is `'loading'`. Blocking on a network
 * call before the first paint would give a white screen on a slow connection.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query';
import { useAuthStore } from '@/stores/auth.store';
import { App } from '@/App';
import '@/styles/index.css';
void useAuthStore.getState().bootstrap();
const container = document.getElementById('root');
if (!container)
    throw new Error('The #root element is missing from index.html.');
createRoot(container).render(<StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>);
