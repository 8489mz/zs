import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Source guards for O27 and O28 (ARCHITECTURE_INVARIANTS.md §8). Both were reads that took an id
// straight from a request body and skipped the tenant filter, so the row they returned — and the
// scope derived from it — could belong to another tenant. A unit test cannot see that; the shape of
// the query is the thing worth freezing.

const read = (rel: string) => readFileSync(resolve(__dirname, '../../src', rel), 'utf8');

function testVanSalesReadsStayInTenant(): void {
  // Van-sales split: the reads now live across the facade + the extracted
  // services (batch 1: lifecycle, field-sales, collections-and-swaps;
  // batch 2: expenses-packaging-customers). The safety property is checked
  // over every file that can hold one; add the next split's service here
  // when it moves a read.
  const sources = [
    read('modules/delivery-reps/van-sales.service.ts'),
    read('modules/delivery-reps/services/van-trip-lifecycle.service.ts'),
    read('modules/delivery-reps/services/van-field-sales.service.ts'),
    read('modules/delivery-reps/services/van-collections-and-swaps.service.ts'),
    read('modules/delivery-reps/services/van-expenses-packaging-customers.service.ts'),
  ];

  for (const src of sources) {
    for (const match of src.matchAll(/selectFrom\('(customers|products)'\)([\s\S]{0,400}?)\.executeTakeFirst(OrThrow)?\(\)/g)) {
      assert.ok(
        match[2].includes("'tenant_id'") || match[2].includes('tenant_id'),
        `O27: read of ${match[1]} in van-sales must filter by tenant_id:\n${match[0].slice(0, 200)}`,
      );
    }
  }

  // Every trip fetched by an id from the request body belongs to the calling rep, not just the
  // tenant. Matches both the `vt.`-aliased style (executeFieldSale, recordFieldCollection,
  // settleTrip) and the plain, unaliased style (submitFieldReturn) — the safety property is the
  // same either way, and recordFieldReturn's removal (it bypassed the field-return approval
  // workflow entirely; see the exact same file's history) is exactly why this dropped from 4 to 3
  // under the old vt.-only regex, not because any remaining lookup lost its scope.
  const tripLookups = sources.flatMap((src) => [
    ...src.matchAll(/\.where\('(?:vt\.)?id', '=', payload\.tripId\)([\s\S]{0,300}?)\.executeTakeFirst(OrThrow)?\(\)/g),
  ]);
  assert.ok(tripLookups.length >= 4, 'the trip lookups are still there');
  for (const match of tripLookups) {
    assert.ok(/\b(?:vt\.)?tenant_id\b/.test(match[1]), 'O27: trip lookup filters by tenant');
    assert.ok(/\b(?:vt\.)?rep_id\b/.test(match[1]), `O27: trip lookup must also filter by rep_id:\n${match[0].slice(0, 200)}`);
  }
}

function testPayrollRunScopeComesFromTheCaller(): void {
  const src = read('modules/hr/hr.service.ts');

  const runSelect = src.match(/SELECT period_month, tenant_id[\s\S]{0,400}?FROM hr_payroll_runs WHERE[^`]*/);
  assert.ok(runSelect, 'the payroll run lookup is still there');
  assert.ok(
    /WHERE id = \$\{runId\} AND tenant_id = \$\{callerTenantId\}/.test(runSelect[0]),
    `O28: the payroll run must be read within the caller's tenant:\n${runSelect[0]}`,
  );

  for (const call of src.matchAll(/rebuildPayrollRunItems\(trx,[^)]*\)/g)) {
    assert.ok(/auth\.tenantId/.test(call[0]), `O28: every caller passes its tenant: ${call[0]}`);
  }
}

testVanSalesReadsStayInTenant();
testPayrollRunScopeComesFromTheCaller();

