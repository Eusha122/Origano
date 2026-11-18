import { connectRealtime, type RealtimeStatus } from '@oregano/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { handleAuthFailed, handleOrderHint } from './queries';
import { useApiContext } from './session';

/**
 * Keeps a realtime connection open while signed in and refreshes orders on each hint.
 * Mount it once per app, near the root; it returns the connection status for a banner.
 * When the server ends the connection because the access token expired, the session is renewed and the
 * connection reopens with the new token; when the session is over, the user is signed out and it stays closed.
 */
export function useRealtimeHints(): RealtimeStatus {
  const { api, realtimeUrl, token, session } = useApiContext();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>('offline');

  useEffect(() => {
    if (token === null) {
      setStatus('offline');
      return;
    }
    const connection = connectRealtime({
      url: realtimeUrl,
      getToken: () => session.getAccessToken(),
      // The server closes the socket with 4401 when roles, staff membership or rider status change, as well as when
      // the token expires: after renewing, check who this person is now.
      refresh: async () => {
        const renewed = await api.refresh();
        if (renewed) void handleAuthFailed(queryClient);
        return renewed;
      },
      onHint: (orderId) => void handleOrderHint(queryClient, orderId),
      onStatus: setStatus,
    });
    return () => connection.close();
  }, [api, realtimeUrl, token, session, queryClient]);

  return status;
}
