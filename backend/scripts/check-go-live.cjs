const fs = require('fs');
const path = require('path');

const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '..');
const requiredBackendFiles = [
  'PRODUCTION_CHECKLIST.md',
  'BACKUP_RESTORE.md',
  'MONITORING_READINESS.md',
  'DEPLOYMENT_RUNBOOK.md',
  'PRE_SALE_HARDENING.md',
  'PHASE12_FINANCIAL_INTEGRITY.md',
  'PHASE13_CRITICAL_FLOW_CONFIDENCE.md',
  'PHASE14_OPERATIONS_READINESS.md',
  '.env.example',
  'scripts/check-architecture-guardrails.cjs',
  'src/common/utils/location-stock-ledger.ts',
  'src/database/migrations/1710000006000-location-stock-ledger.ts',
];

const requiredEnvKeys = [
  'NODE_ENV',
  'APP_HOST',
  'APP_PORT',
  'DATABASE_HOST',
  'DATABASE_NAME',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'CORS_ORIGINS',
  'SESSION_COOKIE_SECURE',
  'SESSION_COOKIE_SAME_SITE',
  'SESSION_CSRF_SECRET',
  'ALLOW_SESSION_ID_HEADER',
  'ENABLE_BOOTSTRAP_ADMIN',
  'DEFAULT_ADMIN_PASSWORD',
  'LOGIN_RATE_LIMIT_MAX',
  'AUTH_BURST_RATE_LIMIT_MAX',
];

function assertFile(base, rel) {
  const full = path.join(base, rel);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing required file: ${rel}`);
  }
}

for (const file of requiredBackendFiles) assertFile(backendRoot, file);
for (const file of [
  'PERMISSIONS_AUDIT.md',
  'RELEASE_GATE_FINAL.md',
  'GO_LIVE_GATE.md',
  'PHASE15_FINAL_COMMERCIAL_POLISH.md',
]) {
  assertFile(path.join(repoRoot, 'docs', 'archive'), file);
}
assertFile(path.join(repoRoot, 'docs'), 'LIVE_SAAS_OPERATIONS_CHECKLIST.md');

const envExample = fs.readFileSync(path.join(backendRoot, '.env.example'), 'utf8');
for (const key of requiredEnvKeys) {
  if (!envExample.includes(`${key}=`)) {
    throw new Error(`Missing env.example key: ${key}`);
  }
}

const backendPkg = JSON.parse(fs.readFileSync(path.join(backendRoot, 'package.json'), 'utf8'));
const requiredBackendScripts = [
  'build',
  'typecheck',
  'test:infra',
  'test:critical',
  'test:e2e',
  'check:architecture',
  'check:readiness',
  'check:permissions',
  'check:env-safety',
  'check:release-gate',
];
for (const script of requiredBackendScripts) {
  if (!backendPkg.scripts || !backendPkg.scripts[script]) {
    throw new Error(`Missing backend package.json script: ${script}`);
  }
}

const repoPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
for (const script of [
  'qa',
  'qa:backend',
  'qa:frontend',
  'compose:e2e',
  'qa:release',
  'package:clean',
  'qa:sale-ready',
]) {
  if (!repoPkg.scripts || !repoPkg.scripts[script]) {
    throw new Error(`Missing repo package.json script: ${script}`);
  }
}

const saleReadyScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'certify-sale-ready.sh'), 'utf8');
if (!saleReadyScript.includes('docker compose up -d postgres backend frontend')) {
  throw new Error('Sale readiness script must boot postgres, backend, and frontend');
}
if (!saleReadyScript.includes('health/ready')) {
  throw new Error('Sale readiness script must wait for the readiness endpoint');
}
if (!saleReadyScript.includes('npm run qa')) {
  throw new Error('Sale readiness script must execute the QA suite before packaging');
}

console.log('[check:go-live] release wiring and QA scripts are present; live UAT sign-off is a separate gate.');
