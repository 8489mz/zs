import 'dotenv/config';
import assert from 'node:assert/strict';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { resolveDatabaseConfigFromEnv } from '../../src/database/migration-runner';
import { resolvePgSslConfig } from '../../src/database/ssl.util';
import type { Database } from '../../src/database/database.types';
import type { AuditService } from '../../src/core/audit/audit.service';
import type { DeliveryRepsService } from '../../src/modules/delivery-reps/delivery-reps.service';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';

// Regression coverage for the field-return approval workflow. Before this fix:
//   - POST /returns (recordFieldReturn) posted a return straight away with no review at all,
//     reachable from the driver portal at the same time as the new POST /field-returns
//     (submitFieldReturn) that is supposed to require approval — the gate could be bypassed
//     entirely just by calling the older route. recordFieldReturn has been removed.
//   - submitFieldReturn validated the return price against the original invoice's net unit price,
//     but never validated quantity: a driver could return more units of a line than were sold, or
//     the same units twice across two separate return requests.
//   - approveFieldReturn updated stock and the customer sub-ledger but never posted anything to the
//     general ledger — a return was invisible to every financial report, same class of gap as the
//     original van-sale/collection/settlement postings before those were fixed.
// This drives the real VanSalesService (submitFieldReturn -> approveFieldReturn) against a live
// database and cleans up in a `finally` block scoped to one disposable tenant id.

const TENANT = '__van_returns_verify_tmp__';
const ACCOUNT = 'e2e-van-returns';

async function cleanup(db: Kysely<Database>): Promise<void> {
  const dbAny = db as any;
  await sql`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE tenant_id = ${TENANT})`.execute(
    db,
  );
  const tables = [
    'journal_entries',
    'accounting_posting_failures',
    'settlement_allocations',
    'van_rep_financial_settlements',
    'van_field_returns',
    'customer_ledger',
    'sale_items',
    'sales',
    'van_sales_trips',
    'stock_movements',
    'product_location_stock',
    'customers',
    'products',
    'delivery_representatives',
    'stock_locations',
    'accounting_settings',
    'accounting_accounts',
    'users',
    'branches',
  ];
  for (const table of tables) {
    await dbAny.deleteFrom(table).where('tenant_id', '=', TENANT).execute();
  }
}

