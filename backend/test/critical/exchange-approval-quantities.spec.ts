import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { BadRequestException } from '@nestjs/common';
import { AppError } from '../../src/common/errors/app-error';
import { requestValidationPipe } from '../../src/common/pipes/request-validation.pipe';
import { UpsertSaleDto } from '../../src/modules/sales/dto/upsert-sale.dto';
import { CreateSaleService, type CreateSaleDeps } from '../../src/modules/sales/services/create-sale.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
New file: backend/test/critical/exchange-approval-quantities.spec.ts
Pins INV-EXCHANGE-APPROVAL-QUANTITIES: an Instant Exchange approval
carrying negative return lines must pass the global validation pipe
and reach createSale — the pipe may NOT reject the exchange payload
with the 0.001 minimum before the service ever runs.

THE DEFECT (cashier retrial 2, finding R2-8): the Instant Exchange
dialog sends items: [...cartItems, ...negativeItems] where each
return line carries qty: -qty with originalSaleItemId and the sale
carries exchangeSaleId — but SaleItemDto.qty had @Min(0.001), so the
global pipe refused EVERY exchange approval with "الحقل أصناف الطلب
< الكمية يجب أن يكون أكبر من أو يساوي 0.001" (6 failed attempts: 3
net 0.00, 3 net 40.00 by card). The service NEEDS the negative
lines — createSale derives returnedItems from qty < 0 and throws
EXCHANGE_SOURCE_REQUIRED for negative lines without an exchange
source — but that check was unreachable because the pipe rejected
first.

THE RULE (decided, not re-decided here): a negative-qty line is
permitted ONLY for an exchange return line — the sale carries a
valid exchangeSaleId AND the line carries a valid
originalSaleItemId (positive integer). Every other negative-qty
line is still rejected by validation, and ordinary items keep the
0.001 minimum (same user-facing wording as before). The quantity
rule lives on UpsertSaleDto.items as one constraint because a
nested SaleItemDto cannot see its parent's exchangeSaleId.

WHAT THIS PINS, driving the REAL global pipe
(requestValidationPipe.transform) and the REAL CreateSaleService:
- Case A: the exact dialog payload (one new item at 40 by card +
  two return lines, qty -1 and fractional -0.5, each with a valid
  originalSaleItemId, exchangeSaleId 101) passes the pipe and the
  transformed DTO keeps the negative quantities.
- Case B: a normal sale item with negative qty is still rejected
  with VALIDATION_ERROR and the 0.001 message.
- Case C: an exchange sale whose negative line lacks
  originalSaleItemId is rejected by the pipe (the source must be
  valid, not merely claimed).
- Case D: a negative line with NO exchangeSaleId is rejected by
  the pipe with the 0.001 message.
- Case E: the service guard is reachable — a direct createSale
  call with a negative line and no exchangeSaleId throws
  EXCHANGE_SOURCE_REQUIRED (direct callers bypass the pipe, so
  the guard must still refuse instead of silently accepting).
- Case F: a direct createSale call with exchangeSaleId but a
  negative line without a valid originalSaleItemId throws
  EXCHANGE_REQUEST_INVALID.
- Case G: the magnitude rule is mirrored for both signs — qty 0
  on a normal item is rejected, and a sub-minimum negative
  exchange line (-0.0005) is rejected even with a valid source.
- Case H: the case-A payload, fed through the pipe into the real
  createSale, passes BOTH service exchange guards and enters the
  transaction (a sentinel trx throws REACHED_SERVICE at the first
  DB touch) — the approval reaches the service instead of dying
  in validation.
*/

const ADMIN = {
  tenantId: 't1',
  accountId: 'a1',
  role: 'admin',
  userId: 1,
  username: 'admin',
  permissions: [],
} as unknown as AuthContext;

/* The exact PosInstantExchangeDialog submit payload shape: the new
   cart items first, then the negative return lines (qty: -qty,
   price 0, originalSaleItemId = the source sale-item id). */
