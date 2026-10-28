'use strict';

// Rasterize the repository-native SVG mark for Windows PNG/ICO consumers.
// No downloaded branding or proprietary assets are included.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const size = 256;
const supersample = 3;
const pixels = Buffer.alloc((size * 4 + 1) * size);
const bg = [41, 38, 63, 255];
function rounded(x, y) { const dx = Math.max(56 - x, x - 200, 0); const dy = Math.max(56 - y, y - 200, 0); return dx * dx + dy * dy <= 56 * 56; }
function inside(x, y, points) { let c = false; for (let i = 0, j = points.length - 1; i < points.length; j = i++) { const a = points[i], b = points[j]; if (((a[1] > y) !== (b[1] > y)) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
const mark = [[66, 77], [136, 77], [156, 80], [171, 90], [181, 108], [181, 130], [170, 151], [151, 160], [99, 161], [99, 134], [136, 134], [147, 129], [152, 119], [147, 109], [136, 104], [95, 104], [95, 179], [66, 179]];
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const values = [0, 0, 0, 0]; for (let sy = 0; sy < supersample; sy++) for (let sx = 0; sx < supersample; sx++) { const px = x + (sx + .5) / supersample, py = y + (sy + .5) / supersample; let color = rounded(px, py) ? bg : [0, 0, 0, 0]; if (inside(px, py, mark)) color = [255, 255, 255, 255]; if (px >= 161 && px < 190 && py >= 157 && py < 179) color = [165, 180, 252, 255]; color.forEach((v, i) => { values[i] += v; }); } const offset = y * (size * 4 + 1) + 1 + x * 4; values.forEach((v, i) => { pixels[offset + i] = Math.round(v / (supersample * supersample)); }); }
function crc32(data) { let crc = 0xffffffff; for (const value of data) { crc ^= value; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(name, data) { const type = Buffer.from(name); const bytes = Buffer.alloc(12 + data.length); bytes.writeUInt32BE(data.length, 0); type.copy(bytes, 4); data.copy(bytes, 8); bytes.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length); return bytes; }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
const icoHeader = Buffer.alloc(22); icoHeader.writeUInt16LE(1, 2); icoHeader.writeUInt16LE(1, 4); icoHeader.writeUInt16LE(1, 10); icoHeader.writeUInt16LE(32, 12); icoHeader.writeUInt32LE(png.length, 14); icoHeader.writeUInt32LE(22, 18);
const root = path.resolve(__dirname, '../assets'); fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(path.join(root, 'icon.png'), png); fs.writeFileSync(path.join(root, 'icon.ico'), Buffer.concat([icoHeader, png]));
console.log('Generated Windows PNG/ICO mark from repository geometry.');
