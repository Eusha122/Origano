import {
  AdminOrderRow,
  ApiErrorBody,
  DocumentSummary,
  type ErrorCode,
  Me,
  Order,
  OtpRequestResponse,
  type PlaceOrderBody,
  RefreshResponse,
  type RestaurantApplicationBody,
  RestaurantApplicationView,
  RestaurantDetail,
  RestaurantListResponse,
  type RiderApplicationBody,
  RiderApplicationView,
  RiderInvite,
  RiderOffer,
  RiderZone,
  SessionResponse,
  StaffMember,
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

/**
 * Where the session lives. In browser mode the refresh token is an httpOnly cookie the page cannot read, so
 * `getRefreshToken` is always null and requests to /v1/auth/ carry credentials. In body mode (native apps)
 * the client keeps and sends the refresh token itself.
 */
export type SessionStore = {
  mode: 'cookie' | 'body';
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  save(tokens: { accessToken: string; refreshToken: string | null }): void;
  clear(): void;
  /** True when a session probably exists although no access token is held yet (a browser after a reload). */
  hasSession?(): boolean;
};

/** A store that keeps tokens in memory only. */
export function createMemorySessionStore(mode: SessionStore['mode'] = 'body'): SessionStore {
  let access: string | null = null;
  let refresh: string | null = null;
  return {
    mode,
    getAccessToken: () => access,
    getRefreshToken: () => refresh,
    save: (tokens) => {
      access = tokens.accessToken;
      refresh = tokens.refreshToken;
    },
    clear: () => {
      access = null;
      refresh = null;
    },
    hasSession: () => access !== null || refresh !== null,
  };
}

/**
 * A file to upload. On the web it is the picked `File`; on a phone it is the asset's local uri with a name and type,
 * which React Native's FormData sends as a file part.
 */
export type UploadFile = Blob | { uri: string; name: string; type: string };

export type ApiClient = {
  /** Trades the refresh token for new tokens. False means the session is over and the user must sign in. */
  refresh(): Promise<boolean>;
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
  /** The caller's restaurant application, or null when they have not started one. */
  restaurantApplication(): Promise<RestaurantApplicationView | null>;
  saveRestaurantApplication(body: RestaurantApplicationBody): Promise<RestaurantApplicationView>;
  uploadRestaurantDocument(kind: string, file: UploadFile): Promise<DocumentSummary>;
  submitRestaurantApplication(noTradeLicence: boolean): Promise<RestaurantApplicationView>;
  staff(restaurantId: string): Promise<StaffMember[]>;
  addStaff(restaurantId: string, phone: string): Promise<StaffMember>;
  removeStaff(restaurantId: string, userId: string): Promise<void>;
  riderInvites(restaurantId: string): Promise<RiderInvite[]>;
  addRiderInvite(restaurantId: string, phone: string): Promise<RiderInvite>;
  removeRiderInvite(restaurantId: string, phone: string): Promise<void>;
  /** The areas a rider can apply in. */
  zones(): Promise<RiderZone[]>;
  /** The caller's rider application, or null when they have not started one. */
  riderApplication(): Promise<RiderApplicationView | null>;
  saveRiderApplication(body: RiderApplicationBody): Promise<RiderApplicationView>;
  uploadRiderDocument(kind: string, file: UploadFile): Promise<DocumentSummary>;
  submitRiderApplication(): Promise<RiderApplicationView>;
};

const Orders = z.object({ orders: z.array(Order) });
const Offers = z.object({ offers: z.array(RiderOffer) });
const AdminOrders = z.object({ orders: z.array(AdminOrderRow) });
const Staff = z.object({ members: z.array(StaffMember) });
const RiderInvites = z.object({ invites: z.array(RiderInvite) });
const Zones = z.object({ zones: z.array(RiderZone) });

type Request = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  /** A file upload. Sent as multipart; the content type is left to the platform, which adds the boundary. */
  form?: FormData;
  headers?: Record<string, string>;
};

type RefreshOutcome = 'ok' | 'signed_out' | 'offline';

