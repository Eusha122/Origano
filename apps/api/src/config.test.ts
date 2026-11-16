import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://u:p@localhost:5432/oregano',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig(valid)).toEqual({
      nodeEnv: 'test',
      port: 4000,
      logLevel: 'info',
      databaseUrl: 'postgres://u:p@localhost:5432/oregano',
      redisUrl: 'redis://localhost:6379',
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
});
