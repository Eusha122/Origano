import websocket from '@fastify/websocket';
import { RealtimeClientMessage, type RealtimeServerMessage } from '@oregano/contracts';
import { teamCan } from '@oregano/domain';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import { riderCanWork } from '../identity/auth';
import type { AuthUser, authenticateAccess } from '../identity/sessions';
import type { OrderChangedPayload } from './outbox';
import { EVENTS_CHANNEL } from './relay';

const AUTH_TIMEOUT_MS = 5000;
const PING_MS = 25_000;

/** What the relay publishes: a topic, then its payload. */
const Envelope = z.object({ topic: z.string(), payload: z.unknown() });
const SessionRevoked = z.object({ sessionId: z.string() });
const AccessChanged = z.object({ userId: z.string() });

const OrderChanged = z.object({
  orderId: z.string(),
  customerId: z.string(),
  restaurantId: z.string(),
  riderId: z.string().nullable(),
  zoneId: z.string(),
  status: z.string(),
});

/** Who may be told that an order changed. */
export function audienceIncludes(user: AuthUser, event: OrderChangedPayload): boolean {
  if (teamCan(user.teamRoles, 'orders.read')) return true;
  if (user.id === event.customerId) return true;
  if (user.restaurantIds.includes(event.restaurantId)) return true;
  if (event.riderId !== null) return user.id === event.riderId;
  const offerable = event.status === 'preparing' || event.status === 'ready';
  if (!offerable || !riderCanWork(user.rider) || user.rider?.zoneId !== event.zoneId) return false;
  // A restaurant's own rider hears only about that restaurant's orders.
  return user.rider.restaurantId === null || user.rider.restaurantId === event.restaurantId;
}

type Connection = { socket: WebSocket; user: AuthUser; sessionId: string; expiryTimer: NodeJS.Timeout };

const CLOSE_AUTH = 4401;

/** Longest delay setTimeout accepts. */
const MAX_TIMER_MS = 2 ** 31 - 1;

export class RealtimeHub {
  private subscriber: Redis | undefined;
  private readonly connections = new Set<Connection>();
  private readonly sockets = new Set<WebSocket>();
  /** Open connections per client address, for the cap. */
  private readonly perClient = new Map<string, number>();
  /** Sessions revoked in the last minute, for a socket whose authentication was already under way. */
  private readonly recentlyRevoked = new Map<string, number>();

  constructor(private readonly redisUrl: string) {}

  async start(): Promise<void> {
    const subscriber = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
    subscriber.on('error', (error) => console.error('realtime redis error', error.message));
    subscriber.on('message', (_channel, message) => this.dispatch(message));
    await subscriber.subscribe(EVENTS_CHANNEL);
    this.subscriber = subscriber;
  }

  async stop(): Promise<void> {
    this.subscriber?.disconnect();
    this.subscriber = undefined;
    for (const socket of this.sockets) socket.terminate();
    this.sockets.clear();
    this.connections.clear();
  }

  private dispatch(message: string): void {
    let envelope: z.infer<typeof Envelope>;
    try {
      envelope = Envelope.parse(JSON.parse(message));
    } catch {
      return;
    }
    if (envelope.topic === 'order.changed') this.dispatchOrderChanged(envelope.payload);
    else if (envelope.topic === 'session.revoked') {
      const revoked = SessionRevoked.safeParse(envelope.payload);
      if (revoked.success) {
        this.noteRevoked(revoked.data.sessionId);
        this.closeWhere((c) => c.sessionId === revoked.data.sessionId);
      }
    } else if (envelope.topic === 'user.access_changed') {
      // Roles, staff membership or rider status changed: reconnecting reloads who this user is.
      const changed = AccessChanged.safeParse(envelope.payload);
      if (changed.success) this.closeWhere((c) => c.user.id === changed.data.userId);
    }
  }

  private noteRevoked(sessionId: string): void {
    const now = Date.now();
    for (const [id, at] of this.recentlyRevoked) if (now - at > 60_000) this.recentlyRevoked.delete(id);
    this.recentlyRevoked.set(sessionId, now);
  }

