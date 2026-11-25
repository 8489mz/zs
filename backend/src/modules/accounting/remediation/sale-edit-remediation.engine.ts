/**
 * Sale-edit remediation engine — Phase 0 (discovery) and Phase 1 (classification).
 *
 * Intended path in the zs repo:
 *   backend/src/modules/accounting/remediation/sale-edit-remediation.engine.ts
 *
 * This module is deliberately pure and side-effect free:
 * - It never writes, reverses, deletes, or updates a journal. Phase 2 (repair)
 *   is a separate, operator-approved step that must consume the output of
 *   `classifySaleEditCandidate` and reverse only the identified stale journal.
 * - It never calls `postSaleEdit()` for backfill. `postSaleEdit()` reverses the
 *   *latest* unreversed journal and posts a new journal; backfill must reverse
 *   a *specific* stale journal and, in the normal auto-fixable case, post
 *   nothing new, because the kept journal already matches the current header.
 *
 * Discovery mirrors the P0 `SALE_EDIT_NET` check in
 * `backend/src/modules/accounting/accounting-integrity.ts`:
 *   status = 'posted', source_type IN ('sale', 'sale_edit'),
 *   reversed_by_entry_id IS NULL, grouped by source_id, count > 1.
 *
 * Classification mirrors the line construction in
 * `AccountingPostingService.postSale()` / `postSaleEdit()`:
 *   revenueCredit = prices_include_tax
 *     ? subtotal + service_charge - tax_amount + delivery_fee + tip_amount
 *     : subtotal + service_charge + delivery_fee + tip_amount
 *   discountDebit = discount
 *   taxCredit     = tax_amount
 *   cogsDebit     = sum(sale_items.qty * sale_items.cost_price)
 *   inventoryCredit = cogsDebit
 *   cashDebit + bankDebit + receivableDebit = total - store_credit_used
 *
 * Two deliberate choices in the funding check, both taken from postSale():
 * - Cash (1110) and bank (1120) are compared only as a sum. postSale() maps
 *   every non-cash payment channel to bank, so a payment-channel edit changes
 *   the cash/bank split without changing the total paid. Comparing cash and
 *   bank separately would falsely reject a correct channel edit.
 * - Receivable (1130) is compared as a sum over all partner types. A van-sale
 *   split posts part of 1130 with partnerType 'customer' and part with
 *   partnerType 'none' (rep custody); both are 1130 debits and both count.
 *
 * Tolerance is exactly one minor unit: `10 ** -bookDigits` (0.01 for
 * 2-decimal currencies, 0.001 for 3-decimal currencies). Comparison is done
 * in integer minor units to avoid binary floating-point artefacts
 * (e.g. 0.1 + 0.2). A difference of at most 1 minor unit counts as a match.
 *
 * Test-fixture note: the production `sales` table has a `status` column
 * (see `backend/src/database/database.types.ts` — SalesTable). A PGlite
 * fixture that omits `sales.status` will fail at the sale query, exactly as
 * any other production query selecting that column would. Add `status`
 * to the fixture sales table before test-driving this engine against the
 * simplified commercial-posting fixture.
 */

import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { roundMoney, type MoneyDigits } from '../engines/money-minor-units.engine';

/** Account codes used by sale journals. 2150 is store credit, checked separately. */
const ACCOUNT_CODES = [
  '4100',
  '4300',
  '2120',
  '1110',
  '1120',
  '1130',
  '5100',
  '1140',
  '2150',
] as const;

export interface SaleEditJournalTotals {
  /** Account 4100, credit side. */
  revenueCredit: number;
  /** Account 4300, debit side. */
  discountDebit: number;
  /** Account 2120, credit side. */
  taxCredit: number;
  /** Account 1110, debit side. */
  cashDebit: number;
  /** Account 1120, debit side. */
  bankDebit: number;
  /** Account 1130, debit side, all partner types summed. */
  receivableDebit: number;
  /** Account 5100, debit side. */
  cogsDebit: number;
  /** Account 1140, credit side. */
  inventoryCredit: number;
}

