import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { server } from '../src/server.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function hit(pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const srv = server.listen(0, '127.0.0.1', () => {
      const request = http.request({
        host: '127.0.0.1',
        port: srv.address().port,
        path: pathname,
        method,
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => srv.close(() => resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks),
        })));
      });
      request.on('error', reject);
      request.end();
    });
  });
}

function pngSize(bytes) {
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function pngPixels(bytes) {
  const [width, height] = pngSize(bytes);
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1);
    assert.equal(raw[row], 0, 'deterministic exports use unfiltered PNG rows');
    raw.copy(pixels, y * stride, row + 1, row + 1 + stride);
  }
  return { width, height, pixels };
}

function pixelAt(image, xPct, yPct) {
  const x = Math.floor(image.width * xPct / 100);
  const y = Math.floor(image.height * yPct / 100);
  const offset = (y * image.width + x) * 4;
  return [...image.pixels.subarray(offset, offset + 4)];
}

function blueGradientAt(x, y) {
  const top = [0x34, 0x78, 0xf6];
  const bottom = [0x17, 0x47, 0xc3];
  const dx = 62;
  const dy = 88;
  const amount = Math.min(1, Math.max(0, ((x - 20) * dx + (y - 8) * dy) / (dx * dx + dy * dy)));
  return top.map((value, index) => Math.round(value + (bottom[index] - value) * amount));
}

test('both dashboard documents reference the complete local icon family', () => {
  for (const file of ['index.html', 'settings.html']) {
    const html = fs.readFileSync(path.join(root, 'public', file), 'utf8');
    assert.match(html, /<meta name="theme-color" content="#2563eb" \/>/);
    assert.match(html, /href="\/favicon\.ico" sizes="16x16 32x32"/);
    assert.match(html, /rel="icon" type="image\/png" sizes="16x16" href="\/icons\/favicon-16x16\.png"/);
    assert.match(html, /rel="icon" type="image\/png" sizes="32x32" href="\/icons\/favicon-32x32\.png"/);
    assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="\/icons\/apple-touch-icon-180x180\.png"/);
    assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  }
});

test('manifest metadata declares standard and maskable Double dash exports', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public', 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'llmdash');
  assert.equal(manifest.short_name, 'llmdash');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, '#0c1015');
  assert.equal(manifest.theme_color, '#2563eb');
  assert.deepEqual(manifest.icons, [
    { src: '/icons/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ]);
  assert.equal('serviceworker' in manifest, false);
});

test('committed icon exports are deterministic and have their declared dimensions', () => {
  execFileSync(process.execPath, ['scripts/generate-web-icons.mjs', '--check'], { cwd: root });
  const expected = new Map([
    ['favicon-16x16.png', 16],
    ['favicon-32x32.png', 32],
    ['apple-touch-icon-180x180.png', 180],
    ['pwa-192x192.png', 192],
    ['pwa-512x512.png', 512],
    ['pwa-maskable-512x512.png', 512],
  ]);
  for (const [file, size] of expected) {
    const bytes = fs.readFileSync(path.join(root, 'public', 'icons', file));
    assert.deepEqual(pngSize(bytes), [size, size], file);
  }

  const ico = fs.readFileSync(path.join(root, 'public', 'favicon.ico'));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 2);
  assert.deepEqual([ico[6], ico[22]], [16, 32]);
});

