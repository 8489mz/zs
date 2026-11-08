#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '..');
const envExamplePath = path.join(backendRoot, '.env.example');
const runtimeEnvPath = path.join(backendRoot, '.env');
const composeFilePath = path.join(repoRoot, 'docker-compose.yml');
const composeExamplePath = path.join(repoRoot, '.env.compose.example');
const saleReadyScriptPath = path.join(repoRoot, 'scripts', 'certify-sale-ready.sh');
const localE2EScriptPath = path.join(repoRoot, 'scripts', 'run-backend-e2e-local.sh');
const cleanReleaseScriptPath = path.join(repoRoot, 'scripts', 'package-clean-release.sh');
const portableOfflineTemplatePath = path.join(repoRoot, 'portable', 'config', '.env.offline.template');
const readmePath = path.join(repoRoot, 'README.md');

function parseEnv(content) {
  const out = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

function parseComposeBackendEnv(content) {
  const env = {};
  const lines = content.split(/\r?\n/);
  let inBackend = false;
  let inEnvironment = false;

  for (const line of lines) {
    if (!inBackend) {
      if (line === '  backend:') {
        inBackend = true;
      }
      continue;
    }

    if (!inEnvironment) {
      if (line === '    environment:') {
        inEnvironment = true;
        continue;
      }

      if (/^  [A-Za-z0-9_-]+:$/.test(line)) {
        break;
      }
      continue;
    }

    const envMatch = line.match(/^      ([A-Z0-9_]+):\s*(.*)$/);
    if (envMatch) {
      env[envMatch[1]] = envMatch[2].trim().replace(/^['"]|['"]$/g, '');
      continue;
    }

    if (line.trim() === '') {
      continue;
    }

    if (!line.startsWith('      ')) {
      break;
    }
  }

  return env;
}

function parseGithubJobEnv(content, jobName) {
  const env = {};
  const lines = content.split(/\r?\n/);
  let inJob = false;
  let inEnv = false;

  for (const line of lines) {
    if (!inJob) {
      if (line === `  ${jobName}:`) {
        inJob = true;
      }
      continue;
    }

    if (!inEnv) {
      if (line === '    env:') {
        inEnv = true;
        continue;
      }

      if (/^  [A-Za-z0-9_-]+:$/.test(line)) {
        break;
      }
      continue;
    }

    const envMatch = line.match(/^      ([A-Z0-9_]+):\s*(.*)$/);
    if (envMatch) {
      env[envMatch[1]] = envMatch[2].trim().replace(/^['"]|['"]$/g, '');
      continue;
    }

    if (line.trim() === '') {
      continue;
    }

    if (!line.startsWith('      ')) {
      break;
    }
  }

  return env;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isTruthy(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function assertBootstrapEnv(sourceName, env) {
  const bootstrapEnabled = isTruthy(env.ENABLE_BOOTSTRAP_ADMIN);
  const nodeEnv = String(env.NODE_ENV || 'development').trim();
  const password = String(env.DEFAULT_ADMIN_PASSWORD || '');
  const username = String(env.DEFAULT_ADMIN_USERNAME || '').trim();

  if (bootstrapEnabled) {
    assert(username.length > 0, `${sourceName}: DEFAULT_ADMIN_USERNAME is required when bootstrap admin is enabled`);
    assert(password.length > 0, `${sourceName}: DEFAULT_ADMIN_PASSWORD is required when bootstrap admin is enabled`);
    assert(password !== 'ChangeMe123!', `${sourceName}: bootstrap admin password must not use the forbidden default placeholder`);
    assert(password.length >= 14, `${sourceName}: bootstrap admin password must be at least 14 characters long`);
  }

  if (nodeEnv === 'production') {
    assert(String(env.SESSION_COOKIE_SECURE || '').toLowerCase() === 'true', `${sourceName}: production config must enable secure session cookies`);
    assert(String(env.ALLOW_SESSION_ID_HEADER || 'false').toLowerCase() === 'false', `${sourceName}: production config must keep ALLOW_SESSION_ID_HEADER=false`);
    assert(String(env.ALLOW_BOOTSTRAP_ADMIN_IN_PRODUCTION || 'false').toLowerCase() === 'false', `${sourceName}: production config must keep ALLOW_BOOTSTRAP_ADMIN_IN_PRODUCTION=false`);
    assert(!bootstrapEnabled, `${sourceName}: production config must keep ENABLE_BOOTSTRAP_ADMIN=false`);
  }
}

function assertPortableCustomerTemplateSafe(sourceName, env) {
  assert(String(env.ENABLE_BOOTSTRAP_ADMIN || 'false').toLowerCase() === 'false', `${sourceName}: customer portable template must keep ENABLE_BOOTSTRAP_ADMIN=false`);
  assert(String(env.DEFAULT_ADMIN_USERNAME || '').trim() === '', `${sourceName}: customer portable template must keep DEFAULT_ADMIN_USERNAME blank`);
  assert(String(env.DEFAULT_ADMIN_PASSWORD || '').trim() === '', `${sourceName}: customer portable template must keep DEFAULT_ADMIN_PASSWORD blank`);
}

function assertFileDoesNotContain(filePath, pattern, message) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  assert(!pattern.test(content), message);
}

assert(fs.existsSync(envExamplePath), 'Missing backend/.env.example');
const envExample = parseEnv(fs.readFileSync(envExamplePath, 'utf8'));

const required = [
  'NODE_ENV',
  'APP_HOST',
  'APP_PORT',
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_NAME',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'CORS_ORIGINS',
  'SESSION_COOKIE_SECURE',
  'SESSION_COOKIE_SAME_SITE',
  'SESSION_CSRF_SECRET',
  'ALLOW_SESSION_ID_HEADER',
  'ENABLE_BOOTSTRAP_ADMIN',
  'ALLOW_BOOTSTRAP_ADMIN_IN_PRODUCTION',
  'DEFAULT_ADMIN_USERNAME',
  'DEFAULT_ADMIN_PASSWORD',
  'LOGIN_RATE_LIMIT_MAX',
  'LOGIN_RATE_LIMIT_WINDOW_SECONDS',
  'AUTH_BURST_RATE_LIMIT_MAX',
  'AUTH_BURST_RATE_LIMIT_WINDOW_SECONDS',
];

for (const key of required) {
  assert(Object.prototype.hasOwnProperty.call(envExample, key), `Missing env.example key: ${key}`);
}

assert(envExample.ALLOW_SESSION_ID_HEADER === 'false', 'ALLOW_SESSION_ID_HEADER must default to false');
assert(envExample.ENABLE_BOOTSTRAP_ADMIN === 'false', 'ENABLE_BOOTSTRAP_ADMIN must default to false');
assert(envExample.ALLOW_BOOTSTRAP_ADMIN_IN_PRODUCTION === 'false', 'ALLOW_BOOTSTRAP_ADMIN_IN_PRODUCTION must default to false');
assert(envExample.DEFAULT_ADMIN_PASSWORD === '', 'DEFAULT_ADMIN_PASSWORD must be blank in .env.example');
assert(envExample.SESSION_CSRF_SECRET && envExample.SESSION_CSRF_SECRET.length >= 16, 'SESSION_CSRF_SECRET example must be present and long enough');
assertBootstrapEnv('backend/.env.example', envExample);

if (fs.existsSync(runtimeEnvPath) && String(process.env.CHECK_RUNTIME_ENV || '').toLowerCase() === 'true') {
  const runtime = parseEnv(fs.readFileSync(runtimeEnvPath, 'utf8'));
  const nodeEnv = runtime.NODE_ENV || 'development';

  if (nodeEnv === 'production') {
    assert(runtime.SESSION_COOKIE_SECURE === 'true', 'In production, SESSION_COOKIE_SECURE must be true');
    assert((runtime.SESSION_COOKIE_SAME_SITE || '').toLowerCase() !== 'none' || runtime.SESSION_COOKIE_SECURE === 'true', 'SESSION_COOKIE_SAME_SITE=none requires secure cookies');
    assert((runtime.ALLOW_SESSION_ID_HEADER || 'false') === 'false', 'In production, ALLOW_SESSION_ID_HEADER must stay false');
    assert((runtime.ENABLE_BOOTSTRAP_ADMIN || 'false') === 'false', 'In production, ENABLE_BOOTSTRAP_ADMIN must stay false');
    assert((runtime.ALLOW_BOOTSTRAP_ADMIN_IN_PRODUCTION || 'false') === 'false', 'In production, ALLOW_BOOTSTRAP_ADMIN_IN_PRODUCTION must stay false');
    assert(Boolean(runtime.SESSION_CSRF_SECRET) && runtime.SESSION_CSRF_SECRET.length >= 24, 'In production, SESSION_CSRF_SECRET must be set to a strong value (24+ chars)');
    assert(runtime.DEFAULT_ADMIN_PASSWORD !== 'ChangeMe123!', 'Default admin password placeholder must never be used');
  }
}

assert(fs.existsSync(composeFilePath), 'Missing docker-compose.yml');
const composeEnv = parseComposeBackendEnv(fs.readFileSync(composeFilePath, 'utf8'));
assert(Object.keys(composeEnv).length > 0, 'Could not parse backend environment from docker-compose.yml');
assertBootstrapEnv('docker-compose.yml backend service', composeEnv);

if (fs.existsSync(composeExamplePath)) {
  const composeExample = parseEnv(fs.readFileSync(composeExamplePath, 'utf8'));
  const composePassword = String(composeExample.DEFAULT_ADMIN_PASSWORD || '');
  if (composePassword) {
    assert(composePassword.length >= 14, '.env.compose.example must use a bootstrap password that satisfies the app guardrails');
    assert(composePassword !== 'ChangeMe123!', '.env.compose.example must not use the forbidden default admin password placeholder');
  }
}

// CI runs in two stages since the 2026-11-08 split: ci.yml carries the fast
// backend-fast job, ci-full.yml carries the full backend job. The safety check
// must cover the backend env in every CI workflow file that exists, trying the
// pre-split job name first and the split name second.
const ciWorkflowNames = ['ci.yml', 'ci-full.yml'];
for (const ciName of ciWorkflowNames) {
  const ciFile = path.join(repoRoot, '.github', 'workflows', ciName);
  if (!fs.existsSync(ciFile)) continue;
  const ciContent = fs.readFileSync(ciFile, 'utf8');
  let ciEnv = parseGithubJobEnv(ciContent, 'backend');
  let ciJob = 'backend';
  if (Object.keys(ciEnv).length === 0) {
    ciEnv = parseGithubJobEnv(ciContent, 'backend-fast');
    ciJob = 'backend-fast';
  }
  assert(Object.keys(ciEnv).length > 0, `Could not parse backend env from .github/workflows/${ciName}`);
  assertBootstrapEnv(`.github/workflows/${ciName} ${ciJob} job`, ciEnv);
}

assert(fs.existsSync(portableOfflineTemplatePath), 'Missing portable/config/.env.offline.template');
const portableOfflineTemplate = parseEnv(fs.readFileSync(portableOfflineTemplatePath, 'utf8'));
assertPortableCustomerTemplateSafe('portable/config/.env.offline.template', portableOfflineTemplate);

assert(fs.existsSync(cleanReleaseScriptPath), 'Missing scripts/package-clean-release.sh');
const cleanReleaseScript = fs.readFileSync(cleanReleaseScriptPath, 'utf8');
assert(cleanReleaseScript.includes("--exclude 'backend/scripts/reset-zs-password.js'"), 'scripts/package-clean-release.sh must exclude backend/scripts/reset-zs-password.js from customer releases');
assert(cleanReleaseScript.includes("--exclude 'backend/.env'"), 'scripts/package-clean-release.sh must exclude backend/.env from customer releases');

assertFileDoesNotContain(saleReadyScriptPath, /owner123/, 'scripts/certify-sale-ready.sh still references the rejected bootstrap password owner123');
assertFileDoesNotContain(localE2EScriptPath, /owner123/, 'scripts/run-backend-e2e-local.sh still references the rejected bootstrap password owner123');
assertFileDoesNotContain(readmePath, /owner123/, 'README.md still documents the rejected bootstrap password owner123');
assertFileDoesNotContain(portableOfflineTemplatePath, /DEFAULT_ADMIN_PASSWORD=\S+/, 'portable/config/.env.offline.template must not contain a distributable default admin password');

console.log('[check:env-safety] env defaults, compose/CI bootstrap guardrails, and operator docs passed.');