  /** A closed socket reconnects with a fresh token, which is how a revoked or expired session stops hearing hints. */
  private closeWhere(match: (connection: Connection) => boolean): void {
    for (const connection of [...this.connections]) {
      if (match(connection)) connection.socket.close(CLOSE_AUTH, 'session ended');
    }
  }

  private dispatchOrderChanged(payload: unknown): void {
    let parsed: z.infer<typeof OrderChanged>;
    try {
      parsed = OrderChanged.parse(payload);
    } catch {
      return;
    }
    const event = parsed as OrderChangedPayload;
    for (const { socket, user } of this.connections) {
      if (socket.readyState === socket.OPEN && audienceIncludes(user, event)) {
        // A hint carries only the order id; the client refetches the details.
        this.send(socket, { type: 'order.changed', orderId: event.orderId });
      }
    }
  }

  private send(socket: WebSocket, message: RealtimeServerMessage): void {
    socket.send(JSON.stringify(message));
  }

  register(
    app: FastifyInstance,
    authenticate: (token: string) => ReturnType<typeof authenticateAccess>,
    caps: { maxPerIp: number; clientKey: (ip: string) => string },
  ): void {
    app.register(async (scope) => {
      await scope.register(websocket, { options: { maxPayload: 4096 } });
      scope.get('/v1/realtime', { websocket: true }, (socket, request) => {
        // One address may hold only so many connections to this API instance.
        const client = caps.clientKey(request.ip);
        const open = this.perClient.get(client) ?? 0;
        if (open >= caps.maxPerIp) {
          socket.close(4429, 'too many connections');
          return;
        }
        this.perClient.set(client, open + 1);
        socket.once('close', () => {
          const left = (this.perClient.get(client) ?? 1) - 1;
          if (left <= 0) this.perClient.delete(client);
          else this.perClient.set(client, left);
        });
        this.sockets.add(socket);
        let state: 'waiting' | 'authenticating' | 'ready' = 'waiting';
        let connection: Connection | undefined;
        const authTimer = setTimeout(() => {
          if (state !== 'ready') socket.close(4401, 'auth required');
        }, AUTH_TIMEOUT_MS);
        const pingTimer = setInterval(() => {
          if (socket.readyState === socket.OPEN) socket.ping();
        }, PING_MS);

        socket.on('close', () => {
          clearTimeout(authTimer);
          clearInterval(pingTimer);
          this.sockets.delete(socket);
          if (connection) {
            clearTimeout(connection.expiryTimer);
            this.connections.delete(connection);
          }
        });
        socket.on('error', () => socket.terminate());
        socket.on('message', (data) => {
          let message: RealtimeClientMessage;
          try {
            message = RealtimeClientMessage.parse(JSON.parse(String(data)));
          } catch {
            socket.close(4400, 'bad message');
            return;
          }
          if (state !== 'waiting') return;
          state = 'authenticating';
          authenticate(message.token).then(
            (live) => {
              if (socket.readyState !== socket.OPEN) return;
              if (!live) {
                socket.close(CLOSE_AUTH, 'invalid token');
                return;
              }
              if (this.recentlyRevoked.has(live.sessionId)) {
                socket.close(CLOSE_AUTH, 'session ended');
                return;
              }
              clearTimeout(authTimer);
              // The socket outlives nothing it was not allowed to: it closes when the access token does.
              const expiryTimer = setTimeout(
                () => socket.close(CLOSE_AUTH, 'token expired'),
                Math.min(Math.max(live.expiresAt.getTime() - Date.now(), 0), MAX_TIMER_MS),
              );
              connection = { socket, user: live.user, sessionId: live.sessionId, expiryTimer };
              this.connections.add(connection);
              state = 'ready';
              this.send(socket, { type: 'ready' });
            },
            () => socket.close(1011, 'error'),
          );
        });
      });
    });
  }
}
