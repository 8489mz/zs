import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { Database } from '../../database/database.types';
import { KYSELY_DB } from '../../database/database.constants';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../auth/utils/tenant-boundary';

type AuditActor = Pick<AuthContext, 'userId' | 'tenantId' | 'accountId'> & Pick<Partial<AuthContext>, 'impersonatedBy'>;

/** Stable event codes consumed by detection logic (fraud radar, alerting). */
export const AUDIT_EVENT_CODES = {
  POS_CART_ITEM_REMOVED: 'POS_CART_ITEM_REMOVED',
  POS_DRAFT_SALE_CANCELLED: 'POS_DRAFT_SALE_CANCELLED',
  POS_DISCOUNT_OVERRIDE: 'POS_DISCOUNT_OVERRIDE',
  POS_SALE_RETURN: 'POS_SALE_RETURN',
  SAAS_TENANT_TRIAL_CREATED: 'SAAS_TENANT_TRIAL_CREATED',
  SAAS_TENANT_ACTIVATED: 'SAAS_TENANT_ACTIVATED',
  SAAS_TENANT_SUSPENDED: 'SAAS_TENANT_SUSPENDED',
  SAAS_TENANT_EXPIRED: 'SAAS_TENANT_EXPIRED',
  SAAS_TENANT_TRIAL_EXTENDED: 'SAAS_TENANT_TRIAL_EXTENDED',
  SAAS_TENANT_DELETED: 'SAAS_TENANT_DELETED',
  SAAS_TENANT_PLAN_UPDATED: 'SAAS_TENANT_PLAN_UPDATED',
  SAAS_TENANT_SLUG_UPDATED: 'SAAS_TENANT_SLUG_UPDATED',
  SAAS_TENANT_PASSWORD_RESET: 'SAAS_TENANT_PASSWORD_RESET',
  SAAS_TENANT_OWNER_UNLOCKED: 'SAAS_TENANT_OWNER_UNLOCKED',
  SAAS_SUBSCRIPTION_RENEWED: 'SAAS_SUBSCRIPTION_RENEWED',
  SAAS_PAYMENT_RECORDED: 'SAAS_PAYMENT_RECORDED',
  SAAS_IMPERSONATION_STARTED: 'SAAS_IMPERSONATION_STARTED',
  SAAS_IMPERSONATION_ENDED: 'SAAS_IMPERSONATION_ENDED',
  AUTH_PASSWORD_RESET_REQUESTED: 'AUTH_PASSWORD_RESET_REQUESTED',
  AUTH_PASSWORD_RESET_COMPLETED: 'AUTH_PASSWORD_RESET_COMPLETED',
  VAN_SUSPICION_INVALID_PIN: 'VAN_SUSPICION_INVALID_PIN',
  VAN_SUSPICION_SELF_APPROVAL: 'VAN_SUSPICION_SELF_APPROVAL',
  VAN_SUSPICION_PRICE_MANIPULATION: 'VAN_SUSPICION_PRICE_MANIPULATION',
  VAN_SUSPICION_UNAUTHORIZED_BONUS: 'VAN_SUSPICION_UNAUTHORIZED_BONUS',
  VAN_SUSPICION_CREDIT_BYPASS: 'VAN_SUSPICION_CREDIT_BYPASS',
  VAN_SUSPICION_FAKE_CARD_PAYMENT: 'VAN_SUSPICION_FAKE_CARD_PAYMENT',
  VAN_SUSPICION_EXPENSE_ABUSE: 'VAN_SUSPICION_EXPENSE_ABUSE',
  VAN_SUSPICION_CROSS_REP_COLLECTION: 'VAN_SUSPICION_CROSS_REP_COLLECTION',
  VAN_SUSPICION_FRAUDULENT_RETURN: 'VAN_SUSPICION_FRAUDULENT_RETURN',
  VAN_SUSPICION_ODOMETER_ROLLBACK: 'VAN_SUSPICION_ODOMETER_ROLLBACK',
  VAN_SUSPICION_UNAUTHORIZED_LOAD_OR_SETTLE: 'VAN_SUSPICION_UNAUTHORIZED_LOAD_OR_SETTLE',
  VAN_SUSPICION_GEOFENCE_VIOLATION: 'VAN_SUSPICION_GEOFENCE_VIOLATION',
  VAN_SUSPICION_SETTLEMENT_SHORTAGE: 'VAN_SUSPICION_SETTLEMENT_SHORTAGE',
  MANUFACTURING_UNBUILD_VARIANCE_REVIEW_REQUIRED: 'MANUFACTURING_UNBUILD_VARIANCE_REVIEW_REQUIRED',
} as const;

export type AuditEventCode = (typeof AUDIT_EVENT_CODES)[keyof typeof AUDIT_EVENT_CODES];

type AuditLogOptions = { targetTenantId?: string; eventCode?: AuditEventCode | string; idempotencyKey?: string };

@Injectable()
export class AuditService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  async log(action: string, details: string, actor: AuditActor, options?: AuditLogOptions): Promise<void> {
    await this.logWithExecutor(this.db, action, details, actor, options);
  }

  async logWithExecutor(executor: Kysely<Database>, action: string, details: string, actor: AuditActor, options?: AuditLogOptions): Promise<void> {
    const scope = requireTenantScope(actor as AuthContext);
    // A caller-supplied idempotency key deduplicates its own audit row:
    // the same business save replayed (double-click, two UI paths calling
    // the same POST) must not write a second identical row. The key is
    // derived from the saved payload, so a genuine correction (different
    // payload, different key) still logs. Without a key the insert is
    // unchanged — legacy NULL keys never conflict (unique indexes treat
    // NULLs as distinct).
    const idempotencyKey = options?.idempotencyKey ? String(options.idempotencyKey) : null;
    const base = {
      action,
      details,
      // Stable machine-readable discriminator. Detection logic must key off this, never off the
      // human-facing `action` text, which is free to be reworded or translated.
      event_code: options?.eventCode ?? null,
      target_tenant_id: options?.targetTenantId ?? null,
      created_by: actor.userId ?? null,
      // `created_by` is whose identity the action ran under; this is who actually took
      // it. They differ only during platform impersonation, which is exactly the case
      // that used to be invisible here (O34).
      impersonated_by: actor.impersonatedBy ?? null,
      tenant_id: scope.tenantId,
      account_id: scope.accountId,
    };
    if (idempotencyKey) {
      await executor
        .insertInto('audit_logs')
        .values({ ...base, idempotency_key: idempotencyKey } as any)
        .onConflict((oc) => oc.columns(['tenant_id', 'idempotency_key']).doNothing())
        .execute();
    } else {
      // Keyless callers keep the exact pre-0293 insert: schemas that have
      // not run the migration (older specs, pre-migration databases) must
      // not see the new column at all.
      await executor
        .insertInto('audit_logs')
        .values(base as any)
        .execute();
    }
  }
}
