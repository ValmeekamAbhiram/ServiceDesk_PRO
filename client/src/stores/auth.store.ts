import { create } from 'zustand';
import type { Permission, Role } from '@shared/enums';
import type { AuthResponse, CurrentUserDto } from '@shared/types';
import { api } from '@/lib/api';
import { getSession, onSessionChange, setSession } from '@/lib/session';

/**
 * Who is signed in, and what the UI may therefore render.
 *
 * `permissions` comes from the server and is used **only** to decide which controls
 * appear. Every action behind them is checked again server-side, so hiding a button
 * is a courtesy and never the enforcement — the same reason `can()` lives here and
 * not in a route guard that pretends to be security.
 *
 * `status` distinguishes three states the UI must render differently: `loading` on
 * first paint while a stored token is verified, `authenticated`, and `anonymous`.
 * Collapsing the first two would flash the sign-in page at a signed-in user on every
 * refresh, which reads as being logged out.
 */

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  status: Status;
  user: CurrentUserDto | null;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Changing a password revokes every session and moves `passwordChangedAt` forward, which
   * makes `authenticate()` reject the access token this tab is holding. The server answers
   * with a replacement pair, so this has to live in the store: a plain mutation hook would
   * succeed and then log the user out of the app they are standing in.
   */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /**
   * Fold a successful self-edit back into the cached identity.
   *
   * Deliberately not a re-`bootstrap()`: that signs the user out if the follow-up request
   * fails, which would be an absurd punishment for having successfully saved a job title.
   * Only the three fields `PATCH /users/me` can touch are accepted, so a response cannot
   * quietly rewrite a role or a permission list.
   */
  applyProfile: (fields: Pick<CurrentUserDto, 'name' | 'jobTitle' | 'phone'>) => void;
  can: (permission: Permission) => boolean;
  hasRole: (...roles: Role[]) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: getSession() ? 'loading' : 'anonymous',
  user: null,

  /** Verify a stored token against the server before trusting it. */
  bootstrap: async () => {
    if (!getSession()) {
      set({ status: 'anonymous', user: null });
      return;
    }
    try {
      const user = await api.get<CurrentUserDto>('/auth/me');
      set({ status: 'authenticated', user });
    } catch {
      /* The api layer has already cleared an unrecoverable session; anything else
       * (a network blip) still means we cannot claim to know who this is. */
      setSession(null);
      set({ status: 'anonymous', user: null });
    }
  },

  login: async (email, password) => {
    const auth = await api.post<AuthResponse>('/auth/login', { email, password });
    accept(auth);
    set({ status: 'authenticated', user: auth.user });
  },

  register: async (name, email, password) => {
    const auth = await api.post<AuthResponse>('/auth/register', { name, email, password });
    accept(auth);
    set({ status: 'authenticated', user: auth.user });
  },

  logout: async () => {
    try {
      /* Best effort: the point of the call is to delete the session row server-side,
       * but a failure must not leave the user staring at a signed-in app. */
      await api.postNoContent('/auth/logout');
    } catch {
      /* Ignored on purpose — see above. */
    }
    setSession(null);
    set({ status: 'anonymous', user: null });
  },

  applyProfile: (fields) => {
    const current = get().user;
    if (!current) return;
    set({ user: { ...current, ...fields } });
  },

  changePassword: async (currentPassword, newPassword) => {
    const auth = await api.post<AuthResponse>('/auth/change-password', {
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

function accept(auth: AuthResponse): void {
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
