import { z } from 'zod';

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  redisUrl: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
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

const schema = z.object({
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
  };
}