function exchangePayload(): Record<string, unknown> {
  return {
    exchangeSaleId: 101,
    exchangeRefundMethod: 'cash',
    customerId: 25,
    branchId: 1,
    source: 'pos',
    paymentType: 'cash',
    paymentChannel: 'card',
    payments: [],
    tenderedAmount: 0,
    discount: 0,
    deliveryFee: 0,
    taxRate: 0,
    pricesIncludeTax: false,
    managerPin: '2468',
    note: 'استبدال فاتورة 101',
    items: [
      {
        productId: 10,
        qty: 1,
        price: 40,
        unitName: 'قطعة',
        unitMultiplier: 1,
        priceType: 'retail',
        notes: '',
        modifiers: {},
        serials: [],
      },
      { productId: 10, originalSaleItemId: 77, qty: -1, price: 0, serials: [] },
      { productId: 11, originalSaleItemId: 78, qty: -0.5, price: 0, serials: [] },
    ],
  };
}

function normalPayload(): Record<string, unknown> {
  return {
    customerId: 25,
    branchId: 1,
    source: 'pos',
    paymentType: 'cash',
    paymentChannel: 'cash',
    items: [
      { productId: 10, qty: 1, price: 40, unitName: 'قطعة', unitMultiplier: 1, priceType: 'retail', serials: [] },
    ],
  };
}

async function pipeTransform(payload: unknown): Promise<UpsertSaleDto> {
  return (await requestValidationPipe.transform(payload, { type: 'body', metatype: UpsertSaleDto })) as UpsertSaleDto;
}

async function expectPipeReject(payload: unknown, messagePart: string, label: string): Promise<void> {
  let caught: unknown;
  try {
    await pipeTransform(payload);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof BadRequestException, `${label}: the pipe must reject`);
  const response = caught.getResponse() as { code?: string; message?: string };
  assert.equal(response.code, 'VALIDATION_ERROR', `${label}: code must be VALIDATION_ERROR`);
  assert.ok(
    String(response.message).includes(messagePart),
    `${label}: message must mention "${messagePart}", got: ${response.message}`,
  );
}

async function expectServiceCode(promise: Promise<unknown>, code: string, label: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof AppError, `${label}: the service must throw AppError, got ${String(caught)}`);
  assert.equal((caught as AppError).code, code, `${label}: expected ${code}`);
}

/* A service whose transaction throws a sentinel at the first DB
   touch: the only way createSale reaches it is past BOTH exchange
   guards, so the sentinel proves the payload entered the service
   instead of being refused by a guard. No other dep is touched
   before that point (no idempotency store, no online order). */
function buildGuardProbingService(): CreateSaleService {
  const sentinelTrx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return undefined;
        return () => {
          throw new Error('REACHED_SERVICE');
        };
      },
    },
  );
  const deps = {
    tx: { runInTransaction: async (_db: unknown, cb: (trx: unknown) => Promise<unknown>) => cb(sentinelTrx) },
  } as unknown as CreateSaleDeps;
  return new CreateSaleService(deps);
}

function buildBareService(): CreateSaleService {
  return new CreateSaleService({} as unknown as CreateSaleDeps);
}

