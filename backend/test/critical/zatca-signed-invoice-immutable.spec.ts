/*
New file: backend/test/critical/zatca-signed-invoice-immutable.spec.ts
Pins the ZATCA signed-invoice guard (Phase 1, tax F3): once an invoice
is signed ('generated' — the ICV chain has advanced and the signed
UBL XML, hash, and QR are stored on the sale) or accepted by ZATCA
('cleared'/'reported'/'warning'), neither updateSale nor cancelSale
may touch it. The old code had zero ZATCA references in the sales
writer, so a signed invoice could be edited or cancelled in place and
the signed attestation would keep describing superseded amounts while
the replacement consumed a second ICV.

WHAT THIS PINS:
- The status table on the pure guard: signed/accepted states throw;
  never-signed, failed, and rejected states stay editable (a rejected
  invoice can only be fixed by correcting and re-signing it).
- The wiring on the real updateSale/cancelSale with a mock DB: the
  guard fires immediately after the locked sale row is read, before
  any other query runs — the mock answers only the sale load (plus the
  currency lookup updateSale needs first) and throws on every other
  table, so reaching any later step fails the test.
- The guard fires for every signed state, and an unsigned posted sale
  passes the guard (it then fails on the mock's next query, which is
  the expected proof that the guard did not block it).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { SalesWriteService } from '../../src/modules/sales/services/sales-write.service';
import {
  assertSaleNotZatcaSigned,
  isZatcaSignedStatus,
} from '../../src/modules/tax-integration/services/zatca/zatca-invoice-status';

function testStatusTable(): void {
  for (const status of ['generated', 'cleared', 'reported', 'warning', 'GENERATED', ' Cleared ']) {
    assert.equal(isZatcaSignedStatus(status), true, `${status} must be immutable`);
    assert.throws(() => assertSaleNotZatcaSigned(status), /SALE_ZATCA_SIGNED_IMMUTABLE/);
  }
  for (const status of ['not_submitted', 'failed', 'rejected', null, undefined, '', 'draft']) {
    assert.equal(isZatcaSignedStatus(status), false, `${String(status)} must stay editable`);
    assertSaleNotZatcaSigned(status);
  }
  console.log('ZATCA signed-status table tests passed');
}

function chainable(result: any) {
  const builder: any = {
    selectAll: () => builder,
    select: () => builder,
    where: () => builder,
    forUpdate: () => builder,
    executeTakeFirst: async () => result,
    execute: async () => result,
  };
  return builder;
}

/** Answers only the queries the guard path needs; anything else proves overreach. */
function guardMockDb(saleRow: Record<string, any>): any {
  return {
    transaction: () => ({ execute: async (cb: any) => cb(guardMockDb(saleRow)) }),
    selectFrom: (table: string) => {
      if (table === 'sales') return chainable(saleRow);
      if (table === 'settings') return chainable({ value: 'EGP' });
      if (table === 'currency_exchange_rates') return chainable([{ currency_code: 'EGP', exchange_rate: 1 }]);
      throw new Error(`unexpected query on table ${table}: the ZATCA guard must fire before any other read`);
    },
  };
}

function buildService(saleRow: Record<string, any>): any {
  const db = guardMockDb(saleRow);
  const tx = { runInTransaction: async (_db: any, cb: any) => cb(db) };
  const authz = { authorizeDiscountOverride: async () => undefined };
  return new (SalesWriteService as any)(
    db,
    tx,
    undefined,
    authz,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  );
}

const adminAuth: any = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] };

function signedSale(status: string): Record<string, any> {
  return {
    id: 7,
    tenant_id: 't1',
    status: 'posted',
    exchange_return_id: null,
    zatca_status: status,
    created_by: 1,
    created_at: new Date(),
    branch_id: null,
  };
}

async function testServiceWiring(): Promise<void> {
  const editPayload: any = {
    items: [{ productId: 1, qty: 1, unitPrice: 100 }],
    editReason: 'تصحيح سعر',
    paymentType: 'cash',
  };

  // 1. updateSale refuses a generated (signed, unsubmitted) invoice.
  await assert.rejects(
    async () => buildService(signedSale('generated')).updateSale(7, editPayload, adminAuth),
    /SALE_ZATCA_SIGNED_IMMUTABLE/,
  );

  // 2. updateSale refuses a cleared (accepted) invoice.
  await assert.rejects(
    async () => buildService(signedSale('cleared')).updateSale(7, editPayload, adminAuth),
    /SALE_ZATCA_SIGNED_IMMUTABLE/,
  );

  // 3. cancelSale refuses a reported invoice.
  await assert.rejects(
    async () => buildService(signedSale('reported')).cancelSale(7, 'إلغاء', '1234', adminAuth),
    /SALE_ZATCA_SIGNED_IMMUTABLE/,
  );

  // 4. cancelSale refuses a warning invoice.
  await assert.rejects(
    async () => buildService(signedSale('warning')).cancelSale(7, 'إلغاء', '1234', adminAuth),
    /SALE_ZATCA_SIGNED_IMMUTABLE/,
  );

  // 5. An unsigned posted sale passes the guard: it proceeds to the
  // next read (shift lookup), which the mock refuses — proving the
  // guard did not block an editable invoice.
  await assert.rejects(
    async () => buildService(signedSale('not_submitted')).updateSale(7, editPayload, adminAuth),
    /unexpected query on table cashier_shifts/,
  );
  await assert.rejects(
    async () => buildService(signedSale('rejected')).cancelSale(7, 'إلغاء', '1234', adminAuth),
    /unexpected query on table return_documents/,
  );

  console.log(
    '  -> ZATCA: signed/accepted invoices immutable in updateSale and cancelSale; unsigned ones pass the guard.',
  );
}

async function main() {
  testStatusTable();
  await testServiceWiring();
  console.log('ZATCA signed invoice immutability tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
