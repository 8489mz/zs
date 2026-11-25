import assert from 'node:assert/strict';
import { OfflineReleasesService } from '../../src/modules/settings/services/offline-releases.service';
import * as crypto from 'crypto';
import AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';

async function run() {
  const service = new OfflineReleasesService({} as any);

  // Mock env
  process.env.APP_MODE = 'SELF_CONTAINED';
  process.env.PORTABLE_MODE = 'true';
  process.env.ELECTRON_EXE_PATH = path.join(process.cwd(), 'electron.exe');
  process.env.NODE_ENV = 'test';

  const exitOrig = process.exit;
  (process as any).exit = () => {};

  // Create dummy ApplyAndRestart.ps1
  const scriptDir = path.join(process.cwd(), 'tools', 'launcher', 'scripts');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(path.join(scriptDir, 'ApplyAndRestart.ps1'), '');

  function createValidManifest(zip: AdmZip) {
    const files = [
      { path: 'backend/dist/main.js', content: 'console.log("backend");' },
      { path: 'backend/package.json', content: '{"version": "1.2.0"}' },
      { path: 'frontend/dist/index.html', content: '<html></html>' }
    ];
    
    const manifestFiles = [];
    
    for (const f of files) {
      zip.addFile(f.path, Buffer.from(f.content));
      manifestFiles.push({
        path: f.path,
        sha256: crypto.createHash('sha256').update(f.content).digest('hex')
      });
    }

    const manifest = {
      version: '1.2.0',
      createdAt: new Date().toISOString(),
      expectedFolders: ['backend/dist', 'backend/package.json', 'frontend/dist'],
      files: manifestFiles
    };

    zip.addFile('update-manifest.json', Buffer.from(JSON.stringify(manifest)));
    return zip;
  }

  try {
    // 1. Missing Manifest
    const zip1 = new AdmZip();
    zip1.addFile('backend/dist/main.js', Buffer.from('code'));
    try {
      await service.applyLocalZipUpdate({ buffer: zip1.toBuffer() } as any);
      assert.fail('Should reject missing manifest');
    } catch (e: any) {
      assert.ok(e.message.includes('لا يحتوي على update-manifest.json'), 'Missing manifest error expected');
    }

    // 2. Path Traversal
    const zip2 = new AdmZip();
    zip2.addFile('evil.dll', Buffer.from('evil'));
    zip2.getEntries()[0].entryName = '../Windows/System32/evil.dll';
    try {
      await service.applyLocalZipUpdate({ buffer: zip2.toBuffer() } as any);
      assert.fail('Should reject path traversal');
    } catch (e: any) {
      assert.ok(e.message.includes('مسار غير آمن في الملف'), 'Path traversal error expected');
    }

    // 3. Absolute Paths
    const zip3 = new AdmZip();
    zip3.addFile('C:/Windows/System32/evil.dll', Buffer.from('evil'));
    try {
      await service.applyLocalZipUpdate({ buffer: zip3.toBuffer() } as any);
      assert.fail('Should reject absolute paths');
    } catch (e: any) {
      assert.ok(e.message.includes('مسار غير آمن في الملف'), 'Path traversal error expected');
    }

    // 4. Invalid Checksum
    const zip4 = new AdmZip();
    createValidManifest(zip4);
    zip4.updateFile('backend/dist/main.js', Buffer.from('console.log("hacked");'));
    try {
      await service.applyLocalZipUpdate({ buffer: zip4.toBuffer() } as any);
      assert.fail('Should reject checksum mismatch');
    } catch (e: any) {
      assert.ok(e.message.includes('Checksum Mismatch'), 'Checksum error expected');
    }

    // 5. Valid Zip
    const zip5 = new AdmZip();
    createValidManifest(zip5);
    const res = await service.applyLocalZipUpdate({ buffer: zip5.toBuffer() } as any);
    assert.equal(res.ok, true);
    assert.equal(res.version, '1.2.0');

    process.stdout.write('offline-releases.security.spec: ok\n');
  } finally {
    // Restore
    (process as any).exit = exitOrig;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
