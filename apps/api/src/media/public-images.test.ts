import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { withTestApp } from '../testing/app';

const OWNER = '01711000002';
const STAFF = '01711000050';
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name));

function multipart(file: Buffer, filename = 'photo.png'): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----oregano-test-boundary';
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const payload = Buffer.concat([Buffer.from(head), file, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

const bigPng = () =>
  sharp({ create: { width: 1200, height: 800, channels: 3, background: '#cc3300' } })
    .png()
    .toBuffer();

describe('public photos', () => {
  const t = withTestApp();
  const rid = () => t.demo().restaurantId;
  const itemId = () => t.demo().menuItemIds.beefCheeseBurger;

  const upload = async (phone: string, path: string, file: Buffer) => {
    const m = multipart(file);
    return t.app().inject({
      method: 'PUT',
      url: `/v1/restaurants/${rid()}${path}`,
      payload: m.payload,
      headers: { ...m.headers, ...t.as(await t.signIn(phone)) },
    });
  };
  const keyOf = (imageUrl: string) => imageUrl.split('/v1/media/public/')[1]?.split('?')[0] as string;
  const fetchImage = (key: string, size = 'large') =>
    t.app().inject({ method: 'GET', url: `/v1/media/public/${key}?size=${size}` });

  it('turns a PNG into two WebP sizes served with an immutable cache header', async () => {
    const res = await upload(OWNER, `/items/${itemId()}/photo`, await bigPng());
    expect(res.statusCode).toBe(200);
    const key = keyOf(res.json().imageUrl);
    const large = await fetchImage(key, 'large');
    expect(large.statusCode).toBe(200);
    expect(large.headers['content-type']).toBe('image/webp');
    expect(large.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await sharp(large.rawPayload).metadata()).width).toBe(960);
    expect((await sharp((await fetchImage(key, 'small')).rawPayload).metadata()).width).toBe(320);
    const menu = (await t.app().inject({ method: 'GET', url: '/v1/restaurants/burger-lane' })).json();
    const item = menu.categories
      .flatMap((c: { items: { id: string; imageUrl: string }[] }) => c.items)
      .find((i: { id: string }) => i.id === itemId());
    expect(item.imageUrl).toContain(key);
  });

  it('does not enlarge a small image', async () => {
    const small = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#00aa55' } })
      .png()
      .toBuffer();
    const key = keyOf((await upload(OWNER, `/items/${itemId()}/photo`, small)).json().imageUrl);
    expect((await sharp((await fetchImage(key)).rawPayload).metadata()).width).toBe(200);
  });

  it('refuses a polyglot, a renamed text file, a pixel bomb and an oversize file', async () => {
    for (const [name, file, code] of [
      ['polyglot', fixture('polyglot.jpg'), 'unsupported_image'],
      ['text', Buffer.from('<html>not an image</html>'), 'unsupported_image'],
      ['bomb', fixture('bomb.png'), 'unsupported_image'],
      ['big', Buffer.concat([fixture('ok.png'), Buffer.alloc(6 * 1024 * 1024)]), 'image_too_large'],
    ] as const) {
      const res = await upload(OWNER, `/items/${itemId()}/photo`, file);
      expect(res.statusCode, name).toBe(400);
      expect(res.json().error.code, name).toBe(code);
    }
    const row = await t.db.execute<{ image_key: string | null }>(
      sql`SELECT image_key FROM menu_items WHERE id = ${itemId()}`,
    );
    expect(row[0]?.image_key).toBeNull();
  });

  it('replacing a photo removes the old one, and deleting clears it', async () => {
    const first = keyOf((await upload(OWNER, `/items/${itemId()}/photo`, await bigPng())).json().imageUrl);
    const second = keyOf((await upload(OWNER, `/items/${itemId()}/photo`, await bigPng())).json().imageUrl);
    expect(second).not.toBe(first);
    expect((await fetchImage(first)).statusCode).toBe(404);
    expect((await fetchImage(second)).statusCode).toBe(200);
    const del = await t.app().inject({
      method: 'DELETE',
      url: `/v1/restaurants/${rid()}/items/${itemId()}/photo`,
      headers: t.as(await t.signIn(OWNER)),
    });
    expect(del.statusCode).toBe(200);
    expect((await fetchImage(second)).statusCode).toBe(404);
  });

  it('sets the restaurant cover photo', async () => {
    const res = await upload(OWNER, '/photo', await bigPng());
    expect(res.statusCode).toBe(200);
    const list = (await t.app().inject({ method: 'GET', url: '/v1/restaurants' })).json();
    expect(list.restaurants[0].coverImageUrl).toContain(keyOf(res.json().imageUrl));
  });

  it('answers 404 for a malformed or unknown key, or an unknown size', async () => {
    expect((await fetchImage('..%2Fx')).statusCode).toBe(404);
    expect((await fetchImage('not-a-key')).statusCode).toBe(404);
    expect((await fetchImage('00000000-0000-4000-8000-000000000001')).statusCode).toBe(404);
    const key = keyOf((await upload(OWNER, `/items/${itemId()}/photo`, await bigPng())).json().imageUrl);
    expect((await fetchImage(key, 'huge')).statusCode).toBe(404);
  });

  it('is owner only', async () => {
    await t.signIn(STAFF);
    await t.db.execute(sql`
      INSERT INTO restaurant_staff (restaurant_id, user_id, role)
      SELECT ${rid()}, id, 'staff' FROM users WHERE phone = '+8801711000050'`);
    expect((await upload(STAFF, `/items/${itemId()}/photo`, await bigPng())).statusCode).toBe(403);
    expect((await upload('01711000001', '/photo', await bigPng())).statusCode).toBe(404);
  });
});

describe('public upload limit', () => {
  const t = withTestApp({ limits: { publicUploadsPerUserHour: 2 } });

  it('answers 429 after the hourly cap', async () => {
    const png = await bigPng();
    const send = async () => {
      const m = multipart(png);
      return t.app().inject({
        method: 'PUT',
        url: `/v1/restaurants/${t.demo().restaurantId}/photo`,
        payload: m.payload,
        headers: { ...m.headers, ...t.as(await t.signIn(OWNER)) },
      });
    };
    expect([(await send()).statusCode, (await send()).statusCode]).toEqual([200, 200]);
    expect((await send()).statusCode).toBe(429);
  });
});
