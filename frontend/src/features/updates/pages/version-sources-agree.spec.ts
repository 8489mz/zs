/* Version sources agree (INV-VERSION-DISPLAY-STALE): the footer and the
 * /updates page show the version they read from the repo's own version
 * sources — frontend/package.json via __APP_VERSION__ (footer, Vite define)
 * and GET /api/updates/version, which the backend answers from its
 * package.json — while the "current stable" release comes from
 * releases/manifest-*.json. Proven live on test10k after deploy #963: the
 * footer was frozen at 1.1.40 (package.json last bumped 2026-10-29, never
 * bumped again through batches 1-12) and /updates called 1.1.35 the current
 * stable release (newest manifest, 2026-10-18; no release record existed for
 * 1.1.40, so the page fell back to 1.1.35 as the current release). The fix
 * publishes one version, 1.1.41, in every source. This spec follows the
 * deploy-pipeline.spec.ts precedent: it asserts on the real repo files and
 * the real display wiring, because version resolution is split across the
 * Vite define, the backend version endpoint and the manifest seed — there is
 * no single pure function to import. It fails at the pre-fix base on the
 * manifest assertions (1.1.35 != 1.1.40, no manifest-1.1.40.json).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');

/* Strip a leading UTF-8 BOM, as the backend manifest seed does
 * (offline-releases.service.ts syncManifestsFromDisk): some committed
 * manifests carry one and JSON.parse rejects it. */
const readJson = (relative: string) => JSON.parse(readFileSync(join(ROOT, relative), 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>;
const readText = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');

const PACKAGE_FILES = [
  'package.json',
  'frontend/package.json',
  'backend/package.json',
  'frontend/electron/backend/package.json',
] as const;

function appVersion(): string {
  return String(readJson('package.json').version);
}

/* Test-only semver ordering for the manifest list (mirrors the hook's
 * parseSemver); the business comparison lives in the backend service. */
function parseSemver(v: string): number[] {
  return v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
}

function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function versionedManifests(): string[] {
  return readdirSync(join(ROOT, 'releases'))
    .filter((f) => /^manifest-\d+\.\d+\.\d+\.json$/.test(f))
    .map((f) => String(readJson(`releases/${f}`).version));
}

describe('version sources agree (INV-VERSION-DISPLAY-STALE)', () => {
  it('all package.json files declare one app version', () => {
    const versions = PACKAGE_FILES.map((f) => String(readJson(f).version));
    for (const [i, v] of versions.entries()) {
      expect(v, `${PACKAGE_FILES[i]} must declare the app version`).toMatch(/^\d+\.\d+\.\d+$/);
      expect(v, `${PACKAGE_FILES[i]} must agree with the root package.json`).toBe(versions[0]);
    }
  });

  it('manifest-latest names the running app version (the published version)', () => {
    const latest = String(readJson('releases/manifest-latest.json').version);
    expect(latest).toBe(appVersion());
  });

  it('a release manifest exists for the running app version', () => {
    const version = appVersion();
    const manifestPath = `releases/manifest-${version}.json`;
    expect(existsSync(join(ROOT, manifestPath)), `${manifestPath} must exist so /updates finds the running version in its release history`).toBe(true);
    expect(String(readJson(manifestPath).version)).toBe(version);
  });

  it('manifest-latest is the newest release and no release is newer than the app', () => {
    const manifests = versionedManifests();
    expect(manifests.length).toBeGreaterThan(0);
    const newest = [...manifests].sort(compareSemver).at(-1)!;
    expect(String(readJson('releases/manifest-latest.json').version)).toBe(newest);
    for (const v of manifests) {
      expect(compareSemver(v, appVersion()), `release ${v} must not be newer than the running app ${appVersion()}`).toBeLessThanOrEqual(0);
    }
  });

  it('the footer and the updates page read the version from these sources, not a literal', () => {
    const viteConfig = readText('frontend/vite.config.ts');
    expect(viteConfig).toContain('__APP_VERSION__: JSON.stringify(pkg.version)');
    const appShell = readText('frontend/src/shared/layout/app-shell.tsx');
    expect(appShell).toContain('__APP_VERSION__');
    const updatesSection = readText('frontend/src/features/settings/components/workspace-sections/SystemUpdatesSection.tsx');
    expect(updatesSection).toContain('__APP_VERSION__');
    expect(updatesSection).toContain('/api/updates/version');
  });

  it('no superseded version literal survives in the display sources', () => {
    const displaySources = [
      'frontend/vite.config.ts',
      'frontend/src/shared/layout/app-shell.tsx',
      'frontend/src/features/settings/components/workspace-sections/SystemUpdatesSection.tsx',
      'frontend/src/shared/hooks/use-offline-update-check.ts',
      'backend/src/modules/settings/services/offline-releases.service.ts',
    ];
    for (const file of displaySources) {
      const text = readText(file);
      for (const stale of ['1.1.40', '1.1.35']) {
        expect(text, `${file} must not display the superseded version ${stale}`).not.toContain(stale);
      }
    }
  });
});
