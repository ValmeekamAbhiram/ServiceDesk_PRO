/**
 * Where the tokens live, and the only module that touches storage.
 *
 * It exists as a leaf — importing nothing from the app — because both the axios
 * layer and the auth store need the tokens, and a store that imported axios while
 * axios imported the store would be a cycle. The api layer can also *end* a session
 * (a refresh token that no longer works), so this publishes a change event the store
 * subscribes to rather than the api layer reaching into React state.
 *
 * localStorage rather than a cookie because the API is token-based and the client is
 * a separate origin in development. The trade-off is honest: a stored token is
 * readable by any script on this origin, so the server keeps access tokens short
 * lived and every refresh token is a revocable session row it can delete.
 */
const KEY = 'sdp.session';
const listeners = new Set();
let current = read();
function read() {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        /* Anything half-written is treated as no session at all. A missing refresh
         * token would otherwise strand the app in a loop it cannot recover from. */
        if (!parsed.accessToken || !parsed.refreshToken || !parsed.userId)
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
export function getSession() {
    return current;
}
export function setSession(session) {
    current = session;
    try {
        if (session)
            localStorage.setItem(KEY, JSON.stringify(session));
        else
            localStorage.removeItem(KEY);
    }
    catch {
        /* Private mode: the session stays in memory for this tab and that is enough. */
    }
    for (const listener of listeners)
        listener(session);
}
export function onSessionChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
