// Regenerates the committed test images. Run: node src/media/fixtures/make-fixtures.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const dir = dirname(fileURLToPath(import.meta.url));
const out = (name, data) => writeFileSync(join(dir, name), data);

const photo = () => sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 80, b: 40 } } });

// A phone photo: bigger than 2000 px, with GPS tags and an orientation.
const jpg = await photo()
  .withExif({
    IFD0: { Make: 'FixturePhone', Orientation: '6' },
    IFD3: {
      GPSLatitudeRef: 'N',
      GPSLatitude: '24 35 10/1',
      GPSLongitudeRef: 'E',
      GPSLongitude: '88 16 20/1',
    },
  })
  .withMetadata({ orientation: 6 })
  .jpeg()
  .toBuffer();
out('ok.jpg', jpg);
out('ok.png', await photo().resize(600, 400).png().toBuffer());
out('ok.webp', await photo().resize(600, 400).webp().toBuffer());
out('fake.jpg', Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'));
out(
  'polyglot.jpg',
  Buffer.concat([jpg.subarray(0, 4), Buffer.from('<html><script>alert(1)</script></html>'), jpg.subarray(4)]),
);
// 20000 x 20000 pixels of one colour: tiny on disk, 400 million pixels in memory.
out(
  'bomb.png',
  await sharp({
    create: { width: 20000, height: 20000, channels: 3, background: { r: 128, g: 128, b: 128 } },
    limitInputPixels: false,
  })
    .png({ compressionLevel: 9 })
    .toBuffer(),
);
// 64 million pixels: over our 40 million limit but under sharp's own default, so only our limit refuses it.
out(
  'bomb-mid.png',
  await sharp({ create: { width: 8000, height: 8000, channels: 3, background: { r: 128, g: 128, b: 128 } } })
    .png({ compressionLevel: 9 })
    .toBuffer(),
);
