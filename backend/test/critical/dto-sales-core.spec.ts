/*
 * New file: backend/test/critical/dto-sales-core.spec.ts
 *
 * WHAT THIS PINS (INV-DTO-SALES-CORE, D5): the 10 sales-core
 * controller routes (POS terminal charge / test-connection /
 * bridge poll+callback, kitchen-printer print, price-list
 * create/update/calculate, discount-authorization, sale cancel)
 * now take DTO classes, so the real global
 * requestValidationPipe validates and whitelists them. Before D5
 * they took inline object types or a named interface
 * (TerminalPaymentRequest) — and the pipe does nothing for an
 * inline type or an interface, so any extra field (or a
 * wrong-typed field) reached the service untouched.
 *
 * WHAT IS DRIVEN (the real global pipe from main.ts — no mocks, no
 * booted app; the pipe instance driven here IS the global one):
 * for EACH DTO, (a) a positive case with the REAL caller payload
 * (the exact shape the frontend api file — or, for the bridge
 * endpoints, the C# hardware bridge — sends; see the per-case
 * comments for the caller file), which must pass the pipe with
 * every field intact, and (b) two negative cases: an extra field
 * the caller never sends is rejected with 400 VALIDATION_ERROR,
 * and a wrong-typed field is rejected the same way. Money
 * endpoints (charge) get their positive case with the REAL caller
 * payload.
 *
 * CALLER TRAPS PINNED HERE (found during D5 caller verification):
 * - TerminalPaymentRequestDto.cashierShiftId: the interface
 *   declares it (string | number) but NO caller sends it and the
 *   service never reads it. The DTO declares it a plain optional
 *   string — and a number DOES coerce to a string under
 *   enableImplicitConversion once the field is a plain string
 *   (pinned below). The union type was the trap: implicit
 *   conversion cannot coerce a union-typed field, so the old
 *   declaration would have rejected a numeric value.
 * - BridgeCallbackDto: the C# bridge ALWAYS sends all eight
 *   fields, with "" fallbacks for authCode / cardLastFour /
 *   message and "declined" for status
 *   (tools/z-systems-bridge/Program.cs:358-369). The DTO has no
 *   MinLength anywhere — an empty string is a legitimate bridge
 *   value, pinned by the declined-callback case.
 * - UpsertPriceListDto.code: the interface declares it required
 *   but the service falls back to the name
 *   (price-lists.service.ts:117). It stays optional; a create
 *   without a code passes the pipe (pinned).
 * - UpdatePriceListDto is a SEPARATE all-optional class (the D3
 *   promotion precedent): the update service falls back to the
 *   stored row for every field, so a partial update is a
 *   legitimate service capability; one class with a required name
 *   would narrow it.
 * - CalculatePriceDto.quantity / basePrice: the controller
 *   defaults them (|| 1 / || 0), so both stay optional; a minimal
 *   { productId } body passes the pipe (pinned).
 * - AuthorizeDiscountOverrideDto.secret and CancelSaleDto fields:
 *   the controller String()s them (|| ''), so all stay optional;
 *   a numeric secret / reason coerces to a string under
 *   enableImplicitConversion (pinned — the D2 coercion precedent).
 *
 * NOT DRIVEN: a live HTTP request through Nest (needs a booted
 * app); the services themselves (their own throws stay the
 * backstop — e.g. the charge amount <= 0 throw, the sale-id
 * throw on print, the price-list name throw); the frontend
 * screens and the C# bridge (untouched).
 *
 * Fail-first: this spec is new in D5 — on the unpatched tree the
 * DTO classes do not exist, so the imports fail (MODULE_NOT_FOUND)
 * and the spec exits 1 (see the log). GREEN means the pipe
 * accepts every real caller payload and rejects every
 * extra/wrong-typed field below.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { requestValidationPipe } from '../../src/common/pipes/request-validation.pipe';
import { PrintKitchenTicketDto } from '../../src/modules/sales/dto/kitchen-printer-print.dto';
import {
  BridgeCallbackDto,
  BridgePollDto,
  TestTerminalConnectionDto,
} from '../../src/modules/sales/dto/pos-terminal.dto';
import { CalculatePriceDto } from '../../src/modules/sales/dto/price-calculate.dto';
import { AuthorizeDiscountOverrideDto, CancelSaleDto } from '../../src/modules/sales/dto/sales-misc.dto';
import { TerminalPaymentRequestDto } from '../../src/modules/sales/services/pos-terminal/pos-terminal-shared';
import { UpdatePriceListDto, UpsertPriceListDto } from '../../src/modules/sales/services/price-lists.service';

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

async function main(): Promise<void> {
  // 1. TestTerminalConnectionDto — caller: pos.api.ts
  // testTerminalConnection sends { ip, port, provider }.
  {
    const transformed = await pipeOk(TestTerminalConnectionDto, {
      ip: '192.168.1.50',
      port: 8080,
      provider: 'fawry',
    });
    assert.equal(transformed.ip, '192.168.1.50', 'the terminal IP survives the pipe');
    assert.equal(transformed.port, 8080, 'the terminal port survives the pipe');
    const empty = await pipeOk(TestTerminalConnectionDto, {});
    assert.equal(empty.ip, undefined, 'an empty body passes — the service falls back to settings');
    await pipeRejects(
      TestTerminalConnectionDto,
      { ip: '192.168.1.50', isAdmin: true },
      'an extra admin flag must be rejected on test-connection',
    );
    await pipeRejects(
      TestTerminalConnectionDto,
      { ip: '192.168.1.50', port: 'not-a-port' },
      'a non-numeric port must be rejected on test-connection',
    );
    console.log('  (1) TestTerminalConnectionDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 2. TerminalPaymentRequestDto (MONEY) — caller: pos.api.ts
  // initiateTerminalCharge sends { terminalId, amount, currency,
  // invoiceReference }. cashierShiftId is never sent and never read
  // by the service; it stays optional.
  {
    const transformed = await pipeOk(TerminalPaymentRequestDto, {
      terminalId: 'T1',
      amount: 250.5,
      currency: 'EGP',
      invoiceReference: 'INV-1001',
    });
    assert.equal(transformed.amount, 250.5, 'the charge amount survives the pipe');
    assert.equal(transformed.terminalId, 'T1', 'the terminal id survives the pipe');
    const withShift = await pipeOk(TerminalPaymentRequestDto, { amount: 100, cashierShiftId: 'SHIFT-42' });
    assert.equal(withShift.cashierShiftId, 'SHIFT-42', 'a string shift id passes the pipe');
    const coerced = await pipeOk(TerminalPaymentRequestDto, { amount: 100, cashierShiftId: 42 });
    assert.equal(coerced.cashierShiftId, '42', 'a numeric shift id coerces to a string (never read by the service)');
    await pipeRejects(
      TerminalPaymentRequestDto,
      { amount: 250.5, isAdmin: true },
      'an extra admin flag must be rejected on charge',
    );
    await pipeRejects(TerminalPaymentRequestDto, { amount: 'lots' }, 'a non-numeric amount must be rejected on charge');
    await pipeRejects(TerminalPaymentRequestDto, { terminalId: 'T1' }, 'a missing amount must be rejected on charge');
    console.log(
      '  (2) TerminalPaymentRequestDto: real caller payload passes, extra/wrong-type/missing rejected passed',
    );
  }

  // 3. BridgePollDto — caller: the C# hardware bridge
  // (tools/z-systems-bridge/Program.cs:266-277) sends
  // { tenantId, machineName, bridgeVersion }.
  {
    const transformed = await pipeOk(BridgePollDto, {
      tenantId: 'tenant-1',
      machineName: 'POS-PC-01',
      bridgeVersion: '1.2.0',
    });
    assert.equal(transformed.tenantId, 'tenant-1', 'the tenant id survives the pipe');
    assert.equal(transformed.machineName, 'POS-PC-01', 'the machine name survives the pipe');
    await pipeRejects(
      BridgePollDto,
      { tenantId: 'tenant-1', hacked: 1 },
      'an extra field must be rejected on bridge poll',
    );
    await pipeRejects(
      BridgePollDto,
      { machineName: 'POS-PC-01' },
      'a missing tenantId must be rejected on bridge poll',
    );
    console.log('  (3) BridgePollDto: real bridge payload passes, extra/missing rejected passed');
  }

  // 4. BridgeCallbackDto — caller: the C# hardware bridge
  // (tools/z-systems-bridge/Program.cs:358-369) ALWAYS sends all
  // eight fields, with "" fallbacks for authCode / cardLastFour /
  // message and "declined" for status.
  {
    const transformed = await pipeOk(BridgeCallbackDto, {
      tenantId: 'tenant-1',
      jobId: 'EDC-abc',
      status: 'approved',
      authCode: '123456',
      rrn: '123456789012',
      cardScheme: 'visa',
      cardLastFour: '4242',
      message: '',
    });
    assert.equal(transformed.status, 'approved', 'the approved status survives the pipe');
    assert.equal(transformed.authCode, '123456', 'the auth code survives the pipe');
    const declined = await pipeOk(BridgeCallbackDto, {
      tenantId: 'tenant-1',
      jobId: 'EDC-def',
      status: 'declined',
      authCode: '',
      rrn: '',
      cardScheme: 'visa',
      cardLastFour: '',
      message: '',
    });
    assert.equal(declined.message, '', 'empty-string fallbacks pass the pipe on a declined callback');
    await pipeRejects(
      BridgeCallbackDto,
      { tenantId: 'tenant-1', jobId: 'EDC-abc', status: 'approved', hacked: true },
      'an extra field must be rejected on bridge callback',
    );
    await pipeRejects(
      BridgeCallbackDto,
      { tenantId: 'tenant-1', status: 'approved' },
      'a missing jobId must be rejected on bridge callback',
    );
    console.log('  (4) BridgeCallbackDto: real bridge payload passes, extra/missing rejected passed');
  }

  // 5. PrintKitchenTicketDto — caller: kitchen-printers.api.ts
  // printTicket sends { saleId } only.
  {
    const transformed = await pipeOk(PrintKitchenTicketDto, { saleId: 123 });
    assert.equal(transformed.saleId, 123, 'the sale id survives the pipe');
    await pipeRejects(
      PrintKitchenTicketDto,
      { saleId: 123, isAdmin: true },
      'an extra admin flag must be rejected on print ticket',
    );
    await pipeRejects(PrintKitchenTicketDto, {}, 'a missing sale id must be rejected on print ticket');
    await pipeRejects(PrintKitchenTicketDto, { saleId: 0 }, 'a zero sale id must be rejected on print ticket');
    console.log('  (5) PrintKitchenTicketDto: real caller payload passes, extra/missing/zero rejected passed');
  }

  // 6. UpsertPriceListDto — caller: price-lists.api.ts create sends
  // the full payload (name + code + items).
  {
    const transformed = await pipeOk(UpsertPriceListDto, {
      name: 'Wholesale',
      code: 'WS',
      currency: 'EGP',
      type: 'percentage',
      default_discount_percent: 5,
      is_default: false,
      is_active: true,
      notes: 'wholesale list',
      items: [
        {
          product_id: 1,
          product_name: 'Sugar',
          category_id: null,
          min_quantity: 2,
          fixed_price: null,
          discount_percent: 10,
        },
      ],
    });
    assert.equal(transformed.name, 'Wholesale', 'the list name survives the pipe');
    assert.equal(transformed.items?.[0].min_quantity, 2, 'the item min quantity survives the pipe');
    const noCode = await pipeOk(UpsertPriceListDto, { name: 'Retail' });
    assert.equal(noCode.code, undefined, 'a create without a code passes — the service falls back to the name');
    await pipeRejects(
      UpsertPriceListDto,
      { name: 'Wholesale', code: 'WS', isAdmin: true },
      'an extra admin flag must be rejected on create price list',
    );
    await pipeRejects(UpsertPriceListDto, { code: 'WS' }, 'a missing name must be rejected on create price list');
    await pipeRejects(
      UpsertPriceListDto,
      { name: 'Wholesale', code: 'WS', type: 'mystery' },
      'an unknown list type must be rejected on create price list',
    );
    console.log('  (6) UpsertPriceListDto: real caller payload passes, extra/wrong-type/missing rejected passed');
  }

  // 7. UpdatePriceListDto — caller: price-lists.api.ts update sends
  // the full payload; a partial update is a legitimate service
  // capability (every field falls back to the stored row).
  {
    const transformed = await pipeOk(UpdatePriceListDto, {
      name: 'Wholesale',
      code: 'WS',
      currency: 'EGP',
      type: 'percentage',
      default_discount_percent: 5,
      is_default: false,
      is_active: true,
      notes: 'wholesale list',
      items: [{ product_id: 1, min_quantity: 2 }],
    });
    assert.equal(transformed.name, 'Wholesale', 'the list name survives the pipe on update');
    const partial = await pipeOk(UpdatePriceListDto, { is_active: false });
    assert.equal(partial.is_active, false, 'a partial update passes (all optional)');
    await pipeRejects(
      UpdatePriceListDto,
      { is_active: false, isAdmin: true },
      'an extra admin flag must be rejected on update price list',
    );
    await pipeRejects(
      UpdatePriceListDto,
      { type: 'mystery' },
      'an unknown list type must be rejected on update price list',
    );
    console.log('  (7) UpdatePriceListDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 8. CalculatePriceDto — caller: price-lists.api.ts calculate
  // sends { customerId, productId, quantity, basePrice,
  // paymentTerms }.
  {
    const transformed = await pipeOk(CalculatePriceDto, {
      customerId: 7,
      productId: 42,
      quantity: 3,
      basePrice: 100,
      paymentTerms: 'credit',
    });
    assert.equal(transformed.productId, 42, 'the product id survives the pipe');
    assert.equal(transformed.paymentTerms, 'credit', 'the credit terms survive the pipe');
    const minimal = await pipeOk(CalculatePriceDto, { productId: 42 });
    assert.equal(minimal.quantity, undefined, 'a minimal body passes — the controller defaults quantity/basePrice');
    await pipeRejects(
      CalculatePriceDto,
      { productId: 42, quantity: 3, isAdmin: true },
      'an extra admin flag must be rejected on calculate price',
    );
    await pipeRejects(CalculatePriceDto, { quantity: 3 }, 'a missing product id must be rejected on calculate price');
    await pipeRejects(
      CalculatePriceDto,
      { productId: 42, paymentTerms: 'deferred' },
      'unknown payment terms must be rejected on calculate price',
    );
    console.log('  (8) CalculatePriceDto: real caller payload passes, extra/wrong-type/missing rejected passed');
  }

  // 9. AuthorizeDiscountOverrideDto — caller: pos.api.ts
  // authorizeDiscountOverride sends { secret }.
  {
    const transformed = await pipeOk(AuthorizeDiscountOverrideDto, { secret: 'MGR-1234' });
    assert.equal(transformed.secret, 'MGR-1234', 'the secret survives the pipe');
    const empty = await pipeOk(AuthorizeDiscountOverrideDto, {});
    assert.equal(empty.secret, undefined, 'an empty body passes — the controller String()s a missing secret');
    const coerced = await pipeOk(AuthorizeDiscountOverrideDto, { secret: 1234 });
    assert.equal(coerced.secret, '1234', 'a numeric secret coerces to a string (the controller String()s it)');
    await pipeRejects(
      AuthorizeDiscountOverrideDto,
      { secret: 'MGR-1234', isAdmin: true },
      'an extra admin flag must be rejected on discount authorization',
    );
    console.log('  (9) AuthorizeDiscountOverrideDto: real caller payload passes, extra rejected passed');
  }

  // 10. CancelSaleDto — caller: sales.api.ts cancel sends
  // { reason, managerPin } (both always, possibly empty).
  {
    const transformed = await pipeOk(CancelSaleDto, { reason: 'Customer changed mind', managerPin: '4321' });
    assert.equal(transformed.reason, 'Customer changed mind', 'the reason survives the pipe');
    assert.equal(transformed.managerPin, '4321', 'the manager PIN survives the pipe');
    const empty = await pipeOk(CancelSaleDto, {});
    assert.equal(empty.reason, undefined, 'an empty body passes — the controller String()s missing fields');
    const coerced = await pipeOk(CancelSaleDto, { reason: 5 });
    assert.equal(coerced.reason, '5', 'a numeric reason coerces to a string (the controller String()s it)');
    await pipeRejects(
      CancelSaleDto,
      { reason: 'x', isAdmin: true },
      'an extra admin flag must be rejected on cancel sale',
    );
    console.log('  (10) CancelSaleDto: real caller payload passes, extra rejected passed');
  }

  // Source pins: every core controller takes the DTO class now.
  {
    const read = (rel: string): string => readFileSync(resolve(__dirname, '../../src/modules/sales', rel), 'utf8');
    const terminal = read('controllers/pos-terminal.controller.ts');
    const kitchen = read('controllers/kitchen-printers.controller.ts');
    const priceLists = read('controllers/price-lists.controller.ts');
    const sales = read('sales.controller.ts');
    for (const name of [
      'TestTerminalConnectionDto',
      'TerminalPaymentRequestDto',
      'BridgePollDto',
      'BridgeCallbackDto',
    ]) {
      assert.ok(terminal.includes(name), `the terminal controller takes ${name}`);
    }
    assert.ok(kitchen.includes('PrintKitchenTicketDto'), 'the kitchen controller takes PrintKitchenTicketDto');
    for (const name of ['UpsertPriceListDto', 'UpdatePriceListDto', 'CalculatePriceDto']) {
      assert.ok(priceLists.includes(name), `the price-list controller takes ${name}`);
    }
    for (const name of ['AuthorizeDiscountOverrideDto', 'CancelSaleDto']) {
      assert.ok(sales.includes(name), `the sales controller takes ${name}`);
    }
    for (const [label, src] of [
      ['terminal', terminal],
      ['kitchen', kitchen],
      ['price-lists', priceLists],
      ['sales', sales],
    ] as const) {
      assert.ok(!src.includes('body: any'), `no ${label} route takes any anymore`);
    }
    console.log('  source pins passed');
  }

  console.log('DTO sales core tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
