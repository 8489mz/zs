/**
 * Sale-edit remediation engine — Phase 2 (repair).
 *
 * Intended path in the zs repo:
 *   backend/src/modules/accounting/remediation/sale-edit-remediation-repair.engine.ts
 *
 * Companion to Phase 0 / Phase 1 in
 *   ./sale-edit-remediation.engine.ts
 * (discoverSaleEditDiscrepancies, classifySaleEditCandidate).
 *
 * What this module does, and what it deliberately does NOT do:
 *
 * - It repairs only candidates that Phase 1 classifies as `auto_fixable`
 *   at repair time. A candidate classified as `manual_review` is never
 *   reversed, even if the caller asked for it. Classification is re-run
 *   inside this module, never trusted from the caller.
 * - It reverses ONLY the stale journal, by journal id, and posts nothing
 *   new. In the normal auto-fixable case the kept journal already matches
 *   the current sale header, so a new `sale_edit` journal would itself be
 *   a double-count. It never calls `postSaleEdit()`.
 * - It never calls `AccountingPostingService.reverseSaleJournal()`.
 *   That method reverses the *latest* unreversed journal for a sale.
 *   When the stale journal is the original and the kept journal is a
 *   later edit, `reverseSaleJournal()` would reverse the kept journal —
 *   the wrong journal. Phase 2 therefore requires the one-method addition
 *   to `AccountingPostingService` delivered alongside this file:
 *   `reverseSaleJournalById(queryable, saleId, journalId, reason, auth)`,
 *   which mirrors the existing reversal lines through the existing
 *   private `insertPostedJournal()` (period lock, account lock, balance
 *   check, entry numbering, `reversed_by_entry_id` / `reversal_of_entry_id`
 *   linking). This engine calls that method through the
 *   `SaleEditReversalGateway` interface, so it can also be unit-tested
 *   with a stub gateway that records calls instead of posting journals.
 *   In production, pass the `AccountingPostingService` instance itself:
 *   after the one-method addition it structurally satisfies the gateway.
 *
 * - Mode is dry-run by default. `mode: 'apply'` must be passed explicitly.
 *   Dry-run performs no writes and calls the gateway zero times.
 * - Each sale is repaired in its own transaction. A failure for one sale
 *   rolls back that sale only, is recorded as `failed` in the report, and
 *   does not abort the rest of the batch. There is no single transaction
 *   for the whole batch: a batch-wide transaction would lose all progress
 *   on one failure, hold locks for the whole batch, and hide which sales
 *   actually repaired.
 * - Inside each apply transaction, before calling the gateway, the engine
 *   re-validates (with FOR UPDATE) that the sale header and COGS have not
 *   changed since classification and that the active journal set is still
 *   exactly {keep, stale}. If either changed, that sale is recorded as
 *   `failed` (with the change named) and nothing is posted for it. This
 *   is the concurrency guard: a new edit landing during a repair run
 *   must not be silently repaired against a stale classification.
 * - Idempotency: if the stale journal is already reversed and the kept
 *   journal is the only active journal, the sale is recorded as
 *   `already_repaired` and no new journal is posted. Re-running a report
 *   after a successful batch must therefore produce zero `reversed`
 *   items for the same sales.
 * - Reversal entry date is the repair date (inside the gateway, via
 *   `insertPostedJournal()` with `entryDate: new Date()`), never backdated
 *   to the original sale period. If the current period is closed, the
 *   period lock in `insertPostedJournal()` fails that sale only, and the
 *   sale is recorded as `failed` with the lock error — the engine never
 *   bypasses a period or tax lock.
 * - No repair-run table is assumed. This engine returns a full report;
 *   the caller persists / logs it. Do NOT insert a run-log row inside the
 *   per-sale GL transaction: a GL rollback would then also roll back the
 *   failure evidence, and a log-insert failure would roll back a correct
 *   GL reversal. Persist the report in a separate step, after the batch.
 *
 * Reviewed-batch workflow (recommended over the convenience runner):
 *   1. discoverSaleEditDiscrepancies()          (Phase 0)
 *   2. classifySaleEditCandidate() per sale     (Phase 1)
 *   3. repairSaleEditCandidates(..., mode: 'dry_run')  -> review report
 *   4. repairSaleEditCandidates(..., mode: 'apply', candidates: <same list>)
 *      The apply call re-classifies and re-validates, so a sale that
 *      changed between dry-run and apply is failed, not blindly repaired.
 * The convenience runner `runSaleEditRemediation()` does discovery +
 * repair in one call. If you dry-run with the runner and then apply with
 * the runner, pass the same `saleIds` (taken from the dry-run report) to
 * the apply call, otherwise the apply run may pick up sales that appeared
 * after the dry-run and were never reviewed.
 */

