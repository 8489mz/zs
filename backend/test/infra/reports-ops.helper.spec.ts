import assert from 'node:assert/strict';
import {
  buildAuditPayload,
  buildTreasuryPayload,
  buildTreasurySummary,
  mapAuditLogs,
  mapTreasuryTransactions,
} from '../../src/modules/reports/helpers/reports-ops.helper';

const treasuryRows = [
  {
    id: 11,
    txn_type: 'sale',
    amount: 1250,
    note: 'cash in',
    reference_type: 'sale',
    reference_id: 77,
    branch_id: 2,
    location_id: 5,
    branch_name: 'Main',
    location_name: 'Front',
    created_by_name: 'owner',
    created_at: '2026-01-02T10:00:00.000Z',
  },
];

const auditRows = [
  {
    id: 91,
    action: 'user.login',
    details: 'Success',
    username: 'owner',
    created_at: '2026-01-02T11:00:00.000Z',
  },
];

(() => {
  const items = mapTreasuryTransactions(treasuryRows);
  assert.equal(items.length, 1);
  assert.equal(items[0].branchName, 'Main');
  assert.equal(items[0].locationName, 'Front');
  assert.equal(items[0].referenceId, '77');
})();

(() => {
  const summary = buildTreasurySummary({ cash_in: 1250, cash_out: -200, net_total: 1050 });
  assert.deepEqual(summary, { cashIn: 1250, cashOut: 200, net: 1050 });
})();

(() => {
  const payload = buildTreasuryPayload({
    rows: treasuryRows,
    page: 2,
    pageSize: 25,
    totalItems: 30,
    summaryRow: { cash_in: 1250, cash_out: -200, net_total: 1050 },
  });
  assert.equal(payload.treasury.length, 1);
  assert.equal(payload.pagination.page, 2);
  assert.equal(payload.pagination.totalPages, 2);
  assert.equal(payload.summary.cashOut, 200);
})();

(() => {
  const items = mapAuditLogs(auditRows);
  assert.equal(items.length, 1);
  assert.equal(items[0].user, 'owner');
})();

(() => {
  const payload = buildAuditPayload({
    rows: auditRows,
    page: 1,
    pageSize: 50,
    totalItems: 1,
    distinctUsers: 1,
  });
  assert.equal(payload.auditLogs.length, 1);
  assert.equal(payload.summary.totalItems, 1);
  assert.equal(payload.summary.distinctUsers, 1);
})();

console.log('reports-ops helper tests passed');
