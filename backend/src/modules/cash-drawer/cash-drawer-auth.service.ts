import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { AppError } from '../../common/errors/app-error';
import { type CashDrawerMovementType } from './helpers/cash-drawer.helper';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { type TenantScope } from '../../core/auth/utils/tenant-boundary';
import { verifyPassword } from '../../core/auth/utils/password-hasher';
import { authorizeManagerSecret } from '../../common/utils/manager-approval';
import { Database } from '../../database/database.types';
import { type SettingsRow, type UserPasswordRow } from './cash-drawer.types';

/**
 * CashDrawerAuthService — slice S1 of the cash-drawer split.
 * Pure move of the five auth checks from CashDrawerService. No
 * behavior change: the bodies are byte-identical except for the
 * forced visibility change below; the facade keeps thin delegates
 * with the same names and signatures. This slice reaches the kernel
 * helper only through a bound dep — it never imports another slice
 * service. The checks are public here (private in the facade) — the
 * facade, a different class, cannot call a private slice method
 * (tsc TS2341); the facade delegates stay private, so the facade
 * public surface is unchanged.
 */

export interface CashDrawerAuthDeps {
  db: Kysely<Database>;
  // Bound kernel helper (stays in the facade; passed bound so the moved
  // bodies stay byte-identical).
  scope: (auth: AuthContext) => TenantScope;
}

@Injectable()
export class CashDrawerAuthService {
  private readonly db: Kysely<Database>;
  private readonly scope: (auth: AuthContext) => TenantScope;

  constructor(deps: CashDrawerAuthDeps) {
    this.db = deps.db;
    this.scope = deps.scope;
  }

  // INV-REST-MANAGER-PIN-HASHED: the drawer no longer keeps its own
  // plaintext copy of the manager-PIN check. The shared
  // authorizeManagerSecret is the one rule (bcrypt compare, legacy
  // plaintext migrates in place on first success, admin login-password
  // fallback) — the drawer's observable errors stay its own
  // (MANAGER_PIN_INVALID + the drawer messages), so callers see no change.
  async assertManagerPin(pin: string, auth: AuthContext): Promise<void> {
    try {
      await authorizeManagerSecret(this.db, auth, pin);
    } catch (err) {
      const code = (err as AppError)?.code;
      if (code === 'MANAGER_AUTH_REQUIRED') {
        throw new AppError('أدخل رمز المشرف أو كلمة مرور الإدارة', 'MANAGER_PIN_INVALID', 400);
      }
      if (code === 'MANAGER_AUTH_INVALID') {
        throw new AppError('رمز الاعتماد غير صحيح', 'MANAGER_PIN_INVALID', 400);
      }
      throw err;
    }
  }

  canReviewPendingShift(auth: AuthContext): boolean { return ['admin', 'super_admin', 'manager'].includes(String(auth.role || '').trim()); }

  async assertCurrentUserPassword(password: string, auth: AuthContext): Promise<void> {
    const providedPassword = String(password || '').trim();
    if (!providedPassword) throw new AppError('أدخل كلمة مرور المستخدم الحالي', 'CURRENT_USER_PASSWORD_REQUIRED', 400);
    const scope = this.scope(auth);
    const result = await sql<UserPasswordRow>`select id, is_active, password_hash, password_salt from users where id = ${auth.userId} and tenant_id = ${scope.tenantId} limit 1`.execute(this.db);
    const user = result.rows?.[0] || null;
    if (!user || user.is_active === false || user.is_active === 0 || user.is_active === 'false') throw new AppError('المستخدم الحالي غير متاح', 'CURRENT_USER_NOT_FOUND', 400);
    const passwordCheck = await verifyPassword(providedPassword, String(user.password_hash || ''), String(user.password_salt || ''));
    if (!passwordCheck.valid) {
      try {
        await this.assertManagerPin(providedPassword, auth);
        return;
      } catch {
        throw new AppError('كلمة مرور المستخدم الحالي غير صحيحة', 'CURRENT_USER_PASSWORD_INVALID', 400);
      }
    }
  }

  // F5 (trial problem 5, 2026-11-21, test10k): the STRICT variant for
  // shift open/close ONLY. The close dialog asks for the CURRENT
  // user's password, but the fallback above accepted any active
  // admin login password (via authorizeManagerSecret), so the trial's
  // admin password closed a cashier's shift — password identity was
  // never verified. Strict verifies ONLY the signed-in user's own
  // password: no manager-PIN fallback, no admin-password fallback.
  // The shared assertManagerPin / authorizeManagerSecret stay
  // untouched for their legitimate paths (drawer money-out approvals
  // via assertCashDrawerApproval, open-tables override, second
  // approver) — only the shift open/close assertion is strict.
  async assertCurrentUserPasswordStrict(password: string, auth: AuthContext): Promise<void> {
    const providedPassword = String(password || '').trim();
    if (!providedPassword) throw new AppError('أدخل كلمة مرور المستخدم الحالي', 'CURRENT_USER_PASSWORD_REQUIRED', 400);
    const scope = this.scope(auth);
    const result = await sql<UserPasswordRow>`select id, is_active, password_hash, password_salt from users where id = ${auth.userId} and tenant_id = ${scope.tenantId} limit 1`.execute(this.db);
    const user = result.rows?.[0] || null;
    if (!user || user.is_active === false || user.is_active === 0 || user.is_active === 'false') throw new AppError('المستخدم الحالي غير متاح', 'CURRENT_USER_NOT_FOUND', 400);
    const passwordCheck = await verifyPassword(providedPassword, String(user.password_hash || ''), String(user.password_salt || ''));
    if (!passwordCheck.valid) {
      throw new AppError('كلمة مرور المستخدم الحالي غير صحيحة', 'CURRENT_USER_PASSWORD_INVALID', 400);
    }
  }

  async isPasswordRequiredOnShiftOpen(auth: AuthContext): Promise<boolean> {
    const scope = this.scope(auth);
    const result = await sql<SettingsRow>`select key, value from settings where tenant_id = ${scope.tenantId} and key = 'requirePasswordOnShiftOpen' limit 1`.execute(this.db);
    const raw = result.rows?.[0]?.value;
    if (raw == null) return false;
    if (typeof raw === 'boolean') return raw;
    try {
      const parsed = JSON.parse(String(raw));
      return parsed === true || parsed === 'true' || parsed === 1 || parsed === '1';
    } catch {
      return String(raw).trim() === 'true' || String(raw).trim() === '1';
    }
  }

  // INV-DRAWER-DISBURSE-CASHIER-PASSWORD: drawer disbursements
  // (cash_out + safe_drop) accept the CASHIER'S OWN password —
  // the same current-user confirmation as deposits — instead of a
  // manager PIN. The cashier is recorded in the audit trail
  // (treasury row created_by = auth.userId). The manager PIN is
  // still accepted as a fallback inside assertCurrentUserPassword
  // (the deposits pattern). Posted-invoice edit and stock-count
  // approval stay manager-gated: they do not call this method.
  async assertCashDrawerApproval(movementType: CashDrawerMovementType, approvalSecret: string, auth: AuthContext): Promise<void> {
    await this.assertCurrentUserPassword(approvalSecret, auth);
  }
}
