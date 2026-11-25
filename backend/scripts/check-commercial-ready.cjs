#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');
const checks = [
  '.env.example',
  'BACKUP_RESTORE.md',
  'MONITORING_READINESS.md',
  'DEPLOYMENT_RUNBOOK.md',
  'PRE_SALE_HARDENING.md',
  'PHASE12_FINANCIAL_INTEGRITY.md',
  'PHASE13_CRITICAL_FLOW_CONFIDENCE.md',
  'PHASE14_OPERATIONS_READINESS.md',
  'scripts/check-architecture-guardrails.cjs',
  'scripts/check-go-live.cjs',
  'scripts/check-permissions-audit.cjs',
  'scripts/check-env-safety.cjs',
  'scripts/verify-readiness.cjs',
  'src/common/utils/location-stock-ledger.ts',
  'src/database/migrations/1710000006000-location-stock-ledger.ts',
  'test/critical/bootstrap-admin-safety.spec.ts',
  'test/critical/financial-integrity.spec.ts',
  'test/critical/login-rate-limit.spec.ts',
  'test/critical/operational-flows.spec.ts',
  'test/critical/reports-treasury-pagination.spec.ts',
  'test/critical/reports-audit-logs-pagination.spec.ts',
  'test/critical/session-auth.guard.spec.ts',
  'test/critical/session-auth.spec.ts',
  'test/infra/auth.dto.spec.ts',
];

const missing = checks.filter((entry) => !fs.existsSync(path.join(root, entry)));
const archivedChecks = [
  'GO_LIVE_GATE.md',
  'PERMISSIONS_AUDIT.md',
  'RELEASE_GATE_FINAL.md',
  'PHASE15_FINAL_COMMERCIAL_POLISH.md',
];
missing.push(
  ...archivedChecks
    .filter((entry) => !fs.existsSync(path.join(repoRoot, 'docs', 'archive', entry)))
    .map((entry) => `docs/archive/${entry}`),
);
if (!fs.existsSync(path.join(repoRoot, 'docs', 'LIVE_SAAS_OPERATIONS_CHECKLIST.md'))) {
  missing.push('docs/LIVE_SAAS_OPERATIONS_CHECKLIST.md');
}
if (missing.length) {
  console.error('[check:commercial-ready] missing required release assets:');
  for (const entry of missing) console.error(` - ${entry}`);
  process.exit(1);
}

const repoPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
for (const scriptName of ['qa', 'qa:release', 'package:clean', 'qa:sale-ready']) {
  if (!repoPkg.scripts || !repoPkg.scripts[scriptName]) {
    console.error(`[check:commercial-ready] missing repo script: ${scriptName}`);
    process.exit(1);
  }
}

console.log(
  '[check:commercial-ready] release assets and QA entrypoints are present; live UAT sign-off is a separate gate',
);
