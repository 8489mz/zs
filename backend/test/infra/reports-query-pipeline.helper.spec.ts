import { strict as assert } from 'node:assert';
import {
  applyAuditSearch,
  applyPartnerLedgerSearch,
  applySignedAmountFilter,
  applyTreasurySearch,
} from '../../src/modules/reports/helpers/reports-query-pipeline.helper';

class MockQuery {
  calls: Array<{ kind: 'where'; args: unknown[] }> = [];

  where(...args: unknown[]) {
    this.calls.push({ kind: 'where', args });
    return this;
  }
}

const partner = applyPartnerLedgerSearch(new MockQuery(), '%sale%');
assert.equal(partner.calls.length, 1, 'partner ledger search should add one where callback');
assert.equal(
  typeof partner.calls[0]?.args[0],
  'function',
  'partner ledger search should use expression builder callback',
);

const treasury = applyTreasurySearch(new MockQuery(), '%cash%');
assert.equal(treasury.calls.length, 1, 'treasury search should add one where callback');
assert.equal(typeof treasury.calls[0]?.args[0], 'function', 'treasury search should use expression builder callback');

const audit = applyAuditSearch(new MockQuery(), '%admin%');
assert.equal(audit.calls.length, 1, 'audit search should add one where callback');
assert.equal(typeof audit.calls[0]?.args[0], 'function', 'audit search should use expression builder callback');

const debit = applySignedAmountFilter(new MockQuery(), 'amount', 'debit');
assert.equal(debit.calls.length, 1, 'debit filter should add one predicate');
assert.equal(String(debit.calls[0]?.args[1]), '>', 'debit filter should require positive amount');

const credit = applySignedAmountFilter(new MockQuery(), 't.amount', 'out');
assert.equal(credit.calls.length, 1, 'out filter should add one predicate');
assert.equal(String(credit.calls[0]?.args[1]), '<', 'out filter should require negative amount');

const neutral = applySignedAmountFilter(new MockQuery(), 'amount', 'all');
assert.equal(neutral.calls.length, 0, 'neutral filter should leave query unchanged');

console.log('reports-query-pipeline.helper.spec passed');
