/*
 * INV-BUSINESS-DATE-TENANT-LOCAL: the business day is the calendar day
 * in the tenant's configured timezone (settings key 'timezone',
 * default Africa/Cairo) -- never the UTC day, never the host
 * machine's local day.
 *
 * WHAT THE AUDIT FEARED: the period gates keyed off the UTC day
 * (toISOString slice) while document numbers keyed off the host-local
 * day. On a Portable machine in Cairo the two disagree for 2-3 hours
 * every night: a 00:30-local sale carried a next-day document number
 * but was period-checked against the previous UTC day -- rejected by
 * a just-closed period, or posted into a period the local date says
 * is closed. The tenant-timezone helper that would reconcile them
 * was used only by HR and one storefront validation.
 *
 * WHAT THIS PINS, driving the REAL gates on PGlite at one frozen
 * instant -- 2026-10-31T22:30:00Z, which is 2026-11-01 00:30 in Cairo
 * (UTC+2) and 2026-10-31 18:30 in New York (UTC-4) -- with the locks
 * set to 2026-10-31 and a closed fiscal period covering October:
 * 1. assertBusinessAccountingDate: Cairo passes (business day Nov 1),
 *    New York throws (business day Oct 31), a tenant with no setting
 *    passes via the Cairo default. On the old UTC code Cairo threw.
 * 2. assertTaxPeriodOpen: same split for the tax lock.
 * 3. assertAutomatedJournalPeriodOpen: same split for the shared
 *    automated-journal gate.
 * 4. AccountingService.assertNotInLockedPeriod: same split.
 * 5. resolveBusinessDateKey: a YYYY-MM-DD string passes through
 *    untouched (it is already a day); a datetime string resolves in
 *    the tenant zone.
 * 6. generateDailySequenceNumber issues the number under the
 *    tenant's business day (Cairo 261101, New York 261031).
 * 7. Pure prefix/number helpers honour an explicit timezone.
 * 8. Source pins: the UTC-days comment is gone from the accounting
 *    date engine; every contracting number call passes a timezone;
 *    the storefront checkout derives its ON prefix from
 *    todayTenantDate.
 *
 * Deliberately NOT driven here: the remaining ~49 document-number
 * call sites that still use the host-local day (HR, purchases,
 * inventory, maritime, ...), the report/query UTC slices, and the
 * global schedulers -- recorded as remaining work in the invariant.
 * They need per-module tenant context, one module at a time.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { assertBusinessAccountingDate } from '../../src/modules/accounting/accounting-boundaries';
import { assertTaxPeriodOpen } from '../../src/modules/accounting/accounting-tax-lock';
import { assertAutomatedJournalPeriodOpen } from '../../src/modules/accounting/accounting-period-lock';
import { AccountingService } from '../../src/modules/accounting/accounting.service';
import { resolveBusinessDateKey } from '../../src/modules/accounting/engines/accounting-date.engine';
import { generateDailySequenceNumber } from '../../src/modules/delivery-reps/services/van-common.util';
import {
  formatDailyDocumentNumber,
  getDailyDocumentPrefix,
} from '../../src/common/utils/document-number.util';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const CAIRO = 't-cairo';
const NEW_YORK = 't-ny';
const DEFAULT_TZ = 't-default';
const ACCOUNT = 'a-biz';
// 2026-10-31T22:30:00Z = Nov 1 00:30 Cairo, Oct 31 18:30 New York.
const FROZEN = new Date('2026-10-31T22:30:00.000Z');
const LOCK_DAY = '2026-10-31';

function auth(tenantId: string): AuthContext {
  return {
    userId: 1,
    sessionId: 'sess-spec',
    username: 'actor-1',
    role: 'admin',
    permissions: [],
    tenantId,
    accountId: ACCOUNT,
  } as unknown as AuthContext;
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE settings (key text NOT NULL, value text, tenant_id text NOT NULL, account_id text NOT NULL, PRIMARY KEY (tenant_id, key));
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, is_tax boolean DEFAULT false);
      CREATE TABLE accounting_settings (id bigint, tenant_id text, sales_tax_account_id bigint, purchase_tax_account_id bigint,
        lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
      CREATE TABLE van_load_requisitions (id bigserial PRIMARY KEY, tenant_id text, doc_no text);
    `);

    async function seedTenant(tenantId: string, timezone: string | null, taxAccountId: number): Promise<void> {
      if (timezone) {
        await anyDb.insertInto('settings').values({
          tenant_id: tenantId, account_id: ACCOUNT, key: 'timezone', value: JSON.stringify(timezone),
        }).execute();
      }
      await anyDb.insertInto('accounting_settings').values({
        id: 1, tenant_id: tenantId, sales_tax_account_id: taxAccountId, purchase_tax_account_id: taxAccountId,
        lock_date_all: LOCK_DAY, lock_date_non_adviser: null, lock_date_tax: LOCK_DAY,
      }).execute();
      await anyDb.insertInto('accounting_fiscal_periods').values({
        tenant_id: tenantId, status: 'closed', name: 'Oct 2026', period_number: 10,
        start_date: '2026-10-01', end_date: LOCK_DAY,
      }).execute();
      await anyDb.insertInto('accounting_accounts').values({
        id: taxAccountId, tenant_id: tenantId, code: '2210', is_tax: true,
      }).execute();
    }

    await seedTenant(CAIRO, 'Africa/Cairo', 7);
    await seedTenant(NEW_YORK, 'America/New_York', 8);
    await seedTenant(DEFAULT_TZ, null, 9);

    // 1. Period gate: Cairo passes, New York throws, default passes.
    await assertBusinessAccountingDate(db, CAIRO, FROZEN, true);
    await assert.rejects(() => assertBusinessAccountingDate(db, NEW_YORK, FROZEN, true));
    await assertBusinessAccountingDate(db, DEFAULT_TZ, FROZEN, true);

    // 2. Tax lock: same split.
    await assertTaxPeriodOpen(db, CAIRO, FROZEN, [7]);
    await assert.rejects(() => assertTaxPeriodOpen(db, NEW_YORK, FROZEN, [8]));

    // 3. Automated-journal gate: same split.
    await assertAutomatedJournalPeriodOpen(db, CAIRO, FROZEN, [7]);
    await assert.rejects(() => assertAutomatedJournalPeriodOpen(db, NEW_YORK, FROZEN, [8]));

    // 4. Service-level gate: same split.
    const accounting = new AccountingService(db, {} as never, undefined);
    await accounting.assertNotInLockedPeriod(CAIRO, FROZEN, { auth: auth(CAIRO) });
    await assert.rejects(() => accounting.assertNotInLockedPeriod(NEW_YORK, FROZEN, { auth: auth(NEW_YORK) }));

    // 5. Day-string passthrough + datetime-string resolution.
    assert.equal(await resolveBusinessDateKey(db, CAIRO, '2026-10-31'), '2026-10-31');
    assert.equal(await resolveBusinessDateKey(db, CAIRO, '2026-10-31T22:30:00.000Z'), '2026-11-01');
    assert.equal(await resolveBusinessDateKey(db, NEW_YORK, '2026-10-31T22:30:00.000Z'), '2026-10-31');

    // 6. Daily sequence numbers under the tenant's business day.
    const cairoNo = await db.transaction().execute(async (trx) => {
      const n = await generateDailySequenceNumber(trx as any, db, 'van_load_requisitions', 'doc_no', 'REQ', CAIRO, FROZEN);
      await (trx as any).insertInto('van_load_requisitions').values({ tenant_id: CAIRO, doc_no: n }).execute();
      return n;
    });
    assert.equal(cairoNo, 'REQ-261101-0001');
    const nyNo = await db.transaction().execute(async (trx) => {
      return generateDailySequenceNumber(trx as any, db, 'van_load_requisitions', 'doc_no', 'REQ', NEW_YORK, FROZEN);
    });
    assert.equal(nyNo, 'REQ-261031-0001');

    // 7. Pure helpers honour an explicit timezone.
    assert.equal(getDailyDocumentPrefix('PRJ', FROZEN, 'Africa/Cairo'), 'PRJ-261101-');
    assert.equal(getDailyDocumentPrefix('PRJ', FROZEN, 'America/New_York'), 'PRJ-261031-');
    assert.equal(formatDailyDocumentNumber('SPAY', 7, FROZEN, 4, 'Africa/Cairo'), 'SPAY-261101-0007');

    // 8. Source pins.
    const engineSource = fs.readFileSync(
      path.join(__dirname, '../../src/modules/accounting/engines/accounting-date.engine.ts'),
      'utf8',
    );
    assert.equal(engineSource.includes('UTC days'), false);
    assert.equal(engineSource.includes('resolveBusinessDateKey'), true);
    const contractingSource = fs.readFileSync(
      path.join(__dirname, '../../src/modules/contracting/contracting.service.ts'),
      'utf8',
    );
    const barePrefixCalls = contractingSource.match(/getDailyDocumentPrefix\('[^']+'\)/g) || [];
    assert.equal(barePrefixCalls.length, 0);
    assert.equal(contractingSource.includes('getTenantTimezone'), true);
    const storefrontSource = fs.readFileSync(
      path.join(__dirname, '../../src/modules/storefront/storefront.service.ts'),
      'utf8',
    );
    assert.equal(storefrontSource.includes('todayTenantDate(businessTz, now)'), true);
  } finally {
    await db.destroy();
  }
  console.log('business date tenant-local checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
