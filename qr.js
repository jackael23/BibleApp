// 2026-11-21: Maliit na QR code generator (walang npm install) para maipakita sa itim na window ng PC
// ang link ng app, para ma-scan ng phone. Byte mode, error correction "M", version 1-10 (hanggang ~210 letra).
// Batay sa QR Code spec (ISO/IEC 18004); ang ayos ng code ay sumusunod sa kilalang "qrcodegen" ni Nayuki.
"use strict";

// Per version (index 1..10), error correction level M: [total codewords, EC codewords per block, number of blocks]
const TABLE_M = [null, [26,10,1], [44,16,1], [70,26,1], [100,18,2], [134,24,2], [172,16,4], [196,18,4], [242,22,4], [292,22,5], [346,26,5]];
const ALIGN = [null, [], [6,18], [6,22], [6,26], [6,30], [6,34], [6,22,38], [6,24,42], [6,26,46], [6,28,50]];

function gfMul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z; }
function rsDivisor(deg) {
  const r = new Array(deg).fill(0); r[deg - 1] = 1; let root = 1;
  for (let i = 0; i < deg; i++) {
    for (let j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
    root = gfMul(root, 0x02);
  }
  return r;
}
function rsRemainder(data, div) {
  const r = div.map(() => 0);
  for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gfMul(c, f); }); }
  return r;
}

function qrMatrix(text) {
  const bytes = Buffer.from(String(text), "utf8");
  let ver = 0;
  for (let v = 1; v <= 10; v++) {
    const [total, ec, blocks] = TABLE_M[v];
    if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= (total - ec * blocks) * 8) { ver = v; break; }
  }
  if (!ver) throw new Error("Masyadong mahaba para sa QR");
  const [total, ecLen, numBlocks] = TABLE_M[ver];
  const dataCap = total - ecLen * numBlocks;

  // Data bits: mode 0100 (byte), length, bytes, terminator, pad
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); for (const b of bytes) put(b, 8);
  put(0, Math.min(4, dataCap * 8 - bits.length));
  put(0, (8 - bits.length % 8) % 8);
  for (let pad = 0xEC; bits.length < dataCap * 8; pad ^= 0xEC ^ 0x11) put(pad, 8);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));

  // Split into blocks, add Reed-Solomon EC, interleave
  const shortLen = Math.floor(total / numBlocks), numShort = numBlocks - total % numBlocks;
  const div = rsDivisor(ecLen), blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - ecLen + (i < numShort ? 0 : 1)); k += dat.length;
    blocks.push({dat, ec: rsRemainder(dat, div)});
  }
  const cw = [];
  for (let i = 0; i <= shortLen - ecLen; i++) for (const b of blocks) if (i < b.dat.length) cw.push(b.dat[i]);
  for (let i = 0; i < ecLen; i++) for (const b of blocks) cw.push(b.ec[i]);

  // Function patterns
  const size = ver * 4 + 17;
  const mod = Array.from({length: size}, () => new Array(size).fill(false));
  const fn = Array.from({length: size}, () => new Array(size).fill(false));
  const set = (x, y, dark) => { mod[y][x] = !!dark; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const al = ALIGN[ver];
  for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const drawFormat = mask => {
    const d = (0 << 3) | mask; // level M = 0
    let rem = d; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((d << 10) | rem) ^ 0x5412, bit = i => (b >>> i) & 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0); // reserve
  if (ver >= 7) {
    let rem = ver; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    const b = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) { const bt = (b >>> i) & 1, a = size - 11 + i % 3, c = Math.floor(i / 3); set(a, c, bt); set(c, a, bt); }
  }

  // Data, zigzag from the bottom-right
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
      if (!fn[y][x] && i < cw.length * 8) { mod[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }

  // Pick the mask with the lowest penalty
  const MASKS = [(x,y)=>(x+y)%2===0, (x,y)=>y%2===0, (x,y)=>x%3===0, (x,y)=>(x+y)%3===0,
    (x,y)=>(Math.floor(x/3)+Math.floor(y/2))%2===0, (x,y)=>x*y%2+x*y%3===0, (x,y)=>(x*y%2+x*y%3)%2===0, (x,y)=>((x+y)%2+x*y%3)%2===0];
  const applyMask = m => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x]; };
  const penalty = () => {
    let p = 0, dark = 0;
    const line = get => { // runs + finder-like patterns along one line
      let run = 1;
      for (let k = 1; k <= size; k++) {
        if (k < size && get(k) === get(k - 1)) run++; else { if (run >= 5) p += run - 2; run = 1; }
      }
      for (let k = 0; k + 11 <= size; k++) {
        const s = Array.from({length: 11}, (_, t) => get(k + t) ? 1 : 0).join("");
        if (s === "10111010000" || s === "00001011101") p += 40;
      }
    };
    for (let y = 0; y < size; y++) line(x => mod[y][x]);
    for (let x = 0; x < size; x++) line(y => mod[y][x]);
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = mod[y][x]; if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3;
    }
    for (const row of mod) for (const c of row) if (c) dark++;
    p += (Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1) * 10;
    return p;
  };
  let best = 0, bestP = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m); drawFormat(m);
    const pp = penalty(); if (pp < bestP) { bestP = pp; best = m; }
    applyMask(m); // undo (XOR)
  }
  applyMask(best); drawFormat(best);
  return mod;
}

// Text for a terminal with a dark background: light = "█", 2 rows per line (▀ ▄), 2-module quiet zone.
function qrTerminal(text) {
  const m = qrMatrix(text), q = 2, n = m.length + q * 2;
  const light = (x, y) => { x -= q; y -= q; return x < 0 || y < 0 || x >= m.length || y >= m.length || !m[y][x]; };
  const lines = [];
  for (let y = 0; y < n; y += 2) {
    let s = "";
    for (let x = 0; x < n; x++) {
      const t = light(x, y), b = y + 1 < n ? light(x, y + 1) : false;
      s += t && b ? "█" : t ? "▀" : b ? "▄" : " ";
    }
    lines.push(s);
  }
  return lines.join("\n");
}

module.exports = {qrMatrix, qrTerminal};
