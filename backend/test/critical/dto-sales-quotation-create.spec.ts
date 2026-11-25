/*
 * New file: backend/test/critical/dto-sales-quotation-create.spec.ts
 *
 * WHAT THIS PINS (INV-DTO-SALES-QUOTATION-CREATE, Package C): the sales
 * POST /api/quotations create route now takes a DTO CLASS
 * (CreateQuotationDto), so the real global requestValidationPipe
 * validates and whitelists it. Before Package C it took the sales
 * CreateQuotationDto INTERFACE — and the pipe does nothing for an
 * interface, so any extra field (or a wrong-typed field) reached the
 * service untouched. The create site was ALSO invisible to the census:
 * the census classifier's declaration index is first-seen-wins, so the
 * site resolved to the import-sales CreateQuotationDto CLASS (a
 * different shape) and was counted dto-class. Package C fixes the
 * script (per-import declaration resolution) so the site is counted
 * dto-interface, then converts it.
 *
 * WHAT IS DRIVEN (the real global pipe from main.ts — no mocks, no
 * booted app; the pipe instance driven here IS the global one):
 * (a) a positive case with the REAL caller payload — the exact shape
 * CreateQuotationPage.handleSubmit sends (frontend/src/features/sales/
 * pages/CreateQuotationPage.tsx:422-464, via quotations.api.ts POST
 * /api/quotations), which must pass the pipe with every field intact,
 * and (b) negative cases: an extra field the caller never sends is
 * rejected with 400 VALIDATION_ERROR, and a wrong-typed field is
 * rejected the same way.
 *
 * CALLER TRAPS PINNED HERE (found during Package C caller verification):
 * - tax_rate / tax_amount per item: the caller ALWAYS sends them
 *   (Number(item.tax_rate) || 0 / Number(item.tax_amount) || 0) and the
 *   service NEVER reads them (it inserts product_id, product_name,
 *   unit_name, quantity, unit_price, discount, total, notes only).
 *   They are optional fields on QuotationItemDto — without them the
 *   nested forbidNonWhitelisted check would 400 every real create call.
 * - productId: new items start at productId 0 and the payload maps it
 *   to undefined (item.productId || undefined), so the caller CAN send
 *   an item without productId — but quotation_items.product_id is
 *   integer NOT NULL (migration 2040000000021), so such an item fails
 *   at the DB today (500). QuotationItemDto keeps productId required
 *   (@IsInt @Min(1)): the pipe turns the 500 into a clean 400.
 * - Totals are clamped >= 0 in the caller (lineNet / netTaxable via
 *   Math.max(0, ...)), so @Min(0) on the money fields is safe.
 * - branchId is never sent by the caller (stays optional); status is
 *   only 'draft' | 'sent' at creation ('accepted' is the customer's
 *   response, 'converted' is set by convertToSale — both rejected).
 *
 * NOT DRIVEN: a live HTTP request through Nest (needs a booted app);
 * the quotations service itself (its throws stay the backstop); the
 * frontend page (untouched).
 *
 * Fail-first: this spec is new in Package C — on the unpatched tree
 * CreateQuotationDto is an interface, so the import-as-value fails to
 * compile and the spec exits 1 (see the log). GREEN means the pipe
 * accepts every real caller payload below and rejects every
 * extra/wrong-typed field.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { BadRequestException } from '@nestjs/common';
import { requestValidationPipe } from '../../src/common/pipes/request-validation.pipe';
import { CreateQuotationDto, QuotationItemDto } from '../../src/modules/sales/dto/quotation.dto';

function isValidationError(err: unknown): boolean {
  return err instanceof BadRequestException && (err.getResponse() as { code?: string }).code === 'VALIDATION_ERROR';
}

async function pipeOk<T>(Dto: new () => T, payload: unknown): Promise<T> {
  return (await requestValidationPipe.transform(payload, { type: 'body', metatype: Dto })) as T;
}

async function pipeRejects(Dto: new () => unknown, payload: unknown, why: string): Promise<void> {
  await assert.rejects(
    () => requestValidationPipe.transform(payload, { type: 'body', metatype: Dto }),
    isValidationError,
    why,
  );
}

/** The exact shape CreateQuotationPage.handleSubmit sends (approve path). */
function realCallerPayload(): Record<string, unknown> {
  return {
    customerId: 42,
    customerName: 'عميل تجريبي',
    customerPhone: '01012345678',
    customerAddress: 'القاهرة',
    validUntil: '2026-12-10',
    status: 'sent',
    subtotal: 1000,
    discountAmount: 50,
    taxAmount: 133,
    totalAmount: 1083,
    notes: 'ملاحظة',
    termsConditions: 'شروط',
    items: [
      {
        productId: 7,
        productName: 'صنف تجريبي',
        unitName: 'قطعة',
        quantity: 2,
        unitPrice: 500,
        discount: 50,
        tax_rate: 14,
        tax_amount: 133,
        total: 1083,
        notes: 'بند',
      },
    ],
  };
}

