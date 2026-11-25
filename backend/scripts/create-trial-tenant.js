require('dotenv').config();
const { Pool } = require('pg');
const { randomBytes, randomUUID } = require('node:crypto');
const { genSalt, hash } = require('bcryptjs');

function parseArgs(argv) {
  const args = {};
  for (const token of argv) {
    if (!token.startsWith('--')) continue;
    const eqIndex = token.indexOf('=');
    if (eqIndex === -1) {
      args[token.slice(2)] = 'true';
      continue;
    }
    args[token.slice(2, eqIndex)] = token.slice(eqIndex + 1);
  }
  return args;
}

function requireValue(value, message) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(message);
  return normalized;
}

function optionalValue(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeSlug(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  if (!normalized || normalized.length < 3) {
    throw new Error('Trial slug must contain at least 3 valid characters. Use English letters, numbers, and dashes.');
  }

  if (normalized.length > 60) {
    throw new Error('Trial slug must be 60 characters or fewer.');
  }

  return normalized;
}

function assertStrongTrialPassword(password) {
  if (String(password || '').trim().length < 1) {
    throw new Error('كلمة المرور لا يمكن أن تكون فارغة.');
  }
}

function generatePassword() {
  return `Trial-${randomBytes(9).toString('base64url')}@Zs1`;
}

async function createPasswordRecord(password) {
  const passwordSalt = randomBytes(16).toString('hex');
  const bcryptSalt = await genSalt(12);
  const passwordHash = await hash(password, bcryptSalt);
  return { hash: passwordHash, salt: passwordSalt };
}

function getNumber(value, fallback) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) return fallback;
  return Math.floor(normalized);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required in backend/.env`);
  return value;
}

function defaultPermissions() {
  return JSON.stringify([
    'dashboard',
    'products',
    'sales',
    'purchases',
    'inventory',
    'suppliers',
    'customers',
    'accounts',
    'returns',
    'reports',
    'audit',
    'treasury',
    'services',
    'settings',
    'cashDrawer',
    'canPrint',
    'canDiscount',
    'canEditPrice',
    'canViewProfit',
    'canDelete',
    'canEditInvoices',
    'canAdjustInventory',
    'canManageSettings',
    'canManageUsers',
    'canEditUsers',
    'canManageBackups',
  ]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const acknowledged =
    String(args['support-only'] || process.env.SUPPORT_RESET_ACKNOWLEDGED || '').toLowerCase() === 'true';
  if (!acknowledged) {
    throw new Error('This support-only script requires --support-only=true.');
  }

  const slug = normalizeSlug(requireValue(args.slug, 'Pass --slug=<trial-slug>.'));
  const businessName = requireValue(args['business-name'], 'Pass --business-name=<name>.');
  const ownerName = requireValue(args['owner-name'], 'Pass --owner-name=<name>.');
  const ownerPhone = requireValue(args['owner-phone'], 'Pass --owner-phone=<phone>.');
  const ownerEmail = optionalValue(args['owner-email']);
  const activityType = optionalValue(args['activity-type']);
  const username = requireValue(args.username, 'Pass --username=<trial-owner-username>.');
  const days = getNumber(args.days, 3);
  const temporaryPassword = String(args.password || generatePassword()).trim();
  assertStrongTrialPassword(temporaryPassword);

  const now = new Date();
  const expiresAt = addDays(now, days);
  const tenantId = randomUUID();
  const signupId = randomUUID();
  const passwordRecord = await createPasswordRecord(temporaryPassword);
  const accountId = `${tenantId}:main`;

  const pool = new Pool({
    host: requiredEnv('DATABASE_HOST'),
    port: Number(process.env.DATABASE_PORT || 5432),
    database: requiredEnv('DATABASE_NAME'),
    user: requiredEnv('DATABASE_USER'),
    password: requiredEnv('DATABASE_PASSWORD'),
    ssl: String(process.env.DATABASE_SSL || 'false') === 'true' ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const duplicateSlug = await client.query('SELECT id FROM tenants WHERE slug = $1 LIMIT 1', [slug]);
    if (duplicateSlug.rows.length) {
      throw new Error(`Trial slug '${slug}' already exists.`);
    }

    const duplicateUser = await client.query('SELECT id FROM users WHERE username = $1 LIMIT 1', [username]);
    if (duplicateUser.rows.length) {
      throw new Error(`Username '${username}' already exists. Choose another username.`);
    }

    await client.query(
      `INSERT INTO tenants
       (id, slug, business_name, owner_name, owner_phone, owner_email, activity_type, status, trial_starts_at, trial_ends_at, created_at, updated_at)
       VALUES
       ($1, $2, $3, $4, $5, $6, $7, 'trial', $8, $9, $8, $8)`,
      [tenantId, slug, businessName, ownerName, ownerPhone, ownerEmail, activityType, now, expiresAt],
    );

    await client.query(
      `INSERT INTO trial_signups
       (id, tenant_id, source, campaign, utm_source, utm_campaign, notes, created_at)
       VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        signupId,
        tenantId,
        optionalValue(args.source),
        optionalValue(args.campaign),
        optionalValue(args['utm-source']),
        optionalValue(args['utm-campaign']),
        optionalValue(args.notes),
        now,
      ],
    );

    await client.query(
      `INSERT INTO users
       (username, password_hash, password_salt, role, is_active, permissions_json, default_branch_id, display_name, failed_login_count, locked_until, last_login_at, must_change_password, tenant_id, account_id)
       VALUES
       ($1, $2, $3, 'admin', true, $4, NULL, $5, 0, NULL, NULL, true, $6, $7)`,
      [username, passwordRecord.hash, passwordRecord.salt, defaultPermissions(), ownerName, tenantId, accountId],
    );

    await client.query('COMMIT');

    console.log('[OK] trial tenant created');
    console.log(`tenantId=${tenantId}`);
    console.log(`accountId=${accountId}`);
    console.log(`slug=${slug}`);
    console.log(`businessName=${businessName}`);
    console.log(`username=${username}`);
    console.log(`temporaryPassword=${temporaryPassword}`);
    console.log(`trialStartsAt=${now.toISOString()}`);
    console.log(`trialEndsAt=${expiresAt.toISOString()}`);
    console.log('trialUrl=https://app.DOMAIN_PLACEHOLDER/login');
    console.log('[NEXT] Log in with the trial user, then change the temporary password.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[ERROR]', error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[FATAL]', error.message);
  process.exit(1);
});
