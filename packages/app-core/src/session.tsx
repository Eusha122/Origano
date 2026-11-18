import { type ApiClient, ApiError, createApiClient } from '@oregano/api-client';
import type { Me } from '@oregano/contracts';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { queryKeys } from './queries';

export type TokenStorage = { get(): string | null; set(token: string): void; clear(): void };

const TOKEN_KEY = 'oregano.session';

/** localStorage, wrapped because it throws in private modes and is missing on native. */
export const webTokenStorage: TokenStorage = {
  get() {
    try {
      return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
    } catch {
      return null;
    }
  },
  set(token) {
    try {
      globalThis.localStorage?.setItem(TOKEN_KEY, token);
    } catch {
      // Storage is unavailable; the session lasts until the page closes.
    }
  },
  clear() {
    try {
      globalThis.localStorage?.removeItem(TOKEN_KEY);
    } catch {
      // Nothing stored, nothing to clear.
    }
  },
};

/** Keeps the token in memory only. Native apps use this until secure storage arrives in Plan 10. */
export function createMemoryTokenStorage(): TokenStorage {
  let token: string | null = null;
  return {
    get: () => token,
    set: (next) => {
      token = next;
    },
    clear: () => {
      token = null;
    },
  };
}

type ApiContextValue = {
  api: ApiClient;
  realtimeUrl: string;
  token: string | null;
  setToken: (token: string | null) => void;
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

/** Provides the API client, the session token and React Query to everything below it. */
export function ApiProvider(props: {
  baseUrl: string;
  realtimeUrl: string;
  storage: TokenStorage;
  children: ReactNode;
}) {
  const { baseUrl, realtimeUrl, storage } = props;
  const [queryClient] = useState(makeQueryClient);
  const [token, setTokenState] = useState<string | null>(() => storage.get());
  // The client reads the token through a ref so it never has to be rebuilt when the token changes.
  // setToken is the only writer of both, so they stay in step.
  const tokenRef = useRef(token);

  const api = useMemo(() => createApiClient({ baseUrl, getToken: () => tokenRef.current }), [baseUrl]);
  const setToken = useCallback(
    (next: string | null) => {
      if (next === null) storage.clear();
      else storage.set(next);
      tokenRef.current = next;
      setTokenState(next);
    },
    [storage],
  );
  const value = useMemo(() => ({ api, realtimeUrl, token, setToken }), [api, realtimeUrl, token, setToken]);

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
  /** True while a token is stored, even if me cannot load (offline): do not show sign-in then. */
  isSignedIn: boolean;
  /** Why me failed to load, if it did; status 0 means offline. */
  error: ApiError | null;
};

/** Session state from the stored token and the me query. `expired` means the server refused the token. */
export function deriveSession(input: {
  token: string | null;
  data: Me | undefined;
  error: unknown;
  isPending: boolean;
}): SessionState & { expired: boolean } {
  if (input.token === null) return { me: null, isLoading: false, isSignedIn: false, error: null, expired: false };
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
  const { api, token, setToken } = useApiContext();
  const queryClient = useQueryClient();
  const meQuery = useQuery({ queryKey: queryKeys.me, queryFn: () => api.me(), enabled: token !== null });
  const { expired, ...state } = deriveSession({
    token,
    data: meQuery.data,
    error: meQuery.error,
    isPending: meQuery.isPending,
  });

  // A stored token the server no longer accepts is dropped, which signs the user out.
  useEffect(() => {
    if (expired) {
      setToken(null);
      queryClient.clear();
    }
  }, [expired, setToken, queryClient]);

  const signIn = useCallback(
    async (phone: string, code: string) => {
      const session = await api.verifyOtp(phone, code);
      queryClient.clear();
      queryClient.setQueryData(queryKeys.me, session.user);
      setToken(session.token);
    },
    [api, queryClient, setToken],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Signing out locally must work even offline or with an already expired token.
    }
    setToken(null);
    queryClient.clear();
  }, [api, queryClient, setToken]);

  return { ...state, signIn, signOut };
}
