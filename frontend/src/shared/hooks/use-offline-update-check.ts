import { useQuery } from '@tanstack/react-query';
import { http } from '@/lib/http';

export function getOfflineUpdateApiBaseUrl(): string {
  return import.meta.env.VITE_OFFLINE_UPDATE_API_BASE_URL || 'https://raw.githubusercontent.com/8489mx/zsupdates/main';
}

function parseSemver(v: string) {
  return (v || '0.0.0').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
}

function isVersionGreater(a: string, b: string): boolean {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return true;
    if (na < nb) return false;
  }
  return false;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string | null;
  patchUrl: string | null;
  changelog: string | null;
  cumulativeChangelog?: string | null;
  requiresPasscode?: boolean;
  passcode?: string;
  releases: Array<{
    id?: number;
    version: string;
    changelog: string;
    patchUrl: string;
    promotedAt: string;
    passcode?: string;
    requiresPasscode?: boolean;
  }>;
}

export function useOfflineUpdateCheck(deploymentMode: string | null | undefined) {
  const isDesktop = deploymentMode === 'desktop' || import.meta.env.DEV;
  const currentVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

  return useQuery<UpdateCheckResult>({
    queryKey: ['offline-update-check', currentVersion],
    queryFn: async () => {
      const fallback: UpdateCheckResult = {
        updateAvailable: false,
        currentVersion,
        latestVersion: null,
        patchUrl: null,
        changelog: null,
        releases: []
      };

      // 1. Try checking via local NestJS backend (which checks GitHub + local releases)
      try {
        const backendRes = await http<UpdateCheckResult>(`/api/updates/check?version=${encodeURIComponent(currentVersion)}`, {
          timeoutMs: 4000
        });
        if (backendRes && typeof backendRes.updateAvailable === 'boolean') {
          return backendRes;
        }
      } catch {
        // Fallback to direct GitHub fetch
      }

      if (!navigator.onLine) {
        return fallback;
      }

      // 2. Direct GitHub raw manifest fallback (honours the
      // VITE_OFFLINE_UPDATE_API_BASE_URL override via the helper).
      try {
        const baseUrl = getOfflineUpdateApiBaseUrl().replace(/\/+$/, '');
        const rawRes = await fetch(`${baseUrl}/releases/manifest-latest.json`, {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(4000)
        });
        if (rawRes.ok) {
          const manifest = await rawRes.json();
          if (manifest && manifest.version) {
            const hasUpdate = isVersionGreater(manifest.version, currentVersion);
            return {
              updateAvailable: hasUpdate,
              currentVersion,
              latestVersion: manifest.version,
              patchUrl: manifest.patchUrl || `https://github.com/8489mx/zsupdates/releases/download/v${manifest.version}/patch-${manifest.version}.zip`,
              changelog: manifest.changelog || 'تحديث شامل للنظام متوفر على GitHub.',
              requiresPasscode: manifest.requiresPasscode ?? true,
              passcode: manifest.passcode,
              releases: [
                {
                  version: manifest.version,
                  changelog: manifest.changelog || '',
                  patchUrl: manifest.patchUrl || '',
                  promotedAt: manifest.generatedAt || new Date().toISOString(),
                  passcode: manifest.passcode,
                  requiresPasscode: manifest.requiresPasscode ?? true
                }
              ]
            };
          }
        }
      } catch (err) {
        console.error('Error checking GitHub updates directly:', err);
      }

      return fallback;
    },
    enabled: isDesktop,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
    refetchIntervalInBackground: false,
  });
}
