/*
 * New file: backend/test/critical/sale-edit-payload-contract.spec.ts
 *
 * WHAT THIS PINS (INV-SALE-EDIT-NO-PAIDAMOUNT): PUT /api/sales/:id takes
 * UpsertSaleDto, which has NO paidAmount, subTotal, taxAmount or total
 * field, and the global requestValidationPipe runs with whitelist +
 * forbidNonWhitelisted — so ANY payload carrying one of those keys is
 * rejected with 400 VALIDATION_ERROR before updateSale ever runs. Live
 * trial 2026-11-15, tenant muse2, invoice Z-261115-16456 (60.00, card):
 * the user changed the payment channel card -> cash in the edit dialog,
 * entered the manager code himself, clicked save — rejected TWICE with
 * "الحقل paidAmount غير مسموح إرساله." The code was accepted; the
 * invoice stayed unchanged (Visa / K-NET, 60.00).
 *
 * The frontend builder (frontend/src/features/sales/contracts.ts,
 * buildSaleUpdatePayload) used to emit all four keys on EVERY save
 * (paidAmount hardcoded to 0, totals recomputed client-side), so ANY
 * invoice edit failed this way, not just payment-channel changes.
 * updateSale never reads those four: it derives paidAmount from the
 * tender allocation and recomputes totals server-side.
 *
 * THIS SPEC PINS EXISTING BEHAVIOUR — it passes before and after the
 * frontend fix, because the backend contract does not change. The
 * RED/GREEN proof of the FIX itself is the frontend spec
 * (frontend/src/features/sales/contracts.spec.ts), proven in CI
 * (ci-full.yml `frontend` job, `npm run test:run`). What this spec
 * proves, locally runnable with no DB (pure validation, no PGlite):
 * (a) the exact payload the OLD builder emitted is rejected by the REAL
 *     global pipe with the EXACT live message;
 * (b) each of the four forbidden fields alone is rejected with its own
 *     "غير مسموح إرساله" message;
 * (c) the same payload WITHOUT those four keys passes the pipe and the
 *     edited fields survive (paymentChannel 'cash', discount, items);
 * (d) the DTO declares none of the four properties.
 *
 * Wired into `npm run test:critical` via backend/scripts/
 * critical-specs.json AND the test:critical:serial chain in
 * backend/package.json (run-critical.mjs refuses to run on drift
 * between the two, so both copies list this file).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { UpsertSaleDto } from '../../src/modules/sales/dto/upsert-sale.dto';
import { requestValidationPipe } from '../../src/common/pipes/request-validation.pipe';

// The payload the FIXED frontend builder emits for the live trial edit:
// invoice Z-261115-16456, 60.00, payment channel card -> cash.
function buildCleanPayload(): Record<string, unknown> {
  return {
    customerId: null,
    paymentType: 'cash',
    paymentChannel: 'cash',
    discount: 0,
    note: '',
    editReason: 'تغيير طريقة الدفع',
    managerPin: '1234',
    storeCreditUsed: 0,
    taxRate: 0,
    pricesIncludeTax: false,
    branchId: null,
    locationId: null,
    items: [{ productId: 7, qty: 1, unitName: 'قطعة', unitMultiplier: 1, price: 60, priceType: 'retail' }],
  };
}

// The payload the OLD builder emitted: the clean payload PLUS the four
// keys UpsertSaleDto never declared.
function buildOldPayload(): Record<string, unknown> {
  return {
    ...buildCleanPayload(),
    paidAmount: 0,
    subTotal: 60,
    taxAmount: 0,
    total: 60,
  };
}

function getResponse(err: unknown): { message?: unknown; code?: string } {
  assert.ok(err instanceof BadRequestException, 'the rejection must be a BadRequestException');
  return (err as BadRequestException).getResponse() as { message?: unknown; code?: string };
}

async function main(): Promise<void> {
  // (a) The old builder payload is rejected with the EXACT live message.
  {
    await assert.rejects(
      () =>
        requestValidationPipe.transform(buildOldPayload(), {
          type: 'body',
          metatype: UpsertSaleDto,
        }),
      (err: unknown) => {
        const response = getResponse(err);
        assert.equal(response.code, 'VALIDATION_ERROR', 'the rejection carries code VALIDATION_ERROR');
        assert.equal(
          response.message,
          'الحقل paidAmount غير مسموح إرساله.',
          'the first reported error is the live trial message, verbatim',
        );
        return true;
      },
      'the pipe must refuse the old builder payload',
    );
    console.log('  (a) old builder payload rejected with the exact live message passed');
  }

  // (b) Each forbidden field alone is rejected with its own message.
  for (const field of ['paidAmount', 'subTotal', 'taxAmount', 'total'] as const) {
    const value = field === 'paidAmount' || field === 'taxAmount' ? 0 : 60;
    await assert.rejects(
      () =>
        requestValidationPipe.transform(
          { ...buildCleanPayload(), [field]: value },
          { type: 'body', metatype: UpsertSaleDto },
        ),
      (err: unknown) => {
        const response = getResponse(err);
        assert.equal(response.code, 'VALIDATION_ERROR', `${field}: code VALIDATION_ERROR`);
        assert.equal(
          response.message,
          `الحقل ${field} غير مسموح إرساله.`,
          `${field}: rejected with its own not-allowed message`,
        );
        return true;
      },
      `the pipe must refuse a payload carrying ${field} alone`,
    );
    console.log(`  (b) ${field} alone rejected passed`);
  }

  // (c) The same payload WITHOUT the four keys passes and keeps the edit.
  {
    const transformed = (await requestValidationPipe.transform(buildCleanPayload(), {
      type: 'body',
      metatype: UpsertSaleDto,
    })) as unknown as Record<string, unknown>;
    assert.ok(transformed instanceof UpsertSaleDto, 'the clean payload transforms into UpsertSaleDto');
    assert.equal(transformed.paymentChannel, 'cash', 'the edited channel card -> cash survives the pipe');
    assert.equal(transformed.paymentType, 'cash', 'the payment type survives the pipe');
    assert.equal(transformed.discount, 0, 'the discount survives the pipe');
    assert.equal(transformed.editReason, 'تغيير طريقة الدفع', 'the edit reason survives the pipe');
    assert.equal(transformed.managerPin, '1234', 'the manager PIN survives the pipe');
    assert.equal(
      (transformed.items as unknown as Array<Record<string, unknown>>).length,
      1,
      'the edited items survive the pipe',
    );
    assert.equal(
      (transformed.items as unknown as Array<Record<string, unknown>>)[0]?.productId,
      7,
      'the item product survives the pipe',
    );
    for (const field of ['paidAmount', 'subTotal', 'taxAmount', 'total']) {
      assert.equal(field in transformed, false, `no ${field} key reaches the service`);
    }
    console.log('  (c) clean payload passes the pipe with the edit intact passed');
  }

  // (d) Source pin: the DTO declares none of the four properties.
  {
    const dtoSource = readFileSync(resolve(__dirname, '../../src/modules/sales/dto/upsert-sale.dto.ts'), 'utf8');
    for (const field of ['paidAmount', 'subTotal', 'taxAmount', 'total']) {
      assert.equal(
        new RegExp(`^\\s*${field}\\s*[?:!]`, 'm').test(dtoSource),
        false,
        `UpsertSaleDto declares no ${field} property to whitelist`,
      );
    }
    console.log('  (d) DTO declares none of the four fields passed');
  }

  console.log('Sale edit payload contract tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
