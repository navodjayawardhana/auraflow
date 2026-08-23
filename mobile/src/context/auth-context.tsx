import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { ApiError, getToken } from '@/services/api-client';
import * as authService from '@/services/auth-service';
import { clearNamespace, readCache, writeCache } from '@/services/cache';
import { forgetPendingReset } from '@/services/pending-reset';
import { clearCompletion } from '@/services/reminder-completion';
import type { User } from '@/types';

/**
 * The cached identity is keyed under a fixed id rather than the user's own, because at
 * restore time we do not yet know who the token belongs to.
 */
const IDENTITY_NAMESPACE = 'session';
const IDENTITY_RESOURCE = 'me';

interface AuthContextValue {
  user: User | null;
  isRestoring: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    name: string,
    email: string,
    password: string,
    passwordConfirmation: string,
  ) => Promise<void>;
  completePasswordReset: (
    email: string,
    code: string,
    password: string,
    passwordConfirmation: string,
  ) => Promise<void>;
  signOut: () => Promise<void>;
  signOutEverywhere: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;

        const restoredUser = await authService.fetchCurrentUser();
        setUser(restoredUser);
        await writeCache(IDENTITY_NAMESPACE, IDENTITY_RESOURCE, restoredUser);
      } catch (error) {
        if (error instanceof ApiError && error.isUnauthenticated) {
          // The server has revoked this token, so the local copies of both the token and
          // the identity are worthless.
          setUser(null);
          await clearNamespace(IDENTITY_NAMESPACE);
          return;
        }

        // A network failure is not a sign-out. The token stays where it is, and a
        // previously cached identity lets the app open straight into its signed-in
        // state offline rather than bouncing to the login screen.
        const cached = await readCache<User>(IDENTITY_NAMESPACE, IDENTITY_RESOURCE);
        if (cached !== null) {
          setUser(cached.value);
        }
      } finally {
        setIsRestoring(false);
      }
    })();
  }, []);

  async function signIn(email: string, password: string) {
    const payload = await authService.login({ email, password });
    setUser(payload.user);
    await writeCache(IDENTITY_NAMESPACE, IDENTITY_RESOURCE, payload.user);
  }

  async function signUp(
    name: string,
    email: string,
    password: string,
    passwordConfirmation: string,
  ) {
    const payload = await authService.register({
      name,
      email,
      password,
      password_confirmation: passwordConfirmation,
    });
    setUser(payload.user);
    await writeCache(IDENTITY_NAMESPACE, IDENTITY_RESOURCE, payload.user);
  }

  /**
   * The end of the forgotten-password flow: the reset itself signs the user in.
   *
   * A third way into a session rather than a call to `signIn` with the new password,
   * because the API already returns a token from the reset — asking for one twice would
   * mean a second round trip that could fail on a flaky connection and strand somebody
   * who has just successfully changed their password and no longer has a code.
   *
   * The pending-reset marker is dropped here rather than by the screen, so it cannot
   * survive a completed reset and offer to resume one that is already finished.
   */
  async function completePasswordReset(
    email: string,
    code: string,
    password: string,
    passwordConfirmation: string,
  ) {
    const payload = await authService.resetPassword({
      email,
      code,
      password,
      password_confirmation: passwordConfirmation,
    });

    await forgetPendingReset();
    setUser(payload.user);
    await writeCache(IDENTITY_NAMESPACE, IDENTITY_RESOURCE, payload.user);
  }

  /**
   * Cached health data must not survive a sign-out. Purged before the token is cleared,
   * so an interrupted sign-out never leaves readable data behind with no session to
   * explain it.
   */
  async function purgeLocalData(signedOutUser: User | null) {
    await clearNamespace(IDENTITY_NAMESPACE);
    if (signedOutUser !== null) {
      await clearNamespace(signedOutUser.id);
      // Which days this person had already checked in on is the same kind of fact as the
      // rest of it. The scheduled notifications themselves are cancelled by
      // `useReminderRuntime`, which watches for the user going null.
      await clearCompletion(signedOutUser.id);
    }
  }

  async function signOut() {
    const previous = user;
    setUser(null);
    await purgeLocalData(previous);
    // authService.logout() is already best-effort — it swallows network errors itself.
    await authService.logout();
  }

  async function signOutEverywhere() {
    const previous = user;
    setUser(null);
    await purgeLocalData(previous);
    await authService.logoutEverywhere();
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isRestoring,
        signIn,
        signUp,
        completePasswordReset,
        signOut,
        signOutEverywhere,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