export interface SaleEditJournal {
  journalId: number;
  sourceType: string;
  entryNo: string | null;
  entryDate: Date | string | null;
  totals: SaleEditJournalTotals;
  /** Sum of all lines in the journal, regardless of account code. */
  totalDebit?: number;
  /** Sum of all lines in the journal, regardless of account code. */
  totalCredit?: number;
  /** Account 2150, debit side. Absent only for hand-built candidates. */
  storeCreditDebit?: number;
}

export interface SaleEditDocument {
  saleId: number;
  docNo: string | null;
  customerId: number | null;
  subtotal: number;
  discount: number;
  taxAmount: number;
  total: number;
  /** Raw sum of sale_items.qty * sale_items.cost_price, unrounded. */
  cogs: number;
  status: string | null;
  saleOrigin: string | null;
  paymentType: string | null;
  /** Optional: defaults to 0 / false in classification when absent. */
  paidAmount?: number;
  storeCreditUsed?: number;
  pricesIncludeTax?: boolean;
  deliveryFee?: number;
  serviceCharge?: number;
  tipAmount?: number;
  exchangeReturnId?: number | null;
}

export interface SaleEditCandidate {
  tenantId: string;
  saleId: number;
  /** Count from the SALE_EDIT_NET grouping query (before sale loading). */
  activeJournalCount: number;
  sale: SaleEditDocument;
  /** Active, unreversed journals, oldest first (by journal id). */
  journals: SaleEditJournal[];
}

export type SaleEditClassification =
  | {
      status: 'auto_fixable';
      keepJournalId: number;
      staleJournalId: number;
    }
  | {
      status: 'manual_review';
      reason: string;
    };

const CANCELLED_STATUSES = new Set([
  'cancelled',
  'canceled',
  'void',
  'voided',
]);

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function isWithinOneMinorUnit(
  actual: number,
  expected: number,
  bookDigits: MoneyDigits,
): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  const factor = 10 ** bookDigits;
  const actualMinor = Math.round(actual * factor);
  const expectedMinor = Math.round(expected * factor);
  return Math.abs(actualMinor - expectedMinor) <= 1;
}

function zeroTotals(): SaleEditJournalTotals {
  return {
    revenueCredit: 0,
    discountDebit: 0,
    taxCredit: 0,
    cashDebit: 0,
    bankDebit: 0,
    receivableDebit: 0,
    cogsDebit: 0,
    inventoryCredit: 0,
  };
}

/**
 * Phase 0 — Discovery (read-only).
 *
 * Returns one candidate per sale flagged by SALE_EDIT_NET. Sales whose
 * source_id has no matching `sales` row are skipped here: an orphan journal
 * is a SOURCE_DOCUMENT_POSTINGS problem, not a sale-edit remediation
 * candidate, and there is no current header to compare its journals against.
 *
 * The candidate set is expected to be small (flagged sales only, not all
 * sales), so per-candidate queries are used for readability and for exact
 * parity with the posting service's sale / sale_items queries. Do not use
 * this as a general sales-reporting query over an unfiltered tenant.
 */
