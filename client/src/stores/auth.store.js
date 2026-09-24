import { create } from 'zustand';
import { api } from '@/lib/api';
import { getSession, onSessionChange, setSession } from '@/lib/session';
export const useAuthStore = create((set, get) => ({
    status: getSession() ? 'loading' : 'anonymous',
    user: null,
    /** Verify a stored token against the server before trusting it. */
    bootstrap: async () => {
        if (!getSession()) {
            set({ status: 'anonymous', user: null });
            return;
        }
        try {
            const user = await api.get('/auth/me');
            set({ status: 'authenticated', user });
        }
        catch {
            /* The api layer has already cleared an unrecoverable session; anything else
             * (a network blip) still means we cannot claim to know who this is. */
            setSession(null);
            set({ status: 'anonymous', user: null });
        }
    },
    login: async (email, password) => {
        const auth = await api.post('/auth/login', { email, password });
        accept(auth);
        set({ status: 'authenticated', user: auth.user });
    },
    register: async (name, email, password) => {
        const auth = await api.post('/auth/register', { name, email, password });
        accept(auth);
        set({ status: 'authenticated', user: auth.user });
    },
    logout: async () => {
        try {
            /* Best effort: the point of the call is to delete the session row server-side,
             * but a failure must not leave the user staring at a signed-in app. */
            await api.postNoContent('/auth/logout');
        }
        catch {
            /* Ignored on purpose — see above. */
        }
        setSession(null);
        set({ status: 'anonymous', user: null });
    },
    applyProfile: (fields) => {
        const current = get().user;
        if (!current)
            return;
        set({ user: { ...current, ...fields } });
    },
    changePassword: async (currentPassword, newPassword) => {
        const auth = await api.post('/auth/change-password', {
            currentPassword,
            newPassword,
        });
        accept(auth);
        set({ status: 'authenticated', user: auth.user });
    },
    can: (permission) => get().user?.permissions.includes(permission) ?? false,
    hasRole: (...roles) => {
        const role = get().user?.role;
        return role ? roles.includes(role) : false;
    },
}));
function accept(auth) {
    setSession({
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        accessTokenExpiresAt: auth.accessTokenExpiresAt,
        userId: auth.user.id,
    });
}
/**
 * The api layer clears the session when a refresh token stops working. That happens
 * deep inside an interceptor with no access to React, so this is how the app finds
 * out and moves to the sign-in screen.
 */
onSessionChange((session) => {
    if (session === null && useAuthStore.getState().status !== 'anonymous') {
        useAuthStore.setState({ status: 'anonymous', user: null });
    }
});
