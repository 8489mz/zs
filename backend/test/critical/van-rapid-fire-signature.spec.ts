/*
New file: backend/test/critical/van-rapid-fire-signature.spec.ts
Pins the rapid-fire duplicate check in executeFieldSale (Phase 1, van
F4, sales site): the database backstop that guards against a
double-tapped field sale matched a recent sale on trip + rep +
customer + 4 seconds + the NUMBER OF LINES only. A second, genuinely
different sale to the same customer within 4 seconds — different
products, same line count — was silently dropped: the caller got
ok:true with the FIRST sale's id and cashPaid: 0, while no second
sale, stock movement, or journal ever existed.

The precise layers already key on the full item signature
(sorted productId:qty:unitPrice). This spec pins the database
backstop to the same rule at the product+quantity level: only a
recent sale with the identical product/quantity multiset is a
duplicate. Quantities are compared, not prices, because the server
may adjust stored unit prices (tiers/offers) — comparing stored
prices against raw payload prices would miss true double-taps whose
prices were adjusted on the first write.

WHAT THIS PINS, driving the real executeFieldSale with a mock DB:
- Same line count, different products -> the sale proceeds (the
  internal executor runs; fail-first this was swallowed).
- Same products, different quantities -> the sale proceeds.
- Identical products + quantities -> deduplicated to the recent
  sale, executor never runs (the backstop still works).
- No recent sale -> the sale proceeds.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';

function chainable(terminal: Record<string, any>) {
  const builder: any = {};
  for (const key of ['selectAll', 'select', 'where', 'forUpdate', 'innerJoin', 'orderBy', 'limit']) {
    builder[key] = () => builder;
  }
  Object.assign(builder, terminal);
  return builder;
}

function buildService(opts: { recentSale: any; recentItems: any[]; internalCalls: any[] }) {
  const db: any = {
    selectFrom: (table: string) => {
      if (table === 'sales') {
        // Distinguish the two sales reads: the clientTxId check uses a
        // LIKE on the note (no match in these fixtures), the rapid-fire
        // check uses created_at >= (returns the recent sale).
        const wheres: any[][] = [];
        const builder = chainable({
          executeTakeFirst: async () => (wheres.some((w) => w[1] === 'like') ? null : opts.recentSale),
        });
        const originalWhere = builder.where;
        builder.where = (...args: any[]) => {
          wheres.push(args);
          return originalWhere(...args);
        };
        return builder;
      }
      if (table === 'sale_items') {
        return chainable({
          executeTakeFirst: async () => ({ cnt: opts.recentItems.length }),
          execute: async () => opts.recentItems,
        });
      }
      throw new Error(`unexpected query on table ${table}`);
    },
  };
  const service = Object.create(VanSalesService.prototype);
  service.db = db;
  service.executeFieldSaleInternal = async (...args: any[]) => {
    opts.internalCalls.push(args);
    return {
      ok: true,
      saleId: 999,
      docNo: 'NEW-1',
      total: 100,
      paymentMethod: 'cash',
      customerName: 'Customer',
      itemsCount: 2,
    };
  };
  return service;
}

function clearCaches() {
  (VanSalesService as any).recentSalesCache?.clear?.();
  (VanSalesService as any).inFlightSalePromises?.clear?.();
}

function payloadFor(items: { productId: number; qty: number; unitPrice?: number }[], suffix: string): any {
  return {
    tripId: 11,
    customerId: 21,
    customerName: 'Customer',
    paymentMethod: 'cash',
    items,
    clientTxId: `tx-${suffix}`,
  };
}

const recentSaleRow = { id: 77, doc_no: 'OLD-1', total: 50, payment_type: 'cash' };

async function main() {
  // 1. Same line count, different products: must proceed.
  {
    clearCaches();
    const internalCalls: any[] = [];
    const service = buildService({
      recentSale: recentSaleRow,
      recentItems: [
        { product_id: 1, qty: 2 },
        { product_id: 2, qty: 1 },
      ],
      internalCalls,
    });
    const result = await service.executeFieldSale(
      4,
      't1',
      'a1',
      payloadFor(
        [
          { productId: 9, qty: 2, unitPrice: 10 },
          { productId: 8, qty: 1, unitPrice: 10 },
        ],
        'case1',
      ),
    );
    assert.equal(result.saleId, 999, 'a different sale must be created, not merged into the recent one');
    assert.equal(internalCalls.length, 1);
  }

  // 2. Same products, different quantities: must proceed.
  {
    clearCaches();
    const internalCalls: any[] = [];
    const service = buildService({
      recentSale: recentSaleRow,
      recentItems: [
        { product_id: 1, qty: 2 },
        { product_id: 2, qty: 1 },
      ],
      internalCalls,
    });
    const result = await service.executeFieldSale(
      4,
      't1',
      'a1',
      payloadFor(
        [
          { productId: 1, qty: 5, unitPrice: 10 },
          { productId: 2, qty: 1, unitPrice: 10 },
        ],
        'case2',
      ),
    );
    assert.equal(result.saleId, 999);
    assert.equal(internalCalls.length, 1);
  }

  // 3. Identical products + quantities: deduplicated (backstop works).
  {
    clearCaches();
    const internalCalls: any[] = [];
    const service = buildService({
      recentSale: recentSaleRow,
      recentItems: [
        { product_id: 2, qty: 1 },
        { product_id: 1, qty: 2 },
      ],
      internalCalls,
    });
    const result = await service.executeFieldSale(
      4,
      't1',
      'a1',
      payloadFor(
        [
          { productId: 1, qty: 2, unitPrice: 10 },
          { productId: 2, qty: 1, unitPrice: 10 },
        ],
        'case3',
      ),
    );
    assert.equal(result.saleId, 77, 'a true duplicate returns the existing sale');
    assert.equal(internalCalls.length, 0);
  }

  // 4. No recent sale: proceeds.
  {
    clearCaches();
    const internalCalls: any[] = [];
    const service = buildService({ recentSale: null, recentItems: [], internalCalls });
    const result = await service.executeFieldSale(
      4,
      't1',
      'a1',
      payloadFor(
        [
          { productId: 1, qty: 2, unitPrice: 10 },
          { productId: 2, qty: 1, unitPrice: 10 },
        ],
        'case4',
      ),
    );
    assert.equal(result.saleId, 999);
    assert.equal(internalCalls.length, 1);
  }

  console.log('Van rapid-fire signature tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
