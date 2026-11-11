import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';

/**
 * Automatic database maintenance service.
 * Runs on every application startup to keep the embedded PostgreSQL healthy.
 *
 * Performs:
 * 1. Cleanup of expired sessions
 * 2. Cleanup of old idempotency records (operation_executions)
 * 3. Cleanup of stale rate-limit rows
 * 4. Cleanup of very old audit logs (configurable retention)
 * 5. VACUUM ANALYZE on high-churn tables
 */
@Injectable()
export class DatabaseMaintenanceService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseMaintenanceService.name);

  /** How many days to keep completed operation_executions before pruning */
  private readonly executionRetentionDays: number;

  /** How many days to keep audit_logs before pruning */
  private readonly auditRetentionDays: number;

  /** Whether maintenance is enabled (disabled for lan_client mode) */
  private readonly enabled: boolean;

  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {
    this.executionRetentionDays = Number(process.env.OPERATION_EXECUTION_RETENTION_DAYS) || 30;
    this.auditRetentionDays = Number(process.env.AUDIT_LOG_RETENTION_DAYS) || 365;
    this.enabled = process.env.ELECTRON_RUNTIME_MODE !== 'lan_client';
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('Database maintenance skipped (lan_client mode).');
      return;
    }

    // Run quick cleanup in the background without delaying startup
    setTimeout(() => {
      this.runFastCleanup().catch((err) => {
        this.logger.error('Quick database cleanup failed', err);
      });
    }, 5000); // 5s after app is fully up and responsive

    // Run periodic cleanup every 10 minutes in background
    const intervalTimer = setInterval(() => {
      this.runFastCleanup().catch((err) => {
        this.logger.error('Periodic database cleanup failed', err);
      });
    }, 10 * 60 * 1000);
    if (typeof (intervalTimer as any)?.unref === 'function') {
      (intervalTimer as any).unref();
    }
  }

  /**
   * Fast, non-blocking cleanup of stale temporary rows (sessions, rate limits, old executions).
   * Runs in milliseconds and does not lock tables or perform heavy I/O.
   */
  async runFastCleanup(): Promise<Record<string, unknown>> {
    const startTime = Date.now();
    const results: Record<string, unknown> = {};

    // 1. Cleanup expired sessions
    try {
      const res = await this.db
        .deleteFrom('sessions')
        .where('expires_at', '<', new Date())
        .executeTakeFirst();
      const count = Number(res.numDeletedRows || 0);
      results.expiredSessionsCleaned = count;
      if (count > 0) this.logger.log(`Cleaned ${count} expired sessions.`);
    } catch (err) {
      this.logger.warn('Failed to cleanup expired sessions', err);
    }

    // 2. Cleanup old operation_executions (completed more than N days ago)
    try {
      const cutoffDays = this.executionRetentionDays;
      const res = await sql`
        DELETE FROM operation_executions
        WHERE status IN ('committed', 'failed')
          AND completed_at IS NOT NULL
          AND completed_at < NOW() - MAKE_INTERVAL(days => ${cutoffDays})
      `.execute(this.db);
      const count = Number((res as any).numAffectedRows || 0);
      results.oldExecutionsCleaned = count;
      if (count > 0) this.logger.log(`Cleaned ${count} old operation_executions (>${cutoffDays} days).`);
    } catch (err) {
      this.logger.warn('Failed to cleanup old operation_executions', err);
    }

    // 3. Cleanup stale rate-limit rows
    try {
      const res = await sql`
        DELETE FROM auth_rate_limits
        WHERE reset_at < NOW() - INTERVAL '1 hour'
      `.execute(this.db);
      const count = Number((res as any).numAffectedRows || 0);
      results.staleRateLimitsCleaned = count;
      if (count > 0) this.logger.log(`Cleaned ${count} stale rate-limit rows.`);
    } catch (err) {
      this.logger.warn('Failed to cleanup stale rate-limit rows', err);
    }

    // 4. Cleanup stale abandoned carts (>30 days old and unrecovered)
    try {
      const res = await sql`
        DELETE FROM storefront_abandoned_carts
        WHERE created_at < NOW() - INTERVAL '30 days'
          AND recovered = false
      `.execute(this.db);
      const count = Number((res as any).numAffectedRows || 0);
      results.staleAbandonedCartsCleaned = count;
      if (count > 0) this.logger.log(`Cleaned ${count} stale abandoned carts (>30 days).`);
    } catch (err) {
      this.logger.warn('Failed to cleanup stale abandoned carts', err);
    }

    // 5. Cleanup expired online order reservations (24h for COD, 30m for card/online)
    try {
      const nowMs = Date.now();
      const onlineCutoff = new Date(nowMs - 30 * 60 * 1000);
      const expiredOrders = await this.db
        .selectFrom('online_orders')
        .select([
          'id',
          'tenant_id',
          'order_number',
          'payment_method',
          'stock_reserved_at',
          'created_at',
          'items_json',
          'coupon_code',
          'reserved_branch_id',
          'reserved_location_id',
          'branch_id',
          'account_id',
        ])
        .where('stock_reserved', '=', true)
        .where('status', '=', 'pending')
        .where('payment_status', '!=', 'paid')
        .where('sale_id', 'is', null)
        // D-SF-12: the engine falls back to created_at when stock_reserved_at is NULL —
        // the selector must do the same, or NULL-timestamp rows can never be reaped.
        .where(sql<boolean>`COALESCE(stock_reserved_at, created_at) < ${onlineCutoff}`)
        .orderBy(sql`COALESCE(stock_reserved_at, created_at)`, 'asc')
        .limit(50)
        .execute();

      let reapedCount = 0;
      for (const ord of expiredOrders) {
        // Enforce 24h window for Cash-on-Delivery, 30m for online/card payments
        const timeoutMs = ord.payment_method === 'cod' ? 24 * 60 * 60 * 1000 : 30 * 60 * 1000;
        const currentCutoff = new Date(nowMs - timeoutMs);
        // D-SF-12: fall back to created_at like the engine does, or a NULL
        // stock_reserved_at row skips the check here but can never be selected above.
        const reservedAt = ord.stock_reserved_at || ord.created_at;
        if (reservedAt && new Date(reservedAt).getTime() > currentCutoff.getTime()) {
          continue; // Order was refreshed or is COD within 24h window
        }

        try {
          await this.db.transaction().execute(async (trx) => {
            const locked = await trx
              .updateTable('online_orders')
              .set({
                stock_reserved: false,
                status: 'cancelled',
                payment_status: 'failed',
                customer_notes: sql`CONCAT(COALESCE(customer_notes, ''), ' [تم إلغاء الطلب تلقائياً لانتهاء مهلة حجز المخزون والسداد]')`,
                updated_at: new Date(),
              })
              .where('id', '=', ord.id)
              .where(sql<boolean>`tenant_id = ${ord.tenant_id}`)
              .where('stock_reserved', '=', true)
              .where('status', '=', 'pending')
              .where('payment_status', '!=', 'paid')
              .where('sale_id', 'is', null)
              .where(sql<boolean>`COALESCE(stock_reserved_at, created_at) <= ${currentCutoff}`)
              .executeTakeFirst();

            if (Number(locked?.numUpdatedRows || 0) === 0) return;

            let items: any[] = [];
            try { items = typeof ord.items_json === 'string' ? JSON.parse(ord.items_json) : ord.items_json; } catch {}
            if (Array.isArray(items) && items.length > 0) {
              const releaseItems = items.map((it) => ({
                productId: Number(it.productId ?? it.id),
                qty: Number(it.quantity ?? it.qty ?? 1),
              })).filter((it) => it.productId > 0 && it.qty > 0);

              if (releaseItems.length > 0) {
                const { releaseLocationStock } = await import('../../common/utils/location-stock-ledger');
                await releaseLocationStock(trx, {
                  tenantId: ord.tenant_id,
                  accountId: ord.account_id,
                  branchId: ord.reserved_branch_id ?? ord.branch_id,
                  locationId: ord.reserved_location_id,
                  items: releaseItems,
                });
              }
            }

            if (ord.coupon_code) {
              await trx
                .updateTable('storefront_coupons')
                .set({ times_used: sql`GREATEST(times_used - 1, 0)`, updated_at: new Date() })
                .where(sql<boolean>`tenant_id = ${ord.tenant_id}`)
                .where('code', '=', String(ord.coupon_code).toUpperCase())
                .execute();
            }
            reapedCount++;
          });
        } catch (err) {
          // D-SF-12: a per-order failure must name the order + error — an
          // empty catch here used to swallow it and retry forever in silence.
          this.logger.warn(`Failed to reap expired online order ${ord.order_number}`, err);
        }
      }
      results.expiredReservationsReaped = reapedCount;
      if (reapedCount > 0) this.logger.log(`Reaped ${reapedCount} expired online order reservations.`);
    } catch (err) {
      this.logger.warn('Failed to reap expired online order reservations', err);
    }

    const durationMs = Date.now() - startTime;
    results.durationMs = durationMs;
    DatabaseMaintenanceService._lastResults = {
      ...results,
      type: 'fast_cleanup',
      completedAt: new Date().toISOString(),
    };

    return results;
  }

  /**
   * Full database maintenance & optimization (VACUUM ANALYZE + Deep Cleanup).
   * Intended to be triggered manually from the UI or periodically.
   */
  async runFullOptimization(): Promise<Record<string, unknown>> {
    const startTime = Date.now();
    this.logger.log('Starting full database optimization & VACUUM...');

    const results = await this.runFastCleanup();

    // Cleanup very old audit logs (beyond retention period)
    try {
      const cutoffDays = this.auditRetentionDays;
      const res = await sql`
        DELETE FROM audit_logs
        WHERE created_at < NOW() - MAKE_INTERVAL(days => ${cutoffDays})
      `.execute(this.db);
      const count = Number((res as any).numAffectedRows || 0);
      results.oldAuditLogsCleaned = count;
      if (count > 0) this.logger.log(`Cleaned ${count} old audit_logs (>${cutoffDays} days).`);
    } catch (err) {
      this.logger.warn('Failed to cleanup old audit_logs', err);
    }

    // VACUUM ANALYZE on high-churn tables to reclaim space and rebuild index statistics
    const tablesToVacuum = [
      'sessions',
      'operation_executions',
      'auth_rate_limits',
      'audit_logs',
      'products',
      'sales',
      'sale_items',
      'customers',
      'suppliers',
      'customer_ledger',
      'supplier_ledger',
      'location_products',
      'online_orders',
      'storefront_abandoned_carts',
    ];

    let vacuumedCount = 0;
    for (const table of tablesToVacuum) {
      try {
        await sql.raw(`VACUUM ANALYZE ${table}`).execute(this.db);
        vacuumedCount++;
      } catch (err) {
        this.logger.warn(`VACUUM ANALYZE ${table} skipped: ${(err as Error).message}`);
      }
    }
    results.tablesVacuumed = vacuumedCount;
    this.logger.log(`VACUUM ANALYZE completed on ${vacuumedCount}/${tablesToVacuum.length} tables.`);

    const durationMs = Date.now() - startTime;
    results.durationMs = durationMs;
    this.logger.log(`Full optimization completed in ${(durationMs / 1000).toFixed(1)}s.`);

    DatabaseMaintenanceService._lastResults = {
      ...results,
      type: 'full_optimization',
      completedAt: new Date().toISOString(),
    };

    return results;
  }

  /** Last maintenance results (accessible by the health controller) */
  static _lastResults: Record<string, unknown> | null = null;

  getLastResults(): Record<string, unknown> | null {
    return DatabaseMaintenanceService._lastResults;
  }
}
