#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconDir = path.join(root, 'public', 'icons');
const publicDir = path.join(root, 'public');

// The approved Double dash artwork, kept in one normalized 100 × 100 geometry.
// App icons are full bleed; favicon exports use the same field with a 24-unit
// corner radius so the silhouette stays recognizable against browser chrome.
const COLORS = {
  blueTop: [0x34, 0x78, 0xf6],
  blueBottom: [0x17, 0x47, 0xc3],
  track: [0x12, 0x37, 0x9a],
  light: [0xf4, 0xf8, 0xff],
  good: [0x65, 0xdc, 0x8c],
};

const EXPORTS = [
  { file: 'favicon-16x16.png', size: 16, rounded: true },
  { file: 'favicon-32x32.png', size: 32, rounded: true },
  { file: 'apple-touch-icon-180x180.png', size: 180, rounded: false },
  { file: 'pwa-192x192.png', size: 192, rounded: false },
  { file: 'pwa-512x512.png', size: 512, rounded: false },
  { file: 'pwa-maskable-512x512.png', size: 512, rounded: false },
];

const SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-labelledby="title desc">
  <title id="title">llmdash Double dash icon</title>
  <desc id="desc">A cobalt rounded square with a long warm-white allowance bar and a shorter green headroom bar.</desc>
  <defs>
    <linearGradient id="blue" x1="20" y1="8" x2="82" y2="96" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#3478f6"/>
      <stop offset="1" stop-color="#1747c3"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="24" fill="url(#blue)"/>
  <rect x="17.75" y="21.75" width="64.5" height="15" rx="7.5" fill="#12379a"/>
  <rect x="17.75" y="21.75" width="49.25" height="15" rx="7.5" fill="#f4f8ff"/>
  <rect x="17" y="55" width="66" height="15" rx="7.5" fill="#12379a"/>
  <rect x="17" y="55" width="35" height="15" rx="7.5" fill="#65dc8c"/>
</svg>
`;

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function mix(a, b, amount) {
  return a.map((value, index) => Math.round(value + (b[index] - value) * amount));
}

function gradientAt(x, y) {
  const dx = 82 - 20;
  const dy = 96 - 8;
  const amount = Math.min(1, Math.max(0, ((x - 20) * dx + (y - 8) * dy) / (dx * dx + dy * dy)));
  return mix(COLORS.blueTop, COLORS.blueBottom, amount);
}

function sample(x, y, rounded) {
  if (rounded && !insideRoundedRect(x, y, 0, 0, 100, 100, 24)) return null;
  let color = gradientAt(x, y);
  // The upper bar is inset and lowered by 0.75 units from the review mockup.
  // That subpixel-scale correction keeps its rounded caps wholly inside the
  // maskable icon's central 80% safe circle without changing the visual read.
  if (insideRoundedRect(x, y, 17.75, 21.75, 82.25, 36.75, 7.5)) color = COLORS.track;
  if (insideRoundedRect(x, y, 17.75, 21.75, 67, 36.75, 7.5)) color = COLORS.light;
  if (insideRoundedRect(x, y, 17, 55, 83, 70, 7.5)) color = COLORS.track;
  if (insideRoundedRect(x, y, 17, 55, 52, 70, 7.5)) color = COLORS.good;
  return color;
}

function raster(size, rounded) {
  const supersample = size <= 32 ? 8 : 4;
  const sampleCount = supersample * supersample;
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let covered = 0;
      for (let sy = 0; sy < supersample; sy += 1) {
        for (let sx = 0; sx < supersample; sx += 1) {
          const x = ((px + (sx + 0.5) / supersample) / size) * 100;
          const y = ((py + (sy + 0.5) / supersample) / size) * 100;
          const color = sample(x, y, rounded);
          if (!color) continue;
          red += color[0];
          green += color[1];
          blue += color[2];
          covered += 1;
        }
      }
      const offset = (py * size + px) * 4;
      if (covered > 0) {
        pixels[offset] = Math.round(red / covered);
        pixels[offset + 1] = Math.round(green / covered);
        pixels[offset + 2] = Math.round(blue / covered);
        pixels[offset + 3] = Math.round((covered / sampleCount) * 255);
      }
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return output;
}

function png(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = size * 4;
  const scanlines = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) pixels.copy(scanlines, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function ico(images) {
  const directorySize = 6 + images.length * 16;
  const directory = Buffer.alloc(directorySize);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);
  let offset = directorySize;
  images.forEach(({ size, bytes }, index) => {
    const entry = 6 + index * 16;
    directory[entry] = size === 256 ? 0 : size;
    directory[entry + 1] = size === 256 ? 0 : size;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(bytes.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += bytes.length;
  });
  return Buffer.concat([directory, ...images.map((image) => image.bytes)]);
}

function buildOutputs() {
  const outputs = new Map();
  for (const item of EXPORTS) {
    outputs.set(path.join(iconDir, item.file), png(item.size, raster(item.size, item.rounded)));
  }
  outputs.set(path.join(iconDir, 'llmdash.svg'), Buffer.from(SVG));
  outputs.set(path.join(publicDir, 'favicon.ico'), ico([16, 32].map((size) => ({
    size,
    bytes: outputs.get(path.join(iconDir, `favicon-${size}x${size}.png`)),
  }))));
  return outputs;
}

const outputs = buildOutputs();
if (process.argv.includes('--check')) {
  let stale = false;
  for (const [file, expected] of outputs) {
    const actual = fs.existsSync(file) ? fs.readFileSync(file) : null;
    if (!actual || !actual.equals(expected)) {
      console.error(`${path.relative(root, file)} is missing or out of date`);
      stale = true;
    }
  }
  if (stale) process.exitCode = 1;
} else {
  fs.mkdirSync(iconDir, { recursive: true });
  for (const [file, bytes] of outputs) fs.writeFileSync(file, bytes);
  console.log(`Wrote ${outputs.size} llmdash icon assets.`);
}
