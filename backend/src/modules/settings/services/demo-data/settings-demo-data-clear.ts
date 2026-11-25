import { sql, type Kysely } from '../../../../database/kysely';
import { AppError } from '../../../../common/errors/app-error';
import type { Database } from '../../../../database/database.types';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import type { AuditService } from '../../../../core/audit/audit.service';

export class SettingsDemoDataClear {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly bound: {
      scope: (actor: AuthContext) => { tenantId: string; accountId: string };
      assertSuperAdminAndPassword: (password: string, actor: AuthContext) => Promise<void>;
      takeAutoBackup: (actor: AuthContext, reason: string) => Promise<void>;
    },
  ) {}

  private scope(actor: AuthContext): { tenantId: string; accountId: string } {
    return this.bound.scope(actor);
  }

  private async assertSuperAdminAndPassword(password: string, actor: AuthContext): Promise<void> {
    return this.bound.assertSuperAdminAndPassword(password, actor);
  }

  private async takeAutoBackup(actor: AuthContext, reason: string): Promise<void> {
    return this.bound.takeAutoBackup(actor, reason);
  }

  async clearDemoData(
    password: string,
    actor: AuthContext,
  ): Promise<{ ok: boolean; message: string; deletedProductsCount: number }> {
    const scope = this.scope(actor);

    if (actor.role === 'super_admin' && password) {
      await this.assertSuperAdminAndPassword(password, actor);
    } else if (!['admin', 'super_admin', 'owner'].includes(actor.role)) {
      throw new AppError('فقط المسؤول أو السوبر أدمن هو المخول بتفريغ البيانات التجريبية', 'ADMIN_REQUIRED', 403);
    }

    await this.takeAutoBackup(actor, 'before_clear_demo_data');

    let deletedCount = 0;

    await this.db.transaction().execute(async (trx) => {
      const demoProducts = await trx
        .selectFrom('products')
        .select(['id'])
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .where(sql<boolean>`(metadata::text LIKE '%"is_demo":true%' OR metadata::text LIKE '%"is_demo": true%')`)
        .execute();

      const demoProductIds = demoProducts.map((p) => Number(p.id));
      deletedCount = demoProductIds.length;

      if (demoProductIds.length > 0) {
        await trx
          .deleteFrom('product_location_stock')
          .where('product_id', 'in', demoProductIds)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .execute();

        await trx
          .deleteFrom('sale_line_stock_allocations')
          .where('product_id', 'in', demoProductIds)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .execute()
          .catch(() => undefined);

        const demoSales = await trx
          .selectFrom('sale_items')
          .select(['sale_id'])
          .distinct()
          .where('product_id', 'in', demoProductIds)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .execute();

        const demoSaleIds = demoSales.map((s) => Number(s.sale_id)).filter(Boolean);
        if (demoSaleIds.length > 0) {
          await (trx as any)
            .deleteFrom('settlement_allocations')
            .where('sale_id', 'in', demoSaleIds)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .execute();
          await trx
            .deleteFrom('sale_items')
            .where('sale_id', 'in', demoSaleIds)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .execute();
          await trx
            .deleteFrom('sale_payments')
            .where('sale_id', 'in', demoSaleIds)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .execute();
          await trx
            .deleteFrom('sales')
            .where('id', 'in', demoSaleIds)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .execute();
        }

        const demoPurchases = await trx
          .selectFrom('purchase_items')
          .select(['purchase_id'])
          .distinct()
          .where('product_id', 'in', demoProductIds)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .execute();

        const demoPurchaseIds = demoPurchases.map((p) => Number(p.purchase_id)).filter(Boolean);
        if (demoPurchaseIds.length > 0) {
          await trx
            .deleteFrom('purchase_items')
            .where('purchase_id', 'in', demoPurchaseIds)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .execute();
          await trx
            .deleteFrom('purchases')
            .where('id', 'in', demoPurchaseIds)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .execute();
        }

        await trx
          .deleteFrom('products')
          .where('id', 'in', demoProductIds)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .execute();
      }

      await trx
        .deleteFrom('online_orders')
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .where(sql<boolean>`order_number LIKE 'ON-DEMO-%'`)
        .execute()
        .catch(() => undefined);

      await trx
        .deleteFrom('suppliers')
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .where(sql<boolean>`(metadata::text LIKE '%"is_demo":true%' OR metadata::text LIKE '%"is_demo": true%')`)
        .execute()
        .catch(() => undefined);

      await trx
        .deleteFrom('customers')
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .where(sql<boolean>`(metadata::text LIKE '%"is_demo":true%' OR metadata::text LIKE '%"is_demo": true%')`)
        .execute()
        .catch(() => undefined);

      await trx
        .deleteFrom('held_sales')
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .where(sql<boolean>`note LIKE '%تجريب%'`)
        .execute()
        .catch(() => undefined);
    });

    await this.audit
      .log(
        'تفريغ البيانات التجريبية',
        `تم تفريغ ومسح ${deletedCount} صنفاً وبيانات تجريبية بواسطة ${actor.username}`,
        actor,
      )
      .catch(() => undefined);

    return {
      ok: true,
      message: `تم تفريغ ومسح البيانات التجريبية بنجاح (${deletedCount} صنفاً). النظام الآن مهيأ للعمل الفعلي.`,
      deletedProductsCount: deletedCount,
    };
  }
}
