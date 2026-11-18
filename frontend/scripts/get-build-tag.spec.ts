/* Build tag for __APP_BUILD_ID__ (INV-SERVICE-WORKER-BUILD-MARKER): the tag
 * must change on every deploy, or the PWA update banner's dismiss key
 * (`/sw.js?v=<tag>`) never changes either and a once-dismissed banner never
 * shows again. Drives the real getBuildTag() against real temp git repos:
 * git short SHA wins over the static build-version.json file, GITHUB_SHA
 * covers a sourceless CI build, build-version.json stays as the manual
 * fallback, and the timestamp fallback is never a same-day constant. */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getBuildTag } from './get-build-tag';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zs-build-tag-'));
}

function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeVersionFile(dir: string, buildId: string): void {
  fs.writeFileSync(
    path.join(dir, 'build-version.json'),
    JSON.stringify({ date: '1010', sequence: 1, buildId }, null, 2) + '\n',
    'utf8',
  );
}

/** Real git repo in a temp dir; returns its short HEAD SHA (computed by git itself). */
function initGitRepo(dir: string): string {
  execSync('git init -q', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "spec@example.invalid"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "build-tag spec"', { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'probe.txt'), 'probe\n', 'utf8');
  execSync('git add probe.txt', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -qm probe', { cwd: dir, stdio: 'ignore' });
  return execSync('git rev-parse --short HEAD', { cwd: dir, encoding: 'utf8' }).trim();
}

function commitAgain(dir: string): string {
  fs.writeFileSync(path.join(dir, 'probe.txt'), 'probe-changed\n', 'utf8');
  execSync('git add probe.txt', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -qm probe-2', { cwd: dir, stdio: 'ignore' });
  return execSync('git rev-parse --short HEAD', { cwd: dir, encoding: 'utf8' }).trim();
}

describe('getBuildTag', () => {
  it('returns the git short SHA, never the static build-version.json id', () => {
    const dir = makeTempDir();
    try {
      const sha = initGitRepo(dir);
      // The stale file is present exactly as in the repo (1010-0001, last
      // bumped 2026-10-10, never bumped by any workflow): it must lose.
      writeVersionFile(dir, '1010-0001');
      expect(getBuildTag({ root: dir, env: {} })).toBe(sha);
      expect(getBuildTag({ root: dir, env: {} })).not.toBe('1010-0001');
    } finally {
      removeDir(dir);
    }
  });

  it('changes when the commit changes: two deploys, two tags', () => {
    const dir = makeTempDir();
    try {
      const first = initGitRepo(dir);
      writeVersionFile(dir, '1010-0001');
      const second = commitAgain(dir);
      expect(second).not.toBe(first);
      expect(getBuildTag({ root: dir, env: {} })).toBe(second);
    } finally {
      removeDir(dir);
    }
  });

  it('falls back to GITHUB_SHA when there is no git repo', () => {
    const dir = makeTempDir();
    try {
      const full = 'abcdef1234567890abcdef1234567890abcdef12';
      expect(getBuildTag({ root: dir, env: { GITHUB_SHA: full } })).toBe('abcdef1');
    } finally {
      removeDir(dir);
    }
  });

  it('falls back to build-version.json when neither git nor GITHUB_SHA exists', () => {
    const dir = makeTempDir();
    try {
      writeVersionFile(dir, '1010-0001');
      expect(getBuildTag({ root: dir, env: {} })).toBe('1010-0001');
    } finally {
      removeDir(dir);
    }
  });

  it('ignores a malformed GITHUB_SHA and a buildId-less version file', () => {
    const dir = makeTempDir();
    try {
      fs.writeFileSync(
        path.join(dir, 'build-version.json'),
        JSON.stringify({ date: '1010', sequence: 1 }, null, 2),
        'utf8',
      );
      const tag = getBuildTag({ root: dir, env: { GITHUB_SHA: 'not-a-sha!!' } });
      expect(tag).toMatch(/^\d{4}-\d{9}$/);
      expect(tag).not.toContain('-0001');
    } finally {
      removeDir(dir);
    }
  });

  it('timestamp fallback is unique per build, never a same-day constant', async () => {
    const dir = makeTempDir();
    try {
      const first = getBuildTag({ root: dir, env: {} });
      expect(first).toMatch(/^\d{4}-\d{9}$/);
      expect(first).not.toContain('-0001');
      // Millisecond resolution: a 2ms gap guarantees a different tag.
      await new Promise((resolve) => setTimeout(resolve, 2));
      const second = getBuildTag({ root: dir, env: {} });
      expect(second).not.toBe(first);
    } finally {
      removeDir(dir);
    }
  });

  it('vite.config.ts wires the real tag into __APP_BUILD_ID__', () => {
    const configPath = path.join(__dirname, '..', 'vite.config.ts');
    const config = fs.readFileSync(configPath, 'utf8');
    expect(config).toContain("from './scripts/get-build-tag'");
    expect(config).toContain('__APP_BUILD_ID__: JSON.stringify(getBuildTag(');
    // The config no longer reads the static file itself: the tag comes from
    // git/CI, so a stale build-version.json cannot freeze the marker again.
    expect(config).not.toContain('build-version.json');
    // Prompt behaviour is untouched by the marker change.
    expect(config).toContain("registerType: 'prompt'");
    expect(config).toContain('injectRegister: false');
  });

  it('records the invariant exactly once', () => {
    // Sibling guards count their own ids by substring and demand exactly
    // one hit, so this entry names no other INV- id anywhere in its prose.
    const invariantsPath = path.join(__dirname, '..', '..', 'ARCHITECTURE_INVARIANTS.md');
    const content = fs.readFileSync(invariantsPath, 'utf8');
    expect(content.match(/INV-SERVICE-WORKER-BUILD-MARKER/g) || []).toHaveLength(1);
    expect(content).toContain('get-build-tag.spec.ts');
  });
});