import { Kysely, sql } from '../../../database/kysely';
import type { Transaction } from 'kysely';
import { Database } from '../../../database/database.types';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import type { MoneyDigits } from '../engines/money-minor-units.engine';
import { resolveBusinessDateKey } from '../engines/accounting-date.engine';
import {
  classifySaleEditCandidate,
  discoverSaleEditDiscrepancies,
  type SaleEditCandidate,
} from './sale-edit-remediation.engine';

export type DbOrTx = Kysely<Database> | Transaction<Database>;

/**
 * The only posting operation Phase 2 needs. Satisfied in production by
 * `AccountingPostingService` after adding `reverseSaleJournalById`
 * (see the companion snippet delivered with this engine).
 */
export interface SaleEditReversalGateway {
  reverseSaleJournalById(
    queryable: DbOrTx,
    saleId: number,
    journalId: number,
    reason: string,
    auth: AuthContext,
  ): Promise<{ reversed: boolean; journalEntryId: number | null }>;
}

export type SaleEditRepairMode = 'dry_run' | 'apply';

export interface SaleEditRepairOptions {
  tenantId: string;
  bookDigits: MoneyDigits;
  /** Defaults to 'dry_run'. Pass 'apply' explicitly to post reversals. */
  mode?: SaleEditRepairMode;
  /** Traceability id embedded in reversal descriptions. Defaults to a date-based id. */
  runId?: string;
  /** Restrict the batch to these sale ids (after sorting ascending). */
  saleIds?: number[];
  /** Maximum number of sales to process in this run, after saleIds filtering. */
  limit?: number;
}

export type SaleEditRepairItemStatus =
  | 'would_reverse'
  | 'reversed'
  | 'already_repaired'
  | 'skipped_manual'
  | 'failed';

export interface SaleEditRepairItem {
  saleId: number;
  keepJournalId: number | null;
  staleJournalId: number | null;
  status: SaleEditRepairItemStatus;
  reversalJournalId: number | null;
  /** Present for skipped_manual and failed items. */
  reason?: string;
}

export interface SaleEditRepairReport {
  tenantId: string;
  runId: string;
  mode: SaleEditRepairMode;
  /** Candidates considered after saleIds filtering, before the limit. */
  candidatesConsidered: number;
  items: SaleEditRepairItem[];
  counts: {
    wouldReverse: number;
    reversed: number;
    alreadyRepaired: number;
    skippedManual: number;
    failed: number;
  };
}

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
  return Math.abs(Math.round(actual * factor) - Math.round(expected * factor)) <= 1;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAlreadyReversedError(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    message.includes('JOURNAL_REVERSAL_INVALID') ||
    message.includes('already reversed')
  );
}

function buildReport(
  tenantId: string,
  runId: string,
  mode: SaleEditRepairMode,
  candidatesConsidered: number,
  items: SaleEditRepairItem[],
): SaleEditRepairReport {
  const count = (status: SaleEditRepairItemStatus): number =>
    items.filter((item) => item.status === status).length;
  return {
    tenantId,
    runId,
    mode,
    candidatesConsidered,
    items,
    counts: {
      wouldReverse: count('would_reverse'),
      reversed: count('reversed'),
      alreadyRepaired: count('already_repaired'),
      skippedManual: count('skipped_manual'),
      failed: count('failed'),
    },
  };
}

