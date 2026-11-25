import { sql, type Kysely } from '../../../../database/kysely';
import { executeWipeTables } from '../settings-demo-data-wipe-tables';
import { resetTenantStockToZero } from '../../../../common/utils/location-stock-ledger';
import type { Database } from '../../../../database/database.types';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import type { AuditService } from '../../../../core/audit/audit.service';

export class SettingsDemoDataWipe {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly bound: {
      scope: (actor: AuthContext) => { tenantId: string; accountId: string };
      assertSuperAdminAndPassword: (password: string, actor: AuthContext) => Promise<void>;
      assertAdminAndPassword: (password: string, actor: AuthContext) => Promise<void>;
      takeAutoBackup: (actor: AuthContext, reason: string) => Promise<void>;
      clearVanSettlementRows: (trx: any, tenantId: string) => Promise<void>;
    },
  ) {}

  private scope(actor: AuthContext): { tenantId: string; accountId: string } {
    return this.bound.scope(actor);
  }

  private async assertSuperAdminAndPassword(password: string, actor: AuthContext): Promise<void> {
    return this.bound.assertSuperAdminAndPassword(password, actor);
  }

  private async assertAdminAndPassword(password: string, actor: AuthContext): Promise<void> {
    return this.bound.assertAdminAndPassword(password, actor);
  }

  private async takeAutoBackup(actor: AuthContext, reason: string): Promise<void> {
    return this.bound.takeAutoBackup(actor, reason);
  }

  private async clearVanSettlementRows(trx: any, tenantId: string): Promise<void> {
    return this.bound.clearVanSettlementRows(trx, tenantId);
  }

  async wipeAllData(password: string, actor: AuthContext): Promise<{ ok: boolean; message: string }> {
    await this.assertSuperAdminAndPassword(password, actor);
    const scope = this.scope(actor);

    await this.takeAutoBackup(actor, 'before_wipe');

    await this.db.transaction().execute(async (trx) => {
      await executeWipeTables(trx, scope.tenantId, actor.userId);
    });

    await this.audit
      .log('تصفير النظام والبيانات', `تم تصفير ومسح كافة بيانات النظام بواسطة ${actor.username}`, actor)
      .catch(() => undefined);

    return {
      ok: true,
      message: 'تم تصفير ومسح كافة البيانات بنجاح، والنظام الآن جاهز ونظيف تماماً للبدء الفعلي.',
    };
  }

  async resetStockBalances(
    password: string,
    actor: AuthContext,
  ): Promise<{ ok: boolean; message: string; productsCount: number }> {
    await this.assertAdminAndPassword(password, actor);
    const scope = this.scope(actor);
    const tenantId = scope.tenantId;

    await this.takeAutoBackup(actor, 'before_stock_reset');

    let productsCount = 0;
    await this.db.transaction().execute(async (trx) => {
      // This administrative reset deletes location balances; take the product locks first.
      await trx
        .selectFrom('products')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .orderBy('id', 'asc')
        .forUpdate()
        .execute();
      // 1. Delete stock transactions, movements, transfers, sessions, damages, allocations
      await (trx as any)
        .deleteFrom('customer_installments')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);
      await (trx as any)
        .deleteFrom('customer_installment_plans')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);
      await (trx as any)
        .deleteFrom('quotation_items')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);
      await (trx as any)
        .deleteFrom('quotations')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);

      await this.clearVanSettlementRows(trx, tenantId);
      await trx
        .deleteFrom('sale_items')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('sale_payments')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('held_sale_items')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('held_sales')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('sales')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();

      await trx
        .deleteFrom('purchase_items')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('purchase_attachments')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('purchases')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();

      await trx
        .deleteFrom('return_items')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('return_documents')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();

      await trx
        .deleteFrom('cashier_shifts')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('treasury_transactions')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('expenses')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();

      await (trx as any)
        .deleteFrom('van_sales_trips')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);

      await trx
        .deleteFrom('stock_transfer_items')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('stock_transfers')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('stock_count_items')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('stock_count_sessions')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('damaged_stock_records')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('stock_movements')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('product_location_stock')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();

      await (trx as any)
        .deleteFrom('trade_in_transactions')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);
      await (trx as any)
        .deleteFrom('online_orders')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);
      await (trx as any)
        .deleteFrom('sale_line_stock_allocations')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);

      // 2. Reset product stock quantities to 0 across all products.
      // INV-DIRECT-MUTATION-ALLOWLIST-LEDGER-ONLY: the bulk zero
      // lives in the ledger module (resetTenantStockToZero) — this
      // file holds no direct products.stock_qty write anymore, so
      // its allowlist entry is removed. Per-product applyStockDelta
      // deltas would be ceremony here: step 1 above just deleted
      // the movement trail the deltas would write to, and the
      // ledger does not touch reserved_qty, which a reset also
      // zeroes. The wipe's guards are unchanged (admin + password,
      // auto-backup first).
      const countRes = await trx
        .selectFrom('products')
        .select(trx.fn.count('id').as('cnt'))
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .executeTakeFirst();
      productsCount = Number(countRes?.cnt || 0);

      await resetTenantStockToZero(trx, tenantId);

      // Reset journal entries for sales/purchases/inventory to keep ledger clean
      await trx
        .deleteFrom('journal_entry_lines')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('journal_entries')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
    });

    await this.audit
      .log(
        'تصفير أرصدة المخزون لبدء التشغيل الفعلي',
        `تم تصفير كميات وأرصدة كافة الأصناف (${productsCount} صنف) والحركات التجارية بنجاح بواسطة ${actor.username}`,
        actor,
      )
      .catch(() => undefined);

    return {
      ok: true,
      message: `تم تصفير أرصدة المخزون والحركات لكافة الأصناف (${productsCount} صنف) بنجاح. كافة الأصناف والأسعار محفوظة وجاهزة لبدء الجرد الفعلي.`,
      productsCount,
    };
  }

  async wipeCatalogAndStock(password: string, actor: AuthContext): Promise<{ ok: boolean; message: string }> {
    await this.assertAdminAndPassword(password, actor);
    const scope = this.scope(actor);
    const tenantId = scope.tenantId;

    await this.takeAutoBackup(actor, 'before_catalog_wipe');

    await this.db.transaction().execute(async (trx) => {
      // 1. Operational tables
      await (trx as any)
        .deleteFrom('customer_installments')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);
      await (trx as any)
        .deleteFrom('customer_installment_plans')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);
      await (trx as any)
        .deleteFrom('quotation_items')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);
      await (trx as any)
        .deleteFrom('quotations')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);

      await this.clearVanSettlementRows(trx, tenantId);
      await trx
        .deleteFrom('sale_items')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('sale_payments')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('held_sale_items')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('held_sales')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('sales')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();

      await trx
        .deleteFrom('purchase_items')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('purchase_attachments')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('purchases')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();

      await trx
        .deleteFrom('return_items')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('return_documents')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();

      await trx
        .deleteFrom('cashier_shifts')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('treasury_transactions')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('expenses')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();

      await (trx as any)
        .deleteFrom('van_sales_trips')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);

      await trx
        .deleteFrom('stock_transfer_items')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('stock_transfers')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('stock_count_items')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('stock_count_sessions')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('damaged_stock_records')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('stock_movements')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('product_location_stock')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();

      // Manufacturing & Work Orders (must be deleted before products/stock)
      await trx
        .deleteFrom('manufacturing_wo_consumptions')
        .where(
          'work_order_id',
          'in',
          trx
            .selectFrom('manufacturing_work_orders')
            .select('id')
            .where(sql<boolean>`tenant_id = ${tenantId}`),
        )
        .execute();
      await trx
        .deleteFrom('manufacturing_work_orders')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();

      await trx
        .deleteFrom('manufacturing_bom_lines')
        .where(
          'bom_id',
          'in',
          trx
            .selectFrom('manufacturing_boms')
            .select('id')
            .where(sql<boolean>`tenant_id = ${tenantId}`),
        )
        .execute();
      await trx
        .deleteFrom('manufacturing_boms')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();

      // Import & Export Shipments
      await (trx as any)
        .deleteFrom('import_sale_partner_shares')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);
      await (trx as any)
        .deleteFrom('import_sales_and_profit')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);
      await (trx as any)
        .deleteFrom('import_shipment_items')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);
      await (trx as any)
        .deleteFrom('import_shipments')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);

      // Maintenance & Trade-in & Online Orders & Pharmacy
      await trx
        .deleteFrom('maintenance_ticket_parts')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);
      await trx
        .deleteFrom('maintenance_tickets')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);
      await trx
        .deleteFrom('trade_in_transactions')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);
      await trx
        .deleteFrom('online_orders')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);

      await trx
        .deleteFrom('pharmacy_clinical_services')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);
      await trx
        .deleteFrom('pharmacy_shortages')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);
      await trx
        .deleteFrom('pharmacy_prescriptions')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);
      await trx
        .deleteFrom('pharmacy_batches')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);
      await trx
        .deleteFrom('pharmacy_drugs')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);

      await trx
        .deleteFrom('sale_line_stock_allocations')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);
      await trx
        .deleteFrom('price_change_items')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);
      await trx
        .deleteFrom('price_change_runs')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute()
        .catch(() => undefined);

      // 2. Wipe catalog products & categories & price lists
      await trx
        .deleteFrom('product_offers')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('product_units')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('product_customer_prices')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('product_pricing_profiles')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('pricing_rules')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('products')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('product_categories')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();

      // 3. Accounting & Journals
      await trx
        .deleteFrom('journal_entry_lines')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
      await trx
        .deleteFrom('journal_entries')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
    });

    await this.audit
      .log(
        'مسح كافة الأصناف والمخزون كلياً',
        `تم مسح كافة الأصناف والتصنيفات والمخزون كلياً مع الحفاظ على بيانات المنشأة والفروع والمستخدمين بواسطة ${actor.username}`,
        actor,
      )
      .catch(() => undefined);

    return {
      ok: true,
      message:
        'تم مسح كافة الأصناف والكتالوج وحركات المخزون بنجاح. بيانات المنشأة والفروع والمستخدمين والإعدادات محفوظة تماماً.',
    };
  }
}
