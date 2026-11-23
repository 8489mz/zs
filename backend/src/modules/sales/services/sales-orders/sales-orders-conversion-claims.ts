import type { Kysely } from 'kysely';
import type { Database } from '../../../../database/database.types';

export class SalesOrdersConversionClaims {
  constructor(private readonly db: Kysely<Database>) {}

  /** Durable conversion-operation row for one sales order's claim. */
  conversionOperationParams(scope: { tenantId: string; accountId: string }, idemKey: string) {
    return {
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      idempotencyKey: idemKey,
      operationType: 'sale',
    };
  }

  /** Guarded claim revert: converting -> confirmed, only while converting. */
  async revertConvertingClaim(id: number, scope: { tenantId: string; accountId: string }): Promise<void> {
    await this.db
      .updateTable('sales_orders')
      .set({ status: 'confirmed', updated_at: new Date() })
      .where('id', '=', id)
      .where('status', '=', 'converting')
      .where('tenant_id', '=', scope.tenantId)
      .execute();
  }

  /** Mark the order converted and its items delivered, once a sale id is known. */
  async markOrderConverted(id: number, scope: { tenantId: string; accountId: string }, saleId: number): Promise<void> {
    await this.db
      .updateTable('sales_orders')
      .set({
        status: 'converted',
        sale_id: saleId,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .execute();

    await this.db
      .updateTable('sales_order_items')
      .set((eb) => ({
        delivered_quantity: eb.ref('quantity'),
        reserved_quantity: 0,
      }))
      .where('sales_order_id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .execute();
  }
}
