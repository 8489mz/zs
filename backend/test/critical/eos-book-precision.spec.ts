/*
 * INV-EOS-BOOK-PRECISION: an end-of-service settlement must compute and
 * store entirely at the tenant's book precision. Before this package the
 * EOS engine rounded every component through a local toFixed(2), the
 * service rounded the manually entered pending salary to cents, and
 * hr_end_of_service_settlements stored NUMERIC(15,2) -- so on a KWD
 * tenant a 100.125 salary produced a 50.06 gratuity where 50.063 was
 * due, and the stored settlement could not reconcile with the
 * book-precision journal the posting service already produced.
 * This spec pins the worked KWD example through the production engine
 * (never a re-implemented formula) and proves migration 2040000000266
 * widens the stored columns so the computed values survive Postgres.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import {
  calculateGratuity,
  calculateLeaveEncashment,
  calculateSettlementAbsorption,
} from '../../src/modules/hr/engines/eos-calculation.engine';
import { up as eosPrecisionMigrationUp } from '../../src/database/migrations/2040000000266_eos_minor_unit_precision';

const wholeFils = (value: number): boolean => Math.abs(value * 1000 - Math.round(value * 1000)) < 0.001;

async function main(): Promise<void> {
  // --- KWD gratuity: Saudi resignation, 3.0 years, salary 100.125 ---
  {
    const res = calculateGratuity({
      serviceYearsDecimal: 3,
      totalSalary: 100.125,
      dailyWage: 100.125 / 30,
      lawType: 'saudi',
      reason: 'resignation',
      minorUnits: 3,
    });
    assert.equal(res.gratuityPercentage, 33.333);
    assert.equal(res.baseGratuity, 150.188, '3 * 0.5 * 100.125 = 150.1875 -> 150.188 at 3dp');
    assert.equal(res.gratuityAmount, 50.063, 'a third of 150.1875 = 50.0625 -> 50.063 at 3dp');
    assert.ok(wholeFils(res.gratuityAmount), 'gratuity is a whole number of fils');

    // 2dp behaviour unchanged: the old engine's output, now explicit.
    const two = calculateGratuity({
      serviceYearsDecimal: 3,
      totalSalary: 100.125,
      dailyWage: 100.125 / 30,
      lawType: 'saudi',
      reason: 'resignation',
      minorUnits: 2,
    });
    assert.equal(two.baseGratuity, 150.19);
    assert.equal(two.gratuityAmount, 50.06);
  }

  // --- KWD leave encashment: 10 days at 100.125 / 30 ---
  {
    const amount = calculateLeaveEncashment(10, 100.125 / 30, 3);
    assert.equal(amount, 33.375, '10 * 3.3375 = 33.375 exactly at 3dp');
    assert.ok(wholeFils(amount), 'encashment is a whole number of fils');
  }

  // --- KWD absorption: entitlements and deductions sum exactly ---
  {
    const res = calculateSettlementAbsorption({
      gratuityAmount: 50.063,
      leaveEncashmentAmount: 33.375,
      pendingSalaryAmount: 20.005,
      noticePeriodAmount: 0,
      otherEntitlementsAmount: 0,
      unpaidLoansDeduction: 10.005,
      assetsDeduction: 3.338,
      otherDeductions: 1.001,
      minorUnits: 3,
    });
    assert.equal(res.totalEntitlements, 103.443);
    assert.equal(res.totalDeductions, 14.344);
    assert.equal(res.netPayable, 89.099);
    assert.equal(res.appliedLoans, 10.005);
    assert.equal(res.unabsorbedLoans, 0);

    // Over-claim is absorbed, never negative: the excess is tracked, not lost.
    const over = calculateSettlementAbsorption({
      gratuityAmount: 50.063,
      leaveEncashmentAmount: 33.375,
      pendingSalaryAmount: 20.005,
      noticePeriodAmount: 0,
      otherEntitlementsAmount: 0,
      unpaidLoansDeduction: 0,
      assetsDeduction: 200,
      otherDeductions: 0,
      minorUnits: 3,
    });
    assert.equal(over.netPayable, 0);
    assert.equal(over.appliedAssets, 103.443);
    assert.equal(over.unabsorbedAssets, 96.557);
  }

  // --- Migration 0266: the settlement columns survive Postgres at 3dp ---
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      await sql`
      CREATE TABLE hr_end_of_service_settlements (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        last_basic_salary NUMERIC(15, 2),
        last_total_salary NUMERIC(15, 2),
        gratuity_amount NUMERIC(15, 2),
        leave_encashment_amount NUMERIC(15, 2),
        pending_salary_amount NUMERIC(15, 2),
        notice_period_amount NUMERIC(15, 2),
        other_entitlements_amount NUMERIC(15, 2),
        unpaid_loans_deduction NUMERIC(15, 2),
        assets_deduction NUMERIC(15, 2),
        other_deductions NUMERIC(15, 2),
        net_settlement_amount NUMERIC(15, 2)
      )
    `.execute(db);
      await sql`
      INSERT INTO hr_end_of_service_settlements (tenant_id, gratuity_amount, net_settlement_amount)
      VALUES (1, 50.063, 89.099)
    `.execute(db);
      const before = await sql<{ gratuity_amount: string }>`
      SELECT gratuity_amount FROM hr_end_of_service_settlements LIMIT 1
    `.execute(db);
      assert.equal(Number(before.rows[0].gratuity_amount), 50.06, 'old 2dp column rounds 50.063 to 50.06');

      await eosPrecisionMigrationUp(db as any);

      const scales = await sql<{ column_name: string; numeric_scale: number }>`
      SELECT column_name, numeric_scale FROM information_schema.columns
      WHERE table_name = 'hr_end_of_service_settlements'
        AND column_name IN ('gratuity_amount', 'net_settlement_amount')
    `.execute(db);
      for (const row of scales.rows) assert.equal(Number(row.numeric_scale), 3, `${row.column_name} is scale 3`);

      await sql`
      INSERT INTO hr_end_of_service_settlements (tenant_id, gratuity_amount, net_settlement_amount)
      VALUES (1, 50.063, 89.099)
    `.execute(db);
      const after = await sql<{ gratuity_amount: string; net_settlement_amount: string }>`
      SELECT gratuity_amount, net_settlement_amount FROM hr_end_of_service_settlements ORDER BY id DESC LIMIT 1
    `.execute(db);
      assert.equal(Number(after.rows[0].gratuity_amount), 50.063);
      assert.equal(Number(after.rows[0].net_settlement_amount), 89.099);
    } finally {
      await db.destroy();
    }
  }
}

main().then(
  () => {
    console.log('eos-book-precision.spec: ok');
    process.exit(0);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
