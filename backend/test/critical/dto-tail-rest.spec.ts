/*
 * New file: backend/test/critical/dto-tail-rest.spec.ts
 *
 * WHAT THIS PINS (INV-DTO-TAIL-30, D10): the tail controller routes in
 * import-sales (partner create/update + project partners + capital
 * transaction), partners (loyalty adjust + customer addresses),
 * pharmacy (distributor invoice import), saas-admin (tenant delete +
 * exit-impersonation + seed-demo + wipe-data), saas-diagnostics
 * (diagnostic bundle upload), tenant-subscription (sandbox checkout
 * complete) and users (user delete) now take DTO classes, so the real
 * global requestValidationPipe validates and whitelists them. Before
 * D10 they took `any`, inline object types, or interfaces — and the
 * pipe does nothing for those, so any extra field (or a wrong-typed
 * field) reached the service untouched.
 *
 * WHAT IS DRIVEN (the real global pipe from main.ts — no mocks, no
 * booted app; the pipe instance driven here IS the global one):
 * for EACH DTO, (a) a positive case with the REAL caller payload
 * (the exact shape the frontend api file sends; see the per-case
 * comments for the caller file), which must pass the pipe with
 * every field intact, and (b) negative cases: an extra field the
 * caller never sends is rejected with 400 VALIDATION_ERROR, and a
 * wrong-typed field is rejected the same way.
 *
 * CALLER TRAPS PINNED HERE (found during D10 caller verification):
 * - SetProjectPartnersDto: capitalShare is OPTIONAL (the SERVICE
 *   signature marks it optional) though the controller type marks it
 *   required; profitPercentage is REQUIRED.
 * - RecordCapitalTransactionDto: idempotencyKey is accepted though NO
 *   caller sends it (the service accepts it).
 * - ImportDistributorInvoiceDto: invoiceNumber is REQUIRED though the
 *   caller type marks it optional (the service 422s when it is missing,
 *   empty, or longer than 100 chars — D5 precedent); lines must be a
 *   non-empty array (the engine throws otherwise); quantity must be
 *   positive and prices non-negative (the engine enforces both).
 * - DeleteTenantDto / WipeTenantDataDto: superAdminPassword is REQUIRED
 *   and NON-EMPTY (the service verifies it in production; the frontend
 *   always sends it).
 * - ExitImpersonationDto: originalSessionId is REQUIRED and NON-EMPTY
 *   (the service throws BadRequest when it is missing/blank; the
 *   frontend always sends it).
 * - SeedTenantDemoDto: ALL fields optional (activityType defaults to
 *   'supermarket'; no whitelist found).
 * - UploadDiagnosticDto: ALL fields optional (the service defaults
 *   every one). NO frontend caller — desktop clients post crash bundles.
 * - CompleteSandboxCheckoutDto: ALL fields optional (the service
 *   coerces/defaults every field). NO frontend caller — the caller is
 *   the server-rendered sandbox form. gateway stays a PLAIN STRING
 *   (open-ended gateway names, the service lowercases).
 * - DeleteUserDto: managerPin is REQUIRED and NON-EMPTY (the service
 *   throws CURRENT_USER_PASSWORD_REQUIRED when it is missing/blank;
 *   the settings user-management caller sends { managerPin }).
 *
 * NOT DRIVEN: a live HTTP request through Nest (needs a booted app);
 * the services themselves (their own throws stay the backstop — e.g.
 * the distributor invoice engine, the super-admin password checks,
 * the current-user password check); the frontend screens (untouched).
 *
 * Fail-first: this spec is new in D10 — on the unpatched tree the DTO
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
  CreateImportPartnerDto,
  RecordCapitalTransactionDto,
  SetProjectPartnersDto,
  UpdateImportPartnerDto,
} from '../../src/modules/import-sales/dto/import-sales-dto/import-sales-dto-partners';
import { AdjustCustomerLoyaltyPointsDto, CustomerAddressDto } from '../../src/modules/partners/dto/partners-write.dto';
import { ImportDistributorInvoiceDto } from '../../src/modules/pharmacy/dto/distributor-invoice-write.dto';
import {
  DeleteTenantDto,
  ExitImpersonationDto,
  SeedTenantDemoDto,
  WipeTenantDataDto,
} from '../../src/modules/saas-admin/dto/saas-admin-lifecycle-write.dto';
import { UploadDiagnosticDto } from '../../src/modules/saas-admin/saas-diagnostics.service';
import { CompleteSandboxCheckoutDto } from '../../src/modules/tenant-subscription/dto/sandbox-checkout-write.dto';
import { DeleteUserDto } from '../../src/modules/users/dto/delete-user.dto';

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
  // 1. CreateImportPartnerDto — caller: shipments-partners
  // useCreatePartnerMutation sends { name, percentage, capitalAmount?,
  // accountId? }.
  {
    const transformed = await pipeOk(CreateImportPartnerDto, {
      name: 'شريك الاستيراد',
      percentage: 40,
      capitalAmount: 100000,
      accountId: 'acc-1',
    });
    assert.equal(transformed.name, 'شريك الاستيراد', 'partner name survives the pipe');
    assert.equal(transformed.percentage, 40, 'partner percentage survives the pipe');
    const minimal = await pipeOk(CreateImportPartnerDto, { name: 'شريك', percentage: 25 });
    assert.equal(minimal.capitalAmount, undefined, 'a minimal partner passes — capital/account optional');
    await pipeRejects(CreateImportPartnerDto, { percentage: 25 }, 'a missing partner name is rejected');
    await pipeRejects(CreateImportPartnerDto, { name: 'x' }, 'a missing partner percentage is rejected');
    await pipeRejects(
      CreateImportPartnerDto,
      { name: 'x', percentage: 'much' },
      'a wrong-typed percentage is rejected',
    );
    await pipeRejects(CreateImportPartnerDto, { name: 'x', percentage: 25, extra: 1 }, 'an extra field is rejected');
  }

  // 2. UpdateImportPartnerDto — caller: shipments-partners
  // useUpdatePartnerMutation sends { name?, percentage?, capitalAmount? }.
  {
    const transformed = await pipeOk(UpdateImportPartnerDto, { percentage: 30 });
    assert.equal(transformed.percentage, 30, 'partner percentage update survives the pipe');
    const empty = await pipeOk(UpdateImportPartnerDto, {});
    assert.equal(empty.name, undefined, 'an empty partner update passes — every field is optional');
    const coerced = await pipeOk(UpdateImportPartnerDto, { name: 42 });
    assert.strictEqual(coerced.name, '42', 'a numeric partner name coerces to the string "42"');
    await pipeRejects(UpdateImportPartnerDto, { percentage: 'much' }, 'a wrong-typed percentage is rejected');
    await pipeRejects(UpdateImportPartnerDto, { extra: 1 }, 'an extra field is rejected');
  }

  // 3. SetProjectPartnersDto — caller: shipments-projects
  // useSetProjectPartnersMutation sends { partners: [{ partnerId,
  // capitalShare?, profitPercentage }] }.
  {
    const transformed = await pipeOk(SetProjectPartnersDto, {
      partners: [
        { partnerId: 'p-1', capitalShare: 60000, profitPercentage: 60 },
        { partnerId: 'p-2', profitPercentage: 40 },
      ],
    });
    assert.equal(transformed.partners.length, 2, 'project partners survive the pipe');
    assert.equal(transformed.partners[1].capitalShare, undefined, 'capitalShare is optional (service signature)');
    await pipeRejects(SetProjectPartnersDto, {}, 'missing partners are rejected');
    await pipeRejects(
      SetProjectPartnersDto,
      { partners: [{ capitalShare: 1, profitPercentage: 50 }] },
      'a partner without partnerId is rejected',
    );
    await pipeRejects(
      SetProjectPartnersDto,
      { partners: [{ partnerId: 'p-1', capitalShare: 1 }] },
      'a partner without profitPercentage is rejected',
    );
    await pipeRejects(SetProjectPartnersDto, { partners: [], extra: 1 }, 'an extra field is rejected');
  }

  // 4. RecordCapitalTransactionDto — caller: shipments-partners
  // useRecordCapitalTransactionMutation sends { type, amount, date,
  // note?, accountId? } (no idempotencyKey — accepted anyway).
  {
    const transformed = await pipeOk(RecordCapitalTransactionDto, {
      type: 'DEPOSIT',
      amount: 5000,
      date: '2026-11-25',
      note: 'دفعة أولى',
      accountId: 'acc-1',
      idempotencyKey: 'key-1',
    });
    assert.equal(transformed.type, 'DEPOSIT', 'capital type survives the pipe');
    assert.equal(transformed.amount, 5000, 'capital amount survives the pipe');
    await pipeRejects(
      RecordCapitalTransactionDto,
      { amount: 5000, date: '2026-11-25' },
      'a missing capital type is rejected',
    );
    await pipeRejects(
      RecordCapitalTransactionDto,
      { type: 'PROFIT_PAYOUT', amount: 5000, date: '2026-11-25' },
      'an unknown capital type is rejected',
    );
    await pipeRejects(
      RecordCapitalTransactionDto,
      { type: 'DEPOSIT', date: '2026-11-25' },
      'a missing capital amount is rejected',
    );
    await pipeRejects(
      RecordCapitalTransactionDto,
      { type: 'DEPOSIT', amount: 5000 },
      'a missing capital date is rejected',
    );
    await pipeRejects(
      RecordCapitalTransactionDto,
      { type: 'DEPOSIT', amount: 5000, date: '2026-11-25', extra: 1 },
      'an extra field is rejected',
    );
  }

  // 5. AdjustCustomerLoyaltyPointsDto — caller: customers.api
  // adjustLoyaltyPoints sends { pointsChange, notes, actionType }.
  {
    const transformed = await pipeOk(AdjustCustomerLoyaltyPointsDto, {
      pointsChange: 100,
      actionType: 'earn',
      notes: 'مكافأة',
    });
    assert.equal(transformed.pointsChange, 100, 'loyalty pointsChange survives the pipe');
    const minimal = await pipeOk(AdjustCustomerLoyaltyPointsDto, { pointsChange: -50 });
    assert.equal(minimal.actionType, undefined, 'a minimal adjust passes — action defaults to manual_adjust');
    await pipeRejects(AdjustCustomerLoyaltyPointsDto, {}, 'a missing pointsChange is rejected');
    await pipeRejects(
      AdjustCustomerLoyaltyPointsDto,
      { pointsChange: 10, actionType: 'steal' },
      'an unknown loyalty actionType is rejected',
    );
    await pipeRejects(AdjustCustomerLoyaltyPointsDto, { pointsChange: 10, extra: 1 }, 'an extra field is rejected');
    const coerced = await pipeOk(AdjustCustomerLoyaltyPointsDto, { pointsChange: '100' });
    assert.strictEqual(coerced.pointsChange, 100, 'a numeric pointsChange string coerces to 100');
  }

  // 6. CustomerAddressDto — caller: customers.api addCustomerAddress /
  // deleteCustomerAddress send { address }.
  {
    const transformed = await pipeOk(CustomerAddressDto, { address: 'شارع الجمهورية 5' });
    assert.equal(transformed.address, 'شارع الجمهورية 5', 'customer address survives the pipe');
    await pipeRejects(CustomerAddressDto, {}, 'a missing address is rejected');
    await pipeRejects(CustomerAddressDto, { address: 'x', extra: 1 }, 'an extra field is rejected');
  }

  // 7. ImportDistributorInvoiceDto — caller: pharmacy.api
  // importDistributorInvoice sends { distributor, invoiceNumber?,
  // invoiceDate?, lines: [{ productName, barcode?, quantity,
  // bonusQuantity?, publicPrice, costPrice, expiryDate, batchNumber? }] }.
  {
    const transformed = await pipeOk(ImportDistributorInvoiceDto, {
      distributor: 'المتحدة',
      invoiceNumber: 'INV-1001',
      invoiceDate: '2026-11-25',
      supplierId: 3,
      locationId: 1,
      paymentType: 'credit',
      lines: [
        {
          productName: 'بانادول',
          barcode: '622000000001',
          quantity: 10,
          bonusQuantity: 2,
          publicPrice: 25,
          costPrice: 18,
          expiryDate: '2027-06-01',
          batchNumber: 'B-9',
        },
      ],
    });
    assert.equal(transformed.distributor, 'المتحدة', 'invoice distributor survives the pipe');
    assert.equal(transformed.lines[0].productName, 'بانادول', 'invoice lines survive the pipe');
    await pipeRejects(
      ImportDistributorInvoiceDto,
      { invoiceNumber: 'INV-1', lines: [] },
      'a missing distributor is rejected',
    );
    await pipeRejects(
      ImportDistributorInvoiceDto,
      {
        distributor: '  ',
        invoiceNumber: 'INV-1',
        lines: [{ productName: 'x', quantity: 1, publicPrice: 1, costPrice: 1, expiryDate: '2027-01-01' }],
      },
      'a blank distributor is rejected',
    );
    await pipeRejects(
      ImportDistributorInvoiceDto,
      {
        distributor: 'x',
        lines: [{ productName: 'x', quantity: 1, publicPrice: 1, costPrice: 1, expiryDate: '2027-01-01' }],
      },
      'a missing invoiceNumber is rejected (the service 422s without it)',
    );
    await pipeRejects(
      ImportDistributorInvoiceDto,
      {
        distributor: 'x',
        invoiceNumber: 'N'.repeat(101),
        lines: [{ productName: 'x', quantity: 1, publicPrice: 1, costPrice: 1, expiryDate: '2027-01-01' }],
      },
      'an invoiceNumber over 100 chars is rejected',
    );
    await pipeRejects(
      ImportDistributorInvoiceDto,
      { distributor: 'x', invoiceNumber: 'INV-1', lines: [] },
      'an empty lines array is rejected',
    );
    await pipeRejects(
      ImportDistributorInvoiceDto,
      {
        distributor: 'x',
        invoiceNumber: 'INV-1',
        lines: [{ quantity: 1, publicPrice: 1, costPrice: 1, expiryDate: '2027-01-01' }],
      },
      'a line without productName is rejected',
    );
    await pipeRejects(
      ImportDistributorInvoiceDto,
      {
        distributor: 'x',
        invoiceNumber: 'INV-1',
        lines: [{ productName: 'x', quantity: 0, publicPrice: 1, costPrice: 1, expiryDate: '2027-01-01' }],
      },
      'a zero quantity is rejected',
    );
    await pipeRejects(
      ImportDistributorInvoiceDto,
      {
        distributor: 'x',
        invoiceNumber: 'INV-1',
        lines: [{ productName: 'x', quantity: 1, publicPrice: 1, costPrice: -1, expiryDate: '2027-01-01' }],
      },
      'a negative costPrice is rejected',
    );
    await pipeRejects(
      ImportDistributorInvoiceDto,
      {
        distributor: 'x',
        invoiceNumber: 'INV-1',
        paymentType: 'cheque',
        lines: [{ productName: 'x', quantity: 1, publicPrice: 1, costPrice: 1, expiryDate: '2027-01-01' }],
      },
      'an unknown paymentType is rejected',
    );
    await pipeRejects(
      ImportDistributorInvoiceDto,
      {
        distributor: 'x',
        invoiceNumber: 'INV-1',
        lines: [{ productName: 'x', quantity: 1, publicPrice: 1, costPrice: 1, expiryDate: '2027-01-01' }],
        extra: 1,
      },
      'an extra field is rejected',
    );
  }

  // 8. DeleteTenantDto — caller: saas-admin.api deleteTenant sends
  // { superAdminPassword }.
  {
    const transformed = await pipeOk(DeleteTenantDto, { superAdminPassword: 's3cret' });
    assert.equal(transformed.superAdminPassword, 's3cret', 'delete password survives the pipe');
    await pipeRejects(DeleteTenantDto, {}, 'a missing delete password is rejected');
    await pipeRejects(DeleteTenantDto, { superAdminPassword: '' }, 'a blank delete password is rejected');
    await pipeRejects(DeleteTenantDto, { superAdminPassword: 'x', extra: 1 }, 'an extra field is rejected');
  }

  // 9. ExitImpersonationDto — caller: saas-admin.api exitImpersonation
  // sends { originalSessionId }.
  {
    const transformed = await pipeOk(ExitImpersonationDto, { originalSessionId: 'sess-abc' });
    assert.equal(transformed.originalSessionId, 'sess-abc', 'original session id survives the pipe');
    await pipeRejects(ExitImpersonationDto, {}, 'a missing originalSessionId is rejected');
    await pipeRejects(ExitImpersonationDto, { originalSessionId: '   ' }, 'a blank originalSessionId is rejected');
    await pipeRejects(ExitImpersonationDto, { originalSessionId: 'x', extra: 1 }, 'an extra field is rejected');
  }

  // 10. SeedTenantDemoDto — caller: saas-admin.api seedTenantDemo sends
  // { activityType, wipeExisting?, seedSales?, seedOnlineOrders? }.
  {
    const transformed = await pipeOk(SeedTenantDemoDto, {
      activityType: 'restaurant',
      wipeExisting: true,
      seedSales: true,
      seedOnlineOrders: false,
    });
    assert.equal(transformed.activityType, 'restaurant', 'seed activityType survives the pipe');
    const empty = await pipeOk(SeedTenantDemoDto, {});
    assert.equal(empty.activityType, undefined, 'an empty seed body passes — every field is optional');
    await pipeRejects(SeedTenantDemoDto, { activityType: 'x', extra: 1 }, 'an extra field is rejected');
    const stringFalse = await pipeOk(SeedTenantDemoDto, { wipeExisting: 'false' });
    assert.equal(stringFalse.wipeExisting, true, 'the string "false" converts to boolean true');
  }

  // 11. WipeTenantDataDto — caller: saas-admin.api wipeTenantData sends
  // { superAdminPassword }.
  {
    const transformed = await pipeOk(WipeTenantDataDto, { superAdminPassword: 's3cret' });
    assert.equal(transformed.superAdminPassword, 's3cret', 'wipe password survives the pipe');
    await pipeRejects(WipeTenantDataDto, {}, 'a missing wipe password is rejected');
    await pipeRejects(WipeTenantDataDto, { superAdminPassword: '' }, 'a blank wipe password is rejected');
    await pipeRejects(WipeTenantDataDto, { superAdminPassword: 'x', extra: 1 }, 'an extra field is rejected');
  }

  // 12. UploadDiagnosticDto — NO frontend caller; desktop clients post
  // crash bundles with { clientName, clientIdentifier, appVersion?,
  // logPeriod? }. The service defaults every field.
  {
    const transformed = await pipeOk(UploadDiagnosticDto, {
      clientName: 'مطعم النيل',
      clientIdentifier: 'client-42',
      appVersion: '2.1.0',
      logPeriod: '2026-11',
    });
    assert.equal(transformed.clientName, 'مطعم النيل', 'diagnostic clientName survives the pipe');
    const empty = await pipeOk(UploadDiagnosticDto, {});
    assert.equal(empty.clientIdentifier, undefined, 'an empty diagnostic body passes — every field is optional');
    await pipeRejects(UploadDiagnosticDto, { clientName: 'x', extra: 1 }, 'an extra field is rejected');
    const coerced = await pipeOk(UploadDiagnosticDto, { clientName: 42 });
    assert.strictEqual(coerced.clientName, '42', 'a numeric clientName coerces to the string "42"');
  }

  // 13. CompleteSandboxCheckoutDto — NO frontend caller; the caller is
  // the server-rendered sandbox form, which posts { gateway?, planId?,
  // duration?, amount?, currency?, ref?, redirectUrl? }. The service
  // coerces/defaults every field.
  {
    const transformed = await pipeOk(CompleteSandboxCheckoutDto, {
      gateway: 'xpay',
      planId: 2,
      duration: 12,
      amount: 1500,
      currency: 'EGP',
      ref: 'SANDBOX-1',
      redirectUrl: '/dashboard',
    });
    assert.equal(transformed.gateway, 'xpay', 'sandbox gateway survives the pipe');
    assert.equal(transformed.amount, 1500, 'sandbox amount survives the pipe');
    const empty = await pipeOk(CompleteSandboxCheckoutDto, {});
    assert.equal(empty.gateway, undefined, 'an empty sandbox body passes — every field is optional');
    await pipeRejects(CompleteSandboxCheckoutDto, { gateway: 'x', extra: 1 }, 'an extra field is rejected');
    const coerced = await pipeOk(CompleteSandboxCheckoutDto, { planId: '2' });
    assert.strictEqual(coerced.planId, 2, 'a numeric planId string coerces to 2');
  }

  // 14. DeleteUserDto — caller: settings.api deleteUser sends
  // { managerPin }.
  {
    const transformed = await pipeOk(DeleteUserDto, { managerPin: '1234' });
    assert.equal(transformed.managerPin, '1234', 'manager PIN survives the pipe');
    await pipeRejects(DeleteUserDto, {}, 'a missing managerPin is rejected');
    await pipeRejects(DeleteUserDto, { managerPin: '' }, 'a blank managerPin is rejected');
    await pipeRejects(DeleteUserDto, { managerPin: '1234', extra: 1 }, 'an extra field is rejected');
  }

  // 15. Source pins: the controllers reference the DTO classes.
  {
    const importSales = readSrc('modules/import-sales/import-sales.controller.ts');
    assert.ok(importSales.includes('CreateImportPartnerDto'), 'the partner-create handler takes the DTO class');
    assert.ok(importSales.includes('UpdateImportPartnerDto'), 'the partner-update handler takes the DTO class');
    assert.ok(importSales.includes('SetProjectPartnersDto'), 'the project-partners handler takes the DTO class');
    assert.ok(
      importSales.includes('RecordCapitalTransactionDto'),
      'the capital-transaction handler takes the DTO class',
    );
    const partners = readSrc('modules/partners/partners.controller.ts');
    assert.ok(partners.includes('AdjustCustomerLoyaltyPointsDto'), 'the loyalty-adjust handler takes the DTO class');
    assert.ok(partners.includes('CustomerAddressDto'), 'the address handlers take the DTO class');
    const pharmacy = readSrc('modules/pharmacy/pharmacy.controller.ts');
    assert.ok(pharmacy.includes('ImportDistributorInvoiceDto'), 'the distributor-invoice handler takes the DTO class');
    const saas = readSrc('modules/saas-admin/saas-admin.controller.ts');
    assert.ok(saas.includes('DeleteTenantDto'), 'the delete-tenant handler takes the DTO class');
    assert.ok(saas.includes('ExitImpersonationDto'), 'the exit-impersonation handler takes the DTO class');
    assert.ok(saas.includes('SeedTenantDemoDto'), 'the seed-demo handler takes the DTO class');
    assert.ok(saas.includes('WipeTenantDataDto'), 'the wipe-data handler takes the DTO class');
    const diagnostics = readSrc('modules/saas-admin/saas-diagnostics.service.ts');
    assert.ok(diagnostics.includes('class UploadDiagnosticDto'), 'UploadDiagnosticDto is a class, not an interface');
    const tenantSub = readSrc('modules/tenant-subscription/tenant-subscription.controller.ts');
    assert.ok(tenantSub.includes('CompleteSandboxCheckoutDto'), 'the sandbox-checkout handler takes the DTO class');
    const users = readSrc('modules/users/users.controller.ts');
    assert.ok(users.includes('DeleteUserDto'), 'the user-delete handler takes the DTO class');
    console.log('  source pins passed');
  }

  // 16. Wiring: both new specs are in both critical lists, in
  // identical order (349 specs — the dto-tail-rest spec is the
  // last entry).
  {
    const specs = JSON.parse(readFileSync(resolve(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
      .specs as string[];
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const serial = String(pkg.scripts['test:critical:serial']);
    const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
    assert.equal(specs.length, 379);
    assert.equal(chain.length, 379);
    assert.deepEqual(chain, specs);
    assert.ok(specs.includes('test/critical/dto-tail-core.spec.ts'));
    assert.ok(specs.includes('test/critical/dto-tail-rest.spec.ts'));
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-f3-feature-boundary-legs.spec.ts');
    console.log('  evidence spec wired into both critical lists (373 = 373, identical order), passed');
  }

  console.log('DTO tail-rest tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
