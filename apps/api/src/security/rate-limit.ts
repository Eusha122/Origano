import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type { Limits } from '../config';
import { AppError } from '../errors';
import { hashIp, subkey } from './crypto';

type Check = ReturnType<FastifyInstance['createRateLimit']>;

type Rule = {
  name: string;
  applies: (request: FastifyRequest) => boolean;
  /** Who is counted: an address or a user. Null means this request is not counted by this rule. */
  key: (request: FastifyRequest) => string | null;
  check: Check;
};

const WRITE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MINUTE = 60_000;
const HEALTH_ROUTES: ReadonlySet<string> = new Set(['/healthz', '/readyz']);
const route = (request: FastifyRequest): string => request.routeOptions.url ?? '';

/**
 * Per-address and per-user limits on every route, counted in Redis. If Redis is down the limits fail open
 * (ordering must keep working, blueprint section 8) and a warning is logged. The OTP limits do not live
 * here: they guard SMS money and are counted in PostgreSQL.
 *
 * Address rules run first, before any database lookup; user rules run after authentication. The health
 * checks are never limited.
 */
export async function registerRateLimits(
  app: FastifyInstance,
  deps: { redis: Redis; limits: Limits; prefix: string; otpSecret: string },
): Promise<void> {
  const { limits, prefix } = deps;
  await app.register(rateLimit, { global: false, redis: deps.redis, nameSpace: `${prefix}-rl-`, skipOnError: true });

  const ipKey = subkey(deps.otpSecret, 'ip-hash');
  const byIp = (request: FastifyRequest): string => `ip:${hashIp(ipKey, request.ip)}`;
  const byUser = (request: FastifyRequest): string | null => (request.user ? `u:${request.user.id}` : null);

  const make = (name: string, max: number, windowMs: number, applies: Rule['applies'], key: Rule['key']): Rule => ({
    name,
    applies,
    key,
    check: app.createRateLimit({
      max,
      timeWindow: windowMs,
      skipOnError: true,
      // A different counter for every rule, so one rule's traffic never uses up another's.
      keyGenerator: (request: FastifyRequest) => `${name}:${key(request) ?? 'none'}`,
    }),
  });

  const addressRules: Rule[] = [
    make('ip', limits.routePerIpMinute, MINUTE, () => true, byIp),
    make(
      'restaurants',
      limits.restaurantListPerIpMinute,
      MINUTE,
      (r) => r.method === 'GET' && route(r).startsWith('/v1/restaurants'),
      byIp,
    ),
    make(
      'refresh',
      limits.refreshPerIpMinute,
      MINUTE,
      (r) => r.method === 'POST' && route(r) === '/v1/auth/refresh',
      byIp,
    ),
    make(
      'ws-upgrade',
      limits.wsUpgradesPerIpMinute,
      MINUTE,
      (r) => r.method === 'GET' && route(r) === '/v1/realtime',
      byIp,
    ),
  ];
  const userRules: Rule[] = [
    make('writes', limits.writesPerUserMinute, MINUTE, (r) => WRITE_METHODS.has(r.method), byUser),
    make(
      'orders',
      limits.ordersPerUserTenMinutes,
      10 * MINUTE,
      (r) => r.method === 'POST' && route(r) === '/v1/orders',
      byUser,
    ),
    make(
      'uploads',
      limits.uploadsPerUserHour,
      60 * MINUTE,
      (r) => r.method === 'POST' && route(r).includes('/documents/'),
      byUser,
    ),
  ];

  let lastWarning = 0;
  const enforce = async (request: FastifyRequest, rules: Rule[]): Promise<void> => {
    // Health checks are for the load balancer: never limited.
    if (HEALTH_ROUTES.has(route(request))) return;
    for (const rule of rules) {
      if (!rule.applies(request) || rule.key(request) === null) continue;
      let limit: Awaited<ReturnType<Check>>;
      try {
        limit = await rule.check(request);
      } catch (error) {
        if (Date.now() - lastWarning > MINUTE) {
          lastWarning = Date.now();
          request.log.warn({ err: error, rule: rule.name }, 'rate limits are not being enforced: the store failed');
        }
        continue;
      }
      if (!limit.isAllowed && limit.isExceeded) {
        throw new AppError(
          'rate_limited',
          429,
          'Too many requests. Wait a minute and try again.',
          Math.max(1, limit.ttlInSeconds),
        );
      }
    }
  };

  app.addHook('onRequest', (request) => enforce(request, addressRules));
  app.addHook('preHandler', (request) => enforce(request, userRules));
}