async function main(): Promise<void> {
  // 1. Positive: the real caller payload (approve-and-save, 'sent').
  {
    const transformed = await pipeOk(CreateQuotationDto, realCallerPayload());
    assert.ok(transformed instanceof CreateQuotationDto, 'the payload transforms into a CreateQuotationDto');
    assert.equal(transformed.customerName, 'عميل تجريبي', 'the customer name survives the pipe');
    assert.equal(transformed.status, 'sent', 'the creation status survives the pipe');
    assert.equal(transformed.totalAmount, 1083, 'the money total survives the pipe');
    assert.equal(transformed.items.length, 1, 'the items survive the pipe');
    assert.ok(transformed.items[0] instanceof QuotationItemDto, 'nested items transform into QuotationItemDto');
    assert.equal(transformed.items[0].productId, 7, 'the item product id survives the pipe');
    assert.equal(
      (transformed.items[0] as unknown as Record<string, unknown>).tax_rate,
      14,
      'the caller-sent per-item tax_rate survives the pipe (it is whitelisted, not rejected)',
    );
    assert.equal(
      (transformed.items[0] as unknown as Record<string, unknown>).tax_amount,
      133,
      'the caller-sent per-item tax_amount survives the pipe (it is whitelisted, not rejected)',
    );
    console.log('  (1) CreateQuotationDto: real caller payload passes, tax fields whitelisted passed');
  }

  // 2. Positive: minimal draft — required fields only. Pins that every
  // optional field (customerId, phone, branchId, discount/tax amounts,
  // validUntil, notes, terms, per-item tax fields) is truly optional.
  {
    const transformed = await pipeOk(CreateQuotationDto, {
      customerName: 'عميل نقدي',
      subtotal: 200,
      totalAmount: 200,
      items: [{ productId: 3, productName: 'صنف', quantity: 1, unitPrice: 200, total: 200 }],
    });
    assert.equal(transformed.customerName, 'عميل نقدي', 'a minimal draft passes the pipe');
    assert.equal(transformed.status, undefined, 'status stays undefined when the caller omits it');
    assert.equal(transformed.items.length, 1, 'a minimal item list passes the pipe');
    console.log('  (2) CreateQuotationDto: minimal draft payload passes passed');
  }

  // 3. Negative: an extra top-level field the caller never sends.
  {
    await pipeRejects(
      CreateQuotationDto,
      { ...realCallerPayload(), isAdmin: true },
      'an extra admin flag must be rejected on quotation create',
    );
    console.log('  (3) CreateQuotationDto: extra top-level field rejected passed');
  }

  // 4. Negative: an extra field on an item the caller never sends.
  {
    const payload = realCallerPayload();
    (payload.items as Array<Record<string, unknown>>)[0].internalCode = 'X';
    await pipeRejects(CreateQuotationDto, payload, 'an extra per-item field must be rejected on quotation create');
    console.log('  (4) CreateQuotationDto: extra per-item field rejected passed');
  }

  // 5. Negative: a wrong-typed money field (non-numeric string).
  {
    await pipeRejects(
      CreateQuotationDto,
      { ...realCallerPayload(), subtotal: 'not-a-number' },
      'a non-numeric subtotal must be rejected on quotation create',
    );
    console.log('  (5) CreateQuotationDto: wrong-typed subtotal rejected passed');
  }

  // 6. Negative: 'accepted' is the customer's response, never a
  // creation status — the service whitelist fails closed to 'draft',
  // and the DTO narrows creation to 'draft' | 'sent'.
  {
    await pipeRejects(
      CreateQuotationDto,
      { ...realCallerPayload(), status: 'accepted' },
      "an 'accepted' creation status must be rejected on quotation create",
    );
    console.log('  (6) CreateQuotationDto: accepted creation status rejected passed');
  }

  // 7. Negative: an item without productId. The caller maps productId 0
  // to undefined, but quotation_items.product_id is integer NOT NULL
  // (migration 2040000000021) — such an item fails at the DB today
  // (500); the pipe turns it into a clean 400.
  {
    const payload = realCallerPayload();
    delete (payload.items as Array<Record<string, unknown>>)[0].productId;
    await pipeRejects(
      CreateQuotationDto,
      payload,
      'an item without productId must be rejected on quotation create (DB column is NOT NULL)',
    );
    console.log('  (7) CreateQuotationDto: item without productId rejected passed');
  }

  // 8. Negative: an empty items list — the caller requires at least one
  // valid item (toast error otherwise) and the DTO pins ArrayMinSize(1).
  {
    await pipeRejects(
      CreateQuotationDto,
      { ...realCallerPayload(), items: [] },
      'an empty items list must be rejected on quotation create',
    );
    console.log('  (8) CreateQuotationDto: empty items list rejected passed');
  }

  console.log('dto sales quotation create tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