export async function discoverSaleEditDiscrepancies(
  db: Kysely<Database>,
  tenantId: string,
): Promise<SaleEditCandidate[]> {
  if (typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new Error('discoverSaleEditDiscrepancies: tenantId is required');
  }

  const flaggedRows = await db
    .selectFrom('journal_entries')
    .select([
      'source_id',
      sql<number>`count(*)`.as('active_journal_count'),
    ])
    .where('tenant_id', '=', tenantId)
    .where('status', '=', 'posted')
    .where(sql<boolean>`source_id is not null`)
    .where('source_type', 'in', ['sale', 'sale_edit'])
    .where('reversed_by_entry_id', 'is', null)
    .groupBy('source_id')
    .having(db.fn.count('journal_entries.id'), '>', 1)
    .orderBy('source_id', 'asc')
    .execute();

  // Account code map, built once: account id -> code, for this tenant only.
  // A line whose account id is not in this map still counts toward
  // totalDebit / totalCredit, but not toward any code total; that will
  // normally push the journal to manual_review in classification, which
  // is the safe outcome for an unmapped account.
  const accountRows = await db
    .selectFrom('accounting_accounts')
    .select(['id', 'code'])
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .where('code', 'in', [...ACCOUNT_CODES])
    .execute();
  const codeByAccountId = new Map<number, string>();
  for (const row of accountRows) {
    codeByAccountId.set(Number(row.id), String(row.code));
  }

  const candidates: SaleEditCandidate[] = [];

  for (const flagged of flaggedRows) {
    const saleId = Number(flagged.source_id);
    if (!Number.isFinite(saleId)) continue;

    const saleRow = await db
      .selectFrom('sales')
      .select([
        'id',
        'doc_no',
        'customer_id',
        'subtotal',
        'discount',
        'tax_amount',
        'total',
        'paid_amount',
        'store_credit_used',
        'status',
        'sale_origin',
        'payment_type',
        'prices_include_tax',
        'delivery_fee',
        'service_charge',
        'tip_amount',
        'exchange_return_id',
      ])
      .where('id', '=', saleId)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();
    if (!saleRow) continue;

    const itemRows = await db
      .selectFrom('sale_items')
      .select(['qty', 'cost_price'])
      .where('sale_id', '=', saleId)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .execute();
    // Same COGS source as postSale() / postSaleEdit(): cost_price is
    // already per sold unit (adjusted by unit_multiplier at sale time),
    // so do not multiply by unit_multiplier again here.
    const cogs = itemRows.reduce(
      (sum, item) =>
        sum + toNumber(item.qty) * toNumber(item.cost_price),
      0,
    );

    const journalRows = await db
      .selectFrom('journal_entries')
      .select(['id', 'source_type', 'entry_no', 'entry_date'])
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'posted')
      .where('source_id', '=', saleId)
      .where('source_type', 'in', ['sale', 'sale_edit'])
      .where('reversed_by_entry_id', 'is', null)
      .orderBy('id', 'asc')
      .execute();

    const journals: SaleEditJournal[] = [];
    for (const journalRow of journalRows) {
      const journalId = Number(journalRow.id);
      const lineRows = await db
        .selectFrom('journal_entry_lines')
        .select(['account_id', 'debit', 'credit'])
        .where('journal_entry_id', '=', journalId)
        .execute();

      const totals = zeroTotals();
      let totalDebit = 0;
      let totalCredit = 0;
      let storeCreditDebit = 0;
      for (const line of lineRows) {
        const debit = toNumber(line.debit);
        const credit = toNumber(line.credit);
        totalDebit += debit;
        totalCredit += credit;
        const code = codeByAccountId.get(Number(line.account_id));
        if (code === '4100') totals.revenueCredit += credit;
        else if (code === '4300') totals.discountDebit += debit;
        else if (code === '2120') totals.taxCredit += credit;
        else if (code === '1110') totals.cashDebit += debit;
        else if (code === '1120') totals.bankDebit += debit;
        else if (code === '1130') totals.receivableDebit += debit;
        else if (code === '5100') totals.cogsDebit += debit;
        else if (code === '1140') totals.inventoryCredit += credit;
        else if (code === '2150') storeCreditDebit += debit;
      }

      journals.push({
        journalId,
        sourceType: String(journalRow.source_type),
        entryNo: journalRow.entry_no ?? null,
        entryDate: journalRow.entry_date ?? null,
        totals,
        totalDebit,
        totalCredit,
        storeCreditDebit,
      });
    }

    // Re-check the count from the journals actually loaded, not just the
    // grouping query: if the two disagree, classification works from the
    // loaded journals and the reviewer sees the loaded count here.
    candidates.push({
      tenantId,
      saleId,
      activeJournalCount: journals.length,
      sale: {
        saleId,
        docNo: saleRow.doc_no ?? null,
        customerId:
          saleRow.customer_id == null ? null : Number(saleRow.customer_id),
        subtotal: toNumber(saleRow.subtotal),
        discount: toNumber(saleRow.discount),
        taxAmount: toNumber(saleRow.tax_amount),
        total: toNumber(saleRow.total),
        cogs,
        status: saleRow.status == null ? null : String(saleRow.status),
        saleOrigin:
          saleRow.sale_origin == null ? null : String(saleRow.sale_origin),
        paymentType:
          saleRow.payment_type == null ? null : String(saleRow.payment_type),
        paidAmount: toNumber(saleRow.paid_amount),
        storeCreditUsed: toNumber(saleRow.store_credit_used),
        pricesIncludeTax: Boolean(saleRow.prices_include_tax ?? false),
        deliveryFee: toNumber(saleRow.delivery_fee ?? 0),
        serviceCharge: toNumber(saleRow.service_charge ?? 0),
        tipAmount: toNumber(saleRow.tip_amount ?? 0),
        exchangeReturnId:
          saleRow.exchange_return_id == null
            ? null
            : Number(saleRow.exchange_return_id),
      },
      journals,
    });
  }

  return candidates;
}