test('app exports are opaque, full bleed, and preserve the approved three-color core', () => {
  for (const file of [
    'apple-touch-icon-180x180.png',
    'pwa-192x192.png',
    'pwa-512x512.png',
    'pwa-maskable-512x512.png',
  ]) {
    const image = pngPixels(fs.readFileSync(path.join(root, 'public', 'icons', file)));
    for (let offset = 3; offset < image.pixels.length; offset += 4) {
      assert.equal(image.pixels[offset], 255, `${file} must be opaque and full bleed`);
    }
  }

  const mark = pngPixels(fs.readFileSync(path.join(root, 'public', 'icons', 'pwa-512x512.png')));
  assert.deepEqual(pixelAt(mark, 50, 28.5), [244, 248, 255, 255], 'upper allowance bar');
  assert.deepEqual(pixelAt(mark, 75, 28.5), [18, 55, 154, 255], 'upper cobalt track');
  assert.deepEqual(pixelAt(mark, 25, 62.5), [101, 220, 140, 255], 'lower headroom bar');

  const favicon = pngPixels(fs.readFileSync(path.join(root, 'public', 'icons', 'favicon-32x32.png')));
  const alpha = [...favicon.pixels].filter((_, index) => index % 4 === 3);
  assert.equal(Math.min(...alpha), 0, 'favicon keeps transparent outer corners');
  assert.equal(Math.max(...alpha), 255, 'favicon keeps an opaque central mark');
});

test('every rendered maskable bar pixel stays inside the central 80% safe circle', () => {
  const image = pngPixels(fs.readFileSync(path.join(root, 'public', 'icons', 'pwa-maskable-512x512.png')));
  const radius = image.width * 0.4;
  let barPixels = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const pixel = pixelAt(image, (x + 0.5) * 100 / image.width, (y + 0.5) * 100 / image.height);
      const expectedBlue = blueGradientAt((x + 0.5) * 100 / image.width, (y + 0.5) * 100 / image.height);
      const differsFromField = expectedBlue.some((channel, index) => Math.abs(channel - pixel[index]) >= 3);
      if (!differsFromField) continue;
      barPixels += 1;
      const dx = x + 0.5 - image.width / 2;
      const dy = y + 0.5 - image.height / 2;
      assert.ok(Math.hypot(dx, dy) <= radius,
        `semantic bar pixel (${x}, ${y}) exceeds the 80% maskable safe circle`);
    }
  }
  assert.ok(barPixels > 20_000, 'safe-circle check must inspect the rendered bars, not an empty mask');
});

test('icon and manifest routes use the static no-store/security posture and correct MIME types', async () => {
  const routes = new Map([
    ['/favicon.ico', 'image/x-icon'],
    ['/manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
    ['/icons/llmdash.svg', 'image/svg+xml'],
    ['/icons/favicon-16x16.png', 'image/png'],
    ['/icons/favicon-32x32.png', 'image/png'],
    ['/icons/apple-touch-icon-180x180.png', 'image/png'],
    ['/icons/pwa-192x192.png', 'image/png'],
    ['/icons/pwa-512x512.png', 'image/png'],
    ['/icons/pwa-maskable-512x512.png', 'image/png'],
  ]);

  for (const [route, type] of routes) {
    const response = await hit(route);
    assert.equal(response.status, 200, route);
    assert.equal(response.headers['content-type'], type, route);
    assert.equal(response.headers['cache-control'], 'no-store', route);
    assert.equal(response.headers['x-content-type-options'], 'nosniff', route);
    assert.match(response.headers['content-security-policy'], /default-src 'self'/, route);
    assert.ok(response.body.length > 0, route);

    const head = await hit(route, 'HEAD');
    assert.equal(head.status, 200, `HEAD ${route}`);
    assert.equal(head.headers['content-type'], type, `HEAD ${route}`);
    assert.equal(head.headers['cache-control'], 'no-store', `HEAD ${route}`);
    assert.equal(head.body.length, 0, `HEAD ${route}`);
  }
});

test('every manifest icon resolves directly at the size and type it declares', async () => {
  const response = await hit('/manifest.webmanifest');
  const manifest = JSON.parse(response.body.toString('utf8'));
  for (const icon of manifest.icons) {
    const asset = await hit(icon.src);
    assert.equal(asset.status, 200, icon.src);
    assert.equal(asset.headers['content-type'], icon.type, icon.src);
    const size = Number(icon.sizes.split('x')[0]);
    assert.deepEqual(pngSize(asset.body), [size, size], icon.src);
  }
});
