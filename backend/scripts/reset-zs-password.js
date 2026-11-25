require('dotenv').config();
const { Pool } = require('pg');
const { randomBytes } = require('node:crypto');
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
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}

function assertStrongSupportPassword(password) {
  if (password.length < 14) {
    throw new Error('RESET_PASSWORD must be at least 14 characters long.');
  }
}

async function createPasswordRecord(password) {
  const passwordSalt = randomBytes(16).toString('hex');
  const bcryptSalt = await genSalt(12);
  const passwordHash = await hash(password, bcryptSalt);
  return {
    hash: passwordHash,
    salt: passwordSalt,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const acknowledged =
    String(args['support-only'] || process.env.SUPPORT_RESET_ACKNOWLEDGED || '').toLowerCase() === 'true';

  if (!acknowledged) {
    throw new Error('This support-only script requires --support-only=true or SUPPORT_RESET_ACKNOWLEDGED=true.');
  }

  const username = requireValue(
    args.username || process.env.RESET_USERNAME,
    'RESET_USERNAME is required. Pass --username=<value> or set RESET_USERNAME.',
  );
  const password = requireValue(
    args.password || process.env.RESET_PASSWORD,
    'RESET_PASSWORD is required. Pass --password=<value> or set RESET_PASSWORD.',
  );
  const displayName = String(args['display-name'] || process.env.RESET_DISPLAY_NAME || 'حساب الطوارئ الرئيسي').trim();
  assertStrongSupportPassword(password);
  const passwordRecord = await createPasswordRecord(password);

  const permissions = JSON.stringify([
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

  const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 5432),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: String(process.env.DATABASE_SSL || 'false') === 'true' ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT id FROM users WHERE username = $1 LIMIT 1', [username]);

    if (existing.rows.length) {
      const userId = Number(existing.rows[0].id);
      await client.query(
        `UPDATE users
         SET password_hash = $1,
             password_salt = $2,
             role = 'super_admin',
             is_active = true,
             permissions_json = $3,
             default_branch_id = NULL,
             display_name = $4,
             failed_login_count = 0,
             locked_until = NULL,
             must_change_password = true
         WHERE username = $5`,
        [passwordRecord.hash, passwordRecord.salt, permissions, displayName, username],
      );
      await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM user_branches WHERE user_id = $1', [userId]);
      console.log(`[OK] reset existing support user '${username}'`);
    } else {
      await client.query(
        `INSERT INTO users
         (username, password_hash, password_salt, role, is_active, permissions_json, default_branch_id, display_name, failed_login_count, locked_until, last_login_at, must_change_password)
         VALUES
         ($1, $2, $3, 'super_admin', true, $4, NULL, $5, 0, NULL, NULL, true)`,
        [username, passwordRecord.hash, passwordRecord.salt, permissions, displayName],
      );
      console.log(`[OK] created support user '${username}'`);
    }

    await client.query('COMMIT');
    console.log(`[DONE] support reset user '${username}' is ready and must change password on next use.`);
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