function validateOptions(
  options: SaleEditRepairOptions,
  auth: AuthContext,
  // Tenant-local business day for the default run id, resolved by the caller
  // (which owns the db handle). Falls back to the UTC day only when no caller
  // resolves it -- validateOptions itself is sync and owns no db handle.
  todayKey?: string,
): { tenantId: string; bookDigits: MoneyDigits; mode: SaleEditRepairMode; runId: string } {
  const tenantId = options.tenantId;
  if (typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new Error('repairSaleEditCandidates: tenantId is required');
  }
  if (auth.tenantId != null && auth.tenantId !== tenantId) {
    throw new Error(
      `repairSaleEditCandidates: auth tenant '${auth.tenantId}' does not match requested tenant '${tenantId}'`,
    );
  }
  if (options.bookDigits !== 2 && options.bookDigits !== 3) {
    throw new Error(
      `repairSaleEditCandidates: bookDigits must be 2 or 3, got ${String(options.bookDigits)}`,
    );
  }
  const mode: SaleEditRepairMode = options.mode ?? 'dry_run';
  if (mode !== 'dry_run' && mode !== 'apply') {
    throw new Error(`repairSaleEditCandidates: unknown mode '${String(mode)}'`);
  }
  const runId =
    options.runId && options.runId.trim() !== ''
      ? options.runId
      : `sale-edit-remediation-${todayKey ?? new Date().toISOString().slice(0, 10)}`;
  return { tenantId, bookDigits: options.bookDigits, mode, runId };
}

function selectBatch(
  candidates: SaleEditCandidate[],
  options: SaleEditRepairOptions,
): { considered: SaleEditCandidate[]; batch: SaleEditCandidate[] } {
  const sorted = [...candidates].sort((a, b) => a.saleId - b.saleId);
  const considered =
    options.saleIds && options.saleIds.length > 0
      ? sorted.filter((candidate) => options.saleIds!.includes(candidate.saleId))
      : sorted;
  const batch =
    options.limit != null && options.limit >= 0
      ? considered.slice(0, options.limit)
      : considered;
  return { considered, batch };
}

/**
 * Read-only already-repaired check, used by dry-run and by the
 * already-reversed race path in apply. Returns the reversal journal id
 * when the stale journal is already reversed and the kept journal is the
 * only active journal, otherwise null.
 */
async function findExistingReversal(
  db: Kysely<Database>,
  tenantId: string,
  saleId: number,
  keepJournalId: number,
  staleJournalId: number,
): Promise<number | null> {
  const staleRow = await db
    .selectFrom('journal_entries')
    .select(['id', 'reversed_by_entry_id'])
    .where('id', '=', staleJournalId)
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst();
  if (!staleRow || staleRow.reversed_by_entry_id == null) return null;

  const activeRows = await db
    .selectFrom('journal_entries')
    .select(['id'])
    .where('tenant_id', '=', tenantId)
    .where('status', '=', 'posted')
    .where('source_id', '=', saleId)
    .where('source_type', 'in', ['sale', 'sale_edit'])
    .where('reversed_by_entry_id', 'is', null)
    .execute();
  if (activeRows.length !== 1 || Number(activeRows[0].id) !== keepJournalId) {
    return null;
  }
  return Number(staleRow.reversed_by_entry_id);
}

/**
 * Re-validation inside a per-sale transaction. Throws on any change
 * since classification, so the transaction rolls back with no writes.
 * Returns 'already_repaired' with the reversal id when the stale journal
 * was already reversed before this transaction started.
 */
