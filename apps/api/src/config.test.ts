import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';
import { TEST_DATA_KEYS } from './testing/keys';

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://u:p@localhost:5432/oregano',
  REDIS_URL: 'redis://localhost:6379',
  OTP_SECRET: 'x'.repeat(40),
  DATA_KEYS: TEST_DATA_KEYS,
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig(valid)).toMatchObject({
      nodeEnv: 'test',
      port: 4000,
      logLevel: 'info',
      databaseUrl: 'postgres://u:p@localhost:5432/oregano',
      redisUrl: 'redis://localhost:6379',
      otpSecret: 'x'.repeat(40),
      sessionTtlDays: 60,
      corsOrigins: [],
      devOtpPeek: false,
    });
  });

  it('names every bad setting at once', () => {
    try {
      loadConfig({ NODE_ENV: 'test', PORT: 'abc', REDIS_URL: 'http://wrong' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const text = (error as ConfigError).problems.join(' ');
      expect(text).toContain('DATABASE_URL');
      expect(text).toContain('PORT');
      expect(text).toContain('REDIS_URL');
    }
  });

  it('never puts a secret value in the error', () => {
    try {
      loadConfig({ ...valid, DATABASE_URL: 'mysql://user:hunter2@host/db' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect(String((error as Error).message)).not.toContain('hunter2');
    }
  });

  it('rejects a URL that has the right prefix but cannot be parsed', () => {
    for (const bad of ['postgres://user:p@ss w0rd@host:abc/db', 'postgres://', 'redis://']) {
      const key = bad.startsWith('redis') ? 'REDIS_URL' : 'DATABASE_URL';
      try {
        loadConfig({ ...valid, [key]: bad });
        expect.unreachable(`${bad} should be rejected`);
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        expect((error as ConfigError).problems.join(' ')).toContain(key);
        expect((error as Error).message).not.toContain('w0rd');
      }
    }
  });

  it('refuses DEV_OTP_PEEK in production', () => {
    expect(loadConfig({ ...valid, DEV_OTP_PEEK: 'true' }).devOtpPeek).toBe(true);
    try {
      loadConfig({ ...valid, NODE_ENV: 'production', DEV_OTP_PEEK: 'true' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).problems.join(' ')).toContain('DEV_OTP_PEEK');
    }
  });

  it('requires OTP_SECRET of at least 32 characters and never echoes it', () => {
    for (const bad of [undefined, 'short-secret-value']) {
      try {
        loadConfig({ ...valid, OTP_SECRET: bad });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        expect((error as ConfigError).problems.join(' ')).toContain('OTP_SECRET');
        expect((error as Error).message).not.toContain('short-secret-value');
      }
    }
  });

  it('parses CORS_ORIGINS', () => {
    expect(
      loadConfig({ ...valid, CORS_ORIGINS: 'http://localhost:8081, https://order.example.com/' }).corsOrigins,
    ).toEqual(['http://localhost:8081', 'https://order.example.com']);
    for (const bad of ['*', 'not a url']) {
      expect(() => loadConfig({ ...valid, CORS_ORIGINS: bad })).toThrow(ConfigError);
    }
  });
});

const production = {
  ...valid,
  NODE_ENV: 'production',
  TRUST_PROXY: '10.0.0.0/8',
  SMS_PROVIDERS: 'alpha,beta',
  CORS_ORIGINS: 'https://oregano.example',
  S3_ENDPOINT: 'https://s3.example.com',
};

function problems(env: Record<string, string | undefined>): string {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).problems.join(' ');
  }
  return expect.unreachable('the config should have been refused');
}

describe('production refusals', () => {
  it('accepts a complete production config', () => {
    expect(loadConfig(production).nodeEnv).toBe('production');
  });

  it('refuses each unsafe setting by name, and never echoes its value', () => {
    const cases: [string, Record<string, string | undefined>, string][] = [
      ['LIMITS_PROFILE', { LIMITS_PROFILE: 'relaxed' }, 'relaxed'],
      ['SMS_PROVIDERS', { SMS_PROVIDERS: 'alpha' }, 'alpha'],
      ['SMS_PROVIDERS', { SMS_PROVIDERS: 'alpha,alpha' }, 'alpha'],
      ['SMS_PROVIDERS', { SMS_PROVIDERS: 'alpha,log' }, 'alpha'],
      ['TRUST_PROXY', { TRUST_PROXY: '' }, 'zzz-none'],
      ['CORS_ORIGINS', { CORS_ORIGINS: 'http://insecure.example' }, 'insecure.example'],
      ['S3_ENDPOINT', { S3_ENDPOINT: 'http://s3.insecure.example' }, 's3.insecure.example'],
    ];
    for (const [name, change, secret] of cases) {
      const text = problems({ ...production, ...change });
      expect(text, name).toContain(name);
      try {
        loadConfig({ ...production, ...change });
      } catch (error) {
        expect((error as Error).message, name).not.toContain(secret);
      }
    }
  });

  it('refuses a missing or malformed DATA_KEYS in every environment', () => {
    for (const bad of [undefined, '', 'k1:short', `bad kid:${Buffer.alloc(32).toString('base64')}`, 'nocolon']) {
      expect(problems({ ...valid, DATA_KEYS: bad })).toContain('DATA_KEYS');
    }
  });

  it('puts the first data key first and parses several', () => {
    const second = Buffer.alloc(32, 9).toString('base64');
    const config = loadConfig({ ...valid, DATA_KEYS: `${TEST_DATA_KEYS},old:${second}` });
    expect(config.dataKeys.active).toBe('test1');
    expect([...config.dataKeys.keys.keys()]).toEqual(['test1', 'old']);
  });
});

describe('limits', () => {
  it('multiplies counts by 100 in the relaxed profile but keeps times and the attempt cap', () => {
    const standard = loadConfig(valid).limits;
    const relaxed = loadConfig({ ...valid, LIMITS_PROFILE: 'relaxed' }).limits;
    expect(standard.otpSendsPerPhoneHour).toBe(5);
    expect(relaxed.otpSendsPerPhoneHour).toBe(500);
    expect(relaxed.otpTtlSeconds).toBe(standard.otpTtlSeconds);
    expect(relaxed.otpResendSeconds).toBe(standard.otpResendSeconds);
    expect(relaxed.otpMaxAttempts).toBe(5);
  });

  it('reads the trusted proxy list', () => {
    expect(loadConfig(valid).trustProxy).toBe(false);
    expect(loadConfig({ ...valid, TRUST_PROXY: '10.0.0.1, 192.168.0.0/16' }).trustProxy).toEqual([
      '10.0.0.1',
      '192.168.0.0/16',
    ]);
  });
});
