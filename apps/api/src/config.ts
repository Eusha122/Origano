import { z } from 'zod';

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  redisUrl: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  otpSecret: string;
  session: SessionLimits;
  corsOrigins: string[];
  devOtpPeek: boolean;
  /** Addresses of the proxies in front of the API whose X-Forwarded-For may be believed; false trusts none. */
  trustProxy: string[] | false;
  /** Master keys for sealing SMS text, payout numbers and documents. The first one seals new data. */
  dataKeys: { active: string; keys: Map<string, Buffer> };
  limitsProfile: 'standard' | 'relaxed';
  limits: Limits;
  smsProviders: string[];
  /** Prefix for Redis rate-limit keys, so test runs never share counters. */
  rateLimitPrefix: string;
  webOtpDomain: string | null;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  };
};

export type SessionLimits = {
  /** Access token lifetime. */
  accessSeconds: number;
  /** Refresh token lifetime, renewed on every use. */
  refreshDays: number;
  /** A session's longest life, however often it is refreshed. */
  absoluteDays: number;
  /** The same, for a team member. */
  teamAbsoluteHours: number;
  /** How long a just-replaced refresh token may be answered again. */
  reuseGraceSeconds: number;
};

export type Limits = {
  readonly otpTtlSeconds: number;
  readonly otpResendSeconds: number;
  readonly otpMaxAttempts: number;
  readonly otpSendsPerPhoneHour: number;
  readonly otpSendsPerPhoneDay: number;
  readonly otpSendsPerIpHour: number;
  readonly otpSendsPerIpDay: number;
  readonly otpSendsGlobalHour: number;
  readonly otpFailuresPerPhoneDay: number;
  readonly otpFailuresPerIpHour: number;
  readonly routePerIpMinute: number;
  readonly writesPerUserMinute: number;
  readonly ordersPerUserTenMinutes: number;
  readonly openOrdersPerCustomer: number;
  readonly restaurantListPerIpMinute: number;
  readonly refreshPerIpMinute: number;
  readonly wsUpgradesPerIpMinute: number;
  readonly wsConnectionsPerIp: number;
  readonly uploadsPerUserHour: number;
  readonly catalogWritesPerUserHour: number;
  readonly publicUploadsPerUserHour: number;
  readonly searchPerIpMinute: number;
  readonly staffPerRestaurant: number;
};

/** The blueprint section 7 table. The code lifetime and the per-code attempt cap are never scaled. */
const STANDARD_LIMITS: Limits = {
  otpTtlSeconds: 300,
  otpResendSeconds: 60,
  otpMaxAttempts: 5,
  otpSendsPerPhoneHour: 5,
  otpSendsPerPhoneDay: 10,
  otpSendsPerIpHour: 20,
  otpSendsPerIpDay: 100,
  otpSendsGlobalHour: 1000,
  otpFailuresPerPhoneDay: 10,
  otpFailuresPerIpHour: 30,
  routePerIpMinute: 300,
  writesPerUserMinute: 60,
  ordersPerUserTenMinutes: 5,
  openOrdersPerCustomer: 3,
  restaurantListPerIpMinute: 120,
  refreshPerIpMinute: 30,
  wsUpgradesPerIpMinute: 30,
  wsConnectionsPerIp: 20,
  uploadsPerUserHour: 30,
  catalogWritesPerUserHour: 600,
  publicUploadsPerUserHour: 60,
  searchPerIpMinute: 60,
  staffPerRestaurant: 20,
};

const UNSCALED: ReadonlySet<string> = new Set(['otpTtlSeconds', 'otpMaxAttempts']);

function limitsFor(profile: 'standard' | 'relaxed'): Limits {
  if (profile === 'standard') return STANDARD_LIMITS;
  // Relaxed (local development and browser tests only): counts x100, and no resend gap, so a demo phone can sign in repeatedly.
  return {
    ...(Object.fromEntries(
      Object.entries(STANDARD_LIMITS).map(([name, value]) => [name, UNSCALED.has(name) ? value : value * 100]),
    ) as Limits),
    otpResendSeconds: 0,
  };
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

function isUsableUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  return new URL(value).hostname !== '';
}

/** Comma separated origins. A wildcard, or anything that is not an http(s) URL, is rejected. */
const corsOrigins = z
  .string()
  .default('')
  .transform((value, ctx) => {
    const origins: string[] = [];
    for (const part of value.split(',')) {
      const item = part.trim();
      if (item === '') continue;
      if (!/^https?:\/\//.test(item) || !isUsableUrl(item)) {
        ctx.addIssue({ code: 'custom', message: 'must be a comma separated list of http(s) URLs' });
        return z.NEVER;
      }
      origins.push(new URL(item).origin);
    }
    return origins;
  });

/** `kid:base64key[,kid:base64key...]`; every key is exactly 32 bytes. The first one is active. */
const dataKeys = z.string({ error: 'is required' }).transform((value, ctx) => {
  const keys = new Map<string, Buffer>();
  for (const part of value.split(',')) {
    const [kid, encoded, ...rest] = part.trim().split(':');
    const key = encoded === undefined ? null : Buffer.from(encoded, 'base64');
    if (!kid || !/^[A-Za-z0-9_-]{1,16}$/.test(kid) || rest.length > 0 || key?.length !== 32 || keys.has(kid)) {
      ctx.addIssue({ code: 'custom', message: 'must be kid:base64key, each key exactly 32 bytes' });
      return z.NEVER;
    }
    keys.set(kid, key);
  }
  return { active: keys.keys().next().value as string, keys };
});

