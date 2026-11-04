/*
 * INV-OFFLINE-UPDATE-CHANNEL-ZSUPDATES: after the zs repository went
 * private, desktop update checks must read the PUBLIC releases-only
 * repository 8489mx/zsupdates — never the private zs repo, which is
 * unreachable unauthenticated. Every update-channel URL (raw
 * manifest, releases API, patch-download fallbacks, and the manifest
 * the release generator writes) is built from one repo constant in
 * OfflineReleasesService, with a ZS_OFFLINE_UPDATE_REPO env override
 * for operators. The SHA-256 pin (assertTrustedOfflineUpdatePackage /
 * ZS_TRUSTED_OFFLINE_UPDATE_SHA256) is unchanged: a channel move
 * never weakens package verification.
 *
 * HONEST LIMIT, recorded loudly: no release or manifest exists in
 * zsupdates yet, so no live fetch against the channel is proven here.
 * The spec proves URL construction and SHA verification against
 * fixtures with a stubbed fetch, never a live network call. The first
 * published release must place manifest-latest.json on the `main`
 * branch of zsupdates plus the patch zip, or clients silently fall
 * back (backend: releases API; frontend: no update offered) exactly
 * as they did on the old channel. Docs, deploy workflows, and CI
 * links that reference 8489mx/zs as the SOURCE repository are
 * deliberately untouched — only the update channel moved.
 *
 * WHAT THIS PINS, driving the REAL builders and the REAL
 * fetchGitHubLatestRelease with a stubbed fetch: default repo is
 * 8489mx/zsupdates; manifest URL, API URL, and both download
 * fallbacks point at it with no '/zs/' repo segment; the env override
 * re-points every builder; a manifest without patchUrl yields a
 * zsupdates download URL; the releases-API fallback yields a
 * zsupdates download URL; an explicit manifest patchUrl is honoured
 * verbatim; the SHA-256 pin still rejects wrong/empty digests and
 * accepts the correct one; the release-generator script and the
 * frontend hook carry no old-channel URL.
 */

import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  OFFLINE_UPDATE_REPO_DEFAULT,
  OfflineReleasesService,
  assertTrustedOfflineUpdatePackage,
  offlineUpdateManifestUrl,
  offlineUpdateReleaseDownloadUrl,
  offlineUpdateReleasesApiUrl,
  offlineUpdateRepo,
} from '../../src/modules/settings/services/offline-releases.service';

function noOldChannel(url: string, label: string): void {
  assert.ok(!url.includes('/8489mx/zs/'), `${label} must not point at the private zs repo: ${url}`);
  assert.ok(url.includes('/8489mx/zsupdates/'), `${label} must point at zsupdates: ${url}`);
}