interface JournalMatch {
  journal: SaleEditJournal;
  matches: boolean;
  mismatches: string[];
}

function matchJournal(
  journal: SaleEditJournal,
  expected: {
    revenueCredit: number;
    discountDebit: number;
    taxCredit: number;
    cogsDebit: number;
    fundingDebit: number;
    storeCreditDebit: number;
  },
  bookDigits: MoneyDigits,
): JournalMatch {
  const t = journal.totals;
  const mismatches: string[] = [];

  if (!isWithinOneMinorUnit(t.revenueCredit, expected.revenueCredit, bookDigits)) {
    mismatches.push(`revenue 4100: ${t.revenueCredit} != ${expected.revenueCredit}`);
  }
  if (!isWithinOneMinorUnit(t.discountDebit, expected.discountDebit, bookDigits)) {
    mismatches.push(`discount 4300: ${t.discountDebit} != ${expected.discountDebit}`);
  }
  if (!isWithinOneMinorUnit(t.taxCredit, expected.taxCredit, bookDigits)) {
    mismatches.push(`tax 2120: ${t.taxCredit} != ${expected.taxCredit}`);
  }
  if (!isWithinOneMinorUnit(t.cogsDebit, expected.cogsDebit, bookDigits)) {
    mismatches.push(`cogs 5100: ${t.cogsDebit} != ${expected.cogsDebit}`);
  }
  if (!isWithinOneMinorUnit(t.inventoryCredit, expected.cogsDebit, bookDigits)) {
    mismatches.push(`inventory 1140: ${t.inventoryCredit} != ${expected.cogsDebit}`);
  }
  const fundingDebit = t.cashDebit + t.bankDebit + t.receivableDebit;
  if (!isWithinOneMinorUnit(fundingDebit, expected.fundingDebit, bookDigits)) {
    mismatches.push(
      `funding 1110+1120+1130: ${fundingDebit} != ${expected.fundingDebit}`,
    );
  }
  // Store credit is only verifiable when discover loaded it. If the
  // header used store credit but the journal total is absent, that is a
  // mismatch, not a pass: a missing 2150 line cannot be assumed correct.
  const storeCreditDebit =
    journal.storeCreditDebit == null ? Number.NaN : journal.storeCreditDebit;
  if (!isWithinOneMinorUnit(storeCreditDebit, expected.storeCreditDebit, bookDigits)) {
    mismatches.push(
      `store credit 2150: ${storeCreditDebit} != ${expected.storeCreditDebit}`,
    );
  }
  // Balance is checked only when both totals were loaded; hand-built
  // candidates without them are judged on the code totals alone.
  if (
    journal.totalDebit != null &&
    journal.totalCredit != null &&
    !isWithinOneMinorUnit(journal.totalDebit, journal.totalCredit, bookDigits)
  ) {
    mismatches.push(
      `unbalanced journal: debit ${journal.totalDebit} != credit ${journal.totalCredit}`,
    );
  }

  return { journal, matches: mismatches.length === 0, mismatches };
}

/**
 * Phase 1 — Classification (pure, no database access).
 *
 * Returns auto_fixable only when exactly two active journals exist and
 * exactly one of them matches the current sale header within one minor
 * unit on every checked amount. Every other situation is manual_review,
 * with a reason that names the sale, the journals, and — for amount
 * mismatches — the fields that differ, so a reviewer can act without
 * re-running the comparison.
 *
 * The order of guards is intentional and deterministic:
 *  1. journal count,  2. exchange sale,  3. cancelled sale,
 *  4. amount comparison. A sale that fails an early guard is never
 *  classified by amounts, even if one journal happens to match.
 */
