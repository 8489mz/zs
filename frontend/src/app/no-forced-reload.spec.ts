/* No forced reloads: a deployed build must never interrupt a live session.
 * The service worker is registered for offline operation only, and a failed
 * lazy chunk load must never reload the page on its own. This guard reads the
 * real wiring files so a reintroduced skipWaiting, focus/visibility update
 * check, or automatic chunk-failure reload fails the suite. */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('INV-NO-FORCED-UPDATE-RELOAD', () => {
  const frontendDir = path.resolve(__dirname, '../..');

  it('never forces a waiting service worker to take over or checks for updates on focus/visibility', () => {
    const mainPath = path.join(frontendDir, 'src/main.tsx');
    expect(fs.existsSync(mainPath)).toBe(true);
    const content = fs.readFileSync(mainPath, 'utf8');

    // A waiting worker must stay waiting until the next fresh navigation;
    // forcing it to take over is what dropped live popups and forms.
    expect(content).not.toContain('messageSkipWaiting');
    expect(content).not.toContain('wb.update(');
    expect(content).not.toContain("addEventListener('focus',");
    expect(content).not.toContain('visibilitychange');
    expect(content).not.toContain('location.reload');

    // Offline operation itself is unchanged: the worker is still registered.
    expect(content).toContain('wb.register');
    expect(content).toContain('pwa-updated');
  });

  it('never reloads automatically when a lazy chunk fails to load', () => {
    const lazyRoutePath = path.join(frontendDir, 'src/app/router/lazy-route.tsx');
    expect(fs.existsSync(lazyRoutePath)).toBe(true);
    const content = fs.readFileSync(lazyRoutePath, 'utf8');

    // The single remaining reload is the user pressing the fallback button.
    expect(content.match(/location\.reload/g) || []).toHaveLength(1);
    expect(content).toContain('window.location.reload()');

    // No once-per-pathname automatic reload and no retry bookkeeping.
    expect(content).not.toContain('_chunk_reload_');
    expect(content).not.toContain('sessionStorage');

    // A transient network blip still gets one silent import retry, then the
    // manual fallback is the only path.
    expect(content).toContain('.catch(() => loader())');
    expect(content).toContain('RouteLoadErrorFallback');
  });

  it('records the invariant exactly once', () => {
    const invariantsPath = path.join(frontendDir, '..', 'ARCHITECTURE_INVARIANTS.md');
    expect(fs.existsSync(invariantsPath)).toBe(true);
    const content = fs.readFileSync(invariantsPath, 'utf8');
    expect(content.match(/INV-NO-FORCED-UPDATE-RELOAD/g) || []).toHaveLength(1);
    expect(content).toContain('no-forced-reload.spec.ts');
  });

  it('registers the service worker for prompt updates only, with one registration owner', () => {
    const configPath = path.join(frontendDir, 'vite.config.ts');
    expect(fs.existsSync(configPath)).toBe(true);
    const config = fs.readFileSync(configPath, 'utf8');

    // 'autoUpdate' let the plugin self-activate the new worker AND inject a
    // second registration that reloaded the page the moment it activated —
    // the white-screen reload main.tsx alone could never cause.
    expect(config).toContain("registerType: 'prompt'");
    expect(config).not.toContain('autoUpdate');
    expect(config).toContain('injectRegister: false');

    // The single owner is the manual registration in main.tsx: a waiting
    // worker only announces itself; the banner decides, never this file.
    const mainPath = path.join(frontendDir, 'src/main.tsx');
    const main = fs.readFileSync(mainPath, 'utf8');
    expect(main).toContain("addEventListener('waiting'");
    expect(main).toContain('pwa-update-available');
    expect(main).not.toContain('messageSkipWaiting');
    expect(main).not.toContain('location.reload');
  });

  it('never refetches the public storefront catalog on window focus', () => {
    const hookPath = path.join(frontendDir, 'src/features/storefront/hooks/usePublicStorefront.ts');
    expect(fs.existsSync(hookPath)).toBe(true);
    const hook = fs.readFileSync(hookPath, 'utf8');

    // Both queries used to opt back into focus refetch, re-fetching the full
    // catalog (and silently re-pricing the cart) every time the window was
    // focused. Removing the flag inherits the global false.
    expect(hook).not.toContain('refetchOnWindowFocus: true');
    expect(hook).toContain('storefront-info');
    expect(hook).toContain('storefront-catalog');

    const providersPath = path.join(frontendDir, 'src/app/providers.tsx');
    const providers = fs.readFileSync(providersPath, 'utf8');
    expect(providers).toContain('refetchOnWindowFocus: false');
  });

  it('takes over only from the banner button, never on its own', () => {
    const bannerPath = path.join(frontendDir, 'src/app/pwa-update-banner.tsx');
    expect(fs.existsSync(bannerPath)).toBe(true);
    const banner = fs.readFileSync(bannerPath, 'utf8');

    expect(banner).toContain('pwa-update-available');
    expect(banner).toContain('pwa-updated');
    // Exactly one takeover call and one reload, both behind the user's click.
    expect(banner.match(/messageSkipWaiting/g) || []).toHaveLength(1);
    expect(banner.match(/location\.reload/g) || []).toHaveLength(1);
    expect(banner).toContain('onClick={handleApplyUpdate}');
  });

  it('records the prompt invariant exactly once', () => {
    const invariantsPath = path.join(frontendDir, '..', 'ARCHITECTURE_INVARIANTS.md');
    const content = fs.readFileSync(invariantsPath, 'utf8');
    expect(content.match(/INV-PWA-UPDATE-PROMPT/g) || []).toHaveLength(1);
    expect(content).toContain('pwa-update-banner.tsx');
  });
});
