import { connectRealtime, type RealtimeStatus } from '@oregano/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { handleOrderHint } from './queries';
import { useApiContext } from './session';

/**
 * Keeps a realtime connection open while signed in and refreshes orders on each hint.
 * Mount it once per app, near the root; it returns the connection status for a banner.
 */
export function useRealtimeHints(): RealtimeStatus {
  const { realtimeUrl, token } = useApiContext();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>('offline');

  useEffect(() => {
    if (token === null) {
      setStatus('offline');
      return;
    }
    const connection = connectRealtime({
      url: realtimeUrl,
      getToken: () => token,
      onHint: (orderId) => void handleOrderHint(queryClient, orderId),
      onStatus: setStatus,
    });
    return () => connection.close();
  }, [realtimeUrl, token, queryClient]);

  return status;
}
