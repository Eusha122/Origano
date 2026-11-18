import { type ApiClient, ApiError, createApiClient, type SessionStore } from '@oregano/api-client';
import type { Me } from '@oregano/contracts';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { queryKeys } from './queries';

/** Set while a browser has a session; it holds no secret, only "ask the cookie for an access token". */
const HAS_SESSION_KEY = 'oregano.hasSession';
/** Earlier versions kept the long-lived token here, readable by any script on the page. */
const OLD_TOKEN_KEY = 'oregano.session';

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

function attempt(action: (s: Storage) => void): void {
  try {
    const s = storage();
    if (s) action(s);
  } catch {
    // Storage is unavailable (private mode); the session lasts until the page closes.
  }
}

/**
 * Browser session: the access token lives in memory only, and the refresh token is an httpOnly cookie
 * the page cannot read. All that survives a reload in localStorage is a flag saying a session exists.
 */
export function createWebSessionStore(): SessionStore {
  attempt((s) => s.removeItem(OLD_TOKEN_KEY));
  let access: string | null = null;
  return {
    mode: 'cookie',
    getAccessToken: () => access,
    getRefreshToken: () => null,
    save: (tokens) => {
      access = tokens.accessToken;
      attempt((s) => s.setItem(HAS_SESSION_KEY, '1'));
    },
    clear: () => {
      access = null;
      attempt((s) => s.removeItem(HAS_SESSION_KEY));
    },
    hasSession: () => {
      try {
        return storage()?.getItem(HAS_SESSION_KEY) === '1';
      } catch {
        return false;
      }
    },
  };
}

type ApiContextValue = {
  api: ApiClient;
  realtimeUrl: string;
  /** The access token held right now; changes on sign-in, refresh and sign-out. */
  token: string | null;
  /** True while a remembered browser session is being renewed after a page load. */
  restoring: boolean;
  session: SessionStore;
};

const ApiContext = createContext<ApiContextValue | null>(null);

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Do not retry a request the server refused; retry only network failures, twice.
        retry: (count, error) => error instanceof ApiError && error.status === 0 && count < 2,
      },
    },
  });
}

const RESTORE_RETRY_MS = 5000;

/** Provides the API client, the session and React Query to everything below it. */
export function ApiProvider(props: {
  baseUrl: string;
  realtimeUrl: string;
  session: SessionStore;
  children: ReactNode;
}) {
  const { baseUrl, realtimeUrl, session } = props;
  const [queryClient] = useState(makeQueryClient);
  const [token, setToken] = useState<string | null>(() => session.getAccessToken());
  const [restoring, setRestoring] = useState(
    () => session.getAccessToken() === null && session.hasSession?.() === true,
  );

  // The client changes the store; this copy also tells React, so screens follow sign-in, refresh and sign-out.
  const tracked = useMemo<SessionStore>(
    () => ({
      ...session,
      save: (tokens) => {
        session.save(tokens);
        setToken(tokens.accessToken);
      },
      clear: () => {
        session.clear();
        setToken(null);
      },
    }),
    [session],
  );
  const api = useMemo(
    () => createApiClient({ baseUrl, session: tracked, onSignedOut: () => queryClient.clear() }),
    [baseUrl, tracked, queryClient],
  );

  // After a page load only the cookie remains: trade it for an access token. Offline, keep trying;
  // a remembered session must not be shown the sign-in screen just because the network is down.
  useEffect(() => {
    if (!restoring) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tryRestore = async () => {
      const renewed = await api.refresh();
      if (stopped) return;
      if (renewed || session.hasSession?.() !== true) setRestoring(false);
      else timer = setTimeout(tryRestore, RESTORE_RETRY_MS);
    };
    void tryRestore();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [restoring, api, session]);

  const value = useMemo(
    () => ({ api, realtimeUrl, token, restoring, session: tracked }),
    [api, realtimeUrl, token, restoring, tracked],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ApiContext.Provider value={value}>{props.children}</ApiContext.Provider>
    </QueryClientProvider>
  );
}

export function useApiContext(): ApiContextValue {
  const value = useContext(ApiContext);
  if (!value) throw new Error('useApi and useSession must be used inside ApiProvider');
  return value;
}

export function useApi(): ApiClient {
  return useApiContext().api;
}

export type SessionState = {
  me: Me | null;
  isLoading: boolean;
  /** True while a session exists, even if me cannot load (offline): do not show sign-in then. */
  isSignedIn: boolean;
  /** Why me failed to load, if it did; status 0 means offline. */
  error: ApiError | null;
};

/** Session state from the held token and the me query. `expired` means the server refused the token. */
export function deriveSession(input: {
  token: string | null;
  data: Me | undefined;
  error: unknown;
  isPending: boolean;
  restoring?: boolean;
}): SessionState & { expired: boolean } {
  if (input.token === null) {
    const restoring = input.restoring === true;
    return { me: null, isLoading: restoring, isSignedIn: restoring, error: null, expired: false };
  }
  const error =
    input.error instanceof ApiError
      ? input.error
      : input.error
        ? new ApiError(0, 'internal', String(input.error), '')
        : null;
  return {
    me: input.data ?? null,
    isLoading: input.isPending && error === null,
    isSignedIn: true,
    error,
    expired: error?.status === 401,
  };
}

export function useSession(): SessionState & {
  signIn(phone: string, code: string): Promise<void>;
  signOut(): Promise<void>;
} {
  const { api, token, restoring, session } = useApiContext();
  const queryClient = useQueryClient();
  const meQuery = useQuery({ queryKey: queryKeys.me, queryFn: () => api.me(), enabled: token !== null });
  const { expired, ...state } = deriveSession({
    token,
    data: meQuery.data,
    error: meQuery.error,
    isPending: meQuery.isPending,
    restoring,
  });

  // A token the server still refuses after a renewal is dropped, which signs the user out.
  useEffect(() => {
    if (expired) {
      session.clear();
      queryClient.clear();
    }
  }, [expired, session, queryClient]);

  const signIn = useCallback(
    async (phone: string, code: string) => {
      const result = await api.verifyOtp(phone, code);
      queryClient.clear();
      queryClient.setQueryData(queryKeys.me, result.user);
    },
    [api, queryClient],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Signing out locally must work even offline or with an already expired token.
    }
    queryClient.clear();
  }, [api, queryClient]);

  return { ...state, signIn, signOut };
}
