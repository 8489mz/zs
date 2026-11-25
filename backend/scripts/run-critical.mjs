#!/usr/bin/env node
/**
 * run-critical.mjs — parallel process-per-spec ts-node harness.
 *
 * Why a harness instead of Vitest / node --test:
 * - The suite is 123 plain assertion scripts (top-level asserts, async
 *   main()), not a test-framework suite. Vitest would report "no tests
 *   found" for them and an async main() kicked off with `void main()`
 *   races the runner — a silent-pass class this repo forbids.
 * - Per-process isolation is load-bearing: specs import the same service
 *   modules and several read/write module-level caches. One process per
 *   spec preserves exactly the isolation the `&&` chain had; loading
 *   many specs into one process (Vitest isolate:false, a single
 *   node --test process) would break it.
 * - `node --test`'s default concurrency is unbounded by memory; the
 *   explicit worker cap is the point of this file.
 *
 * What it does:
 * - Reads the spec list from ONE source of truth
 *   (backend/scripts/critical-specs.json by default, or --list <json>).
 *   For the critical list it also verifies the list against the
 *   `test:critical:serial` chain in backend/package.json and refuses to
 *   run on drift, so the two copies can never silently diverge.
 * - Spawns up to N worker processes, each running ONE spec via
 *   `ts-node --transpile-only`. Type-checking is skipped here on purpose:
 *   it already runs as a separate CI step (`tsc --noEmit` before the
 *   tests in both workflows), and measured 3-5x of spec time is the
 *   redundant per-process type-check.
 * - Streams each worker's output to a per-spec log file
 *   (backend/test-runner-logs/, *.log is gitignored) and prints one
 *   progress line per spec, a final table, and the tails of failures.
 * - Runs ALL specs even after failures (strictly more signal than the
 *   old `&&` chain, which aborted at the first failure) and exits
 *   non-zero iff any spec failed.
 *
 * Worker sizing: peak single-spec RSS measured 2.08 GB. Requested
 * workers are clamped so workers * 2.1 GB stays under 80% of RAM;
 * CI runs with --workers 4 (16 GB runner), this VM clamps to 2.
 * Per-spec watchdog: 10 min, then kill + report as a timeout failure.
 *
 * Usage:
 *   node scripts/run-critical.mjs [--list scripts/infra-specs.json]
 *                                  [--workers N] [--log-dir <dir>]
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS_DIR = path.join(BACKEND_ROOT, 'scripts');
const DEFAULT_LIST = path.join(SCRIPTS_DIR, 'critical-specs.json');
const DEFAULT_LOG_DIR = path.join(BACKEND_ROOT, 'test-runner-logs');
const PER_SPEC_PEAK_GB = 2.1; // measured worst single-spec RSS (design §1.2)
const MEMORY_BUDGET_FRACTION = 0.8;
const SPEC_TIMEOUT_MS = 10 * 60 * 1000; // watchdog per spec (design §7.2)
const TAIL_LINES = 40;
const TS_NODE_BIN = path.join(BACKEND_ROOT, 'node_modules', 'ts-node', 'dist', 'bin.js');

function usage() {
  console.log(
    'Usage: node scripts/run-critical.mjs [--list <specs.json>] [--workers N] [--log-dir <dir>]\n' +
      '  --list    spec list JSON ({ "specs": ["test/critical/....spec.ts", ...] }), default scripts/critical-specs.json\n' +
      '  --workers worker cap; default min(4, cpus), clamped by memory (workers * 2.1 GB < 80% of RAM)\n' +
      '  --log-dir per-spec log directory, default backend/test-runner-logs',
  );
}

function parseArgs(argv) {
  const args = { list: DEFAULT_LIST, workers: undefined, logDir: DEFAULT_LOG_DIR };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      usage();
      process.exit(0);
    } else if (a === '--list') {
      args.list = path.resolve(BACKEND_ROOT, argv[++i] ?? '');
    } else if (a === '--workers') {
      args.workers = Number(argv[++i]);
      if (!Number.isInteger(args.workers) || args.workers < 1) {
        throw new Error(`--workers must be a positive integer (got ${argv[i]})`);
      }
    } else if (a === '--log-dir') {
      args.logDir = path.resolve(BACKEND_ROOT, argv[++i] ?? '');
    } else {
      throw new Error(`unknown argument: ${a} (see --help)`);
    }
  }
  return args;
}

function resolveWorkers(requested) {
  const cpus = os.cpus().length;
  const totalGb = os.totalmem() / 2 ** 30;
  const cap = Math.floor((totalGb * MEMORY_BUDGET_FRACTION) / PER_SPEC_PEAK_GB);
  if (cap < 1) {
    throw new Error(
      `refusing to start: ${totalGb.toFixed(1)} GB RAM cannot host even one ${PER_SPEC_PEAK_GB} GB spec worker`,
    );
  }
  const want = requested ?? Math.min(4, cpus);
  const workers = Math.min(want, cap);
  return { workers, want, cap, cpus, totalGb };
}

function loadList(listPath) {
  const raw = JSON.parse(fs.readFileSync(listPath, 'utf8'));
  if (!raw || !Array.isArray(raw.specs) || raw.specs.length === 0) {
    throw new Error(`${listPath}: expected { "specs": ["test/.../*.spec.ts", ...] } with at least one entry`);
  }
  const seen = new Set();
  for (const spec of raw.specs) {
    if (typeof spec !== 'string' || !spec.endsWith('.spec.ts')) {
      throw new Error(`${listPath}: bad entry (must be a .spec.ts path): ${JSON.stringify(spec)}`);
    }
    if (seen.has(spec)) throw new Error(`${listPath}: duplicate entry: ${spec}`);
    seen.add(spec);
  }
  return raw.specs;
}

/** The critical list has a second copy: the test:critical:serial chain in
 *  package.json. Refuse to run on drift so the two can never diverge. */
