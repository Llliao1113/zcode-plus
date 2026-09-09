#!/usr/bin/env node
/*
ZCode+ 图标生成器：读取 ZCode 原版图标（黑底白 Z 圆角方形），像素级反色生成
白底黑 Z 版本，缩放打包为多尺寸 ICO（Windows）/ ICNS（macOS）。纯 Node（zlib），无第三方依赖。
用法（CLI）：node make-icon.mjs [源图标.png]   （默认 D:/Zcode/resources/icon.png，产物 ZCodePlus.ico）
模块导入：install.mjs 复用 decodePng/invert/resize/encodePng/packIco/packIcns 生成 mac 应用图标
*/
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(SCRIPT_DIR, "ZCodePlus.ico");
const SOURCE = process.argv[2] || "D:/Zcode/resources/icon.png";
const SIZES = [16, 32, 48, 256];

// ---- PNG 解码（8bit RGBA/RGB，非隔行）----
function decodePng(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("不是有效的 PNG 文件");
  let width = 0, height = 0, colorType = 0;
  const idat = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      if (data[8] !== 8 || data[12] !== 0) throw new Error("仅支持 8bit 非隔行 PNG");
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") break;
    off += 12 + len;
  }
  if (colorType !== 6 && colorType !== 2) throw new Error("仅支持 RGBA/RGB PNG，实际 colorType=" + colorType);
  const channels = colorType === 6 ? 4 : 3;
  const bpp = channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    raw.copy(line, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? line[x - bpp] : 0;
      const up = prev[x];
      const upLeft = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v = (v + left) & 0xff;          // Sub
      else if (filter === 2) v = (v + up) & 0xff;        // Up
      else if (filter === 3) v = (v + ((left + up) >> 1)) & 0xff; // Average
      else if (filter === 4) {                            // Paeth
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        v = (v + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 0xff;
      }
      line[x] = v;
    }
    for (let x = 0; x < width; x++) {
      const src = x * bpp, dst = (y * width + x) * 4;
      out[dst] = line[src];
      out[dst + 1] = line[src + 1];
      out[dst + 2] = line[src + 2];
      out[dst + 3] = channels === 4 ? line[src + 3] : 255;
    }
    line.copy(prev);
  }
  return { rgba: out, width, height };
}

// ---- 像素级反色：黑底白 Z → 白底黑 Z（alpha 保留，抗锯齿自然过渡）----
function invert(rgba) {
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 255 - rgba[i];
    rgba[i + 1] = 255 - rgba[i + 1];
    rgba[i + 2] = 255 - rgba[i + 2];
  }
  return rgba;
}

// ---- box filter 缩放（面积平均，抗锯齿质量好）----
function resize(rgba, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const sx = sw / dw, sy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = y * sy, y1 = y0 + sy;
    for (let x = 0; x < dw; x++) {
      const x0 = x * sx, x1 = x0 + sx;
      let r = 0, g = 0, b = 0, a = 0, area = 0;
      const xi0 = Math.floor(x0), xi1 = Math.min(Math.ceil(x1), sw);
      const yi0 = Math.floor(y0), yi1 = Math.min(Math.ceil(y1), sh);
      for (let yy = yi0; yy < yi1; yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        for (let xx = xi0; xx < xi1; xx++) {
          const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
          const w = wx * wy;
          const i = (yy * sw + xx) * 4;
          const alpha = rgba[i + 3] / 255;
          r += rgba[i] * alpha * w;
          g += rgba[i + 1] * alpha * w;
          b += rgba[i + 2] * alpha * w;
          a += alpha * w;
          area += w;
        }
      }
      const dst = (y * dw + x) * 4;
      const cover = area > 0 ? a / area : 0;
      const base = a > 0 ? 1 / a : 0;
      out[dst] = Math.round(r * base);
      out[dst + 1] = Math.round(g * base);
      out[dst + 2] = Math.round(b * base);
      out[dst + 3] = Math.round(cover * 255);
    }
  }
  return out;
}

// ---- 极简 PNG 编码器 ----
function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}
function encodePng(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- ICO 打包（PNG 内嵌，多尺寸）----
function packIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = header.length + dir.length;
  pngs.forEach((png, idx) => {
    const e = 16 * idx;
    dir[e] = SIZES[idx] >= 256 ? 0 : SIZES[idx];
    dir[e + 1] = SIZES[idx] >= 256 ? 0 : SIZES[idx];
    dir.writeUInt16LE(1, e + 4);
    dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(png.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...pngs]);
}

// ---- ICNS 打包（macOS，PNG 内嵌；现代类型，10.7+ 系统均支持）----
// sizes 显式传 { type, size } 列表：由调用方按源图尺寸决定放哪些（不放大超过源尺寸）
function packIcns(entries) {
  const parts = [];
  for (const { type, png } of entries) {
    const entry = Buffer.alloc(8 + png.length);
    entry.write(type, 0, "ascii");
    entry.writeUInt32BE(8 + png.length, 4);
    png.copy(entry, 8);
    parts.push(entry);
  }
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.write("icns", 0, "ascii");
  header.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([header, body]);
}

function main() {
  const { rgba, width, height } = decodePng(SOURCE);
  // 角点采样报告：确认圆角外是否透明（不透明则反色后是白色直角，需提醒）
  const corners = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]];
  const cornerAlpha = corners.map(([x, y]) => rgba[(y * width + x) * 4 + 3]);
  const maxCorner = Math.max(...cornerAlpha);
  invert(rgba);
  const pngs = SIZES.map((s) => encodePng(resize(rgba, width, height, s, s), s, s));
  fs.writeFileSync(OUT, packIco(pngs));
  console.log(`已生成 ${OUT}（源 ${width}x${height}，反色白底黑 Z，尺寸 ${SIZES.join("/")}）`);
  if (maxCorner > 0) {
    console.log(`注意：源图四角 alpha 最大值 ${maxCorner}（非全透明），图标可能呈方形而非圆角显示`);
  }
}

// CLI 直跑才生成 ico；被 import 时不执行（install.mjs 复用函数生成 mac 图标）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
export { decodePng, invert, resize, encodePng, packIco, packIcns };