async function main(): Promise<void> {
  const config = resolveDatabaseConfigFromEnv();
  const pool = new Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.name,
    ssl: resolvePgSslConfig({
      enabled: config.ssl,
      rejectUnauthorized: config.sslRejectUnauthorized,
      caCert: config.sslCaCert,
    }),
    application_name: 'backend-e2e-van-returns',
  });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  const dbAny = db as any;

  await cleanup(db);

  try {
    const branch = await dbAny
      .insertInto('branches')
      .values({ name: `Van Returns Branch ${Date.now()}`, tenant_id: TENANT, account_id: ACCOUNT, is_active: true })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const warehouse = await dbAny
      .insertInto('stock_locations')
      .values({
        name: 'Main Warehouse',
        branch_id: branch.id,
        location_type: 'internal_warehouse',
        is_active: true,
        tenant_id: TENANT,
        account_id: ACCOUNT,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const user = await dbAny
      .insertInto('users')
      .values({
        username: `van-returns-e2e-${Date.now()}`,
        password_hash: 'x',
        password_salt: 'x',
        role: 'admin',
        is_active: true,
        tenant_id: TENANT,
        account_id: ACCOUNT,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const rep = await dbAny
      .insertInto('delivery_representatives')
      .values({ tenant_id: TENANT, account_id: ACCOUNT, name: 'Returns Test Rep', is_active: true })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const product = await dbAny
      .insertInto('products')
      .values({
        name: 'Returnable Product',
        cost_price: 6,
        retail_price: 15,
        stock_qty: 100,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        is_active: true,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    await dbAny
      .insertInto('product_location_stock')
      .values({
        product_id: product.id,
        location_id: warehouse.id,
        branch_id: branch.id,
        qty: 100,
        tenant_id: TENANT,
        account_id: ACCOUNT,
      })
      .execute();

    const customer = await dbAny
      .insertInto('customers')
      .values({
        name: 'Returning Shop',
        customer_type: 'credit',
        credit_limit: 5000,
        is_active: true,
        tenant_id: TENANT,
        account_id: ACCOUNT,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const foundation = new AccountingTenantFoundationService();
    const accountingPosting = new AccountingPostingService(foundation);
    const vanSales = new VanSalesService(db, {} as AuditService, {} as DeliveryRepsService, accountingPosting);
    const repId = Number(rep.id);

    const trip = await vanSales.openTripAndLoad(repId, TENANT, ACCOUNT, {
      sourceWarehouseId: Number(warehouse.id),
      items: [{ productId: Number(product.id), qty: 20 }],
    });

    // Credit sale of 6 units so there is a real invoice (and a real customer receivable) to return against.
    const sale = await vanSales.executeFieldSale(repId, TENANT, ACCOUNT, {
      tripId: trip.tripId,
      customerId: Number(customer.id),
      paymentMethod: 'credit',
      items: [{ productId: Number(product.id), qty: 6 }],
    });
    assert.equal(sale.total, 90); // 6 * 15

    const saleItemRow = await dbAny
      .selectFrom('sale_items')
      .select(['id'])
      .where('sale_id', '=', sale.saleId)
      .executeTakeFirstOrThrow();

    // --- 1. Returning more than was sold must be rejected --------------------------------------
    await assert.rejects(
      () =>
        vanSales.submitFieldReturn(repId, TENANT, ACCOUNT, {
          tripId: trip.tripId,
          customerId: Number(customer.id),
          saleId: sale.saleId,
          returnReason: 'customer_request',
          items: [{ productId: Number(product.id), qty: 7, unitPrice: 15, saleItemId: Number(saleItemRow.id) }],
        }),
      (err: any) => err.code === 'RETURN_QTY_EXCEEDS_SOLD',
      'returning 7 units of a 6-unit sale line must be rejected',
    );

    // --- 2. A valid partial return (4 of the 6) is accepted and parked pending approval ---------
    const submitted = await vanSales.submitFieldReturn(repId, TENANT, ACCOUNT, {
      tripId: trip.tripId,
      customerId: Number(customer.id),
      saleId: sale.saleId,
      returnReason: 'customer_request',
      items: [{ productId: Number(product.id), qty: 4, unitPrice: 15, saleItemId: Number(saleItemRow.id) }],
    });
    assert.equal(submitted.status, 'pending_approval');
    assert.equal(submitted.totalAmount, 60);

    // --- 3. A second return for the remaining 2 units is fine; for 3 more (only 2 left) is not --
    await assert.rejects(
      () =>
        vanSales.submitFieldReturn(repId, TENANT, ACCOUNT, {
          tripId: trip.tripId,
          customerId: Number(customer.id),
          saleId: sale.saleId,
          returnReason: 'customer_request',
          items: [{ productId: Number(product.id), qty: 3, unitPrice: 15, saleItemId: Number(saleItemRow.id) }],
        }),
      (err: any) => err.code === 'RETURN_QTY_EXCEEDS_SOLD',
      'a still-pending prior return must count against the remaining returnable qty, not just the original sale',
    );

    const customerBeforeApproval = await dbAny
      .selectFrom('customers')
      .select(['balance'])
      .where('id', '=', customer.id)
      .executeTakeFirstOrThrow();
    assert.equal(Number(customerBeforeApproval.balance), 90, 'balance unaffected while the return is still pending');

    const productBeforeApproval = await dbAny
      .selectFrom('products')
      .select(['stock_qty'])
      .where('id', '=', product.id)
      .executeTakeFirstOrThrow();
    assert.equal(
      Number(productBeforeApproval.stock_qty),
      94,
      '100 - 6 sold; the pending return has not touched stock yet',
    );

    // --- 4. Approve the pending return: stock/ledger/journal all land together -----------------
    const approved = await vanSales.approveFieldReturn(TENANT, ACCOUNT, submitted.returnId, Number(user.id));
    assert.equal(approved.status, 'approved');

    const customerAfterApproval = await dbAny
      .selectFrom('customers')
      .select(['balance'])
      .where('id', '=', customer.id)
      .executeTakeFirstOrThrow();
    assert.equal(Number(customerAfterApproval.balance), 30, '90 owed minus 60 returned');

    const productAfterApproval = await dbAny
      .selectFrom('products')
      .select(['stock_qty'])
      .where('id', '=', product.id)
      .executeTakeFirstOrThrow();
    assert.equal(Number(productAfterApproval.stock_qty), 98, '94 + 4 returned units back in stock');

    const journal = await db
      .selectFrom('journal_entries')
      .selectAll()
      .where('source_type', '=', 'van_field_return')
      .where('source_id', '=', submitted.returnId)
      .executeTakeFirstOrThrow();
    const lines = await db
      .selectFrom('journal_entry_lines')
      .selectAll()
      .where('journal_entry_id', '=', journal.id)
      .execute();
    const totalDebit = lines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredit = lines.reduce((s, l) => s + Number(l.credit), 0);
    assert.ok(Math.abs(totalDebit - totalCredit) < 0.01, 'return journal must balance');
    assert.equal(totalDebit, 60 + 4 * 6, 'revenue reversal (60) + COGS reversal (4 units * cost 6 = 24)');
    const receivableLine = lines.find((l) => Number(l.credit) === 60);
    assert.equal(receivableLine?.partner_type, 'customer');
    assert.equal(Number(receivableLine?.partner_id), Number(customer.id));

    // --- 5. Re-approving (or re-posting) must never double-post ---------------------------------
    await assert.rejects(
      () => vanSales.approveFieldReturn(TENANT, ACCOUNT, submitted.returnId, Number(user.id)),
      (err: any) => err.code === 'RETURN_ALREADY_PROCESSED',
    );
    const journalCount = await db
      .selectFrom('journal_entries')
      .select((eb) => eb.fn.countAll<number>().as('c'))
      .where('source_type', '=', 'van_field_return')
      .where('source_id', '=', submitted.returnId)
      .executeTakeFirstOrThrow();
    assert.equal(Number(journalCount.c), 1);

    // --- 6. The old, unapproved return path must no longer exist --------------------------------
    assert.equal(
      typeof (vanSales as any).recordFieldReturn,
      'undefined',
      'recordFieldReturn must be removed, not just unrouted, or a future controller could resurrect the bypass',
    );

    process.stdout.write('van-field-returns.e2e: all checks passed\n');
  } finally {
    await cleanup(db);
    await pool.end();
  }
}

main().catch((error) => {
  const details = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`van-field-returns.e2e failed:\n${details}\n`);
  process.exit(1);
});
