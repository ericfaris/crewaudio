#!/usr/bin/env node
// Generate study PWA icons as PNGs — no image libraries, just zlib.
// Draws a rounded-square badge with a headphone arc + play triangle.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td));
  return Buffer.concat([len, td, crc]);
}

function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// simple painter's helpers on an RGBA buffer
function makeCanvas(size) {
  const buf = Buffer.alloc(size * size * 4);
  const px = (x, y, [r, g, b, a = 255]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const ia = a / 255, ib = 1 - ia;
    buf[i] = r * ia + buf[i] * ib;
    buf[i + 1] = g * ia + buf[i + 1] * ib;
    buf[i + 2] = b * ia + buf[i + 2] * ib;
    buf[i + 3] = Math.max(buf[i + 3], a);
  };
  return { buf, px };
}

function draw(size, { maskable = false } = {}) {
  const { buf, px } = makeCanvas(size);
  const s = size;
  const pad = maskable ? 0 : s * 0.06;        // full-bleed for maskable
  const radius = maskable ? 0 : s * 0.22;
  const bg = [109, 94, 248];                   // #6d5ef8 (study violet)
  const fg = [255, 255, 255];                  // #ffffff

  // rounded-square background (4x supersampled edges)
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    let hit = 0;
    for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
      const fx = x + sx / 2 + 0.25, fy = y + sy / 2 + 0.25;
      const inX = fx >= pad && fx <= s - pad, inY = fy >= pad && fy <= s - pad;
      if (!inX || !inY) continue;
      const cx = Math.min(Math.max(fx, pad + radius), s - pad - radius);
      const cy = Math.min(Math.max(fy, pad + radius), s - pad - radius);
      if (Math.hypot(fx - cx, fy - cy) <= radius + 0.5) hit++;
    }
    if (hit) px(x, y, [...bg, (hit / 4) * 255]);
  }

  const cx = s / 2, cy = s * 0.52;
  const R = s * 0.26;          // headband radius
  const band = s * 0.055;      // stroke width

  // headphone band: top arc
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (Math.abs(d - R) <= band / 2 && y < cy) px(x, y, fg);
  }
  // ear cups
  const cupW = s * 0.11, cupH = s * 0.17, cupY = cy, cupR = s * 0.045;
  for (const dir of [-1, 1]) {
    const ex = cx + dir * R;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const lx = x - (ex - cupW / 2), ly = y - (cupY - cupH / 2);
      if (lx < 0 || ly < 0 || lx > cupW || ly > cupH) continue;
      const rx = Math.min(Math.max(lx, cupR), cupW - cupR);
      const ry = Math.min(Math.max(ly, cupR), cupH - cupR);
      if (Math.hypot(lx - rx, ly - ry) <= cupR + 0.5) px(x, y, fg);
    }
  }

  // play triangle in the middle
  const tS = s * 0.13;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const rx = x - (cx - tS * 0.35), ry = y - cy;
    if (rx >= 0 && Math.abs(ry) <= tS * (1 - rx / tS) && rx <= tS) px(x, y, bg);
  }

  return encodePNG(s, buf);
}

const jobs = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
];
for (const [name, size, opt] of jobs) {
  fs.writeFileSync(path.join(OUT, name), draw(size, opt));
  console.log('wrote', name);
}
