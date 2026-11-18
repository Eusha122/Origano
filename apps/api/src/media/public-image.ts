import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { MAX_PIXELS, sniff, withSlot } from './image';
import type { ObjectStore } from './store';

export const MAX_PUBLIC_IMAGE_BYTES = 5 * 1024 * 1024;
export const LARGE_WIDTH = 960;
export const SMALL_WIDTH = 320;

export type PublicImageResult =
  | { ok: true; large: Buffer; small: Buffer }
  | { ok: false; code: 'unsupported_image' | 'image_too_large' };

/**
 * Menu and restaurant photos are public content: a JPEG, PNG or WebP (by its first bytes) becomes two still WebP files,
 * 960 and 320 pixels wide, never enlarged, with every piece of metadata dropped. Only the first frame of an animation
 * is kept. Re-encoding also destroys anything hidden inside the file.
 */
export async function processPublicImage(input: Buffer): Promise<PublicImageResult> {
  if (input.length > MAX_PUBLIC_IMAGE_BYTES) return { ok: false, code: 'image_too_large' };
  const sniffed = sniff(input);
  if (!sniffed) return { ok: false, code: 'unsupported_image' };
  return withSlot(async () => {
    try {
      const options = { limitInputPixels: MAX_PIXELS, failOn: 'error', animated: false } as const;
      const meta = await sharp(input, options).metadata();
      if (meta.format !== sniffed) return { ok: false as const, code: 'unsupported_image' as const };
      const render = (width: number) =>
        sharp(input, options)
          .rotate()
          .resize(width, undefined, { withoutEnlargement: true })
          .flatten({ background: '#ffffff' })
          .webp({ quality: 80 })
          .toBuffer();
      return { ok: true as const, large: await render(LARGE_WIDTH), small: await render(SMALL_WIDTH) };
    } catch {
      return { ok: false as const, code: 'unsupported_image' as const };
    }
  });
}

const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isPublicImageKey = (value: string): boolean => KEY.test(value);

const objectKey = (key: string, size: 'large' | 'small') =>
  `public/${key}-${size === 'large' ? LARGE_WIDTH : SMALL_WIDTH}.webp`;

/** Stores both sizes under a fresh random key and returns it. */
export async function putPublicImage(store: ObjectStore, image: { large: Buffer; small: Buffer }): Promise<string> {
  const key = randomUUID();
  await store.put(objectKey(key, 'large'), image.large);
  await store.put(objectKey(key, 'small'), image.small);
  return key;
}

export async function deletePublicImage(store: ObjectStore, key: string): Promise<void> {
  await store.delete(objectKey(key, 'large'));
  await store.delete(objectKey(key, 'small'));
}

/** The bytes of one size, or null when there is no such image. */
export async function getPublicImage(store: ObjectStore, key: string, size: 'large' | 'small'): Promise<Buffer | null> {
  try {
    return await store.get(objectKey(key, size));
  } catch {
    return null;
  }
}
