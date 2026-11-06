/*
 * Purchase-order draft save + approve-on-first-click
 * (INV-PURCHASE-ORDER-DRAFT-APPROVE).
 *
 * Grounding verdict (verified live before any code change): the
 * "draft" status came from the backend, not the payload. createOrder
 * hardcoded `status: 'draft'` and returned no status at all, while
 * the create page's "save as draft" button only showed a success
 * toast (no API call -- the draft lived in localStorage via
 * useFormDraft) and its "approve" button called the same create and
 * toasted "approved" without ever checking the returned status.
 * The details dialog stayed stale for the same family of reason: it
 * renders its badge and buttons from `selectedOrder`, the row
 * snapshot taken when it opened, while the confirm mutation only
 * invalidated the list and the details query -- never the snapshot.
 *
 * The fix, and what this spec proves against the real service:
 * - A plain create is still a server-side draft (status 'draft',
 *   approval gate never consulted) -- but now the response says so.
 * - A create with submitForApproval runs the SAME approval check as
 *   confirmOrder inside the same transaction: 'confirmed' when no
 *   rule applies, 'pending_approval' (with the pending notification)
 *   when one does. It can never land as a draft.
 * - The frontend pins: the draft button saves through the API (no
 *   bare success toast), the approve toast names the real returned
 *   status, and the list page moves the open dialog's snapshot to
 *   the status the server returned on confirm.
 *
 * Deliberately UNCHANGED (separate decisions, not this defect):
 * - confirmOrder itself: same gate, same messages, untouched.
 * - The "create from modal" path on the list page: it already saved
 *   a real server draft ("حفظ أمر الشراء كمسودة") and still does.
 * - cancel/convert/delete flows and their dialog staleness.
 */

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { PurchaseOrdersService } from '../../src/modules/purchases/services/purchase-orders.service';

type Captures = {
  orderInserts: Array<Record<string, unknown>>;
  orderUpdates: Array<Record<string, unknown>>;
  itemInserts: Array<Record<string, unknown>>;
  approvalChecks: Array<Record<string, unknown>>;
  approvalNotifications: Array<{ tenantId: string; recordRef: string; amount: number }>;
};

function makeDb(): { db: Record<string, any>; captures: Captures } {
  const captures: Captures = {
    orderInserts: [], orderUpdates: [], itemInserts: [], approvalChecks: [], approvalNotifications: [],
  };
  const rowFor = (table: string): Record<string, unknown> | undefined => {
    if (table === 'settings') return { value: 'EGP' };
    if (table === 'suppliers') return { id: 9 };
    if (table === 'stock_locations') return { id: 3 };
    return undefined;
  };
  const selectFrom = (table: string) => {
    const builder: Record<string, any> = {};
    for (const name of ['select', 'selectAll', 'where', 'orderBy', 'forUpdate', 'limit']) {
      builder[name] = () => builder;
    }
    builder.executeTakeFirst = async () => rowFor(table);
    builder.executeTakeFirstOrThrow = async () => {
      const row = rowFor(table);
      if (!row) throw new Error(`no row for ${table}`);
      return row;
    };
    builder.execute = async () => {
      if (table === 'currency_exchange_rates') return [{ currency_code: 'EGP', exchange_rate: 1 }];
      if (table === 'products') return [{ id: 5 }];
      const row = rowFor(table);
      return row ? [row] : [];
    };
    return builder;
  };
  const updateTable = (table: string) => {
    let values: Record<string, unknown> = {};
    const builder: Record<string, any> = {};
    builder.set = (next: Record<string, unknown>) => {
      values = next;
      return builder;
    };
    builder.where = () => builder;
    builder.execute = async () => {
      if (table === 'purchase_orders') captures.orderUpdates.push(values);
      return [{ numUpdatedRows: 1n }];
    };
    builder.executeTakeFirst = async () => {
      if (table === 'purchase_orders') captures.orderUpdates.push(values);
      return { numUpdatedRows: 1n };
    };
    return builder;
  };
  const insertInto = (table: string) => {
    let values: Record<string, unknown> = {};
    const builder: Record<string, any> = {};
    builder.values = (next: Record<string, unknown>) => {
      values = next;
      return builder;
    };
    builder.returning = () => builder;
    builder.returningAll = () => builder;
    builder.execute = async () => {
      if (table === 'purchase_orders') captures.orderInserts.push(values);
      if (table === 'purchase_order_items') captures.itemInserts.push(values);
      return [];
    };
    builder.executeTakeFirstOrThrow = async () => {
      if (table === 'purchase_orders') {
        captures.orderInserts.push(values);
        return { id: 11, order_number: 'PO-TMP-x' };
      }
      return values;
    };
    return builder;
  };
  const deleteFrom = (table: string) => {
    const builder: Record<string, any> = {};
    builder.where = () => builder;
    builder.execute = async () => [];
    return builder;
  };
  const db: Record<string, any> = {
    selectFrom,
    updateTable,
    insertInto,
    deleteFrom,
    transaction: () => ({
      execute: async (callback: (trx: Record<string, any>) => Promise<unknown>) => callback(db),
    }),
  };
  return { db, captures };
}

