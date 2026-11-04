/*
New file: backend/test/critical/storefront-marketplace-collection.spec.ts
Pins the marketplace-prepaid collection rule (Phase 1, F3): an order the
marketplace already collected must convert to a COLLECTED invoice, never
cash-on-delivery. The marketplace sync writes online_orders rows with
payment_status 'paid', payment_method 'marketplace_prepaid', and the
marketplace as gateway_provider — but resolveOnlineOrderCollection only
recognized gateway/webhook providers, so every synced marketplace order
converted as COD and the courier collected a second time at the door.

WHAT THIS PINS:
- A paid order from any supported marketplace (amazon/noon/jumia/trendyol,
  by provider or by the marketplace_prepaid method) resolves as collected
  on the card channel, with the marketplace named as the provider for the
  invoice note. A marketplace order that is not yet paid stays COD.
- The boundary is unchanged: a sandbox ("mock") paid order still resolves
  as COD (SF-2), and gateway-paid orders still resolve as collected.
- End to end through the real convertToSale with the mock harness from
  storefront-payment-webhooks.spec.ts: the sale payload for a synced
  Amazon order carries collectionStatus 'prepaid_online' (the canonical value createSale accepts;
  'collected' was rejected with DELIVERY_COLLECTION_STATUS_INVALID), the full paidAmount,
  and a card payment — never 'cod' with an empty payments list.
*/

import { strict as assert } from 'node:assert';
import { resolveOnlineOrderCollection } from '../../src/modules/storefront/engines/online-order-access.engine';

function testResolver(): void {
  for (const provider of ['amazon', 'noon', 'jumia', 'trendyol']) {
    const resolved = resolveOnlineOrderCollection({ payment_status: 'paid', payment_method: 'marketplace_prepaid', gateway_provider: provider });
    assert.equal(resolved.collected, true, `${provider} prepaid orders must be collected`);
    assert.equal(resolved.paymentChannel, 'card');
    assert.equal(resolved.provider, provider);
  }
  // Provider name alone is enough; the method label alone is enough too.
  assert.equal(resolveOnlineOrderCollection({ payment_status: 'paid', gateway_provider: 'Amazon' }).collected, true);
  assert.equal(resolveOnlineOrderCollection({ payment_status: 'paid', gateway_provider: ' amazon ', payment_method: 'marketplace_prepaid' }).provider, 'amazon');
  assert.equal(resolveOnlineOrderCollection({ payment_status: 'paid', payment_method: 'marketplace_prepaid', gateway_provider: '' }).collected, true);
  assert.equal(resolveOnlineOrderCollection({ payment_status: 'paid', payment_method: 'marketplace_prepaid', gateway_provider: '' }).provider, 'marketplace');
  // Not yet paid: the courier still collects.
  assert.deepEqual(resolveOnlineOrderCollection({ payment_status: 'pending', payment_method: 'marketplace_prepaid', gateway_provider: 'amazon' }), { collected: false, paymentChannel: 'cash', provider: null });
  // Boundaries unchanged.
  assert.equal(resolveOnlineOrderCollection({ payment_status: 'paid', gateway_provider: 'paymob' }).collected, true);
  assert.equal(resolveOnlineOrderCollection({ payment_status: 'paid', gateway_provider: 'paymob' }).paymentChannel, 'card');
  assert.equal(resolveOnlineOrderCollection({ payment_status: 'paid', gateway_provider: 'manual' }).paymentChannel, 'instapay');
  assert.equal(resolveOnlineOrderCollection({ payment_status: 'paid', gateway_provider: 'mock' }).collected, false);
  assert.equal(resolveOnlineOrderCollection({ payment_status: 'pending', gateway_provider: 'stripe' }).collected, false);
  console.log('Marketplace collection resolution tests passed');
}

interface MockOrder {
  id: number;
  tenant_id: string;
  order_number: string;
  total_amount: number;
  payment_status: string;
  status: string;
  gateway_provider?: string;
  payment_method?: string;
}

