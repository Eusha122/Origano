/** The path customers load a public photo from; the app puts the API address in front. Null when there is no photo. */
export function publicImageUrl(key: string | null, size: 'small' | 'large'): string | null {
  return key ? `/v1/media/public/${key}?size=${size}` : null;
}