function testAuditIsolationRemediations(): void {
  const hr = read('modules/hr/hr.service.ts');
  const section = (source: string, start: string, end: string) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `missing audit section: ${start}`);
    return source.slice(from, to);
  };
  const expect = (source: string, pattern: RegExp, id: string) => {
    assert.match(source, pattern, `${id}: tenant boundary must remain explicit`);
  };

  // Directly reachable HR reads and money-moving loan updates (MT-01..04, 08, 12).
  expect(section(hr, 'async listLoans(', 'async createLoan('), /WHERE l\.tenant_id = \$\{tenantId\}/, 'MT-01');
  expect(section(hr, 'async getPayrollRun(', 'async createPayrollRun('), /WHERE r\.id = \$\{id\} AND r\.tenant_id = \$\{tenantId\}/, 'MT-02');
  expect(section(hr, 'async listEmployeeAssets(', 'async upsertEmployeeAsset('), /WHERE a\.tenant_id = \$\{tenantId\}/, 'MT-03');
  expect(section(hr, 'async withdrawals(', 'async summary('), /WHERE id = \$\{employeeId\} AND tenant_id = \$\{tenantId\}/, 'MT-04');
  expect(section(hr, 'async createLoan(', 'async updateLoan('), /\.where\('tenant_id', '=', requireTenantScope\(auth\)\.tenantId\)/, 'MT-08');
  expect(section(hr, 'private async settlePayrollLoanDeductions(', 'async approvePayrollRun('), /WHERE id = \$\{row\.installment_id\} AND tenant_id = \$\{tenantId\}/, 'MT-12');

  const maritime = read('modules/maritime-freight/maritime-freight.service.ts');
  const tracking = section(maritime, 'async getPublicTrackingByToken(', 'private assertValidPublicQuoteToken');
  const trackingLookup = tracking.slice(0, tracking.indexOf('if (!job)'));
  expect(trackingLookup, /\.where\('tracking_token', '=', cleanToken\)/, 'MT-05');
  assert.doesNotMatch(trackingLookup, /eb\('(?:job_number|mbl_number|hbl_number|booking_number)'/, 'MT-05: public lookup accepts only random tokens');
  assert.doesNotMatch(tracking, /shipment: job\b/, 'MT-05: never return the full private job row');
  expect(section(maritime, 'async getPublicRfqForQuote(', 'async '), /\.where\('tenant_id', '=', rfq\.tenant_id\)/, 'MT-10');

  const support = read('modules/settings/services/settings-support.service.ts');
  const tenantBundle = section(support, 'async generateSupportBundle(', 'async generateSupportBundleInternal(');
  expect(tenantBundle, /\.where\('tenant_id', '=', tenantId\)/, 'MT-20');
  assert.doesNotMatch(tenantBundle, /generateSupportBundleInternal\(/, 'MT-20: tenant download cannot include shared process logs');
  const webhook = read('modules/settings/services/whatsapp-gateway.service.ts');
  expect(webhook, /timingSafeEqual\(expected, Buffer\.from\(supplied, 'hex'\)\)/, 'MT-21');
  assert.doesNotMatch(webhook, /firstActive/, 'MT-21: no first-tenant fallback');
  const webhookController = read('modules/settings/controllers/whatsapp-gateway.controller.ts');
  expect(webhookController, /handleVerifiedInboundWebhook\(body, tenantId, req\.headers\['x-zs-webhook-signature'\], req\.rawBody\)/, 'MT-21');

  const manufacturing = read('modules/manufacturing/services/manufacturing.service.ts');
  expect(manufacturing, /assertBomProductsOwned\(trx, payload, scope\.tenantId\)/, 'MT-07');
  expect(manufacturing, /\.deleteFrom\('manufacturing_bom_lines'\)[\s\S]{0,170}\.selectFrom\('manufacturing_boms'\)/, 'MT-15');
  const purchases = read('modules/purchases/services/purchases-query.service.ts');
  expect(purchases, /\.where\('pa\.tenant_id', '=', scope\.tenantId\)/, 'MT-13');
  const accounting = read('modules/accounting/accounting.service.ts');
  expect(accounting, /\.where\('l\.tenant_id', '=', tenantId\)/, 'MT-14');
  expect(accounting, /onRef\('pls\.tenant_id', '=', 'p\.tenant_id'\)/, 'MT-16');
  const mobile = read('modules/hr/mobile-attendance.service.ts');
  expect(mobile, /contactsQuery = contactsQuery\.where\('tenant_id', '=', resolvedTenantId\)/, 'MT-19');
}

testAuditIsolationRemediations();
console.log('tenant-scoped-reads.spec: all checks passed');
