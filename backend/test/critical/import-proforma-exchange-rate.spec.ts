/*
New file: backend/test/critical/import-proforma-exchange-rate.spec.ts
Pins the proforma-to-PO exchange-rate gate (Phase 1, FX F1): when a
proforma invoice carries no usable contract exchange rate, converting
it to a purchase order must fail closed instead of silently costing
every line at an invented 50. The old code fell back to 50 and
recorded the invented rate only in the draft PO's free-text notes, so
a merchant who approved the draft without noticing the note posted
purchase costs, stock values, and COGS at a rate nobody chose.

WHAT THIS PINS, driving the real generatePoFromProforma with a mock DB:
- A USD proforma with a null, zero, or negative contract rate is
  rejected with IMPORT_EXCHANGE_RATE_REQUIRED and creates NO purchase
  order, NO order lines, and NO proforma update.
- A USD proforma with an explicit contract rate converts at exactly
  that rate (foreign unit cost x rate, 3dp), and the PO note names it.
- An EGP proforma converts at rate 1 without needing a contract rate.
- An already-issued proforma returns as-is without re-checking the
  rate (the early return precedes the gate).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';

function chainable(terminal: Record<string, any>) {
  const builder: any = {};
  for (const key of ['selectAll', 'select', 'where', 'forUpdate', 'set', 'values', 'returning', 'returningAll']) {
    builder[key] = () => builder;
  }
  Object.assign(builder, terminal);
  return builder;
}

function buildService(piRow: Record<string, any>, captured: { orders: any[]; items: any[]; piUpdates: number }) {
  const trx: any = {
    selectFrom: (table: string) => {
      if (table === 'import_proforma_invoices') {
        return chainable({ executeTakeFirstOrThrow: async () => piRow, execute: async () => [] });
      }
      if (table === 'suppliers') {
        return chainable({ executeTakeFirstOrThrow: async () => ({ id: 3, name: 'Supplier', account_id: 't1' }) });
      }
      if (table === 'products') {
        return chainable({ executeTakeFirst: async () => ({ id: 5, name: 'Widget' }) });
      }
      throw new Error(`unexpected read on table ${table}`);
    },
    insertInto: (table: string) => {
      if (table === 'purchase_orders') {
        return chainable({
          executeTakeFirstOrThrow: async () => {
            captured.orders.push((trx as any).__lastValues);
            return { id: 900 };
          },
        });
      }
      if (table === 'purchase_order_items') {
        return chainable({
          execute: async () => {
            captured.items.push((trx as any).__lastValues);
            return [];
          },
        });
      }
      throw new Error(`unexpected insert into ${table}`);
    },
    updateTable: (table: string) => {
      if (table === 'purchase_orders' || table === 'import_proforma_invoices') {
        return chainable({
          execute: async () => {
            if (table === 'import_proforma_invoices') captured.piUpdates += 1;
            return [];
          },
          executeTakeFirstOrThrow: async () => {
            if (table === 'import_proforma_invoices') captured.piUpdates += 1;
            return { ...piRow, po_status: 'issued', po_number: 'PO-1' };
          },
        });
      }
      throw new Error(`unexpected update on table ${table}`);
    },
  };
  // Capture .values() payloads for the insert assertions.
  const originalInsertInto = trx.insertInto;
  trx.insertInto = (table: string) => {
    const builder = originalInsertInto(table);
    const originalValues = builder.values;
    builder.values = (values: any) => {
      (trx as any).__lastValues = values;
      return originalValues(values);
    };
    return builder;
  };
  const db: any = { transaction: () => ({ execute: async (cb: any) => cb(trx) }) };
  return new (ImportSalesService as any)(db);
}

function piFixture(overrides: Record<string, any>): Record<string, any> {
  return {
    id: 'pi-1',
    tenant_id: 't1',
    pi_number: 'PI-IMP-1',
    currency: 'USD',
    status: 'approved',
    po_status: 'draft',
    po_number: null,
    supplier_id: 3,
    total_amount_foreign: 200,
    exchange_rate_contract: null,
    project_id: null,
    items: JSON.stringify([{ productId: 5, quantity: 2, unitPriceForeign: 100 }]),
    ...overrides,
  };
}

async function main() {
  // 1-3. Null, zero, and negative contract rates: rejected, nothing written.
  for (const badRate of [null, 0, -5]) {
    const captured: { orders: any[]; items: any[]; piUpdates: number } = { orders: [], items: [], piUpdates: 0 };
    const service = buildService(piFixture({ exchange_rate_contract: badRate }), captured as any);
    await assert.rejects(
      async () => service.generatePoFromProforma('t1', 1, 'pi-1'),
      /IMPORT_EXCHANGE_RATE_REQUIRED/,
      `A contract rate of ${String(badRate)} must fail closed`,
    );
    assert.equal(captured.orders.length, 0, 'No purchase order may be created at an invented rate');
    assert.equal(captured.items.length, 0);
    assert.equal(captured.piUpdates, 0);
  }

  // 4. An explicit contract rate converts at exactly that rate.
  {
    const captured: { orders: any[]; items: any[]; piUpdates: number } = { orders: [], items: [], piUpdates: 0 };
    const service = buildService(piFixture({ exchange_rate_contract: 48.5 }), captured as any);
    const result = await service.generatePoFromProforma('t1', 1, 'pi-1');
    assert.equal(result.po_status, 'issued');
    assert.equal(captured.orders.length, 1);
    assert.equal(captured.items.length, 1);
    assert.equal(captured.items[0].unit_cost, 4850);
    assert.equal(captured.items[0].total, 9700);
    assert.ok(String(captured.orders[0].notes).includes('48.5'));
  }

  // 5. An EGP proforma converts at rate 1 with no contract rate.
  {
    const captured: { orders: any[]; items: any[]; piUpdates: number } = { orders: [], items: [], piUpdates: 0 };
    const service = buildService(piFixture({ currency: 'EGP', exchange_rate_contract: null }), captured as any);
    await service.generatePoFromProforma('t1', 1, 'pi-1');
    assert.equal(captured.items[0].unit_cost, 100);
  }

  // 6. An already-issued proforma returns as-is, rate unchecked.
  {
    const captured: { orders: any[]; items: any[]; piUpdates: number } = { orders: [], items: [], piUpdates: 0 };
    const row = piFixture({ po_status: 'issued', po_number: 'PO-OLD', exchange_rate_contract: null });
    const service = buildService(row, captured as any);
    const result = await service.generatePoFromProforma('t1', 1, 'pi-1');
    assert.equal(result.po_number, 'PO-OLD');
    assert.equal(captured.orders.length, 0);
  }

  console.log('Import proforma exchange rate tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