async function revalidateInTransaction(
  trx: Transaction<Database>,
  tenantId: string,
  candidate: SaleEditCandidate,
  keepJournalId: number,
  staleJournalId: number,
  bookDigits: MoneyDigits,
): Promise<{ alreadyRepaired: boolean; reversalJournalId: number | null }> {
  const saleRow = await trx
    .selectFrom('sales')
    .select([
      'subtotal',
      'discount',
      'tax_amount',
      'total',
      'store_credit_used',
      'status',
      'exchange_return_id',
    ])
    .where('id', '=', candidate.saleId)
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .executeTakeFirst();
  if (!saleRow) {
    throw new Error(`sale ${candidate.saleId}: sale row no longer exists`);
  }
  if (saleRow.exchange_return_id != null) {
    throw new Error(
      `sale ${candidate.saleId}: exchange_return_id appeared since classification (now ${saleRow.exchange_return_id}); re-classify before repairing`,
    );
  }
  const status = String(saleRow.status ?? '').trim().toLowerCase();
  if (['cancelled', 'canceled', 'void', 'voided'].includes(status)) {
    throw new Error(
      `sale ${candidate.saleId}: sale status changed to '${saleRow.status}' since classification; re-classify before repairing`,
    );
  }
  const headerChecks: Array<[string, number, number]> = [
    ['subtotal', toNumber(saleRow.subtotal), candidate.sale.subtotal],
    ['discount', toNumber(saleRow.discount), candidate.sale.discount],
    ['tax_amount', toNumber(saleRow.tax_amount), candidate.sale.taxAmount],
    ['total', toNumber(saleRow.total), candidate.sale.total],
    [
      'store_credit_used',
      toNumber(saleRow.store_credit_used),
      candidate.sale.storeCreditUsed ?? 0,
    ],
  ];
  for (const [field, fresh, classified] of headerChecks) {
    if (!isWithinOneMinorUnit(fresh, classified, bookDigits)) {
      throw new Error(
        `sale ${candidate.saleId}: ${field} changed since classification (${fresh} vs ${classified}); re-classify before repairing`,
      );
    }
  }
  const itemRows = await trx
    .selectFrom('sale_items')
    .select(['qty', 'cost_price'])
    .where('sale_id', '=', candidate.saleId)
    .where(sql<boolean>`tenant_id = ${tenantId}`)
    .execute();
  const freshCogs = itemRows.reduce(
    (sum, item) => sum + toNumber(item.qty) * toNumber(item.cost_price),
    0,
  );
  if (!isWithinOneMinorUnit(freshCogs, candidate.sale.cogs, bookDigits)) {
    throw new Error(
      `sale ${candidate.saleId}: COGS changed since classification (${freshCogs} vs ${candidate.sale.cogs}); re-classify before repairing`,
    );
  }

  // FOR UPDATE serialises concurrent edits / repairs for this sale:
  // a concurrent transaction that is already reversing a journal blocks
  // here until it commits, and this check then sees its result.
  const journalRows = await trx
    .selectFrom('journal_entries')
    .select(['id', 'reversed_by_entry_id'])
    .where('tenant_id', '=', tenantId)
    .where('status', '=', 'posted')
    .where('source_id', '=', candidate.saleId)
    .where('source_type', 'in', ['sale', 'sale_edit'])
    .orderBy('id', 'asc')
    .forUpdate()
    .execute();
  const activeIds = journalRows
    .filter((row) => row.reversed_by_entry_id == null)
    .map((row) => Number(row.id));
  const staleRow = journalRows.find((row) => Number(row.id) === staleJournalId);
  const keepRow = journalRows.find((row) => Number(row.id) === keepJournalId);
  if (
    staleRow &&
    staleRow.reversed_by_entry_id != null &&
    keepRow &&
    keepRow.reversed_by_entry_id == null &&
    activeIds.length === 1 &&
    activeIds[0] === keepJournalId
  ) {
    return {
      alreadyRepaired: true,
      reversalJournalId: Number(staleRow.reversed_by_entry_id),
    };
  }
  if (
    activeIds.length !== 2 ||
    !activeIds.includes(keepJournalId) ||
    !activeIds.includes(staleJournalId)
  ) {
    throw new Error(
      `sale ${candidate.saleId}: active journal set changed since classification (expected [${keepJournalId}, ${staleJournalId}], found [${activeIds.join(', ')}]); re-classify before repairing`,
    );
  }
  return { alreadyRepaired: false, reversalJournalId: null };
}

