import {
  offlineUpdateManifestUrl,
  offlineUpdateReleasesApiUrl,
  offlineUpdateReleaseDownloadUrl,
} from './offline-releases-channel';

export class OfflineReleasesGitHub {
  constructor() {}

  // ─── GitHub Cloud Updates ──────────────────────────────────────────────────

  async fetchGitHubLatestRelease(): Promise<{
    version: string;
    changelog: string;
    patchUrl: string;
    passcode?: string;
  } | null> {
    try {
      // 1. Try raw manifest-latest.json from the update-channel repo
      const rawUrl = offlineUpdateManifestUrl();
      const rawRes = await fetch(rawUrl, {
        headers: { 'User-Agent': 'Z-ERP-Desktop-Client' },
        signal: AbortSignal.timeout(4000),
      });

      if (rawRes.ok) {
        const manifest = await rawRes.json();
        if (manifest?.version && manifest.version !== '0.0.0') {
          return {
            version: manifest.version,
            changelog: manifest.changelog || 'تحديث شامل للنظام متوفر على GitHub.',
            patchUrl:
              manifest.patchUrl ||
              offlineUpdateReleaseDownloadUrl(manifest.version, `Z-ERP-Patch-v${manifest.version}.zip`),
            passcode: manifest.passcode,
          };
        }
      }
    } catch {
      // Offline or GitHub raw unreachable
    }

    try {
      // 2. Fallback to GitHub Releases API
      const apiUrl = offlineUpdateReleasesApiUrl();
      const apiRes = await fetch(apiUrl, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Z-ERP-Desktop-Client',
        },
        signal: AbortSignal.timeout(4000),
      });

      if (apiRes.ok) {
        const data = await apiRes.json();
        const tag = (data.tag_name || '').replace(/^v/, '').trim();
        if (tag) {
          const zipAsset = (data.assets || []).find((a: any) => a.name?.endsWith('.zip'));
          return {
            version: tag,
            changelog: data.body || 'تحديث جديد عبر GitHub Releases.',
            patchUrl: zipAsset?.browser_download_url || offlineUpdateReleaseDownloadUrl(tag, `patch-${tag}.zip`),
          };
        }
      }
    } catch {
      // Fallback silently
    }

    return null;
  }
}
