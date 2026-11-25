import assert from 'node:assert/strict';
import type { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { PurchaseOrdersService } from '../../src/modules/purchases/services/purchase-orders.service';

async function main(): Promise<void> {
  const auth: AuthContext = {
    tenantId: 'tenant-a',
    accountId: 'tenant-a',
    userId: 1,
    username: 'approver',
    role: 'admin',
    permissions: [],
    sessionId: 'test',
  };
  const order: any = {
    id: 7,
    tenant_id: 'tenant-a',
    account_id: 'tenant-a',
    supplier_id: 9,
    order_number: 'PO-7',
    status: 'confirmed',
    total_amount: 210,
    discount_amount: 0,
    tax_amount: 10,
  };
  const items = [{ id: 17, product_id: 31, quantity: 2, unit_cost: 100, unit_name: 'piece' }];
  const bill: any = { id: 51, po_id: null };
  const billItems = [{ id: 61, product_id: 31, po_item_id: null as number | null }];
  const query = (table: string) => {
    const builder: any = {
      selectAll: () => builder,
      select: () => builder,
      where: () => builder,
      orderBy: () => builder,
      forUpdate: () => builder,
      executeTakeFirst: async () => (table === 'purchase_orders' ? order : undefined),
      execute: async () => (table === 'purchase_order_items' ? items : table === 'purchase_items' ? billItems : []),
    };
    return builder;
  };
  const db: any = {
    selectFrom: query,
    updateTable: (table: string) => {
      let values: any;
      const builder: any = {
        set: (input: any) => {
          values = input;
          return builder;
        },
        where: () => builder,
        execute: async () => {
          if (table === 'purchases') Object.assign(bill, values);
          if (table === 'purchase_items') Object.assign(billItems[0], values);
          if (table === 'purchase_orders') Object.assign(order, values);
          return [{ numUpdatedRows: 1n }];
        },
      };
      return builder;
    },
    transaction: () => ({ execute: async (callback: (trx: any) => Promise<unknown>) => callback(db) }),
  };
  let payload: any;
  let key = '';
  const purchasesWrite = {
    createPurchase: async (input: any, _auth: AuthContext, idempotencyKey: string) => {
      payload = input;
      key = idempotencyKey;
      return { purchaseId: 51 };
    },
  };
  const service = new PurchaseOrdersService(db, purchasesWrite as any, {} as any);
  const result = await service.convertToBill(7, auth);
  assert.equal(result.convertedPurchaseId, 51);
  assert.equal(payload.supplierId, 9);
  assert.equal(payload.items[0].qty, 2);
  assert.equal(payload.items[0].cost, 100);
  assert.equal(payload.taxRate, 5);
  assert.equal(payload.lifecycleStatus, 'purchase_order');
  assert.equal(key, 'purchase-order-conversion-7');
  assert.equal(bill.po_id, 7);
  assert.equal(billItems[0].po_item_id, 17);
  assert.equal(order.status, 'converted_to_bill');
  await assert.rejects(() => service.convertToBill(7, auth));
  console.log('purchase-order-conversion.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
