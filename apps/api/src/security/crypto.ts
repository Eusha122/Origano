import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import type { Config } from '../config';

type DataKeys = Config['dataKeys'];

/** A 32-byte key derived from `secret` for one purpose, so one secret never serves two jobs. */
export function subkey(secret: string, purpose: 'ip-hash' | 'doc-ticket'): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, '', `oregano:${purpose}`, 32));
}

/** A keyed hash of an IP address. The address itself is never stored. */
export function hashIp(key: Buffer, ip: string): string {
  return createHmac('sha256', key).update(ip).digest('hex').slice(0, 32);
}

const b64 = (buffer: Buffer): string => buffer.toString('base64url');

/** `v1.<kid>.<iv>.<tag>.<ciphertext>`, AES-256-GCM under the active master key. `aad` binds it to its row. */
export function sealString(keys: DataKeys, plaintext: string, aad: string): string {
  const key = keys.keys.get(keys.active);
  if (!key) throw new Error('The active data key is missing');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', keys.active, b64(iv), b64(cipher.getAuthTag()), b64(body)].join('.');
}

export function openString(keys: DataKeys, sealed: string, aad: string): string {
  const [version, kid, iv, tag, body] = sealed.split('.');
  if (version !== 'v1' || !kid || !iv || !tag || body === undefined) throw new Error('Not a sealed value');
  const key = keys.keys.get(kid);
  if (!key) throw new Error('Unknown data key');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}

export type SealedKey = { kid: string; wrappedKey: string };

/** A fresh random data key, plus a copy wrapped by the active master key for storage. */
export function newDataKey(keys: DataKeys, aad: string): { key: Buffer; sealed: SealedKey } {
  const key = randomBytes(32);
  return { key, sealed: { kid: keys.active, wrappedKey: sealString(keys, key.toString('base64'), aad) } };
}

export function unwrapDataKey(keys: DataKeys, sealed: SealedKey, aad: string): Buffer {
  return Buffer.from(openString(keys, sealed.wrappedKey, aad), 'base64');
}

/** `iv(12) | tag(16) | ciphertext`. */
export function encryptBytes(key: Buffer, plaintext: Buffer, aad: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decryptBytes(key: Buffer, sealed: Buffer, aad: string): Buffer {
  if (sealed.length < 28) throw new Error('Not an encrypted value');
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
}