const list = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production'], { error: 'must be development, test or production' }),
    PORT: z.coerce.number({ error: 'must be a number' }).int().min(1).max(65535).default(4000),
    DATABASE_URL: z
      .string({ error: 'is required' })
      .regex(/^postgres(ql)?:\/\//, { error: 'must start with postgres:// or postgresql://' })
      .refine(isUsableUrl, { error: 'must be a valid URL with a host' }),
    REDIS_URL: z
      .string({ error: 'is required' })
      .regex(/^rediss?:\/\//, { error: 'must start with redis:// or rediss://' })
      .refine(isUsableUrl, { error: 'must be a valid URL with a host' }),
    LOG_LEVEL: z
      .enum(['debug', 'info', 'warn', 'error'], { error: 'must be debug, info, warn or error' })
      .default('info'),
    OTP_SECRET: z.string({ error: 'is required' }).min(32, { error: 'must be at least 32 characters' }),
    SESSION_TTL_DAYS: z.coerce.number({ error: 'must be a number' }).int().min(1).max(365).default(60),
    CORS_ORIGINS: corsOrigins,
    DEV_OTP_PEEK: z.enum(['true', 'false'], { error: 'must be true or false' }).default('false'),
    TRUST_PROXY: z.string().default('').transform(list),
    DATA_KEYS: dataKeys,
    LIMITS_PROFILE: z.enum(['standard', 'relaxed'], { error: 'must be standard or relaxed' }).default('standard'),
    SMS_PROVIDERS: z.string().default('log').transform(list),
    RATE_LIMIT_PREFIX: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,40}$/, { error: 'must be letters, digits, - or _' })
      .default('oregano'),
    WEB_OTP_DOMAIN: z.string().optional(),
    S3_ENDPOINT: z.string().default('http://localhost:9000').refine(isUsableUrl, { error: 'must be a valid URL' }),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('oregano'),
    S3_ACCESS_KEY_ID: z.string().default('oregano'),
    S3_SECRET_ACCESS_KEY: z.string().default('oregano-dev-secret'),
    S3_FORCE_PATH_STYLE: z.enum(['true', 'false'], { error: 'must be true or false' }).default('true'),
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV !== 'production') return;
    const refuse = (name: string, message: string) => ctx.addIssue({ code: 'custom', path: [name], message });
    if (v.DEV_OTP_PEEK === 'true') refuse('DEV_OTP_PEEK', 'must not be true in production');
    if (v.LIMITS_PROFILE === 'relaxed') refuse('LIMITS_PROFILE', 'must be standard in production');
    if (new Set(v.SMS_PROVIDERS).size < 2 || v.SMS_PROVIDERS.includes('log')) {
      refuse('SMS_PROVIDERS', 'must name at least two different real providers in production, and not log');
    }
    if (v.TRUST_PROXY.length === 0) refuse('TRUST_PROXY', 'must list the proxies in front of the API in production');
    if (v.CORS_ORIGINS.some((origin) => !origin.startsWith('https://'))) {
      refuse('CORS_ORIGINS', 'must be https only in production');
    }
    if (!v.S3_ENDPOINT.startsWith('https://')) refuse('S3_ENDPOINT', 'must be https in production');
  });

/** Validates every setting at once. Never echoes a value, because values can hold secrets. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((issue) => `${String(issue.path[0])}: ${issue.message}`));
  }
  const v = result.data;
  return {
    nodeEnv: v.NODE_ENV,
    port: v.PORT,
    databaseUrl: v.DATABASE_URL,
    redisUrl: v.REDIS_URL,
    logLevel: v.LOG_LEVEL,
    otpSecret: v.OTP_SECRET,
    session: {
      accessSeconds: 900,
      refreshDays: v.SESSION_TTL_DAYS,
      absoluteDays: 180,
      teamAbsoluteHours: 12,
      reuseGraceSeconds: 30,
    },
    corsOrigins: v.CORS_ORIGINS,
    devOtpPeek: v.DEV_OTP_PEEK === 'true',
    trustProxy: v.TRUST_PROXY.length > 0 ? v.TRUST_PROXY : false,
    dataKeys: v.DATA_KEYS,
    limitsProfile: v.LIMITS_PROFILE,
    limits: limitsFor(v.LIMITS_PROFILE),
    smsProviders: v.SMS_PROVIDERS,
    rateLimitPrefix: v.RATE_LIMIT_PREFIX,
    webOtpDomain: v.WEB_OTP_DOMAIN ?? null,
    s3: {
      endpoint: v.S3_ENDPOINT,
      region: v.S3_REGION,
      bucket: v.S3_BUCKET,
      accessKeyId: v.S3_ACCESS_KEY_ID,
      secretAccessKey: v.S3_SECRET_ACCESS_KEY,
      forcePathStyle: v.S3_FORCE_PATH_STYLE === 'true',
    },
  };
}
