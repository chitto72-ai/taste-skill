/**
 * Genera le icone PWA (PNG) senza dipendenze esterne: disegna il logo
 * Glufree (quadrato arancione, cerchio bianco, spunta verde) pixel per
 * pixel e codifica il PNG con zlib.
 *
 * Uso: node scripts/generate-icons.mjs
 */
import { deflateSync } from "zlib";
import { writeFileSync, mkdirSync } from "fs";
import path from "path";

const ORANGE = [234, 88, 12, 255];
const WHITE = [255, 255, 255, 255];
const GREEN = [5, 150, 105, 255];
const TRANSPARENT = [0, 0, 0, 0];

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
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

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtro: nessuno
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixels(x, y);
      const off = y * (size * 4 + 1) + 1 + x * 4;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = a;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Spunta ✓ dentro un cerchio: distanza dai due segmenti della spunta. */
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function makeIcon(size) {
  const c = size / 2;
  const cornerR = size * 0.22;
  const circleR = size * 0.32;
  const stroke = size * 0.045;
  // segmenti della spunta in coordinate relative al centro
  const a = [-0.14 * size, 0.0 * size];
  const b = [-0.03 * size, 0.11 * size];
  const d = [0.16 * size, -0.1 * size];

  return encodePng(size, (x, y) => {
    // quadrato con angoli arrotondati
    const qx = Math.max(Math.abs(x - c) - (c - cornerR), 0);
    const qy = Math.max(Math.abs(y - c) - (c - cornerR), 0);
    if (Math.hypot(qx, qy) > cornerR) return TRANSPARENT;

    const dist = Math.hypot(x - c, y - c);
    if (dist <= circleR) {
      const px = x - c;
      const py = y - c;
      const dCheck = Math.min(
        distToSegment(px, py, a[0], a[1], b[0], b[1]),
        distToSegment(px, py, b[0], b[1], d[0], d[1])
      );
      return dCheck <= stroke ? GREEN : WHITE;
    }
    return ORANGE;
  });
}

const outDir = path.join(process.cwd(), "public", "icons");
mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(path.join(outDir, `icon-${size}.png`), makeIcon(size));
  console.log(`✔ icon-${size}.png`);
}
