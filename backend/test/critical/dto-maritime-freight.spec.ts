/*
 * New file: backend/test/critical/dto-maritime-freight.spec.ts
 *
 * WHAT THIS PINS (INV-DTO-MARITIME-FREIGHT-28, D4): the 22
 * maritime-freight controller routes (master data, RFQ dispatch,
 * parse, jobs, money, containers, mail/pipeline settings, carrier
 * invoices, sub-jobs) now take DTO classes, so the real global
 * requestValidationPipe validates and whitelists them. Before D4
 * they took `any` or inline object types (or a Partial of an
 * interface for the mail settings) — and the pipe does nothing for
 * `any`, an inline type, or an interface, so any extra field (or a
 * wrong-typed field) reached the service untouched.
 *
 * WHAT IS DRIVEN (the real global pipe from main.ts — no mocks, no
 * booted app; the pipe instance driven here IS the global one):
 * for EACH DTO, (a) a positive case with the REAL caller payload (the
 * exact shape the frontend api file sends — see the per-case comments
 * for the caller file), which must pass the pipe with every field
 * intact, and (b) two negative cases: an extra field the caller never
 * sends is rejected with 400 VALIDATION_ERROR, and a wrong-typed
 * field is rejected the same way. Money endpoints (issue-invoice,
 * record-expense, settle-from-balance, carrier invoices) get their
 * positive case with the REAL caller payload.
 *
 * CALLER TRAPS PINNED HERE (found during D4 caller verification):
 * - CreateShippingLineDto.carrierType: the form sends FOUR values
 *   ('shipping_line' | 'overseas_agent' | 'airline' | 'trucking')
 *   while the service type declares only the first two. The DTO
 *   accepts all four; the positive case uses 'airline'.
 * - ImportCarriersBulkDto items: the modal sends camelCase fields
 *   PLUS `trackingUrl` and `isValid` inside every item (both
 *   unread by the service); the service also reads the snake_case
 *   spellings. The DTO accepts both spellings and both extra
 *   fields; item code/nameAr stay optional because the service
 *   SKIPS rows without them instead of throwing.
 * - UpdateJobDto: the service reads only a subset of what callers
 *   send. The DTO also declares the caller-only fields the service
 *   ignores today — `isConsolidation` (consolidation-master toggle),
 *   the ACI fields (acidNumber/acidIssueDate/acidExpiryDate/
 *   foreignExporterId/importerTaxId), and the cutoff fields
 *   (siCutoffDate/vgmCutoffDate/portCutoffDate) — because the
 *   callers send them and the pipe would otherwise 400 those
 *   saves. PRE-EXISTING IGNORES, NOT fixed here: those three saves
 *   are silent no-ops today (the service updates only `updated_at`).
 * - TestMailConnectionDto: the settings form sends NESTED
 *   { smtp, imap } but the service reads only the FLAT fields, so
 *   today the test ignores the form values and tests the SAVED
 *   config. PRE-EXISTING MISMATCH, NOT fixed here: the DTO accepts
 *   the nested shape the caller sends plus the flat fields.
 * - SaveMailSettingsDto.companyOfficialEmail: not in the
 *   MaritimeMailConfig interface, but the service reads and persists
 *   it and the form sends it with every save.
 * - SavePipelineSettingsDto.defaultExchangeRate: a legacy key the
 *   service deletes on save; accepted so an old client does not 400.
 * - CreateConsolidationSubJobDto: the sub-job form sends cbm,
 *   cargoDescription, clientInvoicedTotal and currency, which
 *   createJob ignores (not in CreateMaritimeJobDto). PRE-EXISTING
 *   IGNORE, NOT fixed here: the DTO accepts them as optional.
 * - SaveMailSettingsDto.smtpSecure: a string "false" coerces to
 *   boolean true under enableImplicitConversion — pinned, not
 *   fought (the form sends real booleans; this documents the
 *   footgun).
 *
 * NOT DRIVEN: a live HTTP request through Nest (needs a booted app);
 * the services themselves (their own throws stay the backstop —
 * e.g. the PIN length rules, the container-number throw, the
 * invoice total <= 0 throw, the exchange-rate != 1 throw on
 * settle-from-balance, the dispute status throw); the frontend
 * screens (untouched).
 *
 * Fail-first: this spec is new in D4 — on the unpatched tree the DTO
 * classes do not exist, so the imports fail (MODULE_NOT_FOUND) and the
 * spec exits 1 (see the log). GREEN means the pipe accepts every real
 * caller payload and rejects every extra/wrong-typed field below.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { requestValidationPipe } from '../../src/common/pipes/request-validation.pipe';
import {
  CreatePortDto,
  CreateShippingLineDto,
  ImportCarriersBulkDto,
  SetCustomerPortalPinDto,
  UpdateShippingLineDto,
} from '../../src/modules/maritime-freight/dto/freight-master-data.dto';
import {
  CreateConsolidationSubJobDto,
  CreateContainerDto,
  DispatchRfqEmailsDto,
  ParseBookingTextDto,
  ParseEmailTextDto,
  UpdateJobDto,
} from '../../src/modules/maritime-freight/dto/freight-jobs.dto';
import {
  CreateCarrierDisputeDto,
  CreateCarrierInvoiceDto,
  IssueJobSalesInvoiceDto,
  OverrideCarrierInvoiceDto,
  PreviewCarrierInvoiceAuditDto,
  RecordJobExpenseVoucherDto,
  ResolveCarrierDisputeDto,
  SettleJobFromBalanceDto,
} from '../../src/modules/maritime-freight/dto/freight-money.dto';
import {
  SaveMailSettingsDto,
  SavePipelineSettingsDto,
  TestMailConnectionDto,
} from '../../src/modules/maritime-freight/dto/freight-settings.dto';

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
  // 1. SetCustomerPortalPinDto — caller: useSetFreightPortalPinMutation
  // sends { pinCode } only (frontend/.../useSetFreightPortalPinMutation.ts).
  {
    const transformed = await pipeOk(SetCustomerPortalPinDto, { pinCode: '4821' });
    assert.equal(transformed.pinCode, '4821', 'the portal PIN survives the pipe');
    await pipeRejects(
      SetCustomerPortalPinDto,
      { pinCode: '4821', isAdmin: true },
      'an extra admin flag must be rejected on set portal PIN',
    );
    await pipeRejects(
      SetCustomerPortalPinDto,
      { pinCode: '12' },
      'a PIN shorter than 4 chars must be rejected on set portal PIN',
    );
    console.log('  (1) SetCustomerPortalPinDto: real caller payload passes, extra/short rejected passed');
  }

  // 2. CreatePortDto — caller: MaritimePortsTab sends exactly the 5
  // fields (frontend/.../maritime-freight-types.ts:
  // CreateMaritimePortPayload).
  {
    const transformed = await pipeOk(CreatePortDto, {
      code: 'EGALY',
      nameAr: 'الإسكندرية',
      nameEn: 'Alexandria',
      countryCode: 'EG',
      countryName: 'Egypt',
    });
    assert.equal(transformed.code, 'EGALY', 'the port code survives the pipe');
    assert.equal(transformed.countryCode, 'EG', 'the country code survives the pipe');
    await pipeRejects(
      CreatePortDto,
      {
        code: 'EGALY',
        nameAr: 'الإسكندرية',
        nameEn: 'Alexandria',
        countryCode: 'EG',
        countryName: 'Egypt',
        isAdmin: true,
      },
      'an extra admin flag must be rejected on create port',
    );
    await pipeRejects(
      CreatePortDto,
      { nameAr: 'الإسكندرية', nameEn: 'Alexandria', countryCode: 'EG', countryName: 'Egypt' },
      'a missing port code must be rejected on create port',
    );
    console.log('  (2) CreatePortDto: real caller payload passes, extra/missing rejected passed');
  }

  // 3. CreateShippingLineDto — caller: PartnerFormModal sends the same
  // shape for create and update (frontend/.../PartnerFormModal.tsx:55).
  // The positive case uses carrierType 'airline' — the fourth value
  // the form offers but the service type omits.
  {
    const transformed = await pipeOk(CreateShippingLineDto, {
      code: 'MSK',
      nameAr: 'ميرسك',
      nameEn: 'Maersk',
      carrierType: 'airline',
      tradeLanes: 'EG-AE',
      countryName: 'Denmark',
      countryCode: 'DK',
      cityName: 'Copenhagen',
      contactPerson: 'Ali',
      email: 'ops@maersk.example',
      rfqEmail: 'rfq@maersk.example',
      bookingEmail: 'book@maersk.example',
      phone: '+4520112233',
      whatsapp: '+4520112233',
      servicesOffered: 'FCL, LCL',
      supportedPorts: 'EGALY,AEJEA',
      notes: 'Preferred line',
    });
    assert.equal(transformed.code, 'MSK', 'the line code survives the pipe');
    assert.equal(transformed.carrierType, 'airline', 'the fourth carrier type survives the pipe');
    assert.equal(transformed.rfqEmail, 'rfq@maersk.example', 'the RFQ email survives the pipe');
    await pipeRejects(
      CreateShippingLineDto,
      { code: 'MSK', nameAr: 'ميرسك', isAdmin: true },
      'an extra admin flag must be rejected on create shipping line',
    );
    await pipeRejects(
      CreateShippingLineDto,
      { code: 'MSK', nameAr: 'ميرسك', carrierType: 'rail' },
      'an unknown carrier type must be rejected on create shipping line',
    );
    await pipeRejects(
      CreateShippingLineDto,
      { code: 'MSK' },
      'a missing line name must be rejected on create shipping line',
    );
    console.log('  (3) CreateShippingLineDto: real caller payload passes, extra/wrong-type/missing rejected passed');
  }

  // 4. UpdateShippingLineDto — caller: PartnerFormModal sends the full
  // form payload (including `code`, which the service ignores).
  {
    const transformed = await pipeOk(UpdateShippingLineDto, {
      code: 'MSK',
      nameAr: 'ميرسك',
      carrierType: 'overseas_agent',
      countryName: 'Denmark',
    });
    assert.equal(transformed.code, 'MSK', 'the ignored code still passes the pipe on update');
    assert.equal(transformed.carrierType, 'overseas_agent', 'the carrier type survives the pipe on update');
    const partial = await pipeOk(UpdateShippingLineDto, { notes: 'New note' });
    assert.equal(partial.notes, 'New note', 'a partial update passes (all optional)');
    await pipeRejects(
      UpdateShippingLineDto,
      { nameAr: 'ميرسك', isAdmin: true },
      'an extra admin flag must be rejected on update shipping line',
    );
    await pipeRejects(
      UpdateShippingLineDto,
      { carrierType: 'rail' },
      'an unknown carrier type must be rejected on update shipping line',
    );
    console.log('  (4) UpdateShippingLineDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 5. ImportCarriersBulkDto — caller: ImportCarriersModal sends only
  // filtered valid rows with camelCase fields PLUS trackingUrl and
  // isValid inside every item (frontend/.../ImportCarriersModal.tsx).
  {
    const transformed = await pipeOk(ImportCarriersBulkDto, {
      items: [
        {
          code: 'MSK',
          nameAr: 'ميرسك',
          nameEn: 'Maersk',
          carrierType: 'shipping_line',
          countryName: 'Denmark',
          countryCode: 'DK',
          email: 'ops@maersk.example',
          rfqEmail: 'rfq@maersk.example',
          trackingUrl: 'https://track.example/msk',
          isValid: true,
        },
        {
          code: 'MSC',
          name_ar: 'ام اس سي',
          carrier_type: 'overseas_agent',
          country_name: 'Switzerland',
        },
      ],
    });
    assert.equal(transformed.items.length, 2, 'both import rows survive the pipe');
    assert.equal(transformed.items[0].trackingUrl, 'https://track.example/msk', 'the tracking URL survives the pipe');
    assert.equal(transformed.items[0].isValid, true, 'the isValid flag survives the pipe');
    assert.equal(transformed.items[1].name_ar, 'ام اس سي', 'the snake_case name spelling survives the pipe');
    assert.equal(transformed.items[1].carrier_type, 'overseas_agent', 'the snake_case carrier type survives the pipe');
    await pipeRejects(
      ImportCarriersBulkDto,
      { items: [{ code: 'MSK', nameAr: 'ميرسك' }], isAdmin: true },
      'an extra admin flag must be rejected on import-bulk',
    );
    await pipeRejects(ImportCarriersBulkDto, { items: [] }, 'an empty items array must be rejected on import-bulk');
    await pipeRejects(
      ImportCarriersBulkDto,
      { items: [{ code: 'MSK', nameAr: ['ميرسك'] }] },
      'a wrong-typed item name must be rejected on import-bulk',
    );
    console.log('  (5) ImportCarriersBulkDto: real caller payload passes, extra/empty/wrong-type rejected passed');
  }

  // 6. DispatchRfqEmailsDto — caller: FreightAuditTab sends
  // { targetLineIds } (dropped to {} when undefined).
  {
    const transformed = await pipeOk(DispatchRfqEmailsDto, { targetLineIds: [3, 5] });
    assert.deepEqual(transformed.targetLineIds, [3, 5], 'the target line ids survive the pipe');
    const empty = await pipeOk(DispatchRfqEmailsDto, {});
    assert.equal(empty.targetLineIds, undefined, 'an empty dispatch payload passes (falls back to the RFQ lines)');
    await pipeRejects(
      DispatchRfqEmailsDto,
      { targetLineIds: [3], isAdmin: true },
      'an extra admin flag must be rejected on dispatch-emails',
    );
    await pipeRejects(
      DispatchRfqEmailsDto,
      { targetLineIds: ['three'] },
      'a non-numeric line id must be rejected on dispatch-emails',
    );
    console.log('  (6) DispatchRfqEmailsDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 7. ParseEmailTextDto — caller: maritimeApi.parseEmailText sends
  // { text } (CarrierBidEntryModal).
  {
    const transformed = await pipeOk(ParseEmailTextDto, { text: 'Ocean freight USD 1250, THC 120' });
    assert.equal(transformed.text, 'Ocean freight USD 1250, THC 120', 'the email text survives the pipe');
    const rawText = await pipeOk(ParseEmailTextDto, { rawText: 'Ocean freight USD 1250' });
    assert.equal(rawText.rawText, 'Ocean freight USD 1250', 'the rawText spelling survives the pipe');
    await pipeRejects(
      ParseEmailTextDto,
      { text: 'x', isAdmin: true },
      'an extra admin flag must be rejected on parse-email-text',
    );
    await pipeRejects(ParseEmailTextDto, { text: ['x'] }, 'an array text must be rejected on parse-email-text');
    console.log('  (7) ParseEmailTextDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 8. ParseBookingTextDto — caller: maritimeApi.parseBookingText
  // sends { text } (JobSmartParseDisputeDialogs).
  {
    const transformed = await pipeOk(ParseBookingTextDto, { text: 'Vessel EVER GIVEN V.123 ETA 2026-12-20' });
    assert.equal(transformed.text, 'Vessel EVER GIVEN V.123 ETA 2026-12-20', 'the booking text survives the pipe');
    await pipeRejects(
      ParseBookingTextDto,
      { text: 'x', isAdmin: true },
      'an extra admin flag must be rejected on parse-booking-text',
    );
    await pipeRejects(ParseBookingTextDto, { text: ['x'] }, 'an array text must be rejected on parse-booking-text');
    console.log('  (8) ParseBookingTextDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 9. UpdateJobDto — callers: JobVoyageContainerDialogs (voyage form),
  // JobSmartParseDisputeDialogs (parsed booking), JobConsolidationTab
  // (isConsolidation toggle), JobEgyptianAciCard (ACI fields),
  // JobExportCutoffsCard (cutoff fields). The last three groups are
  // caller-only fields the service ignores today (see header).
  {
    const transformed = await pipeOk(UpdateJobDto, {
      vesselName: 'EVER GIVEN',
      voyageNumber: '123E',
      bookingNumber: 'BKG-7788',
      etd: '2026-12-10',
      eta: '2026-12-20',
      portCutOff: '2026-12-08',
      blType: 'telex_release',
      mblNumber: 'MSKU123456',
      hblNumber: 'HBL-99',
      shipperDetails: 'Acme Trading',
      consigneeDetails: 'Beta Ltd',
      notifyParty: 'Gamma Co',
      notes: 'Handle with care',
    });
    assert.equal(transformed.vesselName, 'EVER GIVEN', 'the vessel name survives the pipe');
    assert.equal(transformed.blType, 'telex_release', 'the BL type survives the pipe');
    const callerOnly = await pipeOk(UpdateJobDto, {
      isConsolidation: true,
      acidNumber: 'ACID-2026-001',
      acidIssueDate: '2026-11-20',
      acidExpiryDate: '2027-05-20',
      foreignExporterId: 'EXP-1',
      importerTaxId: 'TAX-2',
      siCutoffDate: '2026-12-05',
      vgmCutoffDate: '2026-12-06',
      portCutoffDate: '2026-12-07',
    });
    assert.equal(callerOnly.isConsolidation, true, 'the consolidation flag survives the pipe');
    assert.equal(callerOnly.acidNumber, 'ACID-2026-001', 'the ACI number survives the pipe');
    assert.equal(callerOnly.siCutoffDate, '2026-12-05', 'the SI cutoff survives the pipe');
    const empty = await pipeOk(UpdateJobDto, {});
    assert.equal(empty.vesselName, undefined, 'an empty update passes (all optional)');
    await pipeRejects(
      UpdateJobDto,
      { vesselName: 'EVER GIVEN', isAdmin: true },
      'an extra admin flag must be rejected on update job',
    );
    await pipeRejects(UpdateJobDto, { status: 'shipped' }, 'an unknown job status must be rejected on update job');
    await pipeRejects(UpdateJobDto, { blType: 'copy' }, 'an unknown BL type must be rejected on update job');
    console.log('  (9) UpdateJobDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 10. IssueJobSalesInvoiceDto (MONEY) — caller: JobMoneyDialogs
  // sends { amount, notes } (amount client-guarded > 0).
  {
    const transformed = await pipeOk(IssueJobSalesInvoiceDto, { amount: 1500, notes: 'First invoice' });
    assert.equal(transformed.amount, 1500, 'the invoice amount survives the pipe');
    assert.equal(transformed.notes, 'First invoice', 'the invoice note survives the pipe');
    const empty = await pipeOk(IssueJobSalesInvoiceDto, {});
    assert.equal(empty.amount, undefined, 'an empty issue-invoice payload passes (defaults to the job total)');
    await pipeRejects(
      IssueJobSalesInvoiceDto,
      { amount: 1500, isAdmin: true },
      'an extra admin flag must be rejected on issue-invoice',
    );
    await pipeRejects(IssueJobSalesInvoiceDto, { amount: 0 }, 'a zero amount must be rejected on issue-invoice');
    await pipeRejects(IssueJobSalesInvoiceDto, { amount: -5 }, 'a negative amount must be rejected on issue-invoice');
    console.log('  (10) IssueJobSalesInvoiceDto: real caller payload passes, extra/zero/negative rejected passed');
  }

  // 11. RecordJobExpenseVoucherDto (MONEY) — caller: JobMoneyDialogs
  // sends { amount, expenseType, paymentMethod, description }.
  {
    const transformed = await pipeOk(RecordJobExpenseVoucherDto, {
      amount: 200,
      expenseType: 'port',
      paymentMethod: 'cash',
      description: 'Port handling',
    });
    assert.equal(transformed.amount, 200, 'the expense amount survives the pipe');
    assert.equal(transformed.expenseType, 'port', 'the expense type survives the pipe');
    assert.equal(transformed.paymentMethod, 'cash', 'the payment method survives the pipe');
    await pipeRejects(
      RecordJobExpenseVoucherDto,
      { amount: 200, isAdmin: true },
      'an extra admin flag must be rejected on record-expense',
    );
    await pipeRejects(RecordJobExpenseVoucherDto, { amount: 0 }, 'a zero amount must be rejected on record-expense');
    await pipeRejects(
      RecordJobExpenseVoucherDto,
      { amount: 200, expenseType: 'fuel' },
      'an unknown expense type must be rejected on record-expense',
    );
    console.log('  (11) RecordJobExpenseVoucherDto: real caller payload passes, extra/zero/wrong-type rejected passed');
  }

  // 12. SettleJobFromBalanceDto (MONEY) — caller: JobMoneyDialogs
  // sends { amount } or {}.
  {
    const transformed = await pipeOk(SettleJobFromBalanceDto, { amount: 500 });
    assert.equal(transformed.amount, 500, 'the settle amount survives the pipe');
    const empty = await pipeOk(SettleJobFromBalanceDto, {});
    assert.equal(empty.amount, undefined, 'an empty settle payload passes (defaults to the remaining balance)');
    await pipeRejects(
      SettleJobFromBalanceDto,
      { amount: 500, isAdmin: true },
      'an extra admin flag must be rejected on settle-from-balance',
    );
    await pipeRejects(
      SettleJobFromBalanceDto,
      { amount: -1 },
      'a negative amount must be rejected on settle-from-balance',
    );
    console.log('  (12) SettleJobFromBalanceDto: real caller payload passes, extra/negative rejected passed');
  }

  // 13. CreateContainerDto — callers: JobVoyageContainerDialogs and
  // JobSmartParseDisputeDialogs (parsed containers, freeDays 14).
  {
    const transformed = await pipeOk(CreateContainerDto, {
      jobId: '12',
      containerNumber: 'MSKU1234567',
      containerType: "40' HC",
      freeDays: 14,
    });
    assert.equal(transformed.jobId, '12', 'the job id survives the pipe');
    assert.equal(transformed.containerNumber, 'MSKU1234567', 'the container number survives the pipe');
    assert.equal(transformed.freeDays, 14, 'the free days survive the pipe');
    await pipeRejects(
      CreateContainerDto,
      { jobId: '12', containerNumber: 'MSKU1234567', isAdmin: true },
      'an extra admin flag must be rejected on create container',
    );
    await pipeRejects(
      CreateContainerDto,
      { jobId: '12', containerNumber: '' },
      'a blank container number must be rejected on create container',
    );
    await pipeRejects(
      CreateContainerDto,
      { jobId: '12', containerNumber: 'MSKU1234567', freeDays: -1 },
      'negative free days must be rejected on create container',
    );
    await pipeRejects(
      CreateContainerDto,
      { jobId: '12', containerNumber: 'MSKU1234567', freeDays: 1.5 },
      'fractional free days must be rejected on create container',
    );
    console.log(
      '  (13) CreateContainerDto: real caller payload passes, extra/blank/negative/fractional rejected passed',
    );
  }

  // 14. SaveMailSettingsDto — caller: MaritimeSettingsTab sends the
  // full flat config PLUS companyOfficialEmail.
  {
    const transformed = await pipeOk(SaveMailSettingsDto, {
      outgoingProvider: 'outlook',
      smtpHost: 'smtp.office365.com',
      smtpPort: 587,
      smtpSecure: true,
      smtpUser: 'ops@example.com',
      smtpPassword: 'secret',
      fromName: 'Freight Ops',
      fromEmail: 'ops@example.com',
      incomingProvider: 'outlook',
      imapHost: 'outlook.office365.com',
      imapPort: 993,
      imapSecure: true,
      imapUser: 'ops@example.com',
      imapPassword: 'secret',
      autoReadInboundBids: true,
      companyOfficialEmail: 'official@example.com',
    });
    assert.equal(transformed.smtpHost, 'smtp.office365.com', 'the SMTP host survives the pipe');
    assert.equal(transformed.smtpPort, 587, 'the SMTP port survives the pipe');
    assert.equal(transformed.companyOfficialEmail, 'official@example.com', 'the company email survives the pipe');
    const empty = await pipeOk(SaveMailSettingsDto, {});
    assert.equal(empty.smtpHost, undefined, 'an empty mail settings payload passes (all optional)');
    const coerced = await pipeOk(SaveMailSettingsDto, { smtpSecure: 'false' });
    assert.equal(coerced.smtpSecure, true, 'a string "false" coerces to true (implicit conversion, pinned not fought)');
    await pipeRejects(
      SaveMailSettingsDto,
      { smtpHost: 'smtp.example.com', isAdmin: true },
      'an extra admin flag must be rejected on save mail settings',
    );
    await pipeRejects(
      SaveMailSettingsDto,
      { smtpPort: 'five-eight-seven' },
      'a non-numeric SMTP port must be rejected on save mail settings',
    );
    await pipeRejects(
      SaveMailSettingsDto,
      { outgoingProvider: 'yahoo' },
      'an unknown mail provider must be rejected on save mail settings',
    );
    console.log('  (14) SaveMailSettingsDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 15. TestMailConnectionDto — caller: MaritimeSettingsTab sends
  // NESTED { smtp, imap } (see header: the service reads the flat
  // fields instead — PRE-EXISTING MISMATCH).
  {
    const transformed = await pipeOk(TestMailConnectionDto, {
      smtp: { host: 'smtp.office365.com', port: 587, secure: true, user: 'ops@example.com', password: 'secret' },
      imap: { host: 'outlook.office365.com', port: 993, secure: true, user: 'ops@example.com', password: 'secret' },
    });
    assert.equal(transformed.smtp?.host, 'smtp.office365.com', 'the nested SMTP host survives the pipe');
    assert.equal(transformed.smtp?.port, 587, 'the nested SMTP port survives the pipe');
    assert.equal(transformed.imap?.host, 'outlook.office365.com', 'the nested IMAP host survives the pipe');
    const flat = await pipeOk(TestMailConnectionDto, { smtpHost: 'smtp.example.com', smtpPort: 587 });
    assert.equal(flat.smtpHost, 'smtp.example.com', 'the flat SMTP host survives the pipe (service override path)');
    await pipeRejects(
      TestMailConnectionDto,
      { smtp: { host: 'smtp.example.com' }, isAdmin: true },
      'an extra admin flag must be rejected on test mail connection',
    );
    await pipeRejects(
      TestMailConnectionDto,
      { smtp: { host: 'smtp.example.com', port: 'five-eight-seven' } },
      'a non-numeric nested SMTP port must be rejected on test mail connection',
    );
    console.log('  (15) TestMailConnectionDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 16. SavePipelineSettingsDto — callers: MaritimePipelineSettingsTab
  // (full config from the GET) and MaritimeContext (Partial updates).
  {
    const transformed = await pipeOk(SavePipelineSettingsDto, {
      enableSeaFreight: true,
      enableAirFreight: true,
      enableRoadFreight: false,
      automationMode: 'hybrid',
      defaultMarginType: 'percentage',
      defaultMarginValue: 10,
      marginFloor: 5,
      rfqCutOffHoursStandard: 48,
      rfqCutOffHoursUrgent: 12,
      earlyAwardingEnabled: true,
      earlyAwardingMinFreeDays: 7,
      requireManualRfqDispatch: false,
      requireManualAwardAndMargin: true,
      requireManualQuoteDispatch: true,
      autoSendWhatsAppQuote: false,
      autoSendEmailQuote: true,
      defaultExchangeRate: 48.5,
    });
    assert.equal(transformed.automationMode, 'hybrid', 'the automation mode survives the pipe');
    assert.equal(transformed.defaultMarginValue, 10, 'the default margin survives the pipe');
    assert.equal(transformed.defaultExchangeRate, 48.5, 'the legacy exchange-rate key survives the pipe');
    const partial = await pipeOk(SavePipelineSettingsDto, { automationMode: 'manual' });
    assert.equal(partial.automationMode, 'manual', 'a partial pipeline update passes (all optional)');
    await pipeRejects(
      SavePipelineSettingsDto,
      { automationMode: 'manual', isAdmin: true },
      'an extra admin flag must be rejected on save pipeline settings',
    );
    await pipeRejects(
      SavePipelineSettingsDto,
      { automationMode: 'auto' },
      'an unknown automation mode must be rejected on save pipeline settings',
    );
    console.log('  (16) SavePipelineSettingsDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 17. PreviewCarrierInvoiceAuditDto (MONEY) — caller: JobMoneyDialogs
  // sends { invoicedTotal, shippingLineId, currency } (shippingLineId
  // may be null when the job has no line).
  {
    const transformed = await pipeOk(PreviewCarrierInvoiceAuditDto, {
      invoicedTotal: 1000,
      shippingLineId: 5,
      currency: 'USD',
    });
    assert.equal(transformed.invoicedTotal, 1000, 'the invoiced total survives the pipe');
    assert.equal(transformed.shippingLineId, 5, 'the shipping line id survives the pipe');
    const nullLine = await pipeOk(PreviewCarrierInvoiceAuditDto, {
      invoicedTotal: 1000,
      shippingLineId: null,
      currency: 'USD',
    });
    assert.equal(nullLine.shippingLineId, null, 'a null shipping line id survives the pipe');
    await pipeRejects(
      PreviewCarrierInvoiceAuditDto,
      { invoicedTotal: 1000, isAdmin: true },
      'an extra admin flag must be rejected on preview carrier invoice audit',
    );
    await pipeRejects(
      PreviewCarrierInvoiceAuditDto,
      { invoicedTotal: 'one-thousand' },
      'a non-numeric invoiced total must be rejected on preview carrier invoice audit',
    );
    console.log('  (17) PreviewCarrierInvoiceAuditDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 18. CreateCarrierInvoiceDto (MONEY) — caller: JobMoneyDialogs
  // sends { invoiceNumber, totalInvoicedAmount, currency,
  // shippingLineId, carrierName, notes }.
  {
    const transformed = await pipeOk(CreateCarrierInvoiceDto, {
      invoiceNumber: 'INV-2026-001',
      totalInvoicedAmount: 1250,
      currency: 'USD',
      shippingLineId: 5,
      carrierName: 'Maersk',
      notes: 'First carrier invoice',
    });
    assert.equal(transformed.invoiceNumber, 'INV-2026-001', 'the invoice number survives the pipe');
    assert.equal(transformed.totalInvoicedAmount, 1250, 'the invoiced amount survives the pipe');
    await pipeRejects(
      CreateCarrierInvoiceDto,
      { invoiceNumber: 'INV-2026-001', totalInvoicedAmount: 1250, isAdmin: true },
      'an extra admin flag must be rejected on create carrier invoice',
    );
    await pipeRejects(
      CreateCarrierInvoiceDto,
      { invoiceNumber: 'INV-2026-001', totalInvoicedAmount: 0 },
      'a zero invoiced amount must be rejected on create carrier invoice',
    );
    await pipeRejects(
      CreateCarrierInvoiceDto,
      { totalInvoicedAmount: 1250 },
      'a missing invoice number must be rejected on create carrier invoice',
    );
    console.log('  (18) CreateCarrierInvoiceDto: real caller payload passes, extra/zero/missing rejected passed');
  }

  // 19. OverrideCarrierInvoiceDto — caller: FreightAuditTab sends the
  // reason only, guarded non-empty client-side.
  {
    const transformed = await pipeOk(OverrideCarrierInvoiceDto, { reason: 'Rate card confirms the charge' });
    assert.equal(transformed.reason, 'Rate card confirms the charge', 'the override reason survives the pipe');
    await pipeRejects(
      OverrideCarrierInvoiceDto,
      { reason: 'ok', isAdmin: true },
      'an extra admin flag must be rejected on override carrier invoice',
    );
    await pipeRejects(
      OverrideCarrierInvoiceDto,
      { reason: '' },
      'an empty override reason must be rejected on override carrier invoice',
    );
    console.log('  (19) OverrideCarrierInvoiceDto: real caller payload passes, extra/empty rejected passed');
  }

  // 20. CreateCarrierDisputeDto — caller: FreightAuditTab sends
  // { reason, disputedAmount? }.
  {
    const transformed = await pipeOk(CreateCarrierDisputeDto, {
      reason: 'Charged above the rate card',
      disputedAmount: 150,
    });
    assert.equal(transformed.reason, 'Charged above the rate card', 'the dispute reason survives the pipe');
    assert.equal(transformed.disputedAmount, 150, 'the disputed amount survives the pipe');
    const empty = await pipeOk(CreateCarrierDisputeDto, {});
    assert.equal(empty.reason, undefined, 'an empty dispute payload passes (the service defaults both fields)');
    await pipeRejects(
      CreateCarrierDisputeDto,
      { reason: 'x', isAdmin: true },
      'an extra admin flag must be rejected on create carrier dispute',
    );
    await pipeRejects(
      CreateCarrierDisputeDto,
      { reason: 'x', disputedAmount: 'one-fifty' },
      'a non-numeric disputed amount must be rejected on create carrier dispute',
    );
    console.log('  (20) CreateCarrierDisputeDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 21. ResolveCarrierDisputeDto — NO frontend caller (only the api
  // function exists); the positive case is the service type exactly.
  {
    const transformed = await pipeOk(ResolveCarrierDisputeDto, {
      status: 'accepted',
      resolutionNotes: 'Carrier accepted the rate card price',
      creditNoteNumber: 'CN-2026-004',
      creditNoteAmount: 150,
    });
    assert.equal(transformed.status, 'accepted', 'the resolution status survives the pipe');
    assert.equal(transformed.creditNoteAmount, 150, 'the credit note amount survives the pipe');
    await pipeRejects(
      ResolveCarrierDisputeDto,
      { status: 'accepted', isAdmin: true },
      'an extra admin flag must be rejected on resolve carrier dispute',
    );
    await pipeRejects(
      ResolveCarrierDisputeDto,
      { status: 'pending' },
      'an unknown dispute status must be rejected on resolve carrier dispute',
    );
    await pipeRejects(
      ResolveCarrierDisputeDto,
      { status: 'accepted', creditNoteAmount: -5 },
      'a negative credit note amount must be rejected on resolve carrier dispute',
    );
    console.log('  (21) ResolveCarrierDisputeDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 22. CreateConsolidationSubJobDto — caller: JobConsolidationTab
  // sends { customerName, hblNumber?, cargoDescription?,
  // packageCount, grossWeightKg, cbm, clientInvoicedTotal, currency }.
  {
    const transformed = await pipeOk(CreateConsolidationSubJobDto, {
      customerName: 'Acme Trading',
      hblNumber: 'HBL-101',
      cargoDescription: 'Dates, packed cartons',
      packageCount: 40,
      grossWeightKg: 800,
      cbm: 3.2,
      clientInvoicedTotal: 2400,
      currency: 'USD',
    });
    assert.equal(transformed.customerName, 'Acme Trading', 'the customer name survives the pipe');
    assert.equal(transformed.cargoDescription, 'Dates, packed cartons', 'the cargo description survives the pipe');
    assert.equal(transformed.cbm, 3.2, 'the cbm survives the pipe');
    assert.equal(transformed.clientInvoicedTotal, 2400, 'the client invoiced total survives the pipe');
    const empty = await pipeOk(CreateConsolidationSubJobDto, {});
    assert.equal(empty.customerName, undefined, 'an empty sub-job payload passes (all optional)');
    await pipeRejects(
      CreateConsolidationSubJobDto,
      { customerName: 'Acme Trading', isAdmin: true },
      'an extra admin flag must be rejected on create sub-job',
    );
    await pipeRejects(
      CreateConsolidationSubJobDto,
      { customerName: 'Acme Trading', transportMode: 'rail' },
      'an unknown transport mode must be rejected on create sub-job',
    );
    console.log('  (22) CreateConsolidationSubJobDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // Source pins: the freight controller takes the DTO classes (not
  // `any` or inline types) on all 22 routes.
  {
    const read = (rel: string): string => readFileSync(resolve(__dirname, '../../src', rel), 'utf8');
    const freightController = read('modules/maritime-freight/maritime-freight.controller.ts');
    for (const name of [
      'SetCustomerPortalPinDto',
      'CreatePortDto',
      'CreateShippingLineDto',
      'UpdateShippingLineDto',
      'ImportCarriersBulkDto',
      'DispatchRfqEmailsDto',
      'ParseEmailTextDto',
      'ParseBookingTextDto',
      'UpdateJobDto',
      'IssueJobSalesInvoiceDto',
      'RecordJobExpenseVoucherDto',
      'SettleJobFromBalanceDto',
      'CreateContainerDto',
      'SaveMailSettingsDto',
      'TestMailConnectionDto',
      'SavePipelineSettingsDto',
      'PreviewCarrierInvoiceAuditDto',
      'CreateCarrierInvoiceDto',
      'OverrideCarrierInvoiceDto',
      'CreateCarrierDisputeDto',
      'ResolveCarrierDisputeDto',
      'CreateConsolidationSubJobDto',
    ]) {
      assert.ok(freightController.includes(name), `the freight controller takes ${name}`);
    }
    assert.ok(!freightController.includes('body: any'), 'no freight route takes any anymore');
    assert.ok(!freightController.includes('dto: any'), 'no freight route takes any anymore');
    assert.ok(
      !freightController.includes('Partial<MaritimeMailConfig>'),
      'no freight route takes a Partial interface anymore',
    );
    console.log('  source pins passed');
  }

  console.log('DTO maritime-freight tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
