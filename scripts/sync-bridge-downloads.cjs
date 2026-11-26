'use strict';

/**
 * Keeps the public browser download artifacts for the Z-Systems Hardware Bridge
 * strictly synchronized under fixed, unchanging filenames:
 *   - frontend/public/downloads/z-systems-bridge.exe
 *   - frontend/public/downloads/z-systems-bridge.zip (contains ONLY z-systems-bridge.exe)
 *   - frontend/public/downloads/bridge-manifest.json
 *
 * Any older/versioned bridge artifacts (`z-systems-bridge*.exe` / `*.zip`) in
 * `frontend/public/downloads/` are deleted before writing so stale releases never
 * accumulate and download URLs never break.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const repoRoot = path.resolve(__dirname, '..');
const bridgeDir = path.join(repoRoot, 'tools', 'z-systems-bridge');
const sourceExePath = path.join(bridgeDir, 'z-systems-bridge.exe');
const programCsPath = path.join(bridgeDir, 'Program.cs');
const downloadsDir = path.join(repoRoot, 'frontend', 'public', 'downloads');
const destExePath = path.join(downloadsDir, 'z-systems-bridge.exe');
const destZipPath = path.join(downloadsDir, 'z-systems-bridge.zip');
const manifestPath = path.join(downloadsDir, 'bridge-manifest.json');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildSingleFileZip(fileName, contentBuffer, mtime) {
  const nameBuf = Buffer.from(fileName, 'utf8');
  const compressed = zlib.deflateRawSync(contentBuffer, { level: 9 });
  const crc = crc32(contentBuffer);

  const year = Math.max(1980, mtime.getFullYear());
  const dosTime =
    ((mtime.getHours() & 0x1f) << 11) |
    ((mtime.getMinutes() & 0x3f) << 5) |
    ((mtime.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((year - 1980) & 0x7f) << 9) |
    (((mtime.getMonth() + 1) & 0x0f) << 5) |
    (mtime.getDate() & 0x1f);

  const localHeader = Buffer.alloc(30 + nameBuf.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
  localHeader.writeUInt16LE(8, 8); // Deflate
  localHeader.writeUInt16LE(dosTime, 10);
  localHeader.writeUInt16LE(dosDate, 12);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(contentBuffer.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);
  nameBuf.copy(localHeader, 30);

  const centralHeader = Buffer.alloc(46 + nameBuf.length);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0x0800, 8);
  centralHeader.writeUInt16LE(8, 10);
  centralHeader.writeUInt16LE(dosTime, 12);
  centralHeader.writeUInt16LE(dosDate, 14);
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(compressed.length, 20);
  centralHeader.writeUInt32LE(contentBuffer.length, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0, 42); // offset of local header
  nameBuf.copy(centralHeader, 46);

  const centralOffset = localHeader.length + compressed.length;
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(1, 8);
  endRecord.writeUInt16LE(1, 10);
  endRecord.writeUInt32LE(centralHeader.length, 12);
  endRecord.writeUInt32LE(centralOffset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([localHeader, compressed, centralHeader, endRecord]);
}

function readBridgeVersion() {
  if (!fs.existsSync(programCsPath)) return '1.2.0';
  const source = fs.readFileSync(programCsPath, 'utf8');
  const appMatch = source.match(/AppVersion\s*=\s*"([^"]+)"/);
  if (appMatch && appMatch[1]) return appMatch[1].trim();
  const asmMatch = source.match(/AssemblyFileVersion\("([^"]+)"\)/);
  if (asmMatch && asmMatch[1]) return asmMatch[1].trim();
  return '1.2.0';
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function main() {
  if (!fs.existsSync(sourceExePath)) {
    throw new Error(`Compiled bridge binary not found at ${sourceExePath}. Compile tools/z-systems-bridge/build.bat first.`);
  }

  fs.mkdirSync(downloadsDir, { recursive: true });

  // Remove any stale/versioned bridge installers so old artifacts never accumulate.
  for (const entry of fs.readdirSync(downloadsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (/^z-systems-bridge.*\.(exe|zip)$/i.test(entry.name)) {
      fs.unlinkSync(path.join(downloadsDir, entry.name));
    }
  }

  const exeBuffer = fs.readFileSync(sourceExePath);
  const exeStat = fs.statSync(sourceExePath);
  fs.writeFileSync(destExePath, exeBuffer);

  const zipBuffer = buildSingleFileZip('z-systems-bridge.exe', exeBuffer, exeStat.mtime);
  fs.writeFileSync(destZipPath, zipBuffer);

  const manifest = {
    version: readBridgeVersion(),
    updatedAt: exeStat.mtime.toISOString(),
    exeFile: 'z-systems-bridge.exe',
    exeUrl: '/downloads/z-systems-bridge.exe',
    exeSizeBytes: exeBuffer.length,
    exeSha256: sha256(exeBuffer),
    zipFile: 'z-systems-bridge.zip',
    zipUrl: '/downloads/z-systems-bridge.zip',
    zipSizeBytes: zipBuffer.length,
    zipSha256: sha256(zipBuffer),
  };

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`[sync-bridge-downloads] Synced bridge v${manifest.version}: exe=${manifest.exeSizeBytes}B zip=${manifest.zipSizeBytes}B`);
}

main();
