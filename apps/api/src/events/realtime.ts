import websocket from '@fastify/websocket';
import { RealtimeClientMessage, type RealtimeServerMessage } from '@oregano/contracts';
import { teamCan } from '@oregano/domain';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { AuthUser } from '../identity/sessions';
import type { OrderChangedPayload } from './outbox';
import { EVENTS_CHANNEL } from './relay';

const AUTH_TIMEOUT_MS = 5000;
const PING_MS = 25_000;

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
  return offerable && user.rider?.status === 'approved' && user.rider.zoneId === event.zoneId;
}

type Connection = { socket: WebSocket; user: AuthUser };

export class RealtimeHub {
  private subscriber: Redis | undefined;
  private readonly connections = new Set<Connection>();
  private readonly sockets = new Set<WebSocket>();

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
    let parsed: z.infer<typeof OrderChanged>;
    try {
      parsed = OrderChanged.parse(JSON.parse(message));
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

  register(app: FastifyInstance, authenticate: (token: string) => Promise<AuthUser | null>): void {
    app.register(async (scope) => {
      await scope.register(websocket, { options: { maxPayload: 4096 } });
      scope.get('/v1/realtime', { websocket: true }, (socket) => {
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
          if (connection) this.connections.delete(connection);
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
            (user) => {
              if (socket.readyState !== socket.OPEN) return;
              if (!user) {
                socket.close(4401, 'invalid token');
                return;
              }
              clearTimeout(authTimer);
              connection = { socket, user };
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