function verifyAgainstSerialChain(specs, listPath) {
  if (path.resolve(listPath) !== path.resolve(DEFAULT_LIST)) return;
  const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND_ROOT, 'package.json'), 'utf8'));
  const serial = pkg?.scripts?.['test:critical:serial'];
  if (typeof serial !== 'string' || serial.length === 0) {
    throw new Error('package.json has no test:critical:serial chain to verify the spec list against');
  }
  const chainSpecs = [...serial.matchAll(/ts-node\s+(\S+\.spec\.ts)/g)].map((m) => m[1]);
  const mismatch = chainSpecs.length !== specs.length || chainSpecs.some((s, i) => s !== specs[i]);
  if (mismatch) {
    const onlyList = specs.filter((s) => !chainSpecs.includes(s));
    const onlyChain = chainSpecs.filter((s) => !specs.includes(s));
    throw new Error(
      `spec list drift: ${listPath} (${specs.length} specs) != test:critical:serial (${chainSpecs.length} specs). ` +
        `Only in list: ${onlyList.join(', ') || 'none'}. Only in chain: ${onlyChain.join(', ') || 'none'}. ` +
        'Regenerate one from the other; never hand-edit either.',
    );
  }
}

function logFileName(spec) {
  return spec.replace(/\//g, '__').replace(/\.ts$/, '.log');
}

function tailLines(text, n) {
  const lines = text.split('\n');
  return lines.slice(Math.max(0, lines.length - n)).join('\n');
}

function runOne(spec, logDir) {
  const specAbs = path.join(BACKEND_ROOT, spec);
  const logFile = path.join(logDir, logFileName(spec));
  const started = Date.now();
  if (!fs.existsSync(specAbs)) {
    const seconds = (Date.now() - started) / 1000;
    fs.writeFileSync(logFile, `$ missing spec file: ${spec}\n`);
    return Promise.resolve({ spec, status: 'missing', exit: null, seconds, logFile, reason: 'file not found' });
  }
  const useBin = fs.existsSync(TS_NODE_BIN);
  const cmd = useBin ? process.execPath : 'npx';
  const cmdArgs = useBin ? [TS_NODE_BIN, '--transpile-only', specAbs] : ['ts-node', '--transpile-only', specAbs];
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { cwd: BACKEND_ROOT, env: process.env });
    let out = '';
    let timedOut = false;
    const watchdog = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, SPEC_TIMEOUT_MS);
    // If the timer is the only thing keeping the event loop alive, let the
    // process exit instead of waiting out the full 10 minutes.
    watchdog.unref();
    child.stdout.on('data', (d) => {
      out += d.toString('utf8');
    });
    child.stderr.on('data', (d) => {
      out += d.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(watchdog);
      const seconds = (Date.now() - started) / 1000;
      fs.writeFileSync(logFile, `$ ${cmd} ${cmdArgs.join(' ')}\nspawn error: ${err.message}\n`);
      resolve({ spec, status: 'error', exit: null, seconds, logFile, reason: `spawn error: ${err.message}` });
    });
    child.on('close', (code, signal) => {
      clearTimeout(watchdog);
      const seconds = (Date.now() - started) / 1000;
      const header = `$ ${cmd} ${cmdArgs.join(' ')}\nexit: ${code ?? signal} (${seconds.toFixed(2)}s)\n---\n`;
      fs.writeFileSync(logFile, header + out);
      if (timedOut) {
        resolve({
          spec,
          status: 'timeout',
          exit: null,
          seconds,
          logFile,
          reason: `killed after ${SPEC_TIMEOUT_MS / 60000} min watchdog`,
        });
      } else if (code === 0) {
        resolve({ spec, status: 'pass', exit: 0, seconds, logFile, reason: '' });
      } else {
        resolve({ spec, status: 'fail', exit: code, seconds, logFile, reason: `exit ${code ?? signal}` });
      }
    });
  });
}