async function main(): Promise<void> {
  // 1. Default channel + URL shapes.
  assert.equal(OFFLINE_UPDATE_REPO_DEFAULT, '8489mx/zsupdates');
  assert.equal(offlineUpdateRepo(), '8489mx/zsupdates');
  assert.equal(
    offlineUpdateManifestUrl(),
    'https://raw.githubusercontent.com/8489mx/zsupdates/main/releases/manifest-latest.json',
  );
  assert.equal(
    offlineUpdateReleasesApiUrl(),
    'https://api.github.com/repos/8489mx/zsupdates/releases/latest',
  );
  assert.equal(
    offlineUpdateReleaseDownloadUrl('1.2.3', 'patch-1.2.3.zip'),
    'https://github.com/8489mx/zsupdates/releases/download/v1.2.3/patch-1.2.3.zip',
  );
  assert.equal(
    offlineUpdateReleaseDownloadUrl('v1.2.3', 'Z-ERP-Patch-v1.2.3.zip'),
    'https://github.com/8489mx/zsupdates/releases/download/v1.2.3/Z-ERP-Patch-v1.2.3.zip',
  );
  for (const url of [offlineUpdateManifestUrl(), offlineUpdateReleasesApiUrl(), offlineUpdateReleaseDownloadUrl('1.2.3', 'x.zip')]) {
    noOldChannel(url, 'builder URL');
  }

  // 2. Env override re-points every builder, then restores the default.
  const originalOverride = process.env.ZS_OFFLINE_UPDATE_REPO;
  try {
    process.env.ZS_OFFLINE_UPDATE_REPO = 'example/mirror';
    assert.equal(offlineUpdateRepo(), 'example/mirror');
    assert.ok(offlineUpdateManifestUrl().includes('/example/mirror/'));
    assert.ok(offlineUpdateReleasesApiUrl().includes('/example/mirror/'));
    assert.ok(offlineUpdateReleaseDownloadUrl('1.0.0', 'x.zip').includes('/example/mirror/'));
  } finally {
    if (originalOverride === undefined) delete process.env.ZS_OFFLINE_UPDATE_REPO;
    else process.env.ZS_OFFLINE_UPDATE_REPO = originalOverride;
  }
  assert.equal(offlineUpdateRepo(), '8489mx/zsupdates');

  // 3. fetchGitHubLatestRelease against stubbed fetch (no live network).
  const service = new OfflineReleasesService(undefined as never);
  const realFetch = globalThis.fetch;
  try {
    // 3a. Manifest without patchUrl -> zsupdates download fallback.
    globalThis.fetch = (async (url: unknown) => ({
      ok: true,
      json: async () => ({ version: '1.4.0', changelog: 'notes' }),
    })) as never;
    const fromManifest = await service.fetchGitHubLatestRelease();
    assert.ok(fromManifest, 'manifest path must resolve');
    noOldChannel(fromManifest!.patchUrl, 'manifest download URL');
    assert.equal(
      fromManifest!.patchUrl,
      'https://github.com/8489mx/zsupdates/releases/download/v1.4.0/Z-ERP-Patch-v1.4.0.zip',
    );

    // 3b. Manifest fetch fails, releases API answers -> zsupdates fallback URL.
    let calls = 0;
    globalThis.fetch = (async (url: unknown) => {
      calls += 1;
      if (calls === 1) throw new Error('raw unreachable');
      return {
        ok: true,
        json: async () => ({ tag_name: 'v1.5.0', body: 'api notes', assets: [] }),
      };
    }) as never;
    const fromApi = await service.fetchGitHubLatestRelease();
    assert.ok(fromApi, 'API fallback path must resolve');
    assert.equal(fromApi!.version, '1.5.0');
    noOldChannel(fromApi!.patchUrl, 'API download URL');
    assert.equal(
      fromApi!.patchUrl,
      'https://github.com/8489mx/zsupdates/releases/download/v1.5.0/patch-1.5.0.zip',
    );

    // 3c. Explicit manifest patchUrl is honoured verbatim.
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ version: '1.6.0', patchUrl: 'https://mirror.example.com/custom.zip' }),
    })) as never;
    const explicit = await service.fetchGitHubLatestRelease();
    assert.equal(explicit!.patchUrl, 'https://mirror.example.com/custom.zip');

    // 3d. Both sources unreachable -> null, never a throw.
    globalThis.fetch = (async () => { throw new Error('offline'); }) as never;
    assert.equal(await service.fetchGitHubLatestRelease(), null);
  } finally {
    globalThis.fetch = realFetch;
  }

  // 4. SHA-256 pin unchanged: wrong/empty digests rejected, correct one accepted.
  const buffer = Buffer.from('fake-update-bytes');
  const digest = crypto.createHash('sha256').update(buffer).digest('hex');
  assertTrustedOfflineUpdatePackage(buffer, digest);
  assert.throws(() => assertTrustedOfflineUpdatePackage(buffer, '0'.repeat(64)), /SHA256 does not match/);
  assert.throws(() => assertTrustedOfflineUpdatePackage(buffer, undefined), /must be provisioned/);
  assert.throws(() => assertTrustedOfflineUpdatePackage(Buffer.alloc(0), digest), /empty/);

  // 5. Source pins: release generator + frontend hook carry no old-channel URL.
  const script = fs.readFileSync(
    path.resolve(__dirname, '../../scripts/generate-release-package.ts'),
    'utf8',
  );
  assert.ok(script.includes('8489mx/zsupdates'), 'release generator must write zsupdates patch URLs');
  assert.ok(!script.includes('8489mx/zs/'), 'release generator must not reference the old channel');
  const hook = fs.readFileSync(
    path.resolve(__dirname, '../../../frontend/src/shared/hooks/use-offline-update-check.ts'),
    'utf8',
  );
  assert.ok(hook.includes('8489mx/zsupdates'), 'frontend hook default must be zsupdates');
  assert.ok(!hook.includes('8489mx/zs/'), 'frontend hook must not reference the old channel');
  assert.ok(
    hook.includes('getOfflineUpdateApiBaseUrl()'),
    'frontend direct fetch must honour the env override via the shared helper',
  );

  console.log('offline-update-channel.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
