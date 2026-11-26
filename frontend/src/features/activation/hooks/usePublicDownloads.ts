import { useCallback, useEffect, useState } from 'react';

export interface BridgeManifest {
  version: string;
  updatedAt: string;
  exeFile: string;
  exeUrl: string;
  exeSizeBytes: number;
  exeSha256: string;
  zipFile: string;
  zipUrl: string;
  zipSizeBytes: number;
  zipSha256: string;
}

export type BridgeLiveStatus = 'checking' | 'online' | 'offline';

export interface BridgeProbeState {
  status: BridgeLiveStatus;
  version?: string;
  runtime?: string;
}

const DEFAULT_MANIFEST: BridgeManifest = {
  version: '1.2.0',
  updatedAt: '',
  exeFile: 'z-systems-bridge.exe',
  exeUrl: '/downloads/z-systems-bridge.exe',
  exeSizeBytes: 0,
  exeSha256: '',
  zipFile: 'z-systems-bridge.zip',
  zipUrl: '/downloads/z-systems-bridge.zip',
  zipSizeBytes: 0,
  zipSha256: '',
};

export function usePublicDownloads() {
  const [manifest, setManifest] = useState<BridgeManifest>(DEFAULT_MANIFEST);
  const [bridgeState, setBridgeState] = useState<BridgeProbeState>({ status: 'checking' });

  const checkBridgeStatus = useCallback(async () => {
    setBridgeState({ status: 'checking' });
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 1600);
    try {
      const response = await fetch('http://127.0.0.1:18181/health', {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        signal: controller.signal,
      });
      if (!response.ok) {
        setBridgeState({ status: 'offline' });
        return false;
      }
      const data = await response.json().catch(() => ({}));
      if (data?.status === 'ONLINE') {
        setBridgeState({
          status: 'online',
          version: typeof data?.version === 'string' ? data.version : undefined,
          runtime: typeof data?.runtime === 'string' ? data.runtime : undefined,
        });
        return true;
      }
      setBridgeState({ status: 'offline' });
      return false;
    } catch {
      setBridgeState({ status: 'offline' });
      return false;
    } finally {
      window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/downloads/bridge-manifest.json', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data && typeof data.exeUrl === 'string') {
          setManifest({ ...DEFAULT_MANIFEST, ...data });
        }
      })
      .catch(() => {});

    void checkBridgeStatus();
    return () => {
      active = false;
    };
  }, [checkBridgeStatus]);

  return {
    manifest,
    bridgeState,
    checkBridgeStatus,
  };
}
