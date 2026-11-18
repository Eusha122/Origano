import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Config } from '../config';
import {
  decryptBytes,
  encryptBytes,
  hashIp,
  newDataKey,
  openString,
  sealString,
  subkey,
  unwrapDataKey,
} from './crypto';

function keysOf(...kids: string[]): Config['dataKeys'] {
  return { active: kids[0] as string, keys: new Map(kids.map((kid) => [kid, randomBytes(32)])) };
}

describe('sealString', () => {
  it('round-trips and hides the text', () => {
    const keys = keysOf('k1');
    const sealed = sealString(keys, 'Your code is 123456', 'row-1');
    expect(sealed).not.toContain('123456');
    expect(openString(keys, sealed, 'row-1')).toBe('Your code is 123456');
  });

  it('refuses tampered text and the wrong AAD', () => {
    const keys = keysOf('k1');
    const sealed = sealString(keys, 'secret', 'row-1');
    expect(() => openString(keys, sealed, 'row-2')).toThrow();
    const parts = sealed.split('.');
    parts[4] = `${parts[4]?.slice(0, -2)}AA`;
    expect(() => openString(keys, parts.join('.'), 'row-1')).toThrow();
  });

  it('refuses an unknown key id', () => {
    const sealed = sealString(keysOf('k1'), 'secret', 'a');
    expect(() => openString(keysOf('other'), sealed, 'a')).toThrow();
  });

  it('still opens text sealed under an old key after a new key is put first', () => {
    const old = keysOf('k1');
    const sealed = sealString(old, 'secret', 'a');
    const rotated: Config['dataKeys'] = { active: 'k2', keys: new Map([['k2', randomBytes(32)], ...old.keys]) };
    expect(openString(rotated, sealed, 'a')).toBe('secret');
    expect(sealString(rotated, 'x', 'a').split('.')[1]).toBe('k2');
  });
});

describe('data keys and bytes', () => {
  it('round-trips a wrapped data key and encrypted bytes', () => {
    const keys = keysOf('k1');
    const { key, sealed } = newDataKey(keys, 'doc-1');
    expect(sealed.kid).toBe('k1');
    const data = randomBytes(1000);
    const box = encryptBytes(key, data, 'doc-1');
    expect(box.equals(data)).toBe(false);
    const again = unwrapDataKey(keys, sealed, 'doc-1');
    expect(decryptBytes(again, box, 'doc-1').equals(data)).toBe(true);
  });

  it('refuses a different master key, the wrong AAD, and tampered bytes', () => {
    const keys = keysOf('k1');
    const { key, sealed } = newDataKey(keys, 'doc-1');
    const box = encryptBytes(key, Buffer.from('hello'), 'doc-1');
    expect(() => unwrapDataKey(keysOf('k1'), sealed, 'doc-1')).toThrow();
    expect(() => unwrapDataKey(keys, sealed, 'doc-2')).toThrow();
    expect(() => decryptBytes(key, box, 'doc-2')).toThrow();
    box[box.length - 1] = (box[box.length - 1] ?? 0) ^ 1;
    expect(() => decryptBytes(key, box, 'doc-1')).toThrow();
  });
});

describe('hashIp', () => {
  it('is stable for one key, differs across keys and never holds the address', () => {
    const a = subkey('s'.repeat(40), 'ip-hash');
    const b = subkey('t'.repeat(40), 'ip-hash');
    expect(hashIp(a, '203.0.113.9')).toBe(hashIp(a, '203.0.113.9'));
    expect(hashIp(a, '203.0.113.9')).not.toBe(hashIp(b, '203.0.113.9'));
    expect(hashIp(a, '203.0.113.9')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('derives different subkeys for different purposes', () => {
    expect(subkey('s'.repeat(40), 'ip-hash').equals(subkey('s'.repeat(40), 'doc-ticket'))).toBe(false);
  });
});
