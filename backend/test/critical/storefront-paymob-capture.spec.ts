/*
New file: backend/test/critical/storefront-paymob-capture.spec.ts
Pins the Paymob capture-only rule (Phase 1, F2): a Paymob callback with
success=true and pending=false is NOT proof of capture. Paymob notifies
authorization-only holds, voids, and refunds with the same
success/pending shape, and the old handler marked the order paid on
all of them. This spec pins the classification table on the pure
engine and the end-to-end wiring on the real webhook handler with a
mock DB and valid HMACs, mirroring storefront-payment-webhooks.spec.ts.

WHAT THIS PINS:
- An authorization-only callback (is_auth, no capture flag) is
  acknowledged with no state change: the order stays pending until
  the capture callback arrives. It must be neither paid nor failed.
- A voided or refunded callback for an unpaid order takes the failure
  path (payment_failed, reservation released) instead of paid.
- A flag-less successful callback is routed to human review, never
  marked paid outright.
- The proven shapes still pay: a standalone sale (is_standalone_payment,
  is_capture=false — the existing fixture shape) and a capture
  (is_capture) both confirm the order.
*/

import { strict as assert } from 'node:assert';
import * as crypto from 'crypto';
import { StorefrontPaymentService } from '../../src/modules/storefront/storefront-payment.service';
import { classifyPaymobTransaction } from '../../src/modules/storefront/engines/paymob-notification.engine';

function testClassification(): void {
  assert.equal(
    classifyPaymobTransaction({
      is_capture: true,
      is_auth: false,
      is_standalone_payment: false,
      is_voided: false,
      is_refunded: false,
    }),
    'capture',
  );
  assert.equal(
    classifyPaymobTransaction({
      is_capture: false,
      is_auth: false,
      is_standalone_payment: true,
      is_voided: false,
      is_refunded: false,
    }),
    'capture',
  );
  assert.equal(
    classifyPaymobTransaction({
      is_capture: false,
      is_auth: true,
      is_standalone_payment: false,
      is_voided: false,
      is_refunded: false,
    }),
    'authorization_only',
  );
  assert.equal(
    classifyPaymobTransaction({
      is_capture: false,
      is_auth: false,
      is_standalone_payment: false,
      is_voided: true,
      is_refunded: false,
    }),
    'void_or_refund',
  );
  assert.equal(
    classifyPaymobTransaction({
      is_capture: false,
      is_auth: false,
      is_standalone_payment: false,
      is_voided: false,
      is_refunded: true,
    }),
    'void_or_refund',
  );
  assert.equal(
    classifyPaymobTransaction({
      is_capture: true,
      is_auth: false,
      is_standalone_payment: false,
      is_voided: true,
      is_refunded: false,
    }),
    'void_or_refund',
  );
  assert.equal(
    classifyPaymobTransaction({
      is_capture: false,
      is_auth: false,
      is_standalone_payment: false,
      is_voided: false,
      is_refunded: false,
    }),
    'unclassified',
  );
  assert.equal(classifyPaymobTransaction({}), 'unclassified');
  console.log('Paymob transaction classification tests passed');
}

interface MockOrder {
  id: number;
  tenant_id: string;
  order_number: string;
  total_amount: number;
  payment_status: string;
  status: string;
  gateway_provider?: string;
  gateway_transaction_id?: string;
  gateway_order_id?: string;
  stock_reserved?: boolean;
}

