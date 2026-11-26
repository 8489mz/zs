const logoDataUriCache = new Map<string, string>();
const logoInFlight = new Map<string, Promise<void>>();

function normalizeLogoUrl(rawUrl?: string | null): string {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:')) return trimmed;
  if (trimmed.startsWith('/') && typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${trimmed}`;
  }
  return trimmed;
}

/**
 * Fetches an external/relative store logo once in the background and caches it
 * in memory as an inline data:image/...;base64 URI so the local Hardware Bridge
 * (127.0.0.1:18181), Electron BrowserWindow, and browser iframe render receipts
 * in 0ms without network image downloads or broken relative URLs.
 */
export function warmReceiptLogoDataUri(rawUrl?: string | null): void {
  const rawTrimmed = String(rawUrl || '').trim();
  if (!rawTrimmed || rawTrimmed.startsWith('data:')) return;
  if (logoDataUriCache.has(rawTrimmed) || logoInFlight.has(rawTrimmed)) return;
  if (typeof window === 'undefined' || typeof fetch === 'undefined' || typeof FileReader === 'undefined') {
    return;
  }

  const resolvedUrl = normalizeLogoUrl(rawTrimmed);
  const task = (async () => {
    try {
      const res = await fetch(resolvedUrl, { credentials: 'include' });
      if (!res.ok) return;
      const blob = await res.blob();
      if (!blob || blob.size === 0 || blob.size > 2 * 1024 * 1024) return;
      const dataUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('empty')));
        reader.onerror = () => reject(reader.error || new Error('read failed'));
        reader.readAsDataURL(blob);
      });
      if (dataUri.startsWith('data:image/')) {
        logoDataUriCache.set(rawTrimmed, dataUri);
        logoDataUriCache.set(resolvedUrl, dataUri);
      }
    } catch {
      // Non-blocking warmup; falls back to normalized URL on failure
    } finally {
      logoInFlight.delete(rawTrimmed);
    }
  })();

  logoInFlight.set(rawTrimmed, task);
}

export function resolveCachedReceiptLogo(rawUrl?: string | null): string {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:')) return trimmed;
  return logoDataUriCache.get(trimmed) || normalizeLogoUrl(trimmed);
}
