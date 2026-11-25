const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '..');
const portableOfflineTemplatePath = path.join(repoRoot, 'portable', 'config', '.env.offline.template');
const packageCleanScriptPath = path.join(repoRoot, 'scripts', 'package-clean-release.sh');
const customerPortableScriptPath = path.join(repoRoot, 'scripts', 'customer-portable-release.cjs');
const customerPortablePreflightScriptPath = path.join(repoRoot, 'scripts', 'verify-customer-portable-release.cjs');
const trackedLocalArtifactPatterns = [
  'frontend/tsconfig.app.tsbuildinfo',
  'frontend/tsconfig.node.tsbuildinfo',
  'portable/app',
  'portable/runtime',
  'portable/config/.env.offline',
  '*.bak',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function exists(base, relPath) {
  return fs.existsSync(path.join(base, relPath));
}

function read(base, relPath) {
  return fs.readFileSync(path.join(base, relPath), 'utf8');
}

function parseEnv(content) {
  const out = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

function getTrackedLocalArtifacts() {
  try {
    const output = execFileSync('git', ['ls-files', '--', ...trackedLocalArtifactPatterns], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    const stderr = String(error && error.stderr ? error.stderr : '').trim();
    const message = String(error && error.message ? error.message : '');
    const combined = `${message}\n${stderr}`.trim();
    const gitUnavailable =
      error.code === 'ENOENT' ||
      error.code === 'EPERM' ||
      /not recognized/i.test(combined) ||
      /unable to find/i.test(combined) ||
      /spawnsync git eperm/i.test(combined);

    if (gitUnavailable) {
      console.warn('[verify-readiness] Warning: git is unavailable; skipping tracked local artifact checks.');
      return null;
    }

    throw error;
  }
}

const requiredBackendFiles = [
  '.env.example',
  'README-STRUCTURE.md',
  'PRODUCTION_CHECKLIST.md',
  'PRE_SALE_HARDENING.md',
  'PHASE12_FINANCIAL_INTEGRITY.md',
  'PHASE13_CRITICAL_FLOW_CONFIDENCE.md',
  'PHASE14_OPERATIONS_READINESS.md',
  'BACKUP_RESTORE.md',
  'MONITORING_READINESS.md',
  'scripts/check-architecture-guardrails.cjs',
  'src/common/utils/location-stock-ledger.ts',
  'src/database/migrations/1710000006000-location-stock-ledger.ts',
  'test/critical/bootstrap-admin-safety.spec.ts',
  'test/critical/financial-integrity.spec.ts',
  'test/critical/login-rate-limit.spec.ts',
  'test/critical/operational-flows.spec.ts',
  'test/critical/session-auth.guard.spec.ts',
  'test/critical/session-auth.spec.ts',
  'test/e2e/auth-session.e2e.ts',
  'test/e2e/catalog-master-data.e2e.ts',
  'test/e2e/commercial-flows.e2e.ts',
  'test/infra/auth.dto.spec.ts',
];

for (const relPath of requiredBackendFiles) {
  const fileExists =
    exists(backendRoot, relPath) ||
    exists(repoRoot, path.join('docs', 'archive', relPath)) ||
    exists(repoRoot, path.join('docs', relPath)) ||
    exists(repoRoot, relPath);
  assert(fileExists, `Missing readiness asset: ${relPath}`);
}

const backendPkg = JSON.parse(read(backendRoot, 'package.json'));
const requiredBackendScripts = [
  'build',
  'typecheck',
  'test:infra',
  'test:critical',
  'test:auth',
  'test:e2e',
  'check:architecture',
  'check:readiness',
  'check:permissions',
  'check:env-safety',
  'check:release-gate',
  'check:go-live',
  'check:commercial-ready',
];

for (const scriptName of requiredBackendScripts) {
  assert(backendPkg.scripts && backendPkg.scripts[scriptName], `Missing backend package script: ${scriptName}`);
}

const repoPkg = JSON.parse(read(repoRoot, 'package.json'));
const requiredRepoScripts = [
  'install:all',
  'build',
  'qa',
  'qa:backend',
  'qa:frontend',
  'compose:e2e',
  'qa:release',
  'customer:portable',
  'customer:portable:preflight',
  'e2e:self',
  'package:clean',
  'qa:sale-ready',
];

for (const scriptName of requiredRepoScripts) {
  assert(repoPkg.scripts && repoPkg.scripts[scriptName], `Missing repo package script: ${scriptName}`);
}

const envExample = read(backendRoot, '.env.example');
for (const key of [
  'NODE_ENV',
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_NAME',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'SESSION_CSRF_SECRET',
  'SESSION_COOKIE_SECURE',
  'ALLOW_SESSION_ID_HEADER',
  'ENABLE_BOOTSTRAP_ADMIN',
  'ALLOW_BOOTSTRAP_ADMIN_IN_PRODUCTION',
  'DEFAULT_ADMIN_USERNAME',
  'DEFAULT_ADMIN_PASSWORD',
  'LOGIN_RATE_LIMIT_MAX',
  'AUTH_BURST_RATE_LIMIT_MAX',
]) {
  assert(envExample.includes(`${key}=`), `Missing backend/.env.example key: ${key}`);
}

const certifySaleReady = read(repoRoot, 'scripts/certify-sale-ready.sh');
assert(certifySaleReady.includes('npm run qa'), 'Sale-ready certification script must run the full QA suite');
assert(certifySaleReady.includes('test:e2e'), 'Sale-ready certification script must run backend E2E tests');
assert(certifySaleReady.includes('health/ready'), 'Sale-ready certification script must wait for readiness endpoint');
assert(certifySaleReady.includes('package:clean'), 'Sale-ready certification script must package a clean release');

const localE2E = read(repoRoot, 'scripts/run-backend-e2e-local.sh');
assert(localE2E.includes('health/ready'), 'Local E2E helper must wait for readiness endpoint');
assert(localE2E.includes('test:e2e'), 'Local E2E helper must execute backend E2E tests');

assert(fs.existsSync(portableOfflineTemplatePath), 'Missing portable/config/.env.offline.template');
const portableOfflineTemplate = parseEnv(fs.readFileSync(portableOfflineTemplatePath, 'utf8'));
assert(
  String(portableOfflineTemplate.ENABLE_BOOTSTRAP_ADMIN || 'false').toLowerCase() === 'false',
  'portable/config/.env.offline.template must keep ENABLE_BOOTSTRAP_ADMIN=false for customer delivery',
);
assert(
  String(portableOfflineTemplate.DEFAULT_ADMIN_USERNAME || '').trim() === '',
  'portable/config/.env.offline.template must keep DEFAULT_ADMIN_USERNAME blank for customer delivery',
);
assert(
  String(portableOfflineTemplate.DEFAULT_ADMIN_PASSWORD || '').trim() === '',
  'portable/config/.env.offline.template must keep DEFAULT_ADMIN_PASSWORD blank for customer delivery',
);

assert(fs.existsSync(packageCleanScriptPath), 'Missing scripts/package-clean-release.sh');
const packageCleanScript = fs.readFileSync(packageCleanScriptPath, 'utf8');
assert(
  packageCleanScript.includes("--exclude 'backend/scripts/reset-zs-password.js'"),
  'package-clean-release.sh must exclude backend/scripts/reset-zs-password.js from clean customer releases',
);
assert(
  packageCleanScript.includes("--exclude 'backend/.env'"),
  'package-clean-release.sh must exclude backend/.env from clean customer releases',
);
assert(fs.existsSync(customerPortableScriptPath), 'Missing scripts/customer-portable-release.cjs');
assert(fs.existsSync(customerPortablePreflightScriptPath), 'Missing scripts/verify-customer-portable-release.cjs');

const trackedLocalArtifacts = getTrackedLocalArtifacts();
if (trackedLocalArtifacts) {
  assert(
    trackedLocalArtifacts.length === 0,
    `Tracked generated/customer-local files must be removed from git: ${trackedLocalArtifacts.join(', ')}`,
  );
}

console.log('Readiness assets, scripts, and release wiring verified.');
