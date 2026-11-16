import {
  AdminOrderRow,
  ApiErrorBody,
  type ErrorCode,
  Me,
  Order,
  OtpRequestResponse,
  type PlaceOrderBody,
  RestaurantDetail,
  RestaurantListResponse,
  RiderOffer,
  SessionResponse,
} from '@oregano/contracts';
import type { ReadyMinutes, RejectReason } from '@oregano/domain';
import { z } from 'zod';

/** Every failure the client reports: an error body from the API, a broken contract, or no network (status 0). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly requestId: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type ApiClient = {
  requestOtp(phone: string): Promise<OtpRequestResponse>;
  verifyOtp(phone: string, code: string): Promise<SessionResponse>;
  logout(): Promise<void>;
  me(): Promise<Me>;
  restaurants(at?: { lat: number; lng: number }): Promise<RestaurantListResponse>;
  restaurant(slug: string): Promise<RestaurantDetail>;
  placeOrder(body: PlaceOrderBody, idempotencyKey: string): Promise<Order>;
  myOrders(): Promise<Order[]>;
  order(id: string): Promise<Order>;
  cancelOrder(id: string): Promise<Order>;
  restaurantOrders(): Promise<Order[]>;
  acceptOrder(id: string, readyInMinutes: ReadyMinutes): Promise<Order>;
  rejectOrder(id: string, reason: RejectReason): Promise<Order>;
  markReady(id: string): Promise<Order>;
  setOnline(online: boolean): Promise<Me>;
  offers(): Promise<RiderOffer[]>;
  riderOrders(): Promise<Order[]>;
  claimOrder(id: string): Promise<Order>;
  pickUp(id: string): Promise<Order>;
  deliver(id: string): Promise<Order>;
  adminOrders(): Promise<AdminOrderRow[]>;
};

const Orders = z.object({ orders: z.array(Order) });
const Offers = z.object({ offers: z.array(RiderOffer) });
const AdminOrders = z.object({ orders: z.array(AdminOrderRow) });

type Request = { method: 'GET' | 'POST'; path: string; body?: unknown; headers?: Record<string, string> };

const DEFAULT_TIMEOUT_MS = 15_000;

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  // Older React Native engines lack AbortSignal.timeout.
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/** No response, a dropped connection or a timeout: all are status 0, which the apps show as offline. */
function networkError(error: unknown, signal: AbortSignal): ApiError {
  const message = signal.aborted
    ? 'The request timed out'
    : error instanceof Error
      ? error.message
      : 'Network request failed';
  return new ApiError(0, 'internal', message, '');
}

export function createApiClient(opts: {
  baseUrl: string;
  getToken: () => string | null;
  fetch?: typeof fetch;
  /** Abort a request (including reading its body) after this long; a weak 3G link must not spin forever. */
  timeoutMs?: number;
}): ApiClient {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const doFetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function send(req: Request): Promise<{ status: number; requestId: string; json: unknown }> {
    const headers: Record<string, string> = { accept: 'application/json', ...req.headers };
    const token = opts.getToken();
    if (token) headers.authorization = `Bearer ${token}`;
    // Fastify rejects an empty body sent as JSON, so the content type goes only with a body.
    if (req.body !== undefined) headers['content-type'] = 'application/json';

    const signal = timeoutSignal(timeoutMs);
    let res: Response;
    try {
      res = await doFetch(`${base}${req.path}`, {
        method: req.method,
        headers,
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        signal,
      });
    } catch (error) {
      throw networkError(error, signal);
    }

    const requestId = res.headers.get('x-request-id') ?? '';
    let text: string;
    try {
      text = await res.text();
    } catch (error) {
      throw networkError(error, signal);
    }
    let json: unknown = null;
    if (text !== '') {
      try {
        json = JSON.parse(text);
      } catch {
        throw new ApiError(res.status, 'internal', 'The server sent a response that is not JSON', requestId);
      }
    }

    if (!res.ok) {
      const parsed = ApiErrorBody.safeParse(json);
      if (parsed.success) {
        const { code, message, requestId: id } = parsed.data.error;
        throw new ApiError(res.status, code, message, id);
      }
      throw new ApiError(res.status, 'internal', `Request failed with status ${res.status}`, requestId);
    }
    return { status: res.status, requestId, json };
  }

  async function call<T>(schema: z.ZodType<T>, req: Request): Promise<T> {
    const { status, requestId, json } = await send(req);
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError(status, 'internal', `The response to ${req.method} ${req.path} broke its contract`, requestId);
    }
    return parsed.data;
  }

  const get = <T>(schema: z.ZodType<T>, path: string) => call(schema, { method: 'GET', path });
  const post = <T>(schema: z.ZodType<T>, path: string, body?: unknown) => call(schema, { method: 'POST', path, body });
  const id = encodeURIComponent;

  return {
    requestOtp: (phone) => post(OtpRequestResponse, '/v1/auth/otp/request', { phone }),
    verifyOtp: (phone, code) => post(SessionResponse, '/v1/auth/otp/verify', { phone, code }),
    logout: async () => {
      await send({ method: 'POST', path: '/v1/auth/logout' });
    },
    me: () => get(Me, '/v1/me'),
    restaurants: (at) =>
      get(
        RestaurantListResponse,
        at ? `/v1/restaurants?${new URLSearchParams({ lat: String(at.lat), lng: String(at.lng) })}` : '/v1/restaurants',
      ),
    restaurant: (slug) => get(RestaurantDetail, `/v1/restaurants/${id(slug)}`),
    placeOrder: (body, idempotencyKey) =>
      call(Order, { method: 'POST', path: '/v1/orders', body, headers: { 'idempotency-key': idempotencyKey } }),
    myOrders: async () => (await get(Orders, '/v1/orders')).orders,
    order: (orderId) => get(Order, `/v1/orders/${id(orderId)}`),
    cancelOrder: (orderId) => post(Order, `/v1/orders/${id(orderId)}/cancel`),
    restaurantOrders: async () => (await get(Orders, '/v1/restaurant/orders')).orders,
    acceptOrder: (orderId, readyInMinutes) =>
      post(Order, `/v1/restaurant/orders/${id(orderId)}/accept`, { readyInMinutes }),
    rejectOrder: (orderId, reason) => post(Order, `/v1/restaurant/orders/${id(orderId)}/reject`, { reason }),
    markReady: (orderId) => post(Order, `/v1/restaurant/orders/${id(orderId)}/ready`),
    setOnline: (online) => post(Me, '/v1/rider/online', { online }),
    offers: async () => (await get(Offers, '/v1/rider/offers')).offers,
    riderOrders: async () => (await get(Orders, '/v1/rider/orders')).orders,
    claimOrder: (orderId) => post(Order, `/v1/rider/orders/${id(orderId)}/claim`),
    pickUp: (orderId) => post(Order, `/v1/rider/orders/${id(orderId)}/pick-up`),
    deliver: (orderId) => post(Order, `/v1/rider/orders/${id(orderId)}/deliver`),
    adminOrders: async () => (await get(AdminOrders, '/v1/admin/orders')).orders,
  };
}

/** A fresh key for one checkout attempt; reuse it when retrying the same attempt. */
export function newIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  // Some React Native engines lack randomUUID; a key only has to be unique, not secret.
  const bytes = new Uint8Array(16);
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