async function verifyReversalInTransaction(
  trx: Transaction<Database>,
  tenantId: string,
  saleId: number,
  keepJournalId: number,
  staleJournalId: number,
  reversalJournalId: number,
): Promise<void> {
  const staleRow = await trx
    .selectFrom('journal_entries')
    .select(['reversed_by_entry_id'])
    .where('id', '=', staleJournalId)
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst();
  if (!staleRow || Number(staleRow.reversed_by_entry_id) !== reversalJournalId) {
    throw new Error(
      `sale ${saleId}: post-reversal verification failed: stale journal ${staleJournalId} is not linked to reversal ${reversalJournalId}`,
    );
  }
  const keepRow = await trx
    .selectFrom('journal_entries')
    .select(['reversed_by_entry_id'])
    .where('id', '=', keepJournalId)
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst();
  if (!keepRow || keepRow.reversed_by_entry_id != null) {
    throw new Error(
      `sale ${saleId}: post-reversal verification failed: kept journal ${keepJournalId} is no longer active`,
    );
  }
  const reversalRow = await trx
    .selectFrom('journal_entries')
    .select(['source_type', 'source_id', 'status', 'reversal_of_entry_id'])
    .where('id', '=', reversalJournalId)
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst();
  if (
    !reversalRow ||
    reversalRow.source_type !== 'sale_reversal' ||
    Number(reversalRow.source_id) !== saleId ||
    reversalRow.status !== 'posted' ||
    Number(reversalRow.reversal_of_entry_id) !== staleJournalId
  ) {
    throw new Error(
      `sale ${saleId}: post-reversal verification failed: reversal ${reversalJournalId} does not link to stale journal ${staleJournalId}`,
    );
  }
  const activeRows = await trx
    .selectFrom('journal_entries')
    .select(['id'])
    .where('tenant_id', '=', tenantId)
    .where('status', '=', 'posted')
    .where('source_id', '=', saleId)
    .where('source_type', 'in', ['sale', 'sale_edit'])
    .where('reversed_by_entry_id', 'is', null)
    .execute();
  if (activeRows.length !== 1 || Number(activeRows[0].id) !== keepJournalId) {
    throw new Error(
      `sale ${saleId}: post-reversal verification failed: expected exactly one active journal (${keepJournalId}), found [${activeRows.map((row) => Number(row.id)).join(', ')}]`,
    );
  }
}

/**
 * Phase 2 — Repair a reviewed candidate list.
 *
 * `db` must be a root Kysely connection, not an existing transaction,
 * so each sale gets its own transaction and can commit or roll back
 * independently. Pass the `AccountingPostingService` instance (after
 * adding `reverseSaleJournalById`) as `gateway`, or a stub gateway
 * for unit tests.
 *
 * This function never throws for a single sale's failure: the failure
 * is recorded in the report and the batch continues. It throws only for
 * batch-level validation errors (bad tenant, tenant/auth mismatch, bad
 * bookDigits, unknown mode, or a non-root db) before any sale is touched.
 */
