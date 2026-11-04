import { Kysely, sql, Transaction } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { verifyPassword } from '../../core/auth/utils/password-hasher';
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

/**
 * The one manager-approval check (INV-SPIRIT-MANAGER-APPROVAL-SHARED).
 * A secret is accepted in exactly two forms, and no other: the shared
 * manager PIN from settings (keys managerPin / managerApprovalPin /
 * manager_pin, JSON-string or plain), or the login password of an
 * ACTIVE admin / super_admin account. The shared manager PIN is set
 * in exactly one place (Settings > Security); every approval screen
 * says the same field accepts the PIN or the manager password.
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

  const managerPin = await getManagerPin(queryable, tenantId);
  if (managerPin && normalizedSecret === managerPin) {
    return { mode: 'pin', authorizedByName: 'اعتماد المدير' };
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

async function getManagerPin(queryable: DbOrTx, tenantId: string): Promise<string> {
  const result = await sql<SettingsRow>`
    select key, value from settings
    where key in ('managerPin', 'managerApprovalPin', 'manager_pin')
      and tenant_id = ${tenantId}
  `.execute(queryable);

  const value = result.rows?.find((row) => String(row.key || '').length > 0)?.value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'string' && parsed.trim()) return parsed.trim();
    } catch {
      return value.trim();
    }
  }

  return '';
}
