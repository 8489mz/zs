import { Kysely, sql, Transaction } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { createPasswordRecord, verifyPassword } from '../../core/auth/utils/password-hasher';
import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors/app-error';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';

type DbOrTx = Kysely<Database> | Transaction<Database>;

type ManagerUserRow = {
  id?: number | string | null;
  username?: string | null;
  role?: 'super_admin' | 'admin' | 'cashier' | string | null;
  password_hash?: string | null;
  password_salt?: string | null;
};

type SettingsRow = { key?: string | null; value?: string | null };

/** The keys that can hold the shared manager PIN (legacy aliases included). */
export const MANAGER_PIN_SETTING_KEYS = ['managerPin', 'managerApprovalPin', 'manager_pin'];

const BCRYPT_PREFIXES = ['$2a$', '$2b$', '$2y$'];

/**
 * INV-REST-MANAGER-PIN-HASHED: a stored manager PIN is a bcrypt hash.
 * Mirrors the unexported check in password-hasher (same prefixes).
 */
export function isBcryptHash(value: string): boolean {
  return BCRYPT_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/**
 * INV-REST-MANAGER-PIN-HASHED: hash a manager PIN with bcrypt — the same
 * mechanism as developerMasterPasswordHash (10 rounds, via
 * createPasswordRecord). The hash, never the PIN, is what gets stored.
 */
export async function hashManagerPin(pin: string): Promise<string> {
  const { hash } = await createPasswordRecord(pin);
  return hash;
}

function safeStringEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * The one manager-approval check (INV-SPIRIT-MANAGER-APPROVAL-SHARED).
 * A secret is accepted in exactly two forms, and no other: the shared
 * manager PIN from settings (keys managerPin / managerApprovalPin /
 * manager_pin, JSON-string or plain) — stored as a bcrypt hash and
 * compared via bcrypt, never in plaintext — or the login password of an
 * ACTIVE admin / super_admin account. A legacy plaintext stored PIN still
 * verifies once, and is hashed in place on that first success, so the
 * tenant is never asked to re-enter a PIN it may not remember. The shared
 * manager PIN is set in exactly one place (Settings > Security); every
 * approval screen says the same field accepts the PIN or the manager password.
 * Extracted verbatim from SalesAuthorizationService so purchase
 * edit/cancel verify the same secret the sale paths do — never a
 * second, drifting copy of the rule.
 */
export async function authorizeManagerSecret(
  queryable: DbOrTx,
  auth: AuthContext,
  secret: string,
): Promise<{ mode: 'pin' | 'account'; authorizedByName: string; authorizedById?: number }> {
  const { tenantId } = requireTenantScope(auth);

  const normalizedSecret = String(secret || '').trim();
  if (!normalizedSecret) {
    throw new AppError('أدخل رمز المدير أو كلمة المرور', 'MANAGER_AUTH_REQUIRED', 400);
  }

  const storedPin = await getManagerPin(queryable, tenantId);
  if (storedPin) {
    if (isBcryptHash(storedPin.value)) {
      // Stored as a bcrypt hash: compare via bcrypt, never in plaintext.
      const check = await verifyPassword(normalizedSecret, storedPin.value, '');
      if (check.valid) return { mode: 'pin', authorizedByName: 'اعتماد المدير' };
    } else if (safeStringEquals(normalizedSecret, storedPin.value)) {
      // Legacy plaintext stored value: accept once, then hash it in place
      // so the next verification is bcrypt-only. The tenant is never
      // asked to re-enter a PIN it may not remember, and a wrong PIN
      // still fails closed below.
      await migrateManagerPinToHash(queryable, tenantId, storedPin.key, normalizedSecret);
      return { mode: 'pin', authorizedByName: 'اعتماد المدير' };
    }
  }

  const managerUsers = (await queryable
    .selectFrom('users')
    .select(['id', 'username', 'role', 'password_hash', 'password_salt'])
    .where('is_active', '=', true)
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .where((eb) => eb.or([eb('role', '=', 'admin'), eb('role', '=', 'super_admin')]))
    .execute()) as ManagerUserRow[];

  for (const managerUser of managerUsers) {
    const passwordCheck = await verifyPassword(
      normalizedSecret,
      String(managerUser.password_hash || ''),
      String(managerUser.password_salt || ''),
    );
    if (!passwordCheck.valid) continue;
    return {
      mode: 'account',
      authorizedById: Number(managerUser.id || 0) || undefined,
      authorizedByName: String(managerUser.username || 'المدير'),
    };
  }

  throw new AppError('رمز المدير أو كلمة المرور غير صحيحة', 'MANAGER_AUTH_INVALID', 400);
}

type ManagerPinRow = { key: string; value: string };

async function getManagerPin(queryable: DbOrTx, tenantId: string): Promise<ManagerPinRow | null> {
  const result = await sql<SettingsRow>`
    select key, value from settings
    where key in ('managerPin', 'managerApprovalPin', 'manager_pin')
      and tenant_id = ${tenantId}
  `.execute(queryable);

  const row = result.rows?.find((candidate) => String(candidate.key || '').length > 0);
  if (!row || typeof row.value !== 'string' || !row.value.trim()) return null;
  try {
    const parsed = JSON.parse(row.value);
    if (typeof parsed === 'string' && parsed.trim()) return { key: String(row.key), value: parsed.trim() };
  } catch {
    return { key: String(row.key), value: row.value.trim() };
  }

  return null;
}

/**
 * INV-REST-MANAGER-PIN-HASHED: hash a legacy plaintext PIN in place on
 * first successful verification. Runs on the same queryable (a transaction
 * included), so a rolled-back approval never leaves a half-migrated PIN.
 */
async function migrateManagerPinToHash(
  queryable: DbOrTx,
  tenantId: string,
  key: string,
  pin: string,
): Promise<void> {
  const hash = await hashManagerPin(pin);
  await queryable
    .updateTable('settings')
    .set({ value: JSON.stringify(hash) })
    .where('key', '=', key)
    .where('tenant_id', '=', tenantId)
    .execute();
}
