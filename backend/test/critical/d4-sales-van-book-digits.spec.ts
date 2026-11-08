/*
 * Pins D4 (unification batch U2): sales + van money computation rounds
 * at the tenant's book digits instead of a hardcoded toFixed(2).
 *
 * WHAT THIS PINS (drives the real code, no copies of the rounding math):
 * - PriceListsService.calculateEffectivePrice over PGlite: on a KWD
 *   tenant a 10% discount on a 111.25 base answers effectivePrice
 *   100.125 (old code: 100.13), through both the per-item discount
 *   rule and the list default-discount rule; on an EGP tenant the
 *   same setup still answers 100.13, so 2dp behaviour is identical.
 * - The pure van governance engine at 3 digits: a damaged swap of one
 *   unit at 100.125 values at 100.125 (old code: 100.13); a linked
 *   field return of one unit at 100.125 totals 100.125 with the net
 *   unit cap itself at 100.125; a routine fuel expense of 100.125
 *   projects 100.125; a credit-limit check on a 100.125 balance
 *   with a 0.005 request projects 100.13 at 3 digits (old code:
 *   100.14). At 2 digits every one of those answers the old 2dp value.
 *
 * Deliberately NOT pinned here: loyalty-points balances in
 * sales-write.service.ts, whose toFixed(2) sites are a points unit,
 * not money, and are left as-is; and display-only template strings
 * (sale notes, settlement summaries), which format already-stored
 * values and are not computation.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { PriceListsService } from '../../src/modules/sales/services/price-lists.service';
import {
  evaluateCreditLimitCheck,
  evaluateDamagedSwap,
  evaluateFieldReturnGovernance,
  evaluateTripExpenseGovernance,
} from '../../src/modules/delivery-reps/van-trip-reconciliation.engine';

const KWD_AUTH = {
  tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin',
  permissions: ['sales'],
} as unknown as AuthContext;

const KWD_AUTH_2 = {
  tenantId: 't2', accountId: 'a1', role: 'admin', userId: 1, username: 'admin',
  permissions: ['sales'],
} as unknown as AuthContext;

const EGP_AUTH = {
  tenantId: 't3', accountId: 'a1', role: 'admin', userId: 1, username: 'admin',
  permissions: ['sales'],
} as unknown as AuthContext;

async function main(): Promise<void> {
  // Phase 1: live price-list path over PGlite (KWD vs EGP tenants).
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      await pg.exec(`
        CREATE TABLE settings (tenant_id text, key text, value text);
        CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
        CREATE TABLE price_lists (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, code text, currency text, type text, default_discount_percent numeric, is_default boolean, is_active boolean, notes text, created_at timestamptz, updated_at timestamptz);
        CREATE TABLE price_list_items (id bigint PRIMARY KEY, tenant_id text, account_id text, price_list_id bigint, product_id bigint, product_name text, category_id bigint, min_quantity numeric, fixed_price numeric, discount_percent numeric, created_at timestamptz);
        INSERT INTO settings VALUES ('t1', 'currency', 'KWD'), ('t2', 'currency', 'KWD'), ('t3', 'currency', 'EGP');
        INSERT INTO currency_exchange_rates VALUES ('t1', 'KWD', true, 1), ('t2', 'KWD', true, 1), ('t3', 'EGP', true, 1);
        INSERT INTO price_lists VALUES (1, 't1', 'a1', 'KWD list', 'KWD1', 'KWD', 'percentage', NULL, true, true, NULL, NOW(), NOW());
        INSERT INTO price_lists VALUES (2, 't2', 'a1', 'KWD default list', 'KWD2', 'KWD', 'percentage', 10, true, true, NULL, NOW(), NOW());
        INSERT INTO price_lists VALUES (3, 't3', 'a1', 'EGP list', 'EGP1', 'EGP', 'percentage', NULL, true, true, NULL, NOW(), NOW());
        INSERT INTO price_list_items VALUES (1, 't1', 'a1', 1, 10, NULL, NULL, 1, NULL, 10, NOW());
        INSERT INTO price_list_items VALUES (2, 't3', 'a1', 3, 10, NULL, NULL, 1, NULL, 10, NOW());
      `);
      const service = new PriceListsService(db as never);

      // Per-item discount rule, KWD: 111.25 less 10% is exactly 100.125.
      const kwdItem = await service.calculateEffectivePrice(KWD_AUTH, null, 10, 1, 111.25);
      assert.equal(kwdItem.effectivePrice, 100.125);
      assert.equal(kwdItem.appliedRule, 'product_discount');
      console.log('d4-sales-van-book-digits: phase 1a (price list, KWD item rule) OK');

      // List default-discount rule, KWD: same 100.125, no item row.
      const kwdDefault = await service.calculateEffectivePrice(KWD_AUTH_2, null, 10, 1, 111.25);
      assert.equal(kwdDefault.effectivePrice, 100.125);
      assert.equal(kwdDefault.appliedRule, 'list_default_discount');
      console.log('d4-sales-van-book-digits: phase 1b (price list, KWD default rule) OK');

      // Same setup, EGP tenant: 2dp behaviour is identical (100.13).
      const egpItem = await service.calculateEffectivePrice(EGP_AUTH, null, 10, 1, 111.25);
      assert.equal(egpItem.effectivePrice, 100.13);
      assert.equal(egpItem.appliedRule, 'product_discount');
      console.log('d4-sales-van-book-digits: phase 1c (price list, EGP unchanged) OK');
    } finally {
      await db.destroy();
    }
  }

  // Phase 2: pure van governance engine at 3 vs 2 digits.
  {
    const swap3 = evaluateDamagedSwap({
      moneyDigits: 3,
      damagedProductId: 10,
      damagedQty: 1,
      damagedUnitPrice: 100.125,
      damageReason: 'كسر أثناء التوزيع',
      replacementProductId: 11,
      replacementQty: 1,
      replacementUnitPrice: 100.125,
      availableVanStockQty: 5,
    });
    assert.equal(swap3.allowed, true);
    assert.equal(swap3.damagedValue, 100.125);
    assert.equal(swap3.replacementValue, 100.125);
    assert.equal(swap3.priceDifference, 0);
    const swap2 = evaluateDamagedSwap({
      moneyDigits: 2,
      damagedProductId: 10,
      damagedQty: 1,
      damagedUnitPrice: 100.125,
      damageReason: 'كسر أثناء التوزيع',
      replacementProductId: 11,
      replacementQty: 1,
      replacementUnitPrice: 100.125,
      availableVanStockQty: 5,
    });
    assert.equal(swap2.damagedValue, 100.13);
    assert.equal(swap2.replacementValue, 100.13);
    console.log('d4-sales-van-book-digits: phase 2a (damaged swap) OK');

    const return3 = evaluateFieldReturnGovernance({
      moneyDigits: 3,
      repId: 7,
      customerId: 9,
      items: [{ productId: 10, qty: 1, unitPrice: 100.125, saleItemId: 1 }],
      linkedSale: {
        saleId: 55,
        customerId: 9,
        items: [{ saleItemId: 1, productId: 10, soldQty: 2, unitPrice: 100.125, lineTotal: 200.25, alreadyReturnedQty: 0 }],
      },
    });
    assert.equal(return3.allowed, true);
    assert.equal(return3.totalAmount, 100.125);
    const return2 = evaluateFieldReturnGovernance({
      moneyDigits: 2,
      repId: 7,
      customerId: 9,
      items: [{ productId: 10, qty: 1, unitPrice: 100.125, saleItemId: 1 }],
      linkedSale: {
        saleId: 55,
        customerId: 9,
        items: [{ saleItemId: 1, productId: 10, soldQty: 2, unitPrice: 100.125, lineTotal: 200.25, alreadyReturnedQty: 0 }],
      },
    });
    assert.equal(return2.allowed, true);
    assert.equal(return2.totalAmount, 100.13);
    console.log('d4-sales-van-book-digits: phase 2b (field return) OK');

    const expense3 = evaluateTripExpenseGovernance({
      moneyDigits: 3,
      expenseType: 'fuel',
      amount: 100.125,
      notes: 'وقود',
      existingTripExpenses: 0,
    });
    assert.equal(expense3.allowed, true);
    assert.equal(expense3.projectedTripExpenses, 100.125);
    const expense2 = evaluateTripExpenseGovernance({
      moneyDigits: 2,
      expenseType: 'fuel',
      amount: 100.125,
      notes: 'وقود',
      existingTripExpenses: 0,
    });
    assert.equal(expense2.allowed, true);
    assert.equal(expense2.projectedTripExpenses, 100.13);
    console.log('d4-sales-van-book-digits: phase 2c (trip expense) OK');

    const credit3 = evaluateCreditLimitCheck({
      moneyDigits: 3,
      customerId: 9,
      customerName: 'عميل اختبار',
      currentBalance: 100.125,
      creditLimit: 200,
      isCreditBlocked: false,
      requestedCreditAmount: 0.005,
    });
    assert.equal(credit3.allowed, true);
    assert.equal(credit3.currentBalance, 100.125);
    assert.equal(credit3.projectedBalance, 100.13);
    const credit2 = evaluateCreditLimitCheck({
      moneyDigits: 2,
      customerId: 9,
      customerName: 'عميل اختبار',
      currentBalance: 100.125,
      creditLimit: 200,
      isCreditBlocked: false,
      requestedCreditAmount: 0.005,
    });
    assert.equal(credit2.allowed, true);
    assert.equal(credit2.currentBalance, 100.13);
    assert.equal(credit2.projectedBalance, 100.14);
    console.log('d4-sales-van-book-digits: phase 2d (credit limit) OK');
  }

  console.log('d4-sales-van-book-digits: OK (22 assertions)');
}

main().catch((error) => { console.error(error); process.exit(1); });
