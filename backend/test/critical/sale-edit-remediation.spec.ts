import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import {
  discoverSaleEditDiscrepancies,
  classifySaleEditCandidate,
  SaleEditCandidate,
} from '../../src/modules/accounting/remediation/sale-edit-remediation.engine';
import { repairSaleEditCandidates } from '../../src/modules/accounting/remediation/sale-edit-remediation-repair.engine';

async function testPureClassification() {
  const baseSale = {
    saleId: 100,
    docNo: 'S-100',
    customerId: 5,
    subtotal: 100,
    discount: 10,
    taxAmount: 14,
    total: 104,
    cogs: 60,
    status: 'posted',
    saleOrigin: 'retail',
    paymentType: 'cash',
    paidAmount: 104,
    storeCreditUsed: 0,
    pricesIncludeTax: false,
    deliveryFee: 0,
    serviceCharge: 0,
    tipAmount: 0,
    exchangeReturnId: null,
  };

  const matchingJournal = {
    journalId: 1,
    sourceType: 'sale',
    entryNo: 'J-1',
    entryDate: new Date(),
    totals: {
      revenueCredit: 100,
      discountDebit: 10,
      taxCredit: 14,
      cashDebit: 104,
      bankDebit: 0,
      receivableDebit: 0,
      cogsDebit: 60,
      inventoryCredit: 60,
    },
    totalDebit: 174,
    totalCredit: 174,
    storeCreditDebit: 0,
  };

  const staleJournal = {
    journalId: 2,
    sourceType: 'sale_edit',
    entryNo: 'J-2',
    entryDate: new Date(),
    totals: {
      revenueCredit: 150,
      discountDebit: 15,
      taxCredit: 21,
      cashDebit: 156,
      bankDebit: 0,
      receivableDebit: 0,
      cogsDebit: 90,
      inventoryCredit: 90,
    },
    totalDebit: 261,
    totalCredit: 261,
    storeCreditDebit: 0,
  };

  // Case 1: auto_fixable when first matches and second is stale
  const res1 = classifySaleEditCandidate(
    {
      tenantId: 't1',
      saleId: 100,
      activeJournalCount: 2,
      sale: { ...baseSale },
      journals: [matchingJournal, staleJournal],
    },
    2,
  );
  assert.equal(res1.status, 'auto_fixable');
  if (res1.status === 'auto_fixable') {
    assert.equal(res1.keepJournalId, 1);
    assert.equal(res1.staleJournalId, 2);
  }

  // Case 2: auto_fixable when second matches and first is stale
  const res2 = classifySaleEditCandidate(
    {
      tenantId: 't1',
      saleId: 100,
      activeJournalCount: 2,
      sale: { ...baseSale },
      journals: [staleJournal, matchingJournal],
    },
    2,
  );
  assert.equal(res2.status, 'auto_fixable');
  if (res2.status === 'auto_fixable') {
    assert.equal(res2.keepJournalId, 1);
    assert.equal(res2.staleJournalId, 2);
  }

  // Case 3: manual_review if fewer than 2 journals
  const res3 = classifySaleEditCandidate(
    {
      tenantId: 't1',
      saleId: 100,
      activeJournalCount: 1,
      sale: { ...baseSale },
      journals: [matchingJournal],
    },
    2,
  );
  assert.equal(res3.status, 'manual_review');
  assert.ok(res3.reason.includes('fewer than two active journals'));

  // Case 4: manual_review if more than 2 journals
  const res4 = classifySaleEditCandidate(
    {
      tenantId: 't1',
      saleId: 100,
      activeJournalCount: 3,
      sale: { ...baseSale },
      journals: [matchingJournal, staleJournal, { ...matchingJournal, journalId: 3 }],
    },
    2,
  );
  assert.equal(res4.status, 'manual_review');
  assert.ok(res4.reason.includes('3 active journals'));

  // Case 5: manual_review if sale is cancelled
  const res5 = classifySaleEditCandidate(
    {
      tenantId: 't1',
      saleId: 100,
      activeJournalCount: 2,
      sale: { ...baseSale, status: 'cancelled' },
      journals: [matchingJournal, staleJournal],
    },
    2,
  );
  assert.equal(res5.status, 'manual_review');
  assert.ok(res5.reason.includes("sale status is 'cancelled'"));

  // Case 6: manual_review if exchange sale
  const res6 = classifySaleEditCandidate(
    {
      tenantId: 't1',
      saleId: 100,
      activeJournalCount: 2,
      sale: { ...baseSale, exchangeReturnId: 99 },
      journals: [matchingJournal, staleJournal],
    },
    2,
  );
  assert.equal(res6.status, 'manual_review');
  assert.ok(res6.reason.includes('exchange sale'));

  // Case 7: manual_review if both journals match
  const res7 = classifySaleEditCandidate(
    {
      tenantId: 't1',
      saleId: 100,
      activeJournalCount: 2,
      sale: { ...baseSale },
      journals: [matchingJournal, { ...matchingJournal, journalId: 2 }],
    },
    2,
  );
  assert.equal(res7.status, 'manual_review');
  assert.ok(res7.reason.includes('both journals match'));

  // Case 8: manual_review if neither journal matches
  const res8 = classifySaleEditCandidate(
    {
      tenantId: 't1',
      saleId: 100,
      activeJournalCount: 2,
      sale: { ...baseSale },
      journals: [staleJournal, { ...staleJournal, journalId: 3 }],
    },
    2,
  );
  assert.equal(res8.status, 'manual_review');
  assert.ok(res8.reason.includes('neither journal matches'));

  // Case 9: 3-decimal currencies (1 fil difference passes, 2 fils difference fails)
  const kwdSale = {
    ...baseSale,
    subtotal: 10.0,
    discount: 1.0,
    taxAmount: 0.5,
    total: 9.5,
    cogs: 6.0,
  };
  const kwd1FilDiff = {
    ...matchingJournal,
    totals: {
      ...matchingJournal.totals,
      revenueCredit: 10.0,
      discountDebit: 1.0,
      taxCredit: 0.5,
      cashDebit: 9.501, // exactly 1 fil difference
      cogsDebit: 6.0,
      inventoryCredit: 6.0,
    },
    totalDebit: 16.501,
    totalCredit: 16.501,
  };
  const resKwdPass = classifySaleEditCandidate(
    {
      tenantId: 't1',
      saleId: 100,
      activeJournalCount: 2,
      sale: kwdSale,
      journals: [kwd1FilDiff, staleJournal],
    },
    3,
  );
  assert.equal(resKwdPass.status, 'auto_fixable', '1 fil difference must pass tolerance');

  const kwd2FilsDiff = {
    ...matchingJournal,
    totals: {
      ...matchingJournal.totals,
      revenueCredit: 10.0,
      discountDebit: 1.0,
      taxCredit: 0.5,
      cashDebit: 9.502, // 2 fils difference
      cogsDebit: 6.0,
      inventoryCredit: 6.0,
    },
    totalDebit: 16.502,
    totalCredit: 16.502,
  };
  const resKwdFail = classifySaleEditCandidate(
    {
      tenantId: 't1',
      saleId: 100,
      activeJournalCount: 2,
      sale: kwdSale,
      journals: [kwd2FilsDiff, staleJournal],
    },
    3,
  );
  assert.equal(resKwdFail.status, 'manual_review', '2 fils difference must fail tolerance');
}