function buildService(requiresApproval: boolean): { service: PurchaseOrdersService; captures: Captures } {
  const { db, captures } = makeDb();
  const approvals = {
    checkAndInitiateApproval: async (params: Record<string, unknown>) => {
      captures.approvalChecks.push(params);
      return requiresApproval ? { requiresApproval: true, requestId: 'req-1' } : { requiresApproval: false };
    },
    notifyPendingApproval: (tenantId: string, recordRef: string, amount: number) => {
      captures.approvalNotifications.push({ tenantId, recordRef, amount });
    },
  };
  const service = new PurchaseOrdersService(db as any, {} as any, approvals as any);
  return { service, captures };
}

const auth: AuthContext = {
  tenantId: 't1', accountId: 't1', userId: 1,
  username: 'spec-admin', role: 'admin', permissions: [], sessionId: 'spec-session',
};

// The reported live case: manual-test supplier, one manual-test
// product x2 at 100.00, total 200.00.
function draftPayload(submitForApproval?: boolean): Record<string, unknown> {
  return {
    items: [{ productId: 5, productName: 'منتج اختبار يدوي', quantity: 2, unitCost: 100, taxRate: 0 }],
    discountAmount: 0, supplierId: 9, warehouseId: 3,
    supplierName: 'مورد اختبار يدوي', warehouseName: 'المستودع الرئيسي',
    expectedDeliveryDate: '2026-11-10',
    ...(submitForApproval === undefined ? {} : { submitForApproval }),
  };
}