export function classifySaleEditCandidate(
  candidate: SaleEditCandidate,
  bookDigits: MoneyDigits,
): SaleEditClassification {
  if (bookDigits !== 2 && bookDigits !== 3) {
    throw new Error(
      `classifySaleEditCandidate: bookDigits must be 2 or 3, got ${String(bookDigits)}`,
    );
  }

  const { sale, journals } = candidate;

  if (journals.length < 2) {
    return {
      status: 'manual_review',
      reason: `sale ${sale.saleId}: fewer than two active journals (${journals.length}); SALE_EDIT_NET flag cannot be resolved by keeping one and reversing one`,
    };
  }
  if (journals.length !== 2) {
    return {
      status: 'manual_review',
      reason: `sale ${sale.saleId}: ${journals.length} active journals (${journals.map((j) => j.journalId).join(', ')}); targeted reversal requires exactly one keep journal and one stale journal`,
    };
  }

  if (sale.exchangeReturnId != null) {
    return {
      status: 'manual_review',
      reason: `sale ${sale.saleId}: exchange sale (exchange_return_id=${sale.exchangeReturnId}); journal totals include merged return lines, so a header-only comparison cannot determine the keep journal`,
    };
  }

  const status = (sale.status ?? '').trim().toLowerCase();
  if (CANCELLED_STATUSES.has(status)) {
    return {
      status: 'manual_review',
      reason: `sale ${sale.saleId}: sale status is '${sale.status}'; a cancelled sale must have all active journals reversed, not one kept`,
    };
  }

  // Expected values, rounded exactly as postSaleEdit() rounds them with
  // toBookMoney() (roundMoney). Rounding the components first, then the
  // derived revenue and funding totals, mirrors the posting service
  // instead of comparing raw database values that may carry extra digits.
  const subtotal = roundMoney(sale.subtotal, bookDigits);
  const discount = roundMoney(sale.discount, bookDigits);
  const taxAmount = roundMoney(sale.taxAmount, bookDigits);
  const deliveryFee = roundMoney(sale.deliveryFee ?? 0, bookDigits);
  const serviceCharge = roundMoney(sale.serviceCharge ?? 0, bookDigits);
  const tipAmount = roundMoney(sale.tipAmount ?? 0, bookDigits);
  const total = roundMoney(sale.total, bookDigits);
  const storeCreditUsed = roundMoney(sale.storeCreditUsed ?? 0, bookDigits);
  const cogs = roundMoney(sale.cogs, bookDigits);
  const revenueCredit = sale.pricesIncludeTax
    ? roundMoney(subtotal + serviceCharge - taxAmount + deliveryFee + tipAmount, bookDigits)
    : roundMoney(subtotal + serviceCharge + deliveryFee + tipAmount, bookDigits);
  const fundingDebit = roundMoney(total - storeCreditUsed, bookDigits);

  const expected = {
    revenueCredit,
    discountDebit: discount,
    taxCredit: taxAmount,
    cogsDebit: cogs,
    fundingDebit,
    storeCreditDebit: storeCreditUsed,
  };

  const [first, second] = journals.map((journal) =>
    matchJournal(journal, expected, bookDigits),
  );

  if (first.matches && second.matches) {
    return {
      status: 'manual_review',
      reason: `sale ${sale.saleId}: both journals match the current header (journals ${first.journal.journalId} and ${second.journal.journalId}); cannot determine the stale journal from totals alone`,
    };
  }
  if (!first.matches && !second.matches) {
    return {
      status: 'manual_review',
      reason: `sale ${sale.saleId}: neither journal matches the current header; journal ${first.journal.journalId} mismatches: ${first.mismatches.join('; ')}; journal ${second.journal.journalId} mismatches: ${second.mismatches.join('; ')}`,
    };
  }

  const keep = first.matches ? first.journal : second.journal;
  const stale = first.matches ? second.journal : first.journal;
  return {
    status: 'auto_fixable',
    keepJournalId: keep.journalId,
    staleJournalId: stale.journalId,
  };
}