export async function repairSaleEditCandidates(
  db: Kysely<Database>,
  gateway: SaleEditReversalGateway,
  auth: AuthContext,
  candidates: SaleEditCandidate[],
  options: SaleEditRepairOptions,
): Promise<SaleEditRepairReport> {
  // The default run id carries the tenant-local business day, never the UTC
  // day. The lookup runs before validation only because validation owns the
  // tenantId check; a missing/invalid tenant resolves to the gateway fallback
  // here and validation still throws right after, with no side effect.
  const todayKey = await resolveBusinessDateKey(db, typeof options.tenantId === 'string' ? options.tenantId : '', new Date());
  const { tenantId, bookDigits, mode, runId } = validateOptions(options, auth, todayKey);

  const dbAny = db as unknown as {
    isTransaction?: boolean;
    transaction?: unknown;
  };
  if (dbAny.isTransaction || typeof dbAny.transaction !== 'function') {
    throw new Error(
      'repairSaleEditCandidates: db must be a root Kysely connection, not an existing transaction, so each sale can commit independently',
    );
  }

  const { considered, batch } = selectBatch(candidates, options);
  const items: SaleEditRepairItem[] = [];

  for (const candidate of batch) {
    const classification = classifySaleEditCandidate(candidate, bookDigits);
    if (classification.status !== 'auto_fixable') {
      items.push({
        saleId: candidate.saleId,
        keepJournalId: null,
        staleJournalId: null,
        status: 'skipped_manual',
        reversalJournalId: null,
        reason: classification.reason,
      });
      continue;
    }
    const { keepJournalId, staleJournalId } = classification;
    const reason =
      `P2 sale-edit remediation (run ${runId}): reverse duplicate journal ${staleJournalId}, keep ${keepJournalId}`;

    if (mode === 'dry_run') {
      const existing = await findExistingReversal(
        db,
        tenantId,
        candidate.saleId,
        keepJournalId,
        staleJournalId,
      );
      if (existing != null) {
        items.push({
          saleId: candidate.saleId,
          keepJournalId,
          staleJournalId,
          status: 'already_repaired',
          reversalJournalId: existing,
        });
      } else {
        items.push({
          saleId: candidate.saleId,
          keepJournalId,
          staleJournalId,
          status: 'would_reverse',
          reversalJournalId: null,
        });
      }
      continue;
    }

    // Apply: one transaction per sale.
    try {
      const outcome = await db.transaction().execute(async (trx) => {
        const revalidated = await revalidateInTransaction(
          trx,
          tenantId,
          candidate,
          keepJournalId,
          staleJournalId,
          bookDigits,
        );
        if (revalidated.alreadyRepaired) {
          return {
            status: 'already_repaired' as const,
            reversalJournalId: revalidated.reversalJournalId,
          };
        }
        const result = await gateway.reverseSaleJournalById(
          trx,
          candidate.saleId,
          staleJournalId,
          reason,
          auth,
        );
        if (!result.reversed) {
          if (result.journalEntryId != null) {
            // Gateway found the stale journal already reversed (race
            // serialised by FOR UPDATE). Verify it links to the stale
            // journal before trusting it as already repaired.
            const reversalRow = await trx
              .selectFrom('journal_entries')
              .select(['reversal_of_entry_id'])
              .where('id', '=', Number(result.journalEntryId))
              .where('tenant_id', '=', tenantId)
              .executeTakeFirst();
            if (
              reversalRow &&
              Number(reversalRow.reversal_of_entry_id) === staleJournalId
            ) {
              return {
                status: 'already_repaired' as const,
                reversalJournalId: Number(result.journalEntryId),
              };
            }
          }
          throw new Error(
            `sale ${candidate.saleId}: gateway did not reverse stale journal ${staleJournalId} and returned no linked reversal journal`,
          );
        }
        if (result.journalEntryId == null) {
          throw new Error(
            `sale ${candidate.saleId}: gateway reported success for stale journal ${staleJournalId} without a reversal journal id`,
          );
        }
        const reversalJournalId = Number(result.journalEntryId);
        await verifyReversalInTransaction(
          trx,
          tenantId,
          candidate.saleId,
          keepJournalId,
          staleJournalId,
          reversalJournalId,
        );
        return {
          status: 'reversed' as const,
          reversalJournalId,
        };
      });
      items.push({
        saleId: candidate.saleId,
        keepJournalId,
        staleJournalId,
        status: outcome.status,
        reversalJournalId: outcome.reversalJournalId,
      });
    } catch (error) {
      // Race path: the gateway's insert may have thrown
      // JOURNAL_REVERSAL_INVALID because a concurrent repair committed
      // between re-validation and insert. Re-check outside the rolled
      // back transaction; if the sale is now repaired, report that
      // instead of a failure.
      if (isAlreadyReversedError(error)) {
        const existing = await findExistingReversal(
          db,
          tenantId,
          candidate.saleId,
          keepJournalId,
          staleJournalId,
        );
        if (existing != null) {
          items.push({
            saleId: candidate.saleId,
            keepJournalId,
            staleJournalId,
            status: 'already_repaired',
            reversalJournalId: existing,
          });
          continue;
        }
      }
      items.push({
        saleId: candidate.saleId,
        keepJournalId,
        staleJournalId,
        status: 'failed',
        reversalJournalId: null,
        reason: errorMessage(error),
      });
    }
  }

  return buildReport(tenantId, runId, mode, considered.length, items);
}

/**
 * Convenience runner: discover (Phase 0) then repair the discovered
 * candidates. Prefer `repairSaleEditCandidates()` with a reviewed
 * candidate list when the batch must be exactly the reviewed set;
 * this runner re-discovers, so pass `saleIds` from a prior dry-run
 * report to pin the apply batch to the reviewed sales.
 */
export async function runSaleEditRemediation(
  db: Kysely<Database>,
  gateway: SaleEditReversalGateway,
  auth: AuthContext,
  options: SaleEditRepairOptions,
): Promise<SaleEditRepairReport> {
  const { tenantId } = validateOptions(options, auth);
  const discovered = await discoverSaleEditDiscrepancies(db, tenantId);
  return repairSaleEditCandidates(db, gateway, auth, discovered, options);
}
