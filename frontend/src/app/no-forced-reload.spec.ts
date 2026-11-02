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
});
