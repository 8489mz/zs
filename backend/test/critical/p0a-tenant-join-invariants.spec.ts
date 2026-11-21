import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Source-contract checks complement PostgreSQL tests. They ensure previously
// fixed raw Kysely joins do not revert to ID-only links on code review.
const SRC = resolve(__dirname, '../../src/modules');
const read = (path: string) => readFileSync(resolve(SRC, path), 'utf8');

function check(file: string, required: string[]): void {
  const source = read(file);
  for (const join of required) {
    assert.ok(source.includes(join), `${file}: missing tenant-aware join ${join}`);
  }
}
function run(): void {
  // Accounting split: the joins now live in the extracted services — the
  // journal-entries/lines join in S3 (listAccounts), the bank-statement and
  // journal-entries/lines joins in S10 (reconciliation workspace).
  check('accounting/services/accounting-accounts.service.ts', [
    "join.onRef('je.id', '=', 'l.journal_entry_id').onRef('je.tenant_id', '=', 'l.tenant_id')",
  ]);
  check('accounting/services/accounting-bank-statements.service.ts', [
    "join.onRef('bs.id', '=', 'bsl.statement_id').onRef('bs.tenant_id', '=', 'bsl.tenant_id')",
    "join.onRef('je.id', '=', 'jel.journal_entry_id').onRef('je.tenant_id', '=', 'jel.tenant_id')",
  ]);
  check('reports/reports.service.ts', [
    "join.onRef('s.id', '=', 'si.sale_id').onRef('s.tenant_id', '=', 'si.tenant_id')",
    "join.onRef('rd.id', '=', 'ri.return_document_id').onRef('rd.tenant_id', '=', 'ri.tenant_id')",
  ]);
  // Partners split (#65): the two joins live in two slices — the sales join in
  // S3 (getCustomerPosSummary), the branch join in S4 (getCustomerDeliveryProfile).
  check('partners/partners/customer-addresses-pos.slice.ts', [
    "join.onRef('s.id', '=', 'rd.invoice_id').onRef('s.tenant_id', '=', 'rd.tenant_id')",
  ]);
  check('partners/partners/customer-delivery-profile.slice.ts', [
    "join.onRef('b.id', '=', 's.branch_id').onRef('b.tenant_id', '=', 's.tenant_id')",
  ]);
  // Maritime split: the tenant-aware journal join lives in three slices
  // (assertJobCanClose + postContainerDepositJournal in S12, the sales
  // invoice in S14, the charge update in S17). The facade holds 0: its
  // methods are thin delegates.
  check('maritime-freight/maritime-freight-jobs-core.service.ts', [
    "join.onRef('jl.journal_entry_id', '=', 'je.id').onRef('jl.tenant_id', '=', 'je.tenant_id')",
  ]);
  check('maritime-freight/maritime-freight-invoicing.service.ts', [
    "join.onRef('jl.journal_entry_id', '=', 'je.id').onRef('jl.tenant_id', '=', 'je.tenant_id')",
  ]);
  check('maritime-freight/maritime-freight-job-close.service.ts', [
    "join.onRef('jl.journal_entry_id', '=', 'je.id').onRef('jl.tenant_id', '=', 'je.tenant_id')",
  ]);
  check('contracting/services/contracting-documents.service.ts', [
    "trx.selectFrom('contracting_documents').selectAll().where('id', '=', documentId).where('tenant_id', '=', tenantId)",
  ]);
}
run();