async function main(): Promise<void> {
  // Case A — the exact dialog payload passes the pipe; the
  // transformed DTO keeps the negative return quantities.
  {
    const dto = await pipeTransform(exchangePayload());
    assert.equal(dto.exchangeSaleId, 101);
    assert.equal(dto.items.length, 3);
    assert.equal(dto.items[0].qty, 1);
    assert.equal(dto.items[1].qty, -1);
    assert.equal(dto.items[1].originalSaleItemId, 77);
    assert.equal(dto.items[2].qty, -0.5);
    assert.equal(dto.items[2].originalSaleItemId, 78);
    console.log('  (A) exchange approval payload passes validation with negative return lines passed');
  }

  // Case B — a normal sale item with negative qty is still
  // rejected with the 0.001 message.
  {
    const payload = normalPayload();
    (payload.items as Array<Record<string, unknown>>)[0].qty = -2;
    await expectPipeReject(payload, '0.001', 'case B (normal negative qty)');
    console.log('  (B) normal sale with negative qty still rejected with the 0.001 minimum passed');
  }

  // Case C — exchangeSaleId present but the negative line has no
  // originalSaleItemId: rejected by the pipe, the source must be
  // valid, not merely claimed.
  {
    const payload = exchangePayload();
    delete (payload.items as Array<Record<string, unknown>>)[1].originalSaleItemId;
    await expectPipeReject(payload, 'فاتورة أصلية', 'case C (negative line without originalSaleItemId)');
    console.log('  (C) exchange negative line without originalSaleItemId rejected passed');
  }

  // Case D — a negative line with NO exchangeSaleId is rejected
  // by the pipe with the 0.001 message.
  {
    const payload = normalPayload();
    (payload.items as Array<Record<string, unknown>>).push({ productId: 10, qty: -1, price: 0, serials: [] });
    await expectPipeReject(payload, '0.001', 'case D (negative line without exchangeSaleId)');
    console.log('  (D) negative line without exchangeSaleId rejected passed');
  }

  // Case E — the service guard is reachable: a direct createSale
  // call with a negative line and no exchangeSaleId throws
  // EXCHANGE_SOURCE_REQUIRED instead of silently accepting.
  {
    const service = buildBareService();
    const payload = normalPayload() as unknown as UpsertSaleDto;
    (payload.items as unknown as Array<Record<string, unknown>>).push({
      productId: 10,
      qty: -1,
      price: 0,
      serials: [],
    });
    await expectServiceCode(service.createSale(payload, ADMIN), 'EXCHANGE_SOURCE_REQUIRED', 'case E');
    console.log('  (E) service refuses negative lines without an exchange source passed');
  }

  // Case F — a direct createSale call with exchangeSaleId but a
  // negative line without a valid originalSaleItemId throws
  // EXCHANGE_REQUEST_INVALID.
  {
    const service = buildBareService();
    const payload = exchangePayload() as unknown as UpsertSaleDto;
    delete (payload.items as unknown as Array<Record<string, unknown>>)[1].originalSaleItemId;
    await expectServiceCode(service.createSale(payload, ADMIN), 'EXCHANGE_REQUEST_INVALID', 'case F');
    console.log('  (F) service refuses exchange lines without a valid original item passed');
  }

  // Case G — the magnitude rule is mirrored for both signs: qty 0
  // on a normal item is rejected, and a sub-minimum negative
  // exchange line is rejected even with a valid source.
  {
    const zero = normalPayload();
    (zero.items as Array<Record<string, unknown>>)[0].qty = 0;
    await expectPipeReject(zero, '0.001', 'case G (zero qty)');
    const tiny = exchangePayload();
    (tiny.items as Array<Record<string, unknown>>)[1].qty = -0.0005;
    await expectPipeReject(tiny, '0.001', 'case G (sub-minimum negative exchange qty)');
    console.log('  (G) zero and sub-minimum quantities rejected passed');
  }

  // Case H — the case-A payload, fed through the pipe into the
  // real createSale, passes both exchange guards and enters the
  // transaction (sentinel at the first DB touch).
  {
    const dto = await pipeTransform(exchangePayload());
    const service = buildGuardProbingService();
    let caught: unknown;
    try {
      await service.createSale(dto, ADMIN);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught instanceof Error, 'case H: createSale must reach the transaction');
    assert.equal(
      (caught as Error).message,
      'REACHED_SERVICE',
      `case H: expected the sentinel, got ${(caught as Error).message}`,
    );
    console.log('  (H) exchange approval reaches the service past both guards passed');
  }

  console.log('Exchange approval quantity tests passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
