/* Build tag for __APP_BUILD_ID__ (INV-SERVICE-WORKER-BUILD-MARKER): the tag
 * baked into the service-worker URL (`/sw.js?v=<tag>`) and rendered on the
 * van-sales page MUST change on every deploy. The old tag read
 * frontend/build-version.json (last bumped 2026-10-10; the
 * bump-build.cjs script exists but no workflow or script ever runs it), so
 * every build registered the SAME worker URL — and the PWA banner's dismiss
 * key is that URL, so one dismiss silenced the banner for all later builds.
 * Resolution order, first hit wins:
 *   1. git short HEAD — exact in CI (deploy-oracle.yml checks out DEPLOY_SHA
 *      before `npm run build`, so HEAD IS the deployed commit) and local.
 *   2. GITHUB_SHA env (first 7 chars) — a sourceless CI build without .git.
 *   3. build-version.json — manual local builds outside a git checkout.
 *   4. Timestamp to the millisecond — never a same-day constant, so two
 *      builds on the same day never share a worker URL.
 * Never throws: every source is guarded, the timestamp always answers. */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface BuildTagOptions {
  /** Frontend package root: holds build-version.json, and git runs here
   * (any subdir of the repo resolves HEAD). Defaults to process.cwd(). */
  root?: string;
  /** Environment to read GITHUB_SHA from. Defaults to process.env.
   * Injectable so tests need no real CI env. */
  env?: NodeJS.ProcessEnv;
}

function readGitShortSha(root: string): string | null {
  try {
    const sha = execSync('git rev-parse --short HEAD', {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
    return /^[0-9a-f]+$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

function readCiSha(env: NodeJS.ProcessEnv): string | null {
  const raw = typeof env.GITHUB_SHA === 'string' ? env.GITHUB_SHA.trim() : '';
  return /^[0-9a-f]{7,40}$/.test(raw) ? raw.slice(0, 7) : null;
}

function readVersionFile(root: string): string | null {
  try {
    const data = JSON.parse(
      fs.readFileSync(path.join(root, 'build-version.json'), 'utf8'),
    ) as { buildId?: unknown };
    return typeof data.buildId === 'string' && data.buildId.trim()
      ? data.buildId.trim()
      : null;
  } catch {
    return null;
  }
}

function timestampTag(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  // Never a same-day constant: two builds on the same day must not share a
  // worker URL, or the PWA banner dismiss cannot tell a new build from the
  // dismissed one. Time of day to the millisecond makes each build unique.
  return `${mm}${dd}-${hh}${min}${ss}${ms}`;
}

export function getBuildTag(options: BuildTagOptions = {}): string {
  const root = options.root ?? process.cwd();
  const env = options.env ?? process.env;
  return (
    readGitShortSha(root) ??
    readCiSha(env) ??
    readVersionFile(root) ??
    timestampTag()
  );
}
