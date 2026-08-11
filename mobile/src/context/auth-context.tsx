import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ApiError, clearToken, getToken } from '@/services/api-client';
import * as authService from '@/services/auth-service';
import type { User } from '@/types';

type AuthState = {
  user: User | null;
  /** True until the stored token has been checked, so the router can hold its decision. */
  isRestoring: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: {
    name: string;
    email: string;
    password: string;
    passwordConfirmation: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      const token = await getToken();

      if (!token) {
        if (!cancelled) setIsRestoring(false);
        return;
      }

      try {
        const current = await authService.fetchCurrentUser();
        if (!cancelled) setUser(current);
      } catch (error) {
        // A token the server rejects is dead weight: drop it so the user gets the sign-in
        // screen rather than a session that fails on every subsequent request.
        if (error instanceof ApiError && error.isUnauthenticated) {
          await clearToken();
        }
        // Any other failure -- offline, server down -- leaves the token in place. The
        // user is probably still signed in; they just cannot be verified right now.
      } finally {
        if (!cancelled) setIsRestoring(false);
      }
    }

    restore();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setUser(await authService.login(email, password));
  }, []);

  const signUp = useCallback<AuthState['signUp']>(async (input) => {
    setUser(await authService.register(input));
  }, []);

  const signOut = useCallback(async () => {
    // Clear locally first. If the network call fails the user still expects to be
    // signed out, and auth-service drops the token regardless.
    setUser(null);
    await authService.logout();
  }, []);

  const value = useMemo(
    () => ({ user, isRestoring, signIn, signUp, signOut }),
    [user, isRestoring, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);

  if (context === null) {
    throw new Error('useAuth must be used inside an <AuthProvider>.');
  }

  return context;
}
