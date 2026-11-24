/**
 * Update channel (INV-OFFLINE-UPDATE-CHANNEL-ZSUPDATES): desktop
 * clients read the PUBLIC releases-only repository 8489mx/zsupdates,
 * because the zs source repository went private and is unreachable
 * unauthenticated. Every channel URL is built from the single repo
 * value below so a future channel move touches one place. Operators
 * may re-point the channel with ZS_OFFLINE_UPDATE_REPO; the SHA-256
 * pin above is unaffected by the channel value. The manifest is
 * expected on the `main` branch of the channel repo.
 */
export const OFFLINE_UPDATE_REPO_DEFAULT = '8489mx/zsupdates';

export function offlineUpdateRepo(): string {
  const override = String(process.env.ZS_OFFLINE_UPDATE_REPO || '').trim();
  return override || OFFLINE_UPDATE_REPO_DEFAULT;
}

export function offlineUpdateManifestUrl(): string {
  return `https://raw.githubusercontent.com/${offlineUpdateRepo()}/main/releases/manifest-latest.json`;
}

export function offlineUpdateReleasesApiUrl(): string {
  return `https://api.github.com/repos/${offlineUpdateRepo()}/releases/latest`;
}

export function offlineUpdateReleaseDownloadUrl(version: string, fileName: string): string {
  const clean = String(version || '').replace(/^v/, '');
  return `https://github.com/${offlineUpdateRepo()}/releases/download/v${clean}/${fileName}`;
}