async function main() {
  const started = Date.now();
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`run-critical: ${err.message}`);
    usage();
    process.exitCode = 2;
    return;
  }
  let specs;
  let sizing;
  try {
    specs = loadList(args.list);
    verifyAgainstSerialChain(specs, args.list);
    sizing = resolveWorkers(args.workers);
  } catch (err) {
    console.error(`run-critical: ${err.message}`);
    process.exitCode = 2;
    return;
  }
  fs.mkdirSync(args.logDir, { recursive: true });
  const { workers, want, cap, cpus, totalGb } = sizing;
  const clampNote =
    workers < want
      ? ` (requested ${want}, clamped to ${workers} by memory: ${cap} max on ${totalGb.toFixed(1)} GB RAM)`
      : '';
  console.log(
    `run-critical: ${specs.length} specs, ${workers} workers${clampNote} [cpus ${cpus}, RAM ${totalGb.toFixed(1)} GB], ` +
      `list ${path.relative(BACKEND_ROOT, args.list)}, logs ${path.relative(BACKEND_ROOT, args.logDir)}`,
  );

  const results = new Map();
  let next = 0;
  let running = 0;
  let done = 0;
  await new Promise((resolve) => {
    const launch = () => {
      while (running < workers && next < specs.length) {
        const spec = specs[next++];
        running++;
        runOne(spec, args.logDir).then((r) => {
          results.set(spec, r);
          running--;
          done++;
          const mark = r.status === 'pass' ? 'PASS' : r.status.toUpperCase();
          console.log(
            `[${String(done).padStart(3)}/${specs.length}] ${mark} ${r.seconds.toFixed(2)}s ${spec}${r.reason ? ` (${r.reason})` : ''}`,
          );
          if (next < specs.length) launch();
          else if (running === 0) resolve();
        });
      }
    };
    launch();
  });

  const ordered = specs.map((s) => results.get(s));
  const passed = ordered.filter((r) => r.status === 'pass').length;
  const failed = ordered.filter((r) => r.status !== 'pass');
  const wall = (Date.now() - started) / 1000;

  console.log('\n--- per-spec ---');
  for (const r of ordered) {
    console.log(
      `${r.status === 'pass' ? 'PASS' : r.status.toUpperCase().padEnd(7)} ${r.seconds.toFixed(2).padStart(7)}s ${r.exit === null ? '  -' : String(r.exit).padStart(3)}  ${r.spec}`,
    );
  }
  if (failed.length > 0) {
    console.log('\n--- failures (tail of each log) ---');
    for (const r of failed) {
      const text = fs.readFileSync(r.logFile, 'utf8');
      console.log(
        `\n## ${r.spec} [${r.status}${r.reason ? `: ${r.reason}` : ''}] log: ${path.relative(BACKEND_ROOT, r.logFile)}`,
      );
      console.log(tailLines(text, TAIL_LINES));
    }
  }
  console.log(
    `\nrun-critical: ${passed}/${specs.length} passed, ${failed.length} failed, wall ${wall.toFixed(1)}s, ` +
      `${workers} workers, logs in ${path.relative(BACKEND_ROOT, args.logDir)}`,
  );
  process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(`run-critical: fatal: ${err.stack ?? err.message}`);
  process.exitCode = 2;
});