const AUTH_PREFIX = '/v1/auth/';

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
  session: SessionStore;
  /** Called once when the session ends: the refresh was refused, so the user must sign in again. */
  onSignedOut?: () => void;
  fetch?: typeof fetch;
  /** Abort a request (including reading its body) after this long; a weak 3G link must not spin forever. */
  timeoutMs?: number;
}): ApiClient {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const doFetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const { session } = opts;

  async function sendOnce(req: Request): Promise<{ status: number; requestId: string; json: unknown }> {
    const headers: Record<string, string> = { accept: 'application/json', ...req.headers };
    const token = session.getAccessToken();
    if (token) headers.authorization = `Bearer ${token}`;
    // Only the auth routes see the refresh cookie, and they insist on this header as CSRF protection.
    const browserAuth = session.mode === 'cookie' && req.path.startsWith(AUTH_PREFIX);
    if (browserAuth) headers['x-oregano-client'] = 'web';
    // Fastify rejects an empty body sent as JSON, so the content type goes only with a body.
    if (req.body !== undefined) headers['content-type'] = 'application/json';

    const signal = timeoutSignal(timeoutMs);
    let res: Response;
    try {
      res = await doFetch(`${base}${req.path}`, {
        method: req.method,
        headers,
        body: req.form ?? (req.body === undefined ? undefined : JSON.stringify(req.body)),
        ...(browserAuth ? { credentials: 'include' as const } : {}),
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

  /** In browser mode the page must never hold the refresh token, whatever the server sent. */
  function saveTokens(accessToken: string, refreshToken: string | null): void {
    session.save({ accessToken, refreshToken: session.mode === 'cookie' ? null : refreshToken });
  }

  let refreshing: Promise<RefreshOutcome> | null = null;

  function endSession(): void {
    session.clear();
    opts.onSignedOut?.();
  }

  async function doRefresh(): Promise<RefreshOutcome> {
    const cookie = session.mode === 'cookie';
    const refreshToken = session.getRefreshToken();
    if (!cookie && !refreshToken) {
      endSession();
      return 'signed_out';
    }
    try {
      const { json } = await sendOnce({
        method: 'POST',
        path: `${AUTH_PREFIX}refresh`,
        ...(cookie ? {} : { body: { refreshToken } }),
      });
      const parsed = RefreshResponse.safeParse(json);
      if (!parsed.success) return 'offline';
      saveTokens(parsed.data.accessToken, parsed.data.refreshToken);
      return 'ok';
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        endSession();
        return 'signed_out';
      }
      // No answer, or a server fault: the session may be fine, so keep it and let the caller try later.
      return 'offline';
    }
  }

  /** One refresh at a time: every request that finds its token expired waits for the same answer. */
  function refreshOnce(): Promise<RefreshOutcome> {
    refreshing ??= doRefresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  /** Sends the request; if the access token has expired, refreshes once and sends the same request again. */
  async function send(req: Request): Promise<{ status: number; requestId: string; json: unknown }> {
    try {
      return await sendOnce(req);
    } catch (error) {
      const hasSession = session.getAccessToken() !== null || session.hasSession?.() === true;
      if (!(error instanceof ApiError) || error.status !== 401 || req.path.startsWith(AUTH_PREFIX) || !hasSession) {
        throw error;
      }
      const outcome = await refreshOnce();
      if (outcome === 'signed_out') throw error;
      if (outcome === 'offline') throw new ApiError(0, 'internal', 'The session could not be renewed', '');
      return sendOnce(req);
    }
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
  const put = <T>(schema: z.ZodType<T>, path: string, body?: unknown) => call(schema, { method: 'PUT', path, body });
  /** A DELETE answers 204 with no body. */
  const remove = async (path: string): Promise<void> => {
    await send({ method: 'DELETE', path });
  };
  const upload = <T>(schema: z.ZodType<T>, path: string, file: UploadFile) => {
    const form = new FormData();
    // React Native's FormData takes the { uri, name, type } object as a file; the web takes a Blob.
    form.append('file', file as Blob);
    return call(schema, { method: 'POST', path, form });
  };
  const id = encodeURIComponent;

  return {
    refresh: async () => (await refreshOnce()) === 'ok',
    requestOtp: (phone) => post(OtpRequestResponse, '/v1/auth/otp/request', { phone }),
    verifyOtp: async (phone, code) => {
      const result = await post(SessionResponse, '/v1/auth/otp/verify', { phone, code });
      saveTokens(result.accessToken, result.refreshToken);
      return result;
    },
    logout: async () => {
      const refreshToken = session.getRefreshToken();
      try {
        await send({ method: 'POST', path: '/v1/auth/logout', ...(refreshToken ? { body: { refreshToken } } : {}) });
      } finally {
        // Signing out locally must work even offline or with an already expired token.
        session.clear();
      }
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
    restaurantApplication: async () => {
      try {
        return await get(RestaurantApplicationView, '/v1/onboarding/restaurant-application');
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    saveRestaurantApplication: (body) => put(RestaurantApplicationView, '/v1/onboarding/restaurant-application', body),
    uploadRestaurantDocument: (kind, file) =>
      upload(DocumentSummary, `/v1/onboarding/restaurant-application/documents/${id(kind)}`, file),
    submitRestaurantApplication: (noTradeLicence) =>
      post(RestaurantApplicationView, '/v1/onboarding/restaurant-application/submit', { noTradeLicence }),
    staff: async (restaurantId) => (await get(Staff, `/v1/restaurant/${id(restaurantId)}/staff`)).members,
    addStaff: (restaurantId, phone) => post(StaffMember, `/v1/restaurant/${id(restaurantId)}/staff`, { phone }),
    removeStaff: (restaurantId, userId) => remove(`/v1/restaurant/${id(restaurantId)}/staff/${id(userId)}`),
    riderInvites: async (restaurantId) =>
      (await get(RiderInvites, `/v1/restaurant/${id(restaurantId)}/rider-invites`)).invites,
    addRiderInvite: (restaurantId, phone) =>
      post(RiderInvite, `/v1/restaurant/${id(restaurantId)}/rider-invites`, { phone }),
    removeRiderInvite: (restaurantId, phone) => remove(`/v1/restaurant/${id(restaurantId)}/rider-invites/${id(phone)}`),
    zones: async () => (await get(Zones, '/v1/zones')).zones,
    riderApplication: async () => {
      try {
        return await get(RiderApplicationView, '/v1/onboarding/rider');
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    saveRiderApplication: (body) => put(RiderApplicationView, '/v1/onboarding/rider', body),
    uploadRiderDocument: (kind, file) => upload(DocumentSummary, `/v1/onboarding/rider/documents/${id(kind)}`, file),
    submitRiderApplication: () => post(RiderApplicationView, '/v1/onboarding/rider/submit'),
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
