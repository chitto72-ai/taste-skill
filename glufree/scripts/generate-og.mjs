/**
 * Genera l'immagine Open Graph (1200x630) per le anteprime social, senza
 * dipendenze: sfondo crema, pin del brand a sinistra, "blocchi" mappa,
 * e il testo disegnato da un piccolo font vettoriale incorporato.
 *
 * Uso: node scripts/generate-og.mjs
 */
import { deflateSync } from "zlib";
import { writeFileSync } from "fs";
import path from "path";

const W = 1200;
const H = 630;

const COL = {
  cream: [255, 247, 237],
  ink: [15, 23, 42],
  orange: [234, 88, 12],
  green: [5, 150, 105],
  blue: [37, 99, 235],
  white: [255, 255, 255],
  block: [253, 232, 215],
  road: [255, 255, 255],
};

// ---- PNG encoder (RGBA) ----
function crc32(buf) {
  let t = crc32.t;
  if (!t) {
    t = crc32.t = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = t[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// canvas
const px = Buffer.alloc(W * H * 4);
function set(x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 4;
  const af = a / 255;
  px[o] = Math.round(px[o] * (1 - af) + r * af);
  px[o + 1] = Math.round(px[o + 1] * (1 - af) + g * af);
  px[o + 2] = Math.round(px[o + 2] * (1 - af) + b * af);
  px[o + 3] = 255;
}
function rect(x, y, w, h, col, a = 255) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, col, a);
}
function roundRect(x, y, w, h, r, col, a = 255) {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const dx = Math.min(i, w - 1 - i);
      const dy = Math.min(j, h - 1 - j);
      if (dx < r && dy < r && Math.hypot(r - dx, r - dy) > r) continue;
      set(x + i, y + j, col, a);
    }
}
function disc(cx, cy, rad, col, a = 255) {
  for (let j = -rad; j <= rad; j++)
    for (let i = -rad; i <= rad; i++)
      if (i * i + j * j <= rad * rad) set(cx + i, cy + j, col, a);
}
function thickLine(x1, y1, x2, y2, width, col, a = 255) {
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    disc(Math.round(x1 + (x2 - x1) * t), Math.round(y1 + (y2 - y1) * t), width, col, a);
  }
}

// ---- mini font 5x7 (solo i caratteri che ci servono) ----
const FONT = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  I: ["111", "010", "010", "010", "010", "010", "111"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  a: ["00000", "00000", "01110", "00001", "01111", "10001", "01111"],
  b: ["10000", "10000", "11110", "10001", "10001", "10001", "11110"],
  c: ["00000", "00000", "01111", "10000", "10000", "10000", "01111"],
  d: ["00001", "00001", "01111", "10001", "10001", "10001", "01111"],
  e: ["00000", "00000", "01110", "10001", "11111", "10000", "01111"],
  f: ["00110", "01001", "01000", "11100", "01000", "01000", "01000"],
  g: ["00000", "01111", "10001", "10001", "01111", "00001", "01110"],
  i: ["010", "000", "110", "010", "010", "010", "111"],
  l: ["110", "010", "010", "010", "010", "010", "111"],
  m: ["00000", "00000", "11110", "10101", "10101", "10101", "10101"],
  n: ["00000", "00000", "11110", "10001", "10001", "10001", "10001"],
  o: ["00000", "00000", "01110", "10001", "10001", "10001", "01110"],
  p: ["00000", "11110", "10001", "10001", "11110", "10000", "10000"],
  r: ["00000", "00000", "10110", "11001", "10000", "10000", "10000"],
  s: ["00000", "00000", "01111", "10000", "01110", "00001", "11110"],
  t: ["01000", "01000", "11100", "01000", "01000", "01001", "00110"],
  u: ["00000", "00000", "10001", "10001", "10001", "10011", "01101"],
  v: ["00000", "00000", "10001", "10001", "10001", "01010", "00100"],
  z: ["00000", "00000", "11111", "00010", "00100", "01000", "11111"],
  " ": ["000", "000", "000", "000", "000", "000", "000"],
};

function drawText(text, x, y, scale, col) {
  let cx = x;
  for (const ch of text) {
    const glyph = FONT[ch] ?? FONT[" "];
    const cols = glyph[0].length;
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < cols; c++)
        if (glyph[r][c] === "1") rect(cx + c * scale, y + r * scale, scale, scale, col);
    cx += (cols + 1) * scale;
  }
  return cx;
}

// ---------- COMPOSIZIONE ----------
rect(0, 0, W, H, COL.cream);

// Pannello mappa stilizzato a destra
const mapX = 720;
rect(mapX, 0, W - mapX, H, [246, 239, 230]);
// strade
thickLine(mapX - 20, 150, W + 20, 110, 7, COL.road);
thickLine(mapX - 20, 380, W + 20, 420, 6, COL.road);
thickLine(860, -20, 900, H + 20, 7, COL.road);
thickLine(1050, -20, 1020, H + 20, 5, COL.road);
// isolati
roundRect(mapX + 40, 200, 90, 70, 10, COL.block);
roundRect(960, 250, 110, 90, 12, COL.block);
roundRect(mapX + 30, 430, 80, 80, 10, COL.block);
roundRect(1000, 470, 120, 70, 12, COL.block);
// parco
disc(1080, 150, 55, [217, 234, 211]);
// pin sulla mappa (3 colori)
function mapPin(cx, cy, col, scale = 1) {
  for (let j = 0; j < 70 * scale; j++)
    for (let i = -28 * scale; i <= 28 * scale; i++) {
      const t = j / (70 * scale);
      const halfW = 28 * scale * (1 - t * 0.55) * (t < 0.45 ? 1 : 1 - (t - 0.45) * 1.4);
      if (Math.abs(i) <= halfW) set(cx + i, cy + j, col);
    }
  disc(cx, cy + 24 * scale, 16 * scale, COL.white);
  disc(cx, cy + 24 * scale, 9 * scale, col);
}
mapPin(860, 230, COL.green);
mapPin(1010, 360, COL.orange);
mapPin(930, 470, COL.blue);

// Pin grande del brand (a sinistra, sopra il testo)
const bx = 120;
const by = 110;
mapPin(bx + 35, by, COL.orange, 1.6);
// spunta nel cerchio del pin grande
const ccx = bx + 35;
const ccy = by + 24 * 1.6;
thickLine(ccx - 16, ccy + 2, ccx - 4, ccy + 14, 5, COL.green);
thickLine(ccx - 4, ccy + 14, ccx + 18, ccy - 12, 5, COL.green);

// Testo
drawText("Glufree", 110, 260, 11, COL.orange);
drawText("La mappa dei locali", 112, 380, 9, COL.ink);
drawText("gluten free", 112, 455, 9, COL.green);
drawText("ristoranti pizzerie e dolci senza glutine", 114, 545, 4, [71, 85, 105]);

// ---- encode ----
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const raw = Buffer.alloc(H * (W * 4 + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
const out = path.join(process.cwd(), "public", "og-image.png");
writeFileSync(out, png);
console.log(`✔ og-image.png (${W}x${H}, ${(png.length / 1024).toFixed(0)} KB)`);
