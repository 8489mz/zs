/*
 * New file: backend/test/critical/dto-tax-approvals.spec.ts
 *
 * WHAT THIS PINS (INV-DTO-HR-TAX-APPROVALS-30, D9): the 7
 * tax-integration controller routes (ETA submit + attach-signature,
 * tax-settings update, ZATCA bulk-submit + compliance-check + EGS
 * unit create + compliance-CSID request) and the 4 approvals routes
 * (rule create + rule update + request approve + request reject) now
 * take DTO classes, so the real global requestValidationPipe
 * validates and whitelists them. Before D9 they took inline object
 * types, `any`, or interfaces — and the pipe does nothing for an
 * inline type, `any`, or an interface, so any extra field (or a
 * wrong-typed field) reached the service untouched.
 *
 * WHAT IS DRIVEN (the real global pipe from main.ts — no mocks, no
 * booted app; the pipe instance driven here IS the global one):
 * for EACH DTO, (a) a positive case with the REAL caller payload —
 * tax + approvals have NO frontend caller anywhere in frontend/src,
 * so the positive case is the interface shape itself (D5 precedent),
 * which must pass the pipe with every field intact, and (b)
 * negative cases: an extra field is rejected with 400
 * VALIDATION_ERROR, and a wrong-typed field is rejected the same way.
 *
 * CALLER TRAPS PINNED HERE (found during D9 service verification):
 * - SubmitEtaInvoicesDto.invoiceIds is OPTIONAL (the service returns
 *   success count 0 when it is missing/empty — D5 precedent).
 * - SubmitZatcaInvoicesBulkDto.invoiceIds is OPTIONAL and NARROWED
 *   from (number|string)[] to string[] (D5 cashierShiftId precedent:
 *   numbers coerce to strings, non-numeric strings pass the pipe and
 *   are filtered by the service).
 * - ValidateZatcaComplianceDto: ALL FIVE fields OPTIONAL — the
 *   endpoint RETURNS an error list instead of throwing, so
 *   required-ness stays with the service (a strict DTO would turn a
 *   {valid:false, errors:[...]} 200 into a 400 and defeat the
 *   endpoint's purpose). lineItems is @IsArray() only (no
 *   ArrayMinSize — [] is a service-reported error); totalWithVat is
 *   @IsNumber() only (no Min — a negative is a service-reported
 *   error).
 * - AttachSignatureDto.signerCertificate is NEVER read by the service
 *   (only saleId + cadesSignature are used) — optional (Package C
 *   trap).
 * - TaxSettingsDto.provider is OPTIONAL (the controller defaults
 *   ETA_EGYPT when it is missing). Every other tax-settings field is
 *   optional (the service falls back to the existing row / sandbox /
 *   is_active true).
 * - CreateEgsUnitDto.environment stays a PLAIN STRING, not an enum
 *   (the service falls back to sandbox for an unknown value — D8
 *   CalculateFees precedent). egsId is NARROWED from string|number
 *   to string (a numeric 42 coerces to '42', pinned below). otp is a
 *   required string only (the service enforces exactly-6).
 * - CreateApprovalRuleDto.module is purchase_orders ONLY (the service
 *   throws otherwise — D8 settlement precedent); requiredRole is
 *   'admin' ONLY (the service throws otherwise). minAmount is
 *   optional @Min(0) (the service defaults 0, throws on negative);
 *   tierLevel is optional @IsInt @Min(1) (the service defaults 1).
 * - RejectApprovalRequestDto.reason is REQUIRED (the service throws
 *   when it is blank).
 *
 * NOT DRIVEN: a live HTTP request through Nest (needs a booted app);
 * the services themselves (their own throws stay the backstop — e.g.
 * the approvals module/role whitelists, the ETA/ZATCA submission
 * flows, the compliance error list); the frontend screens
 * (untouched — tax + approvals have no frontend caller).
 *
 * Fail-first: this spec is new in D9 — on the unpatched tree the DTO
 * classes do not exist, so the imports fail (MODULE_NOT_FOUND) and the
 * spec exits 1 (see the log). GREEN means the pipe accepts every
 * interface-shape payload and rejects every extra/wrong-typed field
 * below.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { requestValidationPipe } from '../../src/common/pipes/request-validation.pipe';
import { AttachSignatureDto } from '../../src/modules/tax-integration/services/eta-submission/eta-signature-bridge.service';
import { TaxSettingsDto } from '../../src/modules/tax-integration/services/tax-settings/tax-settings.service';
import {
  CreateEgsUnitDto,
  RequestComplianceDto,
} from '../../src/modules/tax-integration/services/zatca/zatca-onboarding.service';
import { CreateApprovalRuleDto } from '../../src/modules/approvals/approval-workflow.service';
import {
  SubmitEtaInvoicesDto,
  SubmitZatcaInvoicesBulkDto,
  ValidateZatcaComplianceDto,
} from '../../src/modules/tax-integration/dto/tax-write.dto';
import {
  ApproveApprovalRequestDto,
  RejectApprovalRequestDto,
  UpdateApprovalRuleDto,
} from '../../src/modules/approvals/dto/approval-write.dto';

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

function readSrc(rel: string): string {
  return readFileSync(resolve(__dirname, '../../src', rel), 'utf8');
}

async function main(): Promise<void> {
  // 1. SubmitEtaInvoicesDto — NO frontend caller; the positive case is
  // the interface shape { invoiceIds: string[] }. invoiceIds is
  // OPTIONAL (the service returns success count 0 when missing).
  {
    const transformed = await pipeOk(SubmitEtaInvoicesDto, { invoiceIds: ['uuid-1', 'uuid-2'] });
    assert.equal(transformed.invoiceIds?.length, 2, 'ETA invoiceIds survive the pipe');
    const empty = await pipeOk(SubmitEtaInvoicesDto, {});
    assert.equal(empty.invoiceIds, undefined, 'a missing invoiceIds passes (the service tolerates it)');
    await pipeRejects(SubmitEtaInvoicesDto, { invoiceIds: ['a'], extra: 1 }, 'an extra field is rejected');
    // Coercion pin (D7/D8 trap): with @Type(() => String) a numeric
    // element coerces to '42' instead of rejecting — the SERVICE is
    // the backstop (ETA submitInvoices reads invoiceIds as strings).
    const coerced = await pipeOk(SubmitEtaInvoicesDto, { invoiceIds: [42] });
    assert.deepEqual(coerced.invoiceIds, ['42']);
  }

  // 2. AttachSignatureDto — NO frontend caller; the positive case is
  // the interface shape. saleId + cadesSignature required.
  {
    const transformed = await pipeOk(AttachSignatureDto, {
      saleId: 12,
      cadesSignature: 'MIIB...base64...',
      signerCertificate: 'MIIB...cert...',
    });
    assert.equal(transformed.saleId, 12, 'attach saleId survives the pipe');
    assert.equal(transformed.signerCertificate, 'MIIB...cert...', 'signerCertificate survives the pipe');
    await pipeRejects(AttachSignatureDto, { cadesSignature: 'sig' }, 'a missing saleId is rejected');
    await pipeRejects(AttachSignatureDto, { saleId: 12 }, 'a missing cadesSignature is rejected');
    await pipeRejects(
      AttachSignatureDto,
      { saleId: 12, cadesSignature: 'sig', extra: 1 },
      'an extra field is rejected',
    );
  }

  // 3. TaxSettingsDto — NO frontend caller; the positive case is the
  // interface shape. provider is OPTIONAL (the controller defaults
  // ETA_EGYPT); every other field optional.
  {
    const transformed = await pipeOk(TaxSettingsDto, {
      provider: 'ETA_EGYPT',
      client_id: 'cid',
      client_secret: 'secret',
      tax_id: '123456789',
      environment: 'sandbox',
      is_active: true,
    });
    assert.equal(transformed.provider, 'ETA_EGYPT', 'tax-settings provider survives the pipe');
    const minimal = await pipeOk(TaxSettingsDto, {});
    assert.equal(minimal.provider, undefined, 'an empty tax-settings passes — every field is optional');
    await pipeRejects(TaxSettingsDto, { provider: 'ETA_EGYPT', extra: 1 }, 'an extra field is rejected');
    const stringFalse = await pipeOk(TaxSettingsDto, { is_active: 'false' });
    assert.equal(stringFalse.is_active, true, 'the string "false" converts to boolean true');
  }

  // 4. SubmitZatcaInvoicesBulkDto — NO frontend caller; the positive
  // case is the interface shape. invoiceIds is OPTIONAL and NARROWED
  // to string[] (numbers coerce, non-numeric strings pass the pipe
  // and are filtered by the service).
  {
    const transformed = await pipeOk(SubmitZatcaInvoicesBulkDto, { invoiceIds: ['1', '2'] });
    assert.equal(transformed.invoiceIds?.length, 2, 'ZATCA invoiceIds survive the pipe');
    const empty = await pipeOk(SubmitZatcaInvoicesBulkDto, {});
    assert.equal(empty.invoiceIds, undefined, 'a missing invoiceIds passes (the service tolerates it)');
    await pipeRejects(SubmitZatcaInvoicesBulkDto, { invoiceIds: ['1'], extra: 1 }, 'an extra field is rejected');
    const coerced = await pipeOk(SubmitZatcaInvoicesBulkDto, { invoiceIds: [42, '7'] });
    assert.deepEqual(coerced.invoiceIds, ['42', '7'], 'numeric invoiceIds coerce to strings');
  }

  // 5. ValidateZatcaComplianceDto — NO frontend caller; the positive
  // case is the interface shape. ALL fields OPTIONAL: the endpoint
  // RETURNS an error list instead of throwing, so required-ness stays
  // with the service.
  {
    const transformed = await pipeOk(ValidateZatcaComplianceDto, {
      sellerVatNumber: '310123456700003',
      invoiceNumber: 'INV-1',
      issueDate: '2026-11-25',
      lineItems: [{ description: 'item', quantity: 1, price: 100 }],
      totalWithVat: 115,
    });
    assert.equal(transformed.sellerVatNumber, '310123456700003', 'compliance sellerVatNumber survives the pipe');
    assert.equal(transformed.totalWithVat, 115, 'compliance totalWithVat survives the pipe');
    const empty = await pipeOk(ValidateZatcaComplianceDto, {});
    assert.equal(empty.invoiceNumber, undefined, 'an empty compliance body passes — the service reports the errors');
    const emptyItems = await pipeOk(ValidateZatcaComplianceDto, { lineItems: [] });
    assert.equal(emptyItems.lineItems?.length, 0, 'an empty lineItems passes — the service reports it');
    const negativeTotal = await pipeOk(ValidateZatcaComplianceDto, { totalWithVat: -5 });
    assert.equal(negativeTotal.totalWithVat, -5, 'a negative total passes the pipe — the service reports it');
    await pipeRejects(
      ValidateZatcaComplianceDto,
      { sellerVatNumber: '310123456700003', extra: 1 },
      'an extra field is rejected',
    );
    await pipeRejects(ValidateZatcaComplianceDto, { lineItems: 'not-an-array' }, 'a wrong-typed lineItems is rejected');
  }

  // 6. CreateEgsUnitDto — NO frontend caller; the positive case is
  // the interface shape. deviceName required; environment is a plain
  // string (the service falls back to sandbox for unknown values).
  {
    const transformed = await pipeOk(CreateEgsUnitDto, {
      deviceName: 'POS-1',
      customId: 'EGS-001',
      branchId: 2,
      environment: 'sandbox',
    });
    assert.equal(transformed.deviceName, 'POS-1', 'EGS deviceName survives the pipe');
    await pipeRejects(CreateEgsUnitDto, { customId: 'EGS-001' }, 'a missing deviceName is rejected');
    await pipeRejects(CreateEgsUnitDto, { deviceName: 'POS-1', extra: 1 }, 'an extra field is rejected');
    const otherEnv = await pipeOk(CreateEgsUnitDto, { deviceName: 'POS-1', environment: 'staging' });
    assert.equal(otherEnv.environment, 'staging', 'an unknown environment passes the pipe (service falls back)');
  }

  // 7. RequestComplianceDto — NO frontend caller; the positive case is
  // the interface shape. egsId is NARROWED string|number -> string;
  // otp is a required string (the service enforces exactly-6).
  {
    const transformed = await pipeOk(RequestComplianceDto, { egsId: 'egs-9', otp: '123456' });
    assert.equal(transformed.egsId, 'egs-9', 'compliance egsId survives the pipe');
    await pipeRejects(RequestComplianceDto, { otp: '123456' }, 'a missing egsId is rejected');
    await pipeRejects(RequestComplianceDto, { egsId: 'egs-9' }, 'a missing otp is rejected');
    await pipeRejects(RequestComplianceDto, { egsId: 'egs-9', otp: '123456', extra: 1 }, 'an extra field is rejected');
    const coerced = await pipeOk(RequestComplianceDto, { egsId: 42, otp: '123456' });
    assert.strictEqual(coerced.egsId, '42', 'a numeric egsId coerces to the string "42"');
  }

  // 8. CreateApprovalRuleDto — NO frontend caller; the positive case
  // is the interface shape. module is purchase_orders ONLY; requiredRole
  // is 'admin' ONLY (both service whitelists).
  {
    const transformed = await pipeOk(CreateApprovalRuleDto, {
      module: 'purchase_orders',
      minAmount: 10000,
      maxAmount: 50000,
      tierLevel: 1,
      requiredRole: 'admin',
      approverUserId: 4,
      notes: 'large POs',
    });
    assert.equal(transformed.module, 'purchase_orders', 'rule module survives the pipe');
    assert.equal(transformed.minAmount, 10000, 'rule minAmount survives the pipe');
    const minimal = await pipeOk(CreateApprovalRuleDto, { module: 'purchase_orders' });
    assert.equal(
      minimal.minAmount,
      undefined,
      'a minimal rule passes — minAmount/tierLevel/role default in the service',
    );
    await pipeRejects(
      CreateApprovalRuleDto,
      { module: 'purchases', minAmount: 100 },
      'a non-purchase_orders module is rejected',
    );
    await pipeRejects(
      CreateApprovalRuleDto,
      { module: 'purchase_orders', requiredRole: 'manager' },
      'a non-admin requiredRole is rejected',
    );
    await pipeRejects(
      CreateApprovalRuleDto,
      { module: 'purchase_orders', minAmount: -5 },
      'a negative minAmount is rejected',
    );
    await pipeRejects(
      CreateApprovalRuleDto,
      { module: 'purchase_orders', tierLevel: 0 },
      'a tierLevel below 1 is rejected',
    );
    await pipeRejects(CreateApprovalRuleDto, { module: 'purchase_orders', extra: 1 }, 'an extra field is rejected');
  }

  // 9. UpdateApprovalRuleDto — NO frontend caller; the positive case
  // is the Partial shape. Every field optional.
  {
    const transformed = await pipeOk(UpdateApprovalRuleDto, { minAmount: 20000, isActive: false });
    assert.equal(transformed.minAmount, 20000, 'rule update minAmount survives the pipe');
    assert.equal(transformed.isActive, false, 'rule update isActive survives the pipe');
    const empty = await pipeOk(UpdateApprovalRuleDto, {});
    assert.equal(empty.notes, undefined, 'an empty rule update passes — every field is optional');
    await pipeRejects(
      UpdateApprovalRuleDto,
      { module: 'expenses' },
      'a non-purchase_orders module is rejected on update too',
    );
    await pipeRejects(UpdateApprovalRuleDto, { minAmount: 1, extra: 1 }, 'an extra field is rejected');
  }

  // 10. ApproveApprovalRequestDto — NO frontend caller; notes optional.
  {
    const transformed = await pipeOk(ApproveApprovalRequestDto, { notes: 'approved' });
    assert.equal(transformed.notes, 'approved', 'approve notes survive the pipe');
    const empty = await pipeOk(ApproveApprovalRequestDto, {});
    assert.equal(empty.notes, undefined, 'an empty approve passes — notes optional');
    await pipeRejects(ApproveApprovalRequestDto, { notes: 'x', extra: 1 }, 'an extra field is rejected');
  }

  // 11. RejectApprovalRequestDto — NO frontend caller; reason required
  // (the service throws when it is blank).
  {
    const transformed = await pipeOk(RejectApprovalRequestDto, { reason: 'amount too high' });
    assert.equal(transformed.reason, 'amount too high', 'reject reason survives the pipe');
    await pipeRejects(RejectApprovalRequestDto, {}, 'a missing reason is rejected');
    await pipeRejects(RejectApprovalRequestDto, { reason: 'x', extra: 1 }, 'an extra field is rejected');
  }

  // 12. Source pins: the controllers reference the DTO classes.
  {
    const eta = readSrc('modules/tax-integration/controllers/eta-invoices/eta-invoices.controller.ts');
    assert.ok(eta.includes('SubmitEtaInvoicesDto'), 'the ETA submit handler takes the DTO class');
    assert.ok(eta.includes('AttachSignatureDto'), 'the attach-signature handler takes the DTO class');
    const taxSettings = readSrc('modules/tax-integration/controllers/tax-settings/tax-settings.controller.ts');
    assert.ok(taxSettings.includes('TaxSettingsDto'), 'the tax-settings handler takes the DTO class');
    const zatca = readSrc('modules/tax-integration/controllers/zatca/zatca.controller.ts');
    assert.ok(zatca.includes('SubmitZatcaInvoicesBulkDto'), 'the ZATCA bulk-submit handler takes the DTO class');
    assert.ok(zatca.includes('ValidateZatcaComplianceDto'), 'the compliance-check handler takes the DTO class');
    assert.ok(zatca.includes('CreateEgsUnitDto'), 'the EGS create handler takes the DTO class');
    const approvals = readSrc('modules/approvals/approval-workflow.controller.ts');
    assert.ok(approvals.includes('CreateApprovalRuleDto'), 'the rule-create handler takes the DTO class');
    assert.ok(approvals.includes('UpdateApprovalRuleDto'), 'the rule-update handler takes the DTO class');
    assert.ok(approvals.includes('RejectApprovalRequestDto'), 'the reject handler takes the DTO class');
    console.log('  source pins passed');
  }

  // 13. Wiring: both new specs are in both critical lists, in
  // identical order (349 specs — the dto-tax-approvals spec is the
  // last entry).
  {
    const specs = JSON.parse(readFileSync(resolve(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
      .specs as string[];
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const serial = String(pkg.scripts['test:critical:serial']);
    const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
    assert.equal(specs.length, 370);
    assert.equal(chain.length, 370);
    assert.deepEqual(chain, specs);
    assert.ok(specs.includes('test/critical/dto-hr.spec.ts'));
    assert.ok(specs.includes('test/critical/dto-tax-approvals.spec.ts'));
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-b1-reports-sales.spec.ts');
    console.log('  evidence spec wired into both critical lists (370 = 370, identical order), passed');
  }

  console.log('DTO tax-approvals tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
