import axios from 'axios';
import { ErrorCode } from '@shared/enums';
import { getSession, setSession } from './session';
/**
 * The HTTP layer: one axios instance, one error type, one refresh.
 *
 * Three things happen here that are worth knowing about:
 *
 * 1. **The envelope is unwrapped once.** The server answers `{ success, data,
 *    requestId }`; every caller wants `data`. Unwrapping in one place is what keeps
 *    `useQuery` bodies from being a chain of `.data.data`.
 *
 * 2. **A 401 triggers exactly one refresh, shared.** A dashboard fires half a dozen
 *    requests at once, so six 401s must not become six refreshes — the first one
 *    stores its promise and the rest await it. Only then is each request retried.
 *    A request that already carries `_retried` is never retried again, which is what
 *    stops a server that answers 401 to everything from looping forever.
 *
 * 3. **Errors arrive as `ApiClientError`.** The server's message is written to be
 *    shown to a user, so it is carried through verbatim; a network failure or an
 *    HTML error page gets a generic message instead, because whatever a proxy put in
 *    the body is not something to render.
 */
export class ApiClientError extends Error {
    code;
    status;
    fields;
    requestId;
    /** Extra payload for specific codes: `currentVersion`, `retryAfterSeconds`. */
    detail;
    constructor(init) {
        super(init.message);
        this.name = 'ApiClientError';
        this.code = init.code;
        this.status = init.status ?? null;
        this.fields = init.fields ?? [];
        this.requestId = init.requestId ?? null;
        this.detail = init.detail ?? {};
    }
    /** True when the server rejected the body — the form should show field errors. */
    get isValidation() {
        return this.code === ErrorCode.VALIDATION_FAILED && this.fields.length > 0;
    }
    /** Someone else saved first. The caller must refetch before retrying. */
    get isVersionConflict() {
        return this.code === ErrorCode.VERSION_CONFLICT;
    }
    /** The version the server holds, so a form can offer to reload. */
    get currentVersion() {
        const value = this.detail.currentVersion;
        return typeof value === 'number' ? value : null;
    }
}
function isApiError(body) {
    return (typeof body === 'object' &&
        body !== null &&
        body.success === false &&
        typeof body.error?.code === 'string');
}
function toApiClientError(error) {
    if (error instanceof ApiClientError)
        return error;
    if (axios.isAxiosError(error)) {
        const axiosError = error;
        const body = axiosError.response?.data;
        if (isApiError(body)) {
            const { code, message, fields, ...detail } = body.error;
            return new ApiClientError({
                code,
                message,
                status: axiosError.response?.status ?? null,
                fields: Array.isArray(fields) ? fields : [],
                requestId: body.requestId,
                detail: detail,
            });
        }
        /* No envelope: the request never reached the API, or something in front of it
         * answered. Neither body is safe to show, so the message is ours. */
        return new ApiClientError({
            code: 'NETWORK_ERROR',
            message: axiosError.response
                ? 'The server responded with something unexpected. Please try again.'
                : 'Could not reach the server. Check your connection and try again.',
            status: axiosError.response?.status ?? null,
        });
    }
    return new ApiClientError({
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Something went wrong.',
    });
}
export const http = axios.create({
    baseURL: '/api',
    timeout: 20_000,
    headers: { Accept: 'application/json' },
});
http.interceptors.request.use((config) => {
    const session = getSession();
    if (session)
        config.headers.Authorization = `Bearer ${session.accessToken}`;
    return config;
});
/** Requests that must never be retried after a refresh — refresh itself included. */
const NO_RETRY = ['/auth/login', '/auth/register', '/auth/refresh'];
/** The one in-flight refresh, shared by every request that got a 401. */
let refreshing = null;
async function refreshAccessToken() {
    const session = getSession();
    if (!session)
        throw new ApiClientError({ code: ErrorCode.UNAUTHENTICATED, message: 'Your session has ended. Please sign in again.' });
    /* A bare axios call, not `http`: going through the instance would attach the dead
     * access token and re-enter this interceptor on failure. */
    const response = await axios.post('/api/auth/refresh', {
        refreshToken: session.refreshToken,
    });
    const auth = response.data.data;
    setSession({
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        accessTokenExpiresAt: auth.accessTokenExpiresAt,
        userId: auth.user.id,
    });
    return auth.accessToken;
}
http.interceptors.response.use((response) => response, async (error) => {
    if (!axios.isAxiosError(error) || error.response?.status !== 401) {
        throw toApiClientError(error);
    }
    const config = error.config;
    const url = config?.url ?? '';
    if (!config || config._retried || NO_RETRY.some((path) => url.startsWith(path)) || !getSession()) {
        /* Out of options. Clearing the session is what moves the app to the sign-in
         * screen — the auth store is listening for exactly this. */
        if (!NO_RETRY.some((path) => url.startsWith(path)))
            setSession(null);
        throw toApiClientError(error);
    }
    try {
        refreshing ??= refreshAccessToken().finally(() => {
            refreshing = null;
        });
        const token = await refreshing;
        config._retried = true;
        config.headers.Authorization = `Bearer ${token}`;
        return await http.request(config);
    }
    catch {
        setSession(null);
        throw new ApiClientError({
            code: ErrorCode.UNAUTHENTICATED,
            message: 'Your session has expired. Please sign in again.',
            status: 401,
        });
    }
});
/* ─────────────────────────── the callable surface ──────────────────────────── */
async function unwrap(run) {
    try {
        const response = await run();
        return response.data.data;
    }
    catch (error) {
        throw toApiClientError(error);
    }
}
function clean(params) {
    if (!params)
        return undefined;
    const out = {};
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '')
            continue;
        if (Array.isArray(value)) {
            if (value.length === 0)
                continue;
            /* Comma-separated, which is the form every list schema accepts. */
            out[key] = value.join(',');
            continue;
        }
        out[key] = value;
    }
    return out;
}
export const api = {
    get: (url, params) => unwrap(() => http.get(url, { params: clean(params) })),
    /*
     * `params` is here for the two notification routes that answer with the refreshed
     * list: marking something read has to be told which page to send back, or the panel
     * would jump to page one every time somebody clicks a row.
     */
    post: (url, body, params) => unwrap(() => http.post(url, body, { params: clean(params) })),
    patch: (url, body) => unwrap(() => http.patch(url, body)),
    /** Multipart, for the ticket form's attachments. The browser sets the boundary. */
    postForm: (url, form) => unwrap(() => http.post(url, form)),
    /** 204 endpoints — there is no envelope to unwrap. */
    postNoContent: async (url, body) => {
        try {
            await http.post(url, body);
        }
        catch (error) {
            throw toApiClientError(error);
        }
    },
};
