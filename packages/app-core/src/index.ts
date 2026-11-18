export {
  type ApiClient,
  ApiError,
  createMemorySessionStore,
  newIdempotencyKey,
  type RealtimeStatus,
  type SessionStore,
} from '@oregano/api-client';
// Apps import React Query from here so there is exactly one copy, the one ApiProvider uses.
export { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
export { errorMessageKey } from './errors';
export { handleAuthFailed, handleOrderHint, OPEN_ORDER_REFETCH_MS, queryKeys } from './queries';
export { useRealtimeHints } from './realtime';
export {
  ApiProvider,
  createWebSessionStore,
  deriveSession,
  type SessionState,
  useApi,
  useSession,
} from './session';