function createMockDb(orders: MockOrder[], settingsMap: Record<string, string>) {
  const db: any = {
    transaction: () => ({
      execute: async (cb: any) => cb(db),
    }),
    selectFrom: (table: string) => {
      if (table === 'settings') {
        return {
          select: () => ({
            where: () => ({
              where: (col: any, op: any, val: any) => ({
                execute: async () => Object.entries(settingsMap).map(([key, value]) => ({ key, value })),
                executeTakeFirst: async () => {
                  const key = typeof val === 'string' ? val : 'currency';
                  if (key in settingsMap) return { value: settingsMap[key] };
                  return undefined;
                },
              }),
            }),
          }),
        };
      }
      if (table === 'online_orders') {
        const createQueryBuilder = () => {
          let selectedId: any = null;
          let filterCol: any = null;
          let filterVal: any = null;
          const builder: any = {
            where: (col: any, op: any, val: any) => {
              if (col === 'id') selectedId = val;
              else {
                filterCol = col;
                filterVal = val;
              }
              return builder;
            },
            forUpdate: () => builder,
            limit: (n: number) => ({ execute: async () => orders.slice(0, n) }),
            executeTakeFirst: async () => {
              if (selectedId != null) return orders.find((o) => o.id === selectedId) || orders[0];
              if (filterCol === 'order_number') return orders.find((o) => o.order_number === filterVal) || orders[0];
              if (filterCol === 'gateway_order_id')
                return orders.find((o) => o.gateway_order_id === filterVal) || orders[0];
              return orders[0];
            },
            execute: async () => {
              if (filterCol === 'order_number') return orders.filter((o) => o.order_number === filterVal);
              if (filterCol === 'gateway_order_id') return orders.filter((o) => o.gateway_order_id === filterVal);
              return orders;
            },
          };
          return builder;
        };
        return { selectAll: () => createQueryBuilder() };
      }
      if (table === 'storefront_coupons') {
        return { select: () => ({ where: () => ({ execute: async () => [] }) }) };
      }
      return {};
    },
    updateTable: (table: string) => ({
      set: (updates: any) => ({
        where: (col: any, op: any, val: any) => ({
          where: (col2?: any, op2?: any, val2?: any) => ({
            execute: async () => {
              const targetId = col === 'id' ? val : col2 === 'id' ? val2 : null;
              const order = targetId ? orders.find((o) => o.id === targetId) : orders[0];
              if (order) Object.assign(order, updates);
            },
          }),
          execute: async () => {
            const order = orders.find((o) => o.id === val);
            if (order) Object.assign(order, updates);
          },
        }),
      }),
    }),
  };
  return db;
}

const SECRET = 'my-paymob-secret';

function signedObj(overrides: Record<string, any>): any {
  const obj: any = {
    amount_cents: 15000,
    created_at: '2026-09-20T10:00:00.000Z',
    currency: 'EGP',
    error_occured: false,
    has_parent_transaction: false,
    id: 12345,
    integration_id: 111,
    is_3d_secure: true,
    is_auth: false,
    is_capture: false,
    is_refunded: false,
    is_standalone_payment: true,
    is_voided: false,
    order: { id: 999, merchant_order_id: 'tenant-1__ON-260920-0001' },
    owner: 10,
    pending: false,
    source_data: { pan: '2345', sub_type: 'MasterCard', type: 'card' },
    success: true,
    ...overrides,
  };
  const concatenated = [
    obj.amount_cents,
    obj.created_at,
    obj.currency,
    obj.error_occured,
    obj.has_parent_transaction,
    obj.id,
    obj.integration_id,
    obj.is_3d_secure,
    obj.is_auth,
    obj.is_capture,
    obj.is_refunded,
    obj.is_standalone_payment,
    obj.is_voided,
    obj.order?.id,
    obj.owner,
    obj.pending,
    obj.source_data?.pan,
    obj.source_data?.sub_type,
    obj.source_data?.type,
    obj.success,
  ].join('');
  const hmac = crypto.createHmac('sha512', SECRET).update(concatenated).digest('hex');
  return { obj, hmac };
}

function pendingOrder(): MockOrder {
  return {
    id: 1,
    tenant_id: 'tenant-1',
    order_number: 'ON-260920-0001',
    total_amount: 150,
    payment_status: 'pending',
    status: 'pending',
    gateway_provider: 'paymob',
    gateway_order_id: '999',
    stock_reserved: false,
  };
}

