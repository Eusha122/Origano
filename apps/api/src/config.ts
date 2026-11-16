import { z } from 'zod';

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  redisUrl: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  otpSecret: string;
  sessionTtlDays: number;
  corsOrigins: string[];
  devOtpPeek: boolean;
};

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
  })
  .refine((v) => !(v.NODE_ENV === 'production' && v.DEV_OTP_PEEK === 'true'), {
    path: ['DEV_OTP_PEEK'],
    error: 'must not be true in production',
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
    sessionTtlDays: v.SESSION_TTL_DAYS,
    corsOrigins: v.CORS_ORIGINS,
    devOtpPeek: v.DEV_OTP_PEEK === 'true',
  };
}
