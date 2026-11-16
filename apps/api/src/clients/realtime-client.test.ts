import type { AddressInfo, Socket } from 'node:net';
import { connectRealtime, type RealtimeStatus } from '@oregano/api-client';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EVENTS_CHANNEL } from '../events/relay';
import { withTestApp } from '../testing/app';

const FIRST = '7f0c6d3e-1b2a-4c5d-8e9f-0a1b2c3d4e5f';
const SECOND = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';

describe('realtime client against the real hub', () => {
  const t = withTestApp({ realtime: true });
  let publisher: Redis;
  beforeAll(() => {
    publisher = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  });
  afterAll(async () => {
    await publisher.quit();
  });

  const hint = (orderId: string) =>
    publisher.publish(
      EVENTS_CHANNEL,
      JSON.stringify({
        orderId,
        customerId: t.demo().customerId,
        restaurantId: 'r-x',
        riderId: null,
        zoneId: 'z-x',
        status: 'placed',
      }),
    );

  it('authenticates, receives hints, and reconnects after the server drops the connection', async () => {
    const token = await t.signIn('01711000001');
    const statuses: RealtimeStatus[] = [];
    const hints: string[] = [];
    const port = (t.app().server.address() as AddressInfo).port;
    // The hub's websocket server lives in an encapsulated plugin scope, so the test keeps the raw
    // TCP sockets the HTTP server upgrades and destroys them to drop connections from the server side.
    const upgraded: Socket[] = [];
    const track = (_req: unknown, socket: Socket) => upgraded.push(socket);
    t.app().server.on('upgrade', track);
    const connection = connectRealtime({
      url: `ws://127.0.0.1:${port}/v1/realtime`,
      getToken: () => token,
      onHint: (id) => hints.push(id),
      onStatus: (s) => statuses.push(s),
    });
    try {
      await expect.poll(() => statuses.at(-1)).toBe('live');
      await hint(FIRST);
      await expect.poll(() => hints).toEqual([FIRST]);

      // The server drops every socket, as a restart or a network cut would.
      expect(upgraded).toHaveLength(1);
      for (const socket of upgraded) socket.destroy();
      await expect.poll(() => statuses.includes('offline')).toBe(true);
      await expect.poll(() => statuses.at(-1), { timeout: 3000 }).toBe('live');
      await hint(SECOND);
      await expect.poll(() => hints, { timeout: 3000 }).toEqual([FIRST, SECOND]);
      expect(statuses).toEqual(['connecting', 'live', 'offline', 'connecting', 'live']);
    } finally {
      connection.close();
      t.app().server.off('upgrade', track);
    }
  });
});