async function testWebhookWiring(): Promise<void> {
  // 1. Authorization-only: acknowledged, order untouched (neither paid nor failed).
  {
    const order = pendingOrder();
    const service = new StorefrontPaymentService(createMockDb([order], { storefront_paymob_hmac_secret: SECRET }));
    const { obj, hmac } = signedObj({ is_auth: true, is_standalone_payment: false });
    const result = await service.processPaymobWebhook({ hmac }, { obj });
    assert.equal(result.ok, true);
    assert.equal((result as any).received, true);
    assert.equal(order.payment_status, 'pending');
    assert.equal(order.status, 'pending');
  }

  // 2. Voided callback for an unpaid order: failure path, not paid.
  {
    const order = pendingOrder();
    const service = new StorefrontPaymentService(createMockDb([order], { storefront_paymob_hmac_secret: SECRET }));
    const { obj, hmac } = signedObj({ is_voided: true, is_standalone_payment: false });
    const result = await service.processPaymobWebhook({ hmac }, { obj });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'failed');
    assert.equal(order.payment_status, 'failed');
    assert.equal(order.status, 'payment_failed');
  }

  // 3. Refunded callback for an unpaid order: failure path, not paid.
  {
    const order = pendingOrder();
    const service = new StorefrontPaymentService(createMockDb([order], { storefront_paymob_hmac_secret: SECRET }));
    const { obj, hmac } = signedObj({ is_refunded: true, is_standalone_payment: false });
    const result = await service.processPaymobWebhook({ hmac }, { obj });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'failed');
    assert.equal(order.payment_status, 'failed');
  }

  // 4. Standalone sale (the proven production shape): still confirms the order.
  {
    const order = pendingOrder();
    const service = new StorefrontPaymentService(createMockDb([order], { storefront_paymob_hmac_secret: SECRET }));
    const { obj, hmac } = signedObj({});
    const result = await service.processPaymobWebhook({ hmac }, { obj });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'paid');
    assert.equal(order.payment_status, 'paid');
  }

  // 5. Capture of a prior authorization: confirms the order.
  {
    const order = pendingOrder();
    const service = new StorefrontPaymentService(createMockDb([order], { storefront_paymob_hmac_secret: SECRET }));
    const { obj, hmac } = signedObj({ is_capture: true, is_standalone_payment: false });
    const result = await service.processPaymobWebhook({ hmac }, { obj });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'paid');
    assert.equal(order.payment_status, 'paid');
  }

  // 6. Flag-less successful callback: human review, never paid outright.
  {
    const order = pendingOrder();
    const service = new StorefrontPaymentService(createMockDb([order], { storefront_paymob_hmac_secret: SECRET }));
    const { obj, hmac } = signedObj({
      is_auth: false,
      is_capture: false,
      is_standalone_payment: false,
      is_voided: false,
      is_refunded: false,
    });
    const result = await service.processPaymobWebhook({ hmac }, { obj });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'review_required');
    assert.equal(order.status, 'review_required');
    // The established paid-but-review state: held for a human, never confirmed.
    assert.notEqual(order.status, 'confirmed');
  }

  // 7. Authorization-only callback arriving after the order is paid: acknowledged, no review noise.
  {
    const order: MockOrder = {
      ...pendingOrder(),
      payment_status: 'paid',
      status: 'confirmed',
      gateway_transaction_id: '12345',
    };
    const service = new StorefrontPaymentService(createMockDb([order], { storefront_paymob_hmac_secret: SECRET }));
    const { obj, hmac } = signedObj({ is_auth: true, is_standalone_payment: false, id: 77777 });
    const result = await service.processPaymobWebhook({ hmac }, { obj });
    assert.equal(result.ok, true);
    assert.equal((result as any).received, true);
    assert.equal(order.payment_status, 'paid');
    assert.equal(order.status, 'confirmed');
  }

  console.log(
    '  -> Paymob: auth-only acknowledged without state change, void/refund fail, captures pay, flag-less reviewed.',
  );
}

async function main() {
  testClassification();
  await testWebhookWiring();
  console.log('Paymob capture-only tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
