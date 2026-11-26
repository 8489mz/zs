/*
 * New file: backend/test/critical/dto-accounting.spec.ts
 *
 * WHAT THIS PINS (INV-DTO-ACCOUNTING-25, D6): the 25 accounting
 * controller routes (cost centers + allocation matrices, fixed
 * assets + auto-depreciation, multi-currency + forex revaluation,
 * PDC cheques, withholding tax + Form 41 extract, payment
 * allocations, fiscal years + monthly periods) now take DTO
 * classes, so the real global requestValidationPipe validates and
 * whitelists them. Before D6 they took inline object types, `any`,
 * or a named interface — and the pipe does nothing for an inline
 * type, `any`, or an interface, so any extra field (or a
 * wrong-typed field) reached the service untouched.
 *
 * WHAT IS DRIVEN (the real global pipe from main.ts — no mocks, no
 * booted app; the pipe instance driven here IS the global one):
 * for EACH DTO, (a) a positive case with the REAL caller payload
 * (the exact shape the frontend api file sends; see the per-case
 * comments for the caller file), which must pass the pipe with
 * every field intact, and (b) two negative cases: an extra field
 * the caller never sends is rejected with 400 VALIDATION_ERROR,
 * and a wrong-typed field is rejected the same way. Money
 * endpoints (forex execute, PDC create, WHT create, allocation,
 * fiscal close) get their positive case with the REAL caller
 * payload.
 *
 * CALLER TRAPS PINNED HERE (found during D6 caller verification):
 * - PreviewForexRevaluation takes the SAME ExecuteForexRevaluationDto
 *   class as execute: the preview caller (forex.api.ts) sends
 *   `items` too, and the preview service reads dto.items
 *   (forex-revaluation.service.ts:157) — the inline preview type
 *   omitted it, so a preview DTO without items would 400 every
 *   real preview call (the Package C tax_rate/tax_amount trap,
 *   second occurrence).
 * - AllocatePaymentDto.paymentId: the interface declares it
 *   optional, but the service validator REQUIRES it (a number,
 *   safe int, > 0 — payment-allocation.service.ts
 *   validatePaymentAllocationRequest). The DTO makes it required;
 *   a body without paymentId is rejected at the pipe.
 * - AllocatePaymentDto.paymentType: the interface allows 'direct',
 *   but the service validator requires customer_payment /
 *   supplier_payment per partnerType — 'direct' is always rejected
 *   by the service. The DTO enum excludes 'direct' (service
 *   whitelist); the pipe now rejects it (same 400 outcome).
 * - CreatePdcChequeDto.status: the caller never sends it and the
 *   service requires it to equal the type default ('in_safe' for
 *   receivable, 'issued' for payable) — the DTO enum is exactly
 *   those two values.
 * - DepreciateFixedAssetDto / CloseFiscalPeriodDto / CloseFiscalYearDto:
 *   the callers send `body || {}` — an empty body is a real caller
 *   case, so all three DTOs are all-optional and {} passes the pipe.
 * - ToggleAutoDepreciationDto.enabled / UpsertCurrencyDto.isBase:
 *   booleans under enableImplicitConversion — the string "false"
 *   converts to boolean true (Boolean("false") === true), pinned
 *   below; a boolean false still passes as false.
 * - NO frontend caller exists for POST currencies/convert, POST
 *   payment-allocations/allocate, or POST payment-allocations/
 *   auto-fifo (git grep over frontend/src at 3c61fee4f — the
 *   paymentAllocationApi object is defined but nothing imports or
 *   calls it). Their positive cases are the interface/inline
 *   shapes (the D5 zero-caller precedent).
 *
 * NOT DRIVEN: a live HTTP request through Nest (needs a booted
 * app); the services themselves (their own throws stay the
 * backstop — e.g. the allocation total==100% check, the duplicate
 * split check, the WHT paid->draft transition ban, the fiscal
 * startDate<endDate check, the PDC dueDate>=issueDate check, the
 * forex base-currency ban); the frontend screens (untouched).
 *
 * Fail-first: this spec is new in D6 — on the unpatched tree the
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
import {
  AutoAllocateFifoDto,
  CalculateCostCenterSplitDto,
  ConvertCurrencyDto,
  CreateCostCenterDto,
  CreateFixedAssetDto,
  DepreciateFixedAssetDto,
  ToggleAutoDepreciationDto,
  UpdateCostCenterDto,
  UpdateWhtStatusDto,
  UpsertCurrencyDto,
} from '../../src/modules/accounting/dto/accounting-write.dto';
import { ExecuteForexRevaluationDto } from '../../src/modules/accounting/services/forex-revaluation.service';
import {
  CreatePdcChequeDto,
  UpdateChequeStatusDto,
} from '../../src/modules/accounting/services/pdc-cheques/pdc-cheques.types';
import {
  CreateWhtTransactionDto,
  ExtractFromPurchasesDto,
} from '../../src/modules/accounting/services/withholding-tax.service';
import { AllocatePaymentDto } from '../../src/modules/accounting/services/payment-allocation.service';
import {
  CloseFiscalYearDto,
  CreateFiscalYearDto,
  ReopenFiscalYearDto,
} from '../../src/modules/accounting/services/fiscal-year.types';
import { CloseFiscalPeriodDto, ReopenFiscalPeriodDto } from '../../src/modules/accounting/dto/fiscal-period.dto';
import { CreateCostCenterAllocationDto } from '../../src/modules/accounting/services/cost-center-allocations.service';

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
  // 1. CreateCostCenterDto — caller: cost-centers.api.ts create sends
  // { code, name, dimension?, budgetAmount?, parentId?, description?, isActive? }.
  {
    const transformed = await pipeOk(CreateCostCenterDto, {
      code: 'CC-01',
      name: 'Main Cost Center',
      dimension: 'branch',
      budgetAmount: 50000,
      parentId: null,
      description: 'HQ',
      isActive: true,
    });
    assert.equal(transformed.code, 'CC-01', 'the cost-center code survives the pipe');
    assert.equal(transformed.parentId, null, 'a null parentId survives the pipe');
    const minimal = await pipeOk(CreateCostCenterDto, { code: 'CC-02', name: 'Ops' });
    assert.equal(minimal.name, 'Ops', 'a minimal create passes — the rest is optional');
    await pipeRejects(CreateCostCenterDto, { code: 'CC-01', name: 'X', tenantId: 't1' }, 'an extra field is rejected');
    await pipeRejects(CreateCostCenterDto, { name: 'X' }, 'a missing code is rejected');
  }

  // 2. UpdateCostCenterDto — caller: cost-centers.api.ts update sends a
  // partial { code?, name?, dimension?, budgetAmount?, parentId?, description?, isActive? }.
  {
    const transformed = await pipeOk(UpdateCostCenterDto, { name: 'Renamed' });
    assert.equal(transformed.name, 'Renamed', 'a partial update passes');
    const empty = await pipeOk(UpdateCostCenterDto, {});
    assert.equal(empty.name, undefined, 'an empty update passes — every field is optional');
    await pipeRejects(UpdateCostCenterDto, { name: 'X', branchId: 3 }, 'an extra field is rejected');
    await pipeRejects(UpdateCostCenterDto, { budgetAmount: 'much' }, 'a wrong-typed budgetAmount is rejected');
  }

  // 3. CreateCostCenterAllocationDto — caller: cost-centers.api.ts
  // createAllocation/updateAllocation send { code, name, description?, splits: [{ costCenterId, percentage, notes? }] }.
  {
    const transformed = await pipeOk(CreateCostCenterAllocationDto, {
      code: 'ALLOC-1',
      name: 'Split',
      description: 'monthly',
      splits: [
        { costCenterId: 1, percentage: 60, notes: 'main' },
        { costCenterId: 2, percentage: 40 },
      ],
    });
    assert.equal(transformed.splits.length, 2, 'both splits survive the pipe');
    assert.equal(transformed.splits[0].percentage, 60, 'the first split percentage survives the pipe');
    await pipeRejects(
      CreateCostCenterAllocationDto,
      { code: 'A', name: 'X', splits: [{ costCenterId: 1, percentage: 100 }], extra: 1 },
      'an extra field is rejected',
    );
    await pipeRejects(
      CreateCostCenterAllocationDto,
      { code: 'A', name: 'X', splits: [{ costCenterId: 1, percentage: 100 }] },
      'a single split is rejected — the service needs at least two',
    );
    await pipeRejects(
      CreateCostCenterAllocationDto,
      {
        code: 'A',
        name: 'X',
        splits: [
          { costCenterId: 1, percentage: 0 },
          { costCenterId: 2, percentage: 100 },
        ],
      },
      'a zero percentage is rejected',
    );
    await pipeRejects(
      CreateCostCenterAllocationDto,
      {
        code: 'A',
        name: 'X',
        splits: [
          { costCenterId: 1, percentage: 101 },
          { costCenterId: 2, percentage: 40 },
        ],
      },
      'a percentage above 100 is rejected',
    );
  }

  // 4. CalculateCostCenterSplitDto — caller: cost-centers.api.ts
  // calculateSplit sends { amount }.
  {
    const transformed = await pipeOk(CalculateCostCenterSplitDto, { amount: 2500 });
    assert.equal(transformed.amount, 2500, 'the amount survives the pipe');
    await pipeRejects(CalculateCostCenterSplitDto, { amount: 2500, currency: 'EGP' }, 'an extra field is rejected');
    await pipeRejects(CalculateCostCenterSplitDto, { amount: 'much' }, 'a wrong-typed amount is rejected');
  }

  // 5. CreateFixedAssetDto — caller: accounting.api.ts CreateFixedAssetInput
  // { code, name, category?, purchaseCost, salvageValue?, usefulLifeMonths?,
  //   depreciationMethod?, purchaseDate? }.
  {
    const transformed = await pipeOk(CreateFixedAssetDto, {
      code: 'FA-001',
      name: 'Laptop',
      category: 'IT',
      purchaseCost: 15000,
      salvageValue: 1000,
      usefulLifeMonths: 36,
      depreciationMethod: 'straight_line',
      purchaseDate: '2026-01-15',
    });
    assert.equal(transformed.purchaseCost, 15000, 'the purchase cost survives the pipe');
    await pipeRejects(
      CreateFixedAssetDto,
      { code: 'FA-001', name: 'X', purchaseCost: 15000, serialNo: 'S1' },
      'an extra field is rejected',
    );
    await pipeRejects(
      CreateFixedAssetDto,
      { code: 'FA-001', name: 'X', purchaseCost: 0 },
      'a zero purchase cost is rejected — the service needs cost > 0',
    );
    await pipeRejects(
      CreateFixedAssetDto,
      { code: 'FA-001', name: 'X', purchaseCost: 15000, depreciationMethod: 'linear' },
      'an unknown depreciation method is rejected',
    );
  }

  // 6. DepreciateFixedAssetDto — caller: accounting.api.ts depreciate /
  // depreciateAll send `body || {}` — an empty body is a real caller case.
  {
    const transformed = await pipeOk(DepreciateFixedAssetDto, { months: 3, note: 'Q1' });
    assert.equal(transformed.months, 3, 'the months survive the pipe');
    const empty = await pipeOk(DepreciateFixedAssetDto, {});
    assert.equal(empty.months, undefined, 'an empty body passes — the service defaults to 1 month');
    await pipeRejects(DepreciateFixedAssetDto, { months: 3, assetId: 9 }, 'an extra field is rejected');
    await pipeRejects(DepreciateFixedAssetDto, { months: 0 }, 'zero months is rejected');
  }

  // 7. ToggleAutoDepreciationDto — caller: accounting.api.ts
  // toggleAutoDepreciation sends { enabled }.
  {
    const on = await pipeOk(ToggleAutoDepreciationDto, { enabled: true });
    assert.equal(on.enabled, true, 'enabled true survives the pipe');
    const off = await pipeOk(ToggleAutoDepreciationDto, { enabled: false });
    assert.equal(off.enabled, false, 'enabled false survives the pipe');
    const fromString = await pipeOk(ToggleAutoDepreciationDto, { enabled: 'false' });
    assert.equal(
      fromString.enabled,
      true,
      'the string "false" converts to boolean true under enableImplicitConversion — pinned, not fixed',
    );
    await pipeRejects(ToggleAutoDepreciationDto, { enabled: true, at: 'now' }, 'an extra field is rejected');
    await pipeRejects(ToggleAutoDepreciationDto, {}, 'a missing enabled is rejected');
  }

  // 8. UpsertCurrencyDto — caller: forex.api.ts upsertCurrency sends
  // { currencyCode, currencyName, exchangeRate, isBase?, symbol? }.
  {
    const transformed = await pipeOk(UpsertCurrencyDto, {
      currencyCode: 'USD',
      currencyName: 'US Dollar',
      exchangeRate: 48.5,
      isBase: false,
      symbol: '$',
    });
    assert.equal(transformed.exchangeRate, 48.5, 'the exchange rate survives the pipe');
    const baseString = await pipeOk(UpsertCurrencyDto, {
      currencyCode: 'EGP',
      currencyName: 'Pound',
      exchangeRate: 1,
      isBase: 'false',
    });
    assert.equal(
      baseString.isBase,
      true,
      'the string "false" converts to boolean true under enableImplicitConversion — pinned, not fixed',
    );
    await pipeRejects(
      UpsertCurrencyDto,
      { currencyCode: 'USD', currencyName: 'X', exchangeRate: 48.5, digits: 2 },
      'an extra field is rejected',
    );
    await pipeRejects(
      UpsertCurrencyDto,
      { currencyCode: 'USD', currencyName: 'X', exchangeRate: 0 },
      'a zero exchange rate is rejected — the service needs rate > 0',
    );
  }

  // 9. ConvertCurrencyDto — NO frontend caller (git grep over
  // frontend/src at 3c61fee4f); the positive case is the inline shape.
  {
    const transformed = await pipeOk(ConvertCurrencyDto, {
      amount: 100,
      fromCurrency: 'USD',
      toCurrency: 'EGP',
      asOf: '2026-11-01',
    });
    assert.equal(transformed.amount, 100, 'the amount survives the pipe');
    const minimal = await pipeOk(ConvertCurrencyDto, { amount: 50, fromCurrency: 'USD', toCurrency: 'EGP' });
    assert.equal(minimal.asOf, undefined, 'asOf is optional');
    await pipeRejects(
      ConvertCurrencyDto,
      { amount: 100, fromCurrency: 'USD', toCurrency: 'EGP', rate: 48.5 },
      'an extra field is rejected',
    );
    await pipeRejects(
      ConvertCurrencyDto,
      { amount: 'lots', fromCurrency: 'USD', toCurrency: 'EGP' },
      'a wrong-typed amount is rejected',
    );
  }

  // 10. ExecuteForexRevaluationDto — callers: forex.api.ts
  // previewRevaluation sends { periodDate, currencyCode, closingRate, items }
  // and executeRevaluation sends the same plus notes?. The preview site
  // takes this class too (the service reads dto.items on preview).
  {
    const executed = await pipeOk(ExecuteForexRevaluationDto, {
      periodDate: '2026-10-31',
      currencyCode: 'USD',
      closingRate: 48.75,
      items: [{ accountId: 12, foreignBalance: 1000 }],
      notes: 'Oct close',
    });
    assert.equal(executed.closingRate, 48.75, 'the closing rate survives the pipe');
    assert.equal(executed.items!.length, 1, 'the revaluation item survives the pipe');
    const preview = await pipeOk(ExecuteForexRevaluationDto, {
      periodDate: '2026-10-31',
      currencyCode: 'USD',
      closingRate: 48.75,
      items: [{ accountId: 12, foreignBalance: 1000 }],
    });
    assert.equal(preview.notes, undefined, 'the preview shape (no notes) passes');
    await pipeRejects(
      ExecuteForexRevaluationDto,
      { periodDate: '2026-10-31', currencyCode: 'USD', closingRate: 48.75, items: [], runId: 'r1' },
      'an extra field is rejected',
    );
    await pipeRejects(
      ExecuteForexRevaluationDto,
      { periodDate: '2026-10-31', currencyCode: 'USD', closingRate: 0, items: [] },
      'a zero closing rate is rejected — the service needs a finite positive rate',
    );
    await pipeRejects(
      ExecuteForexRevaluationDto,
      {
        periodDate: '2026-10-31',
        currencyCode: 'USD',
        closingRate: 48.75,
        items: [{ accountId: 0, foreignBalance: 5 }],
      },
      'a zero accountId in items is rejected',
    );
  }

  // 11. CreatePdcChequeDto — caller: accounting.api.ts CreatePdcChequePayload
  // (matches the interface field-for-field; the caller never sends status).
  {
    const transformed = await pipeOk(CreatePdcChequeDto, {
      type: 'receivable',
      chequeNumber: 'CHQ-100',
      bankName: 'NBE',
      branchName: 'Downtown',
      drawerName: 'Ahmed',
      partnerType: 'customer',
      partnerId: 5,
      partnerName: 'Client Co',
      amount: 25000,
      currency: 'EGP',
      exchangeRate: 1,
      issueDate: '2026-11-01',
      dueDate: '2026-12-01',
      depositBankId: 2,
      notes: 'first',
    });
    assert.equal(transformed.amount, 25000, 'the cheque amount survives the pipe');
    assert.equal(transformed.status, undefined, 'status is optional — the caller never sends it');
    await pipeRejects(
      CreatePdcChequeDto,
      {
        type: 'receivable',
        chequeNumber: 'C1',
        bankName: 'NBE',
        partnerName: 'X',
        amount: 1,
        issueDate: '2026-11-01',
        dueDate: '2026-12-01',
        cleared: true,
      },
      'an extra field is rejected',
    );
    await pipeRejects(
      CreatePdcChequeDto,
      {
        type: 'receivable',
        chequeNumber: 'C1',
        bankName: 'NBE',
        partnerName: 'X',
        amount: 0,
        issueDate: '2026-11-01',
        dueDate: '2026-12-01',
      },
      'a zero cheque amount is rejected',
    );
    await pipeRejects(
      CreatePdcChequeDto,
      {
        type: 'other',
        chequeNumber: 'C1',
        bankName: 'NBE',
        partnerName: 'X',
        amount: 1,
        issueDate: '2026-11-01',
        dueDate: '2026-12-01',
      },
      'an unknown cheque type is rejected',
    );
  }

  // 12. UpdateChequeStatusDto — caller: accounting.api.ts UpdateChequeStatusPayload.
  {
    const transformed = await pipeOk(UpdateChequeStatusDto, {
      action: 'bounce',
      actionDate: '2026-11-20',
      bouncedReason: 'NSF',
      bouncedFee: 50,
      notes: 'returned',
    });
    assert.equal(transformed.action, 'bounce', 'the action survives the pipe');
    await pipeRejects(UpdateChequeStatusDto, { action: 'deposit', chequeId: 4 }, 'an extra field is rejected');
    await pipeRejects(UpdateChequeStatusDto, { action: 'hold' }, 'an unknown action is rejected');
  }

  // 13. CreateWhtTransactionDto — caller: accounting.api.ts CreateWhtTransactionPayload
  // (matches the interface field-for-field).
  {
    const transformed = await pipeOk(CreateWhtTransactionDto, {
      direction: 'payable',
      source_type: 'purchase_invoice',
      source_id: 10,
      invoice_number: 'INV-1',
      invoice_date: '2026-10-15',
      partner_type: 'supplier',
      partner_id: 7,
      partner_name: 'Supplier Co',
      tax_id_number: '123',
      file_number: 'F1',
      tax_office_code: 'C1',
      partner_address: 'Cairo',
      wht_type: 'goods',
      wht_rate: 1,
      base_amount: 10000,
      quarter: 'Q4',
      tax_year: 2026,
      notes: 'x',
    });
    assert.equal(transformed.base_amount, 10000, 'the base amount survives the pipe');
    await pipeRejects(
      CreateWhtTransactionDto,
      {
        invoice_number: 'INV-1',
        invoice_date: '2026-10-15',
        partner_name: 'X',
        wht_type: 'goods',
        base_amount: 100,
        posted: true,
      },
      'an extra field is rejected',
    );
    await pipeRejects(
      CreateWhtTransactionDto,
      { invoice_number: 'INV-1', invoice_date: '2026-10-15', partner_name: 'X', wht_type: 'goods', base_amount: 0 },
      'a zero base amount is rejected — the service needs base > 0',
    );
    await pipeRejects(
      CreateWhtTransactionDto,
      { invoice_number: 'INV-1', invoice_date: '2026-10-15', partner_name: 'X', wht_type: 'vat', base_amount: 100 },
      'an unknown withholding type is rejected',
    );
  }

  // 14. ExtractFromPurchasesDto — caller: accounting.api.ts extractFromPurchases
  // sends { fromDate, toDate, defaultWhtRate?, defaultWhtType? }.
  {
    const transformed = await pipeOk(ExtractFromPurchasesDto, {
      fromDate: '2026-10-01',
      toDate: '2026-10-31',
      defaultWhtRate: 1,
      defaultWhtType: 'goods',
    });
    assert.equal(transformed.defaultWhtRate, 1, 'the default rate survives the pipe');
    const minimal = await pipeOk(ExtractFromPurchasesDto, { fromDate: '2026-10-01', toDate: '2026-10-31' });
    assert.equal(minimal.defaultWhtType, undefined, 'the defaults are optional — the service falls back');
    await pipeRejects(
      ExtractFromPurchasesDto,
      { fromDate: '2026-10-01', toDate: '2026-10-31', force: true },
      'an extra field is rejected',
    );
    await pipeRejects(
      ExtractFromPurchasesDto,
      { fromDate: '2026-10-01', toDate: '2026-10-31', defaultWhtRate: 0 },
      'a zero default rate is rejected — the service needs (0, 100]',
    );
    await pipeRejects(
      ExtractFromPurchasesDto,
      { fromDate: '2026-10-01', toDate: '2026-10-31', defaultWhtType: 'custom' },
      'custom is not an extract type — the interface allows only goods/services/professional',
    );
  }

  // 15. UpdateWhtStatusDto — caller: accounting.api.ts updateStatus sends
  // { status, payment_reference? }.
  {
    const transformed = await pipeOk(UpdateWhtStatusDto, { status: 'declared', payment_reference: 'REF-1' });
    assert.equal(transformed.status, 'declared', 'the status survives the pipe');
    const minimal = await pipeOk(UpdateWhtStatusDto, { status: 'draft' });
    assert.equal(minimal.payment_reference, undefined, 'the payment reference is optional');
    await pipeRejects(UpdateWhtStatusDto, { status: 'declared', paidAt: '2026-11-01' }, 'an extra field is rejected');
    await pipeRejects(UpdateWhtStatusDto, { status: 'cancelled' }, 'an unknown status is rejected');
  }

  // 16. AllocatePaymentDto — NO frontend caller (paymentAllocationApi is
  // defined in accounting.api.ts but nothing imports or calls it); the
  // positive case is the interface shape.
  {
    const transformed = await pipeOk(AllocatePaymentDto, {
      partnerType: 'customer',
      partnerId: 12,
      paymentType: 'customer_payment',
      paymentId: 34,
      allocations: [{ invoiceId: 5, amount: 100.5 }],
      notes: 'partial',
    });
    assert.equal(transformed.allocations.length, 1, 'the allocation survives the pipe');
    assert.equal(transformed.allocations[0].amount, 100.5, 'the allocated amount survives the pipe');
    await pipeRejects(
      AllocatePaymentDto,
      {
        partnerType: 'customer',
        partnerId: 12,
        paymentType: 'customer_payment',
        paymentId: 34,
        allocations: [{ invoiceId: 5, amount: 1 }],
        voucherNo: 'V1',
      },
      'an extra field is rejected',
    );
    await pipeRejects(
      AllocatePaymentDto,
      {
        partnerType: 'customer',
        partnerId: 12,
        paymentType: 'direct',
        paymentId: 34,
        allocations: [{ invoiceId: 5, amount: 1 }],
      },
      "'direct' is rejected at the pipe — the service whitelist is customer_payment/supplier_payment only",
    );
    await pipeRejects(
      AllocatePaymentDto,
      {
        partnerType: 'customer',
        partnerId: 12,
        paymentType: 'customer_payment',
        allocations: [{ invoiceId: 5, amount: 1 }],
      },
      'a missing paymentId is rejected — the service requires a real payment voucher',
    );
    await pipeRejects(
      AllocatePaymentDto,
      { partnerType: 'customer', partnerId: 12, paymentType: 'customer_payment', paymentId: 34, allocations: [] },
      'an empty allocations list is rejected',
    );
    await pipeRejects(
      AllocatePaymentDto,
      {
        partnerType: 'customer',
        partnerId: 12,
        paymentType: 'customer_payment',
        paymentId: 34,
        allocations: [{ invoiceId: 5, amount: 0 }],
      },
      'a zero allocation amount is rejected',
    );
  }

  // 17. AutoAllocateFifoDto — NO frontend caller (same unwired api object);
  // the positive case is the inline shape.
  {
    const transformed = await pipeOk(AutoAllocateFifoDto, { partnerType: 'supplier', partnerId: 7, paymentId: 9 });
    assert.equal(transformed.paymentId, 9, 'the paymentId survives the pipe');
    await pipeRejects(
      AutoAllocateFifoDto,
      { partnerType: 'supplier', partnerId: 7, paymentId: 9, force: true },
      'an extra field is rejected',
    );
    await pipeRejects(
      AutoAllocateFifoDto,
      { partnerType: 'supplier', partnerId: 0, paymentId: 9 },
      'a zero partnerId is rejected',
    );
  }

  // 18. CreateFiscalYearDto — caller: fiscal-years.api.ts createFiscalYear
  // sends CreateFiscalYearPayload { name, code?, startDate, endDate }.
  {
    const transformed = await pipeOk(CreateFiscalYearDto, {
      name: 'FY 2026',
      code: 'FY26',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    assert.equal(transformed.name, 'FY 2026', 'the fiscal-year name survives the pipe');
    await pipeRejects(
      CreateFiscalYearDto,
      { name: 'FY 2026', startDate: '2026-01-01', endDate: '2026-12-31', closed: true },
      'an extra field is rejected',
    );
    await pipeRejects(
      CreateFiscalYearDto,
      { name: 'FY 2026', startDate: '2026-01-01' },
      'a missing endDate is rejected',
    );
  }

  // 19. CloseFiscalYearDto — caller: fiscal-years.api.ts executeClose sends
  // CloseFiscalYearPayload { retainedEarningsAccountId?, notes? }.
  {
    const transformed = await pipeOk(CloseFiscalYearDto, { retainedEarningsAccountId: 42, notes: 'closing' });
    assert.equal(transformed.retainedEarningsAccountId, 42, 'the retained-earnings account survives the pipe');
    const empty = await pipeOk(CloseFiscalYearDto, {});
    assert.equal(empty.notes, undefined, 'an empty close body passes — the service falls back to the default account');
    await pipeRejects(CloseFiscalYearDto, { notes: 'x', force: true }, 'an extra field is rejected');
    await pipeRejects(CloseFiscalYearDto, { retainedEarningsAccountId: 0 }, 'a zero account id is rejected');
  }

  // 20. ReopenFiscalYearDto — caller: fiscal-years.api.ts reopen sends
  // ReopenFiscalYearPayload { reason }.
  {
    const transformed = await pipeOk(ReopenFiscalYearDto, { reason: 'Correction needed' });
    assert.equal(transformed.reason, 'Correction needed', 'the reason survives the pipe');
    await pipeRejects(ReopenFiscalYearDto, { reason: 'x', byAdmin: true }, 'an extra field is rejected');
    await pipeRejects(ReopenFiscalYearDto, {}, 'a missing reason is rejected — the service needs it for audit');
  }

  // 21. CloseFiscalPeriodDto — caller: fiscal-years.api.ts closePeriod sends
  // `payload || {}` — an empty body is a real caller case.
  {
    const transformed = await pipeOk(CloseFiscalPeriodDto, { notes: 'Oct close' });
    assert.equal(transformed.notes, 'Oct close', 'the notes survive the pipe');
    const empty = await pipeOk(CloseFiscalPeriodDto, {});
    assert.equal(empty.notes, undefined, 'an empty close body passes');
    await pipeRejects(CloseFiscalPeriodDto, { notes: 'x', periodId: 3 }, 'an extra field is rejected');
  }

  // 22. ReopenFiscalPeriodDto — caller: fiscal-years.api.ts reopenPeriod sends
  // ReopenFiscalPeriodPayload { reason }.
  {
    const transformed = await pipeOk(ReopenFiscalPeriodDto, { reason: 'Wrong postings' });
    assert.equal(transformed.reason, 'Wrong postings', 'the reason survives the pipe');
    await pipeRejects(ReopenFiscalPeriodDto, { reason: 'x', force: true }, 'an extra field is rejected');
    await pipeRejects(ReopenFiscalPeriodDto, {}, 'a missing reason is rejected');
  }

  // 23. Source pins: the accounting controller takes the DTO classes now.
  {
    const src = readFileSync(resolve(__dirname, '../../src/modules/accounting/accounting.controller.ts'), 'utf8');
    for (const name of [
      'CreateCostCenterDto',
      'UpdateCostCenterDto',
      'CreateCostCenterAllocationDto',
      'CalculateCostCenterSplitDto',
      'CreateFixedAssetDto',
      'DepreciateFixedAssetDto',
      'ToggleAutoDepreciationDto',
      'UpsertCurrencyDto',
      'ConvertCurrencyDto',
      'ExecuteForexRevaluationDto',
      'CreatePdcChequeDto',
      'UpdateChequeStatusDto',
      'CreateWhtTransactionDto',
      'ExtractFromPurchasesDto',
      'UpdateWhtStatusDto',
      'AllocatePaymentDto',
      'AutoAllocateFifoDto',
      'CreateFiscalYearDto',
      'CloseFiscalYearDto',
      'ReopenFiscalYearDto',
      'CloseFiscalPeriodDto',
      'ReopenFiscalPeriodDto',
    ]) {
      assert.ok(src.includes(name), `the accounting controller takes ${name}`);
    }
    assert.ok(!src.includes('body: any'), 'no accounting route takes any anymore');
    console.log('  source pins passed');
  }

  // 24. Wiring: this spec is in both critical lists, in identical order
  // (363 specs — the purchases-writer spec is the last entry).
  {
    const specs = JSON.parse(readFileSync(resolve(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
      .specs as string[];
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const serial = String(pkg.scripts['test:critical:serial']);
    const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
    assert.equal(specs.length, 372);
    assert.equal(chain.length, 372);
    assert.deepEqual(chain, specs);
    assert.ok(specs.includes('test/critical/dto-accounting.spec.ts'));
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-b3-sales-storefront.spec.ts');
    console.log('  evidence spec wired into both critical lists (372 = 372, identical order), passed');
  }

  console.log('DTO accounting tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
