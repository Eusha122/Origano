import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectRealtime, type RealtimeStatus } from './index';

/** A stand-in socket that records instances so a test can open, message and drop them. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const Impl = FakeSocket as unknown as typeof WebSocket;
const ORDER = '7f0c6d3e-1b2a-4c5d-8e9f-0a1b2c3d4e5f';

describe('connectRealtime with a fake socket', () => {
  afterEach(() => {
    FakeSocket.instances = [];
    vi.useRealTimers();
  });

  it('does not connect or retry without a token', () => {
    vi.useFakeTimers();
    const statuses: RealtimeStatus[] = [];
    connectRealtime({
      url: 'ws://x',
      getToken: () => null,
      onHint: () => {},
      onStatus: (s) => statuses.push(s),
      WebSocketImpl: Impl,
    });
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(0);
    expect(statuses).toEqual(['offline']);
  });

  it('authenticates, reports hints, backs off 1 then 2 seconds, and stops after close', () => {
    vi.useFakeTimers();
    const statuses: RealtimeStatus[] = [];
    const hints: string[] = [];
    const conn = connectRealtime({
      url: 'ws://x',
      getToken: () => 'tok',
      onHint: (id) => hints.push(id),
      onStatus: (s) => statuses.push(s),
      WebSocketImpl: Impl,
    });
    const first = FakeSocket.instances[0];
    if (!first) throw new Error('no socket');
    first.open();
    expect(first.sent).toEqual([JSON.stringify({ type: 'auth', token: 'tok' })]);
    first.receive({ type: 'ready' });
    first.receive({ type: 'order.changed', orderId: ORDER });
    expect(hints).toEqual([ORDER]);

    first.drop();
    vi.advanceTimersByTime(999);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.instances[1]?.drop();
    vi.advanceTimersByTime(1999);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(3);

    FakeSocket.instances[2]?.drop();
    conn.close();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
    expect(statuses).toEqual(['connecting', 'live', 'offline', 'connecting', 'offline', 'connecting', 'offline']);
  });
});
