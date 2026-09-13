import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

// Generate a small PNG-backed ICO without adding a binary asset to the source tree.
// Windows accepts PNG payloads in ICO files and electron-builder embeds it in the installer.
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return result;
}

function png() {
  const size = 256;
  const scanlines = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    scanlines[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const inMark = (x >= 58 && x <= 100 && y >= 44 && y <= 211) || (x >= 58 && x <= 181 && y >= 169 && y <= 211);
      const offset = row + 1 + x * 4;
      if (inMark) scanlines[offset] = 0x8be9c4, scanlines[offset + 1] = 0x9af5d1, scanlines[offset + 2] = 0xff, scanlines[offset + 3] = 0xff;
      else scanlines[offset] = 0x11, scanlines[offset + 1] = 0x14, scanlines[offset + 2] = 0x19, scanlines[offset + 3] = 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'binary'), chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const payload = png();
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[6] = 0;
header[7] = 0;
header.writeUInt16LE(1, 8);
header.writeUInt16LE(32, 10);
header.writeUInt32LE(payload.length, 14);
header.writeUInt32LE(22, 18);
await writeFile(process.argv[2], Buffer.concat([header, payload]));