async function main(): Promise<void> {
  // 1. Plain create is still a server-side draft, the approval gate is
  // never consulted, and the response now says 'draft' instead of
  // leaving the caller to assume approval.
  {
    const { service, captures } = buildService(false);
    const result = await service.createOrder(draftPayload() as any, auth);
    assert.equal(result.success, true);
    assert.equal(result.id, 11);
    assert.equal(result.status, 'draft');
    assert.equal(result.message, 'تم إنشاء أمر الشراء بنجاح');
    assert.equal(captures.orderInserts.length, 1);
    assert.equal(captures.orderInserts[0].status, 'draft');
    assert.equal(captures.itemInserts.length, 1);
    assert.equal(captures.approvalChecks.length, 0);
    assert.equal(captures.orderUpdates.length, 1);
    assert.ok(!('status' in captures.orderUpdates[0]), 'draft create must not rewrite status');
  }

  // 2. Create-with-approve, no approval rule: the order lands
  // 'confirmed' in the same call, the approval check ran with the
  // real order id and total, and no pending notification is sent.
  // This is the pin that fails if the fix is removed (the old code
  // always inserted 'draft' and returned no status).
  {
    const { service, captures } = buildService(false);
    const result = await service.createOrder(draftPayload(true) as any, auth);
    assert.equal(result.success, true);
    assert.equal(result.status, 'confirmed');
    assert.notEqual(result.status, 'draft');
    assert.equal(result.message, 'تم اعتماد أمر الشراء بنجاح');
    assert.equal(captures.approvalChecks.length, 1);
    assert.equal(captures.approvalChecks[0].module, 'purchase_orders');
    assert.equal(captures.approvalChecks[0].recordId, 11);
    assert.equal(captures.approvalChecks[0].amount, 200);
    const statusUpdates = captures.orderUpdates.filter((u) => 'status' in u);
    assert.equal(statusUpdates.length, 1);
    assert.equal(statusUpdates[0].status, 'confirmed');
    assert.equal(captures.approvalNotifications.length, 0);
  }

  // 3. Create-with-approve, approval rule applies: the order lands
  // 'pending_approval' (never 'draft', never 'confirmed'), the
  // pending message names the real outcome, and the manager is
  // notified exactly once with the real order number and total.
  {
    const { service, captures } = buildService(true);
    const result = await service.createOrder(draftPayload(true) as any, auth);
    assert.equal(result.success, true);
    assert.equal(result.status, 'pending_approval');
    assert.equal(result.message, 'أمر الشراء بانتظار موافقة مدير آخر');
    const statusUpdates = captures.orderUpdates.filter((u) => 'status' in u);
    assert.equal(statusUpdates.length, 1);
    assert.equal(statusUpdates[0].status, 'pending_approval');
    assert.equal(captures.approvalNotifications.length, 1);
    assert.equal(captures.approvalNotifications[0].tenantId, 't1');
    assert.equal(captures.approvalNotifications[0].amount, 200);
    assert.ok(String(captures.approvalNotifications[0].recordRef).startsWith('PO-'));
  }

  // 4. Source pins: the service branches on the intent flag (never on
  // a client-supplied status), returns the real status, and the
  // confirmOrder gate is still the same check -- the approve path
  // did not bypass it by inserting 'confirmed' directly.
  {
    const service = readFileSync(
      resolve(__dirname, '../../src/modules/purchases/services/purchase-orders.service.ts'), 'utf8');
    assert.ok(service.includes('if (payload.submitForApproval)'));
    assert.ok(service.includes('status: finalStatus'));
    assert.ok(service.includes('checkAndInitiateApproval'));
    assert.ok(service.includes('async confirmOrder('));
    assert.ok(!service.includes("status: 'confirmed',\n        expected_delivery_date"));
    const dto = readFileSync(
      resolve(__dirname, '../../src/modules/purchases/dto/purchase-order.dto.ts'), 'utf8');
    assert.ok(dto.includes('submitForApproval?: boolean'));
    const createStart = dto.indexOf('export interface CreatePurchaseOrderDto');
    const updateStart = dto.indexOf('export interface UpdatePurchaseOrderDto');
    assert.ok(createStart > 0 && updateStart > createStart);
    assert.ok(!dto.slice(createStart, updateStart).includes('status?:'),
      'status itself must never be client-supplied on create');
  }

  // 5. Frontend pins: the draft button saves through the API (the old
  // bare success toast with no call is gone), the approve toast names
  // the real returned status, and the create payload carries the
  // intent flag.
  {
    const page = readFileSync(
      resolve(__dirname, '../../../frontend/src/features/purchases/pages/CreatePurchaseOrderPage.tsx'), 'utf8');
    assert.ok(!page.includes("toast.success(t('purchases.create_purchase_order_page.s4'"));
    assert.ok(page.includes('handleSaveDraft'));
    assert.ok(page.includes('saveDraftPurchaseOrder(payload)'));
    const hook = readFileSync(
      resolve(__dirname, '../../../frontend/src/features/purchases/hooks/useCreatePurchaseOrderForm.ts'), 'utf8');
    assert.ok(hook.includes('submitForApproval: true'));
    assert.ok(hook.includes("if (res.status === 'draft')"));
    assert.ok(hook.includes("toast.error('تعذر اعتماد أمر الشراء: ما زال في حالة مسودة')"));
    assert.ok(hook.includes('saveDraftPurchaseOrder'));
    const api = readFileSync(
      resolve(__dirname, '../../../frontend/src/features/purchases/api/purchase-orders.api.ts'), 'utf8');
    assert.ok(api.includes('submitForApproval?: boolean'));
    assert.ok(api.includes("status?: PurchaseOrderRecord['status']"));
  }

  // 6. Dialog pin: the list page moves the open dialog's snapshot to
  // the status the server returned on confirm -- the refetch alone
  // never did that, which is why the badge and the approve button
  // stayed stale until reopen.
  {
    const listPage = readFileSync(
      resolve(__dirname, '../../../frontend/src/features/purchases/pages/PurchaseOrdersPage.tsx'), 'utf8');
    const confirmStart = listPage.indexOf('const confirmMutation');
    const convertStart = listPage.indexOf('const convertMutation');
    assert.ok(confirmStart > 0 && convertStart > confirmStart);
    const confirmBlock = listPage.slice(confirmStart, convertStart);
    assert.ok(confirmBlock.includes('setSelectedOrder'));
    assert.ok(confirmBlock.includes('res.status'));
  }

  console.log('purchase-order-draft-approve: all cases passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
