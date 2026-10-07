import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import {
  clearAppSessionStorage,
  clearOidcUser,
  getCurrentUser,
  subscribeToLogout,
} from './auth';
import { getApiUser, type ApiUser } from './api';
import { isApiConfigured, isAuthConfigured } from './config';

type ApiSessionState = {
  authUserId: string | null | undefined;
  authPending: boolean;
  authError: unknown;
  user: ApiUser | undefined;
  userPending: boolean;
  userError: unknown;
  accessDenied: boolean;
  sessionEnding: boolean;
};

const ApiSessionContext = createContext<ApiSessionState | null>(null);
const SESSION_QUERY_KEY = 'sogo-auth-session';
const API_USER_QUERY_KEY = 'sogo-api-me';

export function ApiSessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [accessDenied, setAccessDenied] = useState(false);
  const [sessionEnding, setSessionEnding] = useState(false);
  const previousUserId = useRef<string | null | undefined>(undefined);

  const authQuery = useQuery({
    queryKey: [SESSION_QUERY_KEY],
    queryFn: async () => {
      const user = await getCurrentUser();
      return user?.profile.sub ?? null;
    },
    enabled: isAuthConfigured() && !sessionEnding,
    retry: false,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });

  const authUserId = authQuery.data;
  const apiUserQuery = useQuery({
    queryKey: [API_USER_QUERY_KEY, authUserId],
    queryFn: getApiUser,
    enabled: Boolean(authUserId) && isApiConfigured() && !sessionEnding,
    retry: false,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!authQuery.isSuccess) return;
    const currentUserId = authQuery.data ?? null;
    if (previousUserId.current !== undefined && previousUserId.current !== currentUserId) {
      queryClient.removeQueries({
        predicate: (query) => ![SESSION_QUERY_KEY, API_USER_QUERY_KEY].includes(String(query.queryKey[0])),
      });
      setAccessDenied(false);
    }
    previousUserId.current = currentUserId;
  }, [authQuery.data, authQuery.isSuccess, queryClient]);

  useEffect(() => {
    function clearUserData() {
      queryClient.removeQueries({
        predicate: (query) => ![SESSION_QUERY_KEY, API_USER_QUERY_KEY].includes(String(query.queryKey[0])),
      });
    }

    function handleAccessDenied() {
      clearUserData();
      setAccessDenied(true);
    }

    function handleProjectNotFound() {
      clearUserData();
      setLocation('/projects');
    }

    window.addEventListener('sogo:access-denied', handleAccessDenied);
    window.addEventListener('sogo:project-not-found', handleProjectNotFound);
    return () => {
      window.removeEventListener('sogo:access-denied', handleAccessDenied);
      window.removeEventListener('sogo:project-not-found', handleProjectNotFound);
    };
  }, [queryClient, setLocation]);

  useEffect(() => subscribeToLogout(async (source) => {
    setSessionEnding(true);
    await queryClient.cancelQueries().catch(() => undefined);
    queryClient.clear();
    clearAppSessionStorage();

    if (source === 'remote') {
      try {
        await clearOidcUser();
      } finally {
        const appHome = new URL(import.meta.env.BASE_URL, window.location.origin);
        window.location.replace(appHome.toString());
      }
    }
  }), [queryClient]);

  useEffect(() => {
    if (apiUserQuery.data && !apiUserQuery.data.enabled) {
      queryClient.removeQueries({
        predicate: (query) => ![SESSION_QUERY_KEY, API_USER_QUERY_KEY].includes(String(query.queryKey[0])),
      });
      setAccessDenied(true);
    }
  }, [apiUserQuery.data, queryClient]);

  const contextValue = useMemo<ApiSessionState>(() => ({
    authUserId,
    authPending: isAuthConfigured() && authQuery.isPending,
    authError: authQuery.error,
    user: apiUserQuery.data,
    userPending: Boolean(authUserId) && isApiConfigured() && apiUserQuery.isPending,
    userError: apiUserQuery.error,
    accessDenied,
    sessionEnding,
  }), [
    accessDenied,
    authQuery.error,
    authQuery.isPending,
    authUserId,
    apiUserQuery.data,
    apiUserQuery.error,
    apiUserQuery.isPending,
    sessionEnding,
  ]);

  return <ApiSessionContext.Provider value={contextValue}>{children}</ApiSessionContext.Provider>;
}

export function useApiSession() {
  const context = useContext(ApiSessionContext);
  if (!context) {
    throw new Error('useApiSession must be used within ApiSessionProvider');
  }
  return context;
}

export const ACCESS_DENIED_MESSAGE = 'Nie masz aktywnego dostępu. Skontaktuj się z administratorem.';