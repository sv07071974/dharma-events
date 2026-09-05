import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost, ApiRequestError } from './api.js';

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'EVENT_MANAGER' | 'SUPERVISOR' | 'VOLUNTEER';
  active: boolean;
}

/** Role hierarchy mirrors `apps/api/src/plugins/auth.ts`'s `requireRole` ordering. */
const ROLE_RANK: Record<CurrentUser['role'], number> = {
  VOLUNTEER: 0,
  SUPERVISOR: 1,
  EVENT_MANAGER: 2,
  ADMIN: 3,
};

export function hasRole(user: CurrentUser | null | undefined, minimumRole: CurrentUser['role']): boolean {
  if (!user) return false;
  return ROLE_RANK[user.role] >= ROLE_RANK[minimumRole];
}

interface AuthContextValue {
  user: CurrentUser | null | undefined;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loginError: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: user, isLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        const { user } = await apiGet<{ user: CurrentUser }>('/api/v1/auth/me');
        return user;
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 401) {
          return null;
        }
        throw err;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  /**
   * UI Modernization Spec Section 5.1/10 fix: a page restored from the
   * browser's back-forward cache (bfcache) after logout can briefly show a
   * stale, still-authenticated snapshot before React even re-runs. Force a
   * fresh session check whenever a page is restored this way so
   * `ProtectedLayout`'s `!user` redirect fires immediately instead of
   * relying on a new navigation to trigger a refetch.
   */
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        void queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      }
    }
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [queryClient]);

  const loginMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      apiPost<{ user: CurrentUser }>('/api/v1/auth/login', { email, password }),
    onSuccess: (data) => {
      queryClient.setQueryData(['currentUser'], data.user);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => apiPost('/api/v1/auth/logout'),
    onSuccess: () => {
      queryClient.setQueryData(['currentUser'], null);
      queryClient.clear();
      // Explicit replace-navigation so logout clears protected content
      // immediately, with no reliance on a reactive re-render, and so
      // browser back-navigation lands on /login instead of a stale route.
      navigate('/login', { replace: true });
    },
  });

  const value: AuthContextValue = {
    user,
    isLoading,
    login: async (email, password) => {
      await loginMutation.mutateAsync({ email, password });
    },
    logout: async () => {
      await logoutMutation.mutateAsync();
    },
    loginError: loginMutation.error instanceof ApiRequestError ? loginMutation.error.message : null,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
