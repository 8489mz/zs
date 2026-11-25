/**
 * CORS origin callback used by main.ts (`app.enableCors`).
 *
 * One factory, one policy, so the browser-facing origin decision is testable
 * without booting the Nest app (main.ts calls `bootstrap()` at import).
 *
 * Policy:
 * - `/api/public/*` — the marketing site + configured CORS_ORIGINS only
 *   (`resolvePublicApiCorsOrigin`); anything else is denied (no
 *   Access-Control-Allow-Origin header, so the browser blocks the read).
 * - Everything else — including `GET /api/updates/*` (version / check /
 *   history) — the configured CORS_ORIGINS allowlist, plus `'null'` only
 *   when the Desktop app runs as a LAN server. There is NO reflect-any
 *   branch: an arbitrary `Origin` (for example `https://evil.example`) gets
 *   no header. The old updates branch reflected any origin with
 *   `credentials: true`, which let any website read the release history
 *   cross-origin — including, in dev mode, the stored per-release activation
 *   passcode (`offline-releases.service.ts` `listReleaseHistory`).
 *
 * Legitimate updates callers are all inside the allowlist: the Electron
 * renderer runs from `file://` (the launcher puts `file://` in
 * CORS_ORIGINS), the web app is same-origin, and non-browser callers
 * (curl, the Electron main process, the update checker) send no Origin
 * and do not need CORS at all.
 */
import { isPublicApiPath, resolvePublicApiCorsOrigin } from './public-cors-origin.util';

export function buildCorsOriginCallback(corsOrigins: readonly string[]): (req: any, callback: any) => void {
  return (req: any, callback: any) => {
    const originHeader = req.headers?.origin;
    // Public marketing endpoints (pricing catalog, trial signup) must be
    // readable from the marketing site regardless of the CORS_ORIGINS env
    // list: the single pricing endpoint serves the website, the in-app
    // client, and every other caller, so a missing env entry must never
    // silently hide prices. Exact-origin match only; any other origin is
    // denied (no Access-Control-Allow-Origin header).
    if (isPublicApiPath(req.url)) {
      callback(null, {
        origin: resolvePublicApiCorsOrigin(originHeader, corsOrigins),
        credentials: true,
      });
      return;
    }
    // No /api/updates/ special case: those routes fall through to the
    // default allowlist below, like every other endpoint.
    const allowedOrigins: (string | RegExp)[] = [...corsOrigins];
    const isLanServer = process.env.APP_MODE === 'SELF_CONTAINED' && process.env.ELECTRON_RUNTIME_MODE === 'lan_server';
    if (isLanServer) {
      allowedOrigins.push('null');
    }

    callback(null, { origin: allowedOrigins, credentials: true });
  };
}