async function testDiscoveryIntegration() {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text);
      CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, doc_no text, customer_id bigint,
        subtotal numeric, discount numeric DEFAULT 0, tax_amount numeric DEFAULT 0, total numeric,
        paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, exchange_return_id bigint,
        branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-01',
        delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0,
        tip_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, sale_origin text,
        payment_type text DEFAULT 'cash', collection_status text, status text DEFAULT 'posted');
      CREATE TABLE sale_items (id bigint PRIMARY KEY, tenant_id text, sale_id bigint, product_id bigint, qty numeric, cost_price numeric);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint,
        status text, entry_no text, entry_date timestamptz, reversed_by_entry_id bigint, reversal_of_entry_id bigint);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint, account_id bigint, debit numeric, credit numeric);

      INSERT INTO accounting_accounts VALUES
        (1,'t1','4100'), (2,'t1','4300'), (3,'t1','2120'), (4,'t1','1110'),
        (5,'t1','1120'), (6,'t1','1130'), (7,'t1','5100'), (8,'t1','1140'), (9,'t1','2150');

      -- Sale 1: flagged with 2 unreversed journals
      INSERT INTO sales(id, tenant_id, doc_no, subtotal, discount, tax_amount, total, paid_amount)
        VALUES (1, 't1', 'S1', 100, 10, 14, 104, 104);
      INSERT INTO sale_items VALUES (1, 't1', 1, 10, 2, 30); -- cogs = 60

      -- Journal 1: matches Sale 1
      INSERT INTO journal_entries(id, tenant_id, source_type, source_id, status, entry_no)
        VALUES (1, 't1', 'sale', 1, 'posted', 'JE-1');
      INSERT INTO journal_entry_lines(journal_entry_id, account_id, debit, credit) VALUES
        (1, 4, 104, 0), -- 1110 cash debit
        (1, 1, 0, 100), -- 4100 revenue credit
        (1, 2, 10, 0),  -- 4300 discount debit
        (1, 3, 0, 14),  -- 2120 tax credit
        (1, 7, 60, 0),  -- 5100 cogs debit
        (1, 8, 0, 60);  -- 1140 inventory credit

      -- Journal 2: stale edit journal
      INSERT INTO journal_entries(id, tenant_id, source_type, source_id, status, entry_no)
        VALUES (2, 't1', 'sale_edit', 1, 'posted', 'JE-2');
      INSERT INTO journal_entry_lines(journal_entry_id, account_id, debit, credit) VALUES
        (2, 4, 150, 0),
        (2, 1, 0, 150);

      -- Sale 2: single journal (should NOT be flagged by discover)
      INSERT INTO sales(id, tenant_id, doc_no, subtotal, discount, tax_amount, total)
        VALUES (2, 't1', 'S2', 50, 0, 7, 57);
      INSERT INTO journal_entries(id, tenant_id, source_type, source_id, status, entry_no)
        VALUES (3, 't1', 'sale', 2, 'posted', 'JE-3');

      SELECT setval(pg_get_serial_sequence('journal_entries', 'id'), 10);
    `);

    const candidates = await discoverSaleEditDiscrepancies(db, 't1');
    assert.equal(candidates.length, 1, 'discover must flag only Sale 1');
    const c = candidates[0];
    assert.equal(c.saleId, 1);
    assert.equal(c.activeJournalCount, 2);
    assert.equal(c.sale.total, 104);
    assert.equal(c.sale.cogs, 60);
    assert.equal(c.journals.length, 2);

    const classification = classifySaleEditCandidate(c, 2);
    assert.equal(classification.status, 'auto_fixable');
    if (classification.status === 'auto_fixable') {
      assert.equal(classification.keepJournalId, 1, 'matching journal must be kept');
      assert.equal(classification.staleJournalId, 2, 'stale journal must be reversed');
    }

    // Phase 2 repair verification
    const mockAuth: any = { tenantId: 't1', userId: 1, roles: ['admin'] };
    let reversalCallCount = 0;
    const stubGateway = {
      async reverseSaleJournalById(trx: any, saleId: number, journalId: number) {
        reversalCallCount++;
        const rev = await trx
          .insertInto('journal_entries')
          .values({
            tenant_id: 't1',
            source_type: 'sale_reversal',
            source_id: saleId,
            status: 'posted',
            entry_no: 'REV-1',
            entry_date: new Date(),
            reversal_of_entry_id: journalId,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const revId = Number(rev.id);
        await trx
          .updateTable('journal_entries')
          .set({ reversed_by_entry_id: revId })
          .where('id', '=', journalId)
          .execute();
        return { reversed: true, journalEntryId: revId };
      },
    };

    // 1. Dry run: 0 reversals executed, item marked would_reverse
    const dryRunReport = await repairSaleEditCandidates(db, stubGateway, mockAuth, candidates, {
      tenantId: 't1',
      bookDigits: 2,
      mode: 'dry_run',
    });
    assert.equal(dryRunReport.counts.wouldReverse, 1);
    assert.equal(dryRunReport.items[0].status, 'would_reverse');
    assert.equal(reversalCallCount, 0, 'dry-run must not invoke gateway');

    // 2. Apply: exactly 1 reversal executed, item marked reversed
    const applyReport = await repairSaleEditCandidates(db, stubGateway, mockAuth, candidates, {
      tenantId: 't1',
      bookDigits: 2,
      mode: 'apply',
    });
    assert.equal(applyReport.counts.reversed, 1);
    assert.equal(applyReport.items[0].status, 'reversed');
    assert.equal(reversalCallCount, 1, 'apply must invoke gateway exactly once');

    // 3. Re-run Apply on same candidate: idempotency asserts already_repaired
    const secondApplyReport = await repairSaleEditCandidates(db, stubGateway, mockAuth, candidates, {
      tenantId: 't1',
      bookDigits: 2,
      mode: 'apply',
    });
    assert.equal(secondApplyReport.counts.alreadyRepaired, 1);
    assert.equal(secondApplyReport.items[0].status, 'already_repaired');
    assert.equal(reversalCallCount, 1, 'already_repaired must not call gateway again');
  } finally {
    await db.destroy();
  }
}

async function main() {
  await testPureClassification();
  console.log('sale-edit remediation: pure classification suite passed');
  await testDiscoveryIntegration();
  console.log('sale-edit remediation: discovery & repair integration suite passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
