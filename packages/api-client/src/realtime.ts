import { RealtimeServerMessage } from '@oregano/contracts';

export type RealtimeStatus = 'connecting' | 'live' | 'offline';

/** Seconds to wait before each reconnect attempt; the last value repeats forever. */
export const RECONNECT_BACKOFF_SECONDS = [1, 2, 4, 8, 15] as const;

/**
 * Keeps one authenticated WebSocket open to /v1/realtime and reports order hints.
 * Hints only say "this order changed"; callers refetch. Reconnects with backoff until close().
 * With no token there is nothing to authenticate, so it stays offline and does not retry;
 * the caller reconnects by calling connectRealtime again once a token exists.
 */
export function connectRealtime(opts: {
  url: string;
  getToken: () => string | null;
  onHint: (orderId: string) => void;
  onStatus?: (s: RealtimeStatus) => void;
  WebSocketImpl?: typeof WebSocket;
}): { close: () => void } {
  const Impl = opts.WebSocketImpl ?? globalThis.WebSocket;
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let closed = false;
  let status: RealtimeStatus | null = null;

  const setStatus = (next: RealtimeStatus) => {
    if (closed || next === status) return;
    status = next;
    opts.onStatus?.(next);
  };

  const scheduleReconnect = () => {
    const seconds = RECONNECT_BACKOFF_SECONDS[Math.min(attempt, RECONNECT_BACKOFF_SECONDS.length - 1)] ?? 15;
    attempt += 1;
    timer = setTimeout(connect, seconds * 1000);
  };

  function connect(): void {
    timer = null;
    if (closed) return;
    const token = opts.getToken();
    if (!token) {
      setStatus('offline');
      return;
    }
    setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new Impl(opts.url);
    } catch {
      setStatus('offline');
      scheduleReconnect();
      return;
    }
    socket = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      let raw: unknown;
      try {
        raw = JSON.parse(event.data);
      } catch {
        return;
      }
      const parsed = RealtimeServerMessage.safeParse(raw);
      if (!parsed.success) return;
      if (parsed.data.type === 'ready') {
        attempt = 0;
        setStatus('live');
      } else if (!closed) {
        opts.onHint(parsed.data.orderId);
      }
    };
    // A failed socket always closes afterwards, so reconnecting happens in onclose only.
    ws.onerror = () => {};
    ws.onclose = () => {
      if (socket === ws) socket = null;
      if (closed) return;
      setStatus('offline');
      scheduleReconnect();
    };
  }

  connect();

  return {
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      const ws = socket;
      socket = null;
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        if (ws.readyState === ws.CONNECTING || ws.readyState === ws.OPEN) ws.close();
      }
    },
  };
}
