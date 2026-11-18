import sharp from 'sharp';

export type ImageCheck =
  | { ok: true; jpeg: Buffer }
  | { ok: false; code: 'unsupported_document' | 'document_too_large' };

export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const MAX_EDGE = 2000;

function looksLikeImage(b: Buffer): boolean {
  const jpeg = b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const png = b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';
  return jpeg || png || webp;
}

/**
 * Accepts a JPEG, PNG or WebP by its first bytes, never by its name, and returns a fresh JPEG: orientation applied,
 * at most 2000 px on the longest edge, every piece of metadata (EXIF, GPS, ICC, XMP) dropped. Re-encoding also
 * destroys anything hidden inside the file, such as HTML after a JPEG header.
 */
export async function normaliseDocumentImage(input: Buffer): Promise<ImageCheck> {
  if (input.length > MAX_DOCUMENT_BYTES) return { ok: false, code: 'document_too_large' };
  if (!looksLikeImage(input)) return { ok: false, code: 'unsupported_document' };
  try {
    const jpeg = await sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'error' })
      .rotate()
      .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { ok: true, jpeg };
  } catch {
    return { ok: false, code: 'unsupported_document' };
  }
}