function runConversion(orderRow: Record<string, any>): Promise<{ payload: any; result: any }> {
  let capturedSalePayload: any = null;
  const mockSalesService: any = {
    createSale: async (payload: any) => {
      capturedSalePayload = payload;
      return { id: 101, sale: { id: 101 } };
    },
    getSaleById: async (id: number) => ({ id }),
  };
  const row = {
    ...orderRow,
    items: [{ productId: 1, quantity: 2, unitPrice: 250, total: 500 }],
    totalAmount: 500,
    deliveryFee: 0,
  };
  const db: any = {
    selectFrom: (table: string) => ({
      select: () => ({
        where: () => ({
          where: () => ({
            executeTakeFirst: async () => {
              if (table === 'customers') return { id: 5, name: 'Customer Test', phone: '01000000000' };
              if (table === 'branches') return { id: 1, default_stock_location_id: 1 };
              if (table === 'delivery_representatives') return { id: 2, name: 'Store Rep' };
              return null;
            },
            orderBy: () => ({ executeTakeFirst: async () => ({ id: 2, name: 'Store Rep' }) }),
          }),
          executeTakeFirst: async () => ({ id: 1, default_stock_location_id: 1 }),
        }),
      }),
      selectAll: () => ({
        where: () => ({
          where: () => ({ executeTakeFirst: async () => row }),
        }),
      }),
    }),
    updateTable: () => ({
      set: () => {
        const builder: any = { where: () => builder, execute: async () => undefined };
        return builder;
      },
    }),
  };
  const storefrontService = new (require('../../src/modules/storefront/storefront.service').StorefrontService)(db, mockSalesService);
  const actor: any = { userId: 1, username: 'admin', role: 'admin', tenantId: 'tenant-1', accountId: 'tenant-1:main' };
  return storefrontService.convertToSale(10, actor).then((result: any) => ({ payload: capturedSalePayload, result }));
}

async function testConversion(): Promise<void> {
  // 1. A synced Amazon prepaid order: collected, fully paid, card channel — never COD.
  {
    const { payload, result } = await runConversion({
      id: 10, tenant_id: 'tenant-1', order_number: 'ON-260920-0010', total_amount: 500,
      payment_status: 'paid', status: 'confirmed', gateway_provider: 'amazon',
      payment_method: 'marketplace_prepaid', customer_name: 'Amazon Customer', customer_phone: '01012345678',
    });
    assert.equal(result.ok, true);
    assert.equal(payload.collectionStatus, 'prepaid_online', 'Marketplace-prepaid orders must not convert as COD');
    assert.equal(payload.paidAmount, 500);
    assert.equal(payload.tenderedAmount, 0, 'Cash tender is 0: a card-only payment has no cash line');
    assert.equal(payload.paymentChannel, 'card');
    assert.equal(payload.payments.length, 1);
    assert.equal(payload.payments[0].paymentChannel, 'card');
    assert.ok(String(payload.note).includes('amazon'), 'The marketplace is recorded on the invoice note');
  }

  // 2. A synced Noon prepaid order converts the same way.
  {
    const { payload } = await runConversion({
      id: 10, tenant_id: 'tenant-1', order_number: 'ON-260920-0011', total_amount: 500,
      payment_status: 'paid', status: 'confirmed', gateway_provider: 'noon',
      payment_method: 'marketplace_prepaid', customer_name: 'Noon Customer', customer_phone: '01012345678',
    });
    assert.equal(payload.collectionStatus, 'prepaid_online');
    assert.equal(payload.paidAmount, 500);
    assert.ok(String(payload.note).includes('noon'));
  }

  // 3. A marketplace order that is not yet paid stays cash-on-delivery.
  {
    const { payload } = await runConversion({
      id: 10, tenant_id: 'tenant-1', order_number: 'ON-260920-0012', total_amount: 500,
      payment_status: 'pending', status: 'pending', gateway_provider: 'amazon',
      payment_method: 'marketplace_prepaid', customer_name: 'Amazon Customer', customer_phone: '01012345678',
    });
    assert.equal(payload.collectionStatus, 'cod');
    assert.equal(payload.paidAmount, 0);
    assert.deepEqual(payload.payments, []);
  }

  console.log('  -> Storefront convertToSale: marketplace-prepaid orders convert collected, unpaid ones stay COD.');
}

async function main() {
  testResolver();
  await testConversion();
  console.log('Marketplace collection tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
