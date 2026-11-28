/*
 * New file: backend/test/critical/dto-settings.spec.ts
 *
 * WHAT THIS PINS (INV-DTO-SETTINGS-22, D7): the 22 settings
 * controller routes (daily digest config, offline releases
 * simulate/apply/passcode/create, demo-data seed/clear/wipe/reset/
 * wipe-catalog, cloud backup config, backup verify/restore, CSV
 * import rows, WhatsApp config + provider webhook) now take DTO
 * classes, so the real global requestValidationPipe validates and
 * whitelists them. Before D7 they took inline object types, `any`,
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
 * and a wrong-typed field is rejected the same way.
 *
 * CALLER TRAPS PINNED HERE (found during D7 caller verification):
 * - SeedDemoDataDto: THREE frontend callers, all objects — the
 *   wizard sends all 5 fields, the sandbox card sends { password }
 *   only, the onboarding banner sends { activityType, password: '' }.
 *   The service's bare-string form (password-only) has NO live
 *   caller; the DTO does not accept a string body. All 5 fields
 *   are optional — the service defaults every one of them.
 * - ClearDemoDataDto.password is OPTIONAL: the service only checks
 *   a password for super_admin AND a password present; an admin or
 *   owner clears without a password. Wipe / reset / wipe-catalog
 *   passwords are REQUIRED: their services throw PASSWORD_REQUIRED
 *   on an empty password (D5 precedent).
 * - WhatsAppConfigDto.webhookSecret has NO @MinLength: the masked
 *   '••••••••' placeholder (8 chars) is explicitly skipped by the
 *   service — a min-length would 400 the save whenever the user
 *   does not change the secret. token is string-only for the same
 *   reason.
 * - WhatsAppConfigDto.provider enum is the SERVICE whitelist
 *   (sendRawMessage handles exactly ultramsg / greenapi /
 *   custom_webhook). CloudBackupConfigDto.lastBackupStatus enum
 *   is exactly the values the service ever writes ('', 'success',
 *   'failed').
 * - WhatsAppWebhookDto enumerates the three provider formats +
 *   the generic/simulator format at the top level (Meta object +
 *   entry, UltraMsg event_type + data, GreenAPI typeWebhook +
 *   messageData + senderData + instanceData + timestamp +
 *   idMessage, generic phone/message/text/question/simulate).
 *   Nested contents are NOT validated (unknown[] / object) — a
 *   new provider top-level key must be added here, or the pipe
 *   400s it (recorded risk).
 * - BackupEnvelopeDto is REUSED (it already existed, imported but
 *   unused in the backup controller): verify/restore take either
 *   a File (FormData — body {} or { confirmation }) or a JSON
 *   envelope { meta, tables } (+ confirmation). BackupMetaDto
 *   gains optional exported_at: normalizeEnvelope reads the
 *   snake_case legacy key too.
 * - ApplyLocalUpdateDto.version + patchUrl are REQUIRED (the
 *   service throws 'version and patchUrl are required'); the
 *   caller sends passcode '' when there is none, and it survives.
 *   CreateOfflineReleaseDto.version + patchUrl are REQUIRED
 *   (service throws); changelog is optional (service `?? ''`).
 *   SetReleasePasscodeDto.passcode is REQUIRED (service throws
 *   'passcode مطلوب'); the endpoint has NO caller in the repo —
 *   the release script provisions it externally.
 * - SimulateUpdateDto has NO frontend caller (Developer Sandbox
 *   only); its positive case is the service shape, all optional.
 * - Booleans under enableImplicitConversion: the string "false"
 *   converts to boolean true (Boolean("false") === true), pinned
 *   below wherever a boolean field exists; a boolean false still
 *   passes as false.
 * - NO frontend caller exists for POST /api/updates/simulate or
 *   POST /api/admin/offline-releases/:id/passcode (git grep over
 *   frontend/src at da8747d93). Their positive cases are the
 *   service shapes (the D5 zero-caller precedent).
 *
 * NOT DRIVEN: a live HTTP request through Nest (needs a booted
 * app); the services themselves (their own throws stay the
 * backstop — e.g. the passcode checks, the wipe password guards,
 * the duplicate-version conflict, the backup checksum); the
 * frontend screens (untouched); the 4 pinned Record exclusions
 * (settings-backup config/folder-test, tenant-transfer,
 * settings.controller — open-ended key/value maps by design,
 * decision D3; pinned to stay Record below).
 *
 * Fail-first: this spec is new in D7 — on the unpatched tree the
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
  ApplyLocalUpdateDto,
  ClearDemoDataDto,
  CloudBackupConfigDto,
  CreateOfflineReleaseDto,
  DailyDigestConfigDto,
  ImportRowsDto,
  ResetStockBalancesDto,
  SetReleasePasscodeDto,
  SimulateUpdateDto,
  WhatsAppConfigDto,
  WipeCatalogProductsDto,
  WipeDemoDataDto,
} from '../../src/modules/settings/dto/settings-write.dto';
import { SeedDemoDataDto } from '../../src/modules/settings/dto/seed-demo-data.dto';
import { WhatsAppWebhookDto } from '../../src/modules/settings/dto/whatsapp-webhook.dto';
import { BackupEnvelopeDto } from '../../src/modules/settings/dto/backup-envelope.dto';

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
  // 1. DailyDigestConfigDto — caller: daily-digest.api.ts saveConfig
  // sends Partial<DailyDigestConfig> (booleans + strings; the digest
  // section never sends mainWarehouseId/shopLocationId, but the
  // interface carries them and they stay optional numbers).
  {
    const transformed = await pipeOk(DailyDigestConfigDto, {
      enabled: true,
      phone: '01012345678',
      timeOfDay: '23:30',
      includeSales: true,
      includeTransfers: false,
      includeShortages: true,
      mainWarehouseId: 3,
      shopLocationId: 2,
    });
    assert.equal(transformed.enabled, true, 'digest enabled survives the pipe');
    assert.equal(transformed.phone, '01012345678', 'digest phone survives the pipe');
    assert.equal(transformed.mainWarehouseId, 3, 'digest mainWarehouseId survives the pipe');
    const partial = await pipeOk(DailyDigestConfigDto, { enabled: false });
    assert.equal(partial.enabled, false, 'a boolean false stays false through the pipe');
    const empty = await pipeOk(DailyDigestConfigDto, {});
    assert.equal(empty.enabled, undefined, 'an empty digest config passes — every field is optional');
    const stringFalse = await pipeOk(DailyDigestConfigDto, { enabled: 'false' });
    assert.equal(stringFalse.enabled, true, 'the string "false" converts to boolean true (implicit conversion)');
    await pipeRejects(DailyDigestConfigDto, { enabled: true, tenantId: 't1' }, 'an extra field is rejected');
    await pipeRejects(DailyDigestConfigDto, { mainWarehouseId: 'much' }, 'a wrong-typed mainWarehouseId is rejected');
    // A non-string phone is COERCED, not rejected: enableImplicitConversion
    // turns the number into the string '42' (same trap as the boolean
    // string-'false' pin below — pinned, not fixed).
    const coercedPhone = await pipeOk(DailyDigestConfigDto, { enabled: true, phone: 42 });
    assert.strictEqual(coercedPhone.phone, '42', 'a numeric phone coerces to the string "42"');
  }

  // 2. SimulateUpdateDto — NO frontend caller (Developer Sandbox
  // only); the positive case is the service shape, all optional
  // (the service defaults fromVersion '1.1.2' / targetVersion '1.1.14').
  {
    const empty = await pipeOk(SimulateUpdateDto, {});
    assert.equal(empty.fromVersion, undefined, 'an empty simulate body passes — every field is optional');
    const full = await pipeOk(SimulateUpdateDto, { fromVersion: '1.1.2', targetVersion: '1.1.14', passcode: 'ABC' });
    assert.equal(full.targetVersion, '1.1.14', 'simulate targetVersion survives the pipe');
    await pipeRejects(SimulateUpdateDto, { fromVersion: '1.1.2', extra: 1 }, 'an extra field is rejected');
    // A non-string fromVersion is COERCED, not rejected (implicit
    // conversion turns the number into the string '112' — pinned).
    const coercedFrom = await pipeOk(SimulateUpdateDto, { fromVersion: 112 });
    assert.strictEqual(coercedFrom.fromVersion, '112', 'a numeric fromVersion coerces to the string "112"');
  }

  // 3. ApplyLocalUpdateDto — caller: SystemUpdatesSection
  // handleApplyOnlineUpdate sends { version, patchUrl, changelog,
  // passcode } (passcode is '' when there is none). Both apply
  // aliases (/api/updates/apply + /api/local-updates/apply) take it.
  {
    const transformed = await pipeOk(ApplyLocalUpdateDto, {
      version: '1.1.14',
      patchUrl: 'https://example.com/patch.zip',
      changelog: 'Fixes',
      passcode: '',
    });
    assert.equal(transformed.version, '1.1.14', 'apply version survives the pipe');
    assert.equal(transformed.passcode, '', 'an empty passcode survives the pipe');
    const minimal = await pipeOk(ApplyLocalUpdateDto, { version: '1.1.14', patchUrl: 'https://example.com/p.zip' });
    assert.equal(minimal.patchUrl, 'https://example.com/p.zip', 'a minimal apply passes — changelog/passcode optional');
    await pipeRejects(ApplyLocalUpdateDto, { patchUrl: 'https://example.com/p.zip' }, 'a missing version is rejected');
    await pipeRejects(ApplyLocalUpdateDto, { version: '1.1.14' }, 'a missing patchUrl is rejected');
    await pipeRejects(
      ApplyLocalUpdateDto,
      { version: '1.1.14', patchUrl: 'https://example.com/p.zip', extra: 1 },
      'an extra field is rejected',
    );
    // A non-string version is COERCED, not rejected (implicit conversion
    // turns the number into the string '114' — pinned).
    const coercedVersion = await pipeOk(ApplyLocalUpdateDto, { version: 114, patchUrl: 'u' });
    assert.strictEqual(coercedVersion.version, '114', 'a numeric version coerces to the string "114"');
  }

  // 4. SetReleasePasscodeDto — NO caller in the repo (the release
  // script provisions the passcode externally); the positive case
  // is the service shape. passcode is REQUIRED — the service throws
  // 'passcode مطلوب' on an empty one.
  {
    const transformed = await pipeOk(SetReleasePasscodeDto, { passcode: 'ABC-123' });
    assert.equal(transformed.passcode, 'ABC-123', 'set-passcode survives the pipe');
    await pipeRejects(SetReleasePasscodeDto, {}, 'a missing passcode is rejected');
    await pipeRejects(SetReleasePasscodeDto, { passcode: 'X', extra: 1 }, 'an extra field is rejected');
    // A non-string passcode is COERCED, not rejected (implicit
    // conversion turns the number into the string '123' — pinned).
    const coercedPasscode = await pipeOk(SetReleasePasscodeDto, { passcode: 123 });
    assert.strictEqual(coercedPasscode.passcode, '123', 'a numeric passcode coerces to the string "123"');
  }

  // 5. CreateOfflineReleaseDto — caller: settings.api.ts
  // offlineReleases.create sends { version, changelog, patchUrl }
  // only (no passcode / requiresPasscode). version + patchUrl are
  // REQUIRED (the service throws); changelog is optional (service
  // `?? ''`); passcode? / requiresPasscode? are optional.
  {
    const caller = await pipeOk(CreateOfflineReleaseDto, {
      version: '1.1.15',
      changelog: 'New release',
      patchUrl: 'https://example.com/p.zip',
    });
    assert.equal(caller.version, '1.1.15', 'the exact caller shape passes');
    const full = await pipeOk(CreateOfflineReleaseDto, {
      version: '1.1.15',
      changelog: 'New',
      patchUrl: 'https://example.com/p.zip',
      passcode: 'X',
      requiresPasscode: false,
    });
    assert.equal(full.requiresPasscode, false, 'a boolean false requiresPasscode stays false');
    const stringFalse = await pipeOk(CreateOfflineReleaseDto, {
      version: '1.1.15',
      patchUrl: 'https://example.com/p.zip',
      requiresPasscode: 'false',
    });
    assert.equal(
      stringFalse.requiresPasscode,
      true,
      'the string "false" converts to boolean true (implicit conversion)',
    );
    await pipeRejects(CreateOfflineReleaseDto, { changelog: 'X', patchUrl: 'u' }, 'a missing version is rejected');
    await pipeRejects(CreateOfflineReleaseDto, { version: '1.1.15', changelog: 'X' }, 'a missing patchUrl is rejected');
    await pipeRejects(
      CreateOfflineReleaseDto,
      { version: '1.1.15', changelog: 'X', patchUrl: 'u', extra: 1 },
      'an extra field is rejected',
    );
  }

  // 6. SeedDemoDataDto — THREE frontend callers, all objects: the
  // wizard sends all 5 fields; the sandbox card sends { password }
  // only; the onboarding banner sends { activityType, password: '' }.
  // The service defaults every field, so all 5 are optional. The
  // service's bare-string form (password-only) has NO live caller
  // and the DTO does not accept a string body.
  {
    const wizard = await pipeOk(SeedDemoDataDto, {
      activityType: 'restaurant',
      password: 'pw',
      wipeExisting: true,
      seedSales: false,
      seedOnlineOrders: true,
    });
    assert.equal(wizard.activityType, 'restaurant', 'the wizard payload survives the pipe');
    assert.equal(wizard.seedSales, false, 'a boolean false seedSales stays false');
    const sandbox = await pipeOk(SeedDemoDataDto, { password: 'pw' });
    assert.equal(sandbox.password, 'pw', 'the sandbox { password }-only payload passes');
    const banner = await pipeOk(SeedDemoDataDto, { activityType: 'retail', password: '' });
    assert.equal(banner.password, '', 'an empty password string survives the pipe');
    const empty = await pipeOk(SeedDemoDataDto, {});
    assert.equal(empty.activityType, undefined, 'an empty seed body passes — every field is optional');
    const stringFalse = await pipeOk(SeedDemoDataDto, { wipeExisting: 'false' });
    assert.equal(stringFalse.wipeExisting, true, 'the string "false" converts to boolean true (implicit conversion)');
    await pipeRejects(SeedDemoDataDto, { activityType: 'x', extra: 1 }, 'an extra field is rejected');
    // A non-string activityType is COERCED, not rejected (implicit
    // conversion turns the number into the string '7' — pinned).
    const coercedType = await pipeOk(SeedDemoDataDto, { activityType: 7 });
    assert.strictEqual(coercedType.activityType, '7', 'a numeric activityType coerces to the string "7"');
  }

  // 7. ClearDemoDataDto — caller: demo-data.api.ts clearDemoData
  // sends { password } (password may be undefined, so the body can
  // be {}). password is OPTIONAL: the service only checks a
  // password for super_admin AND a password present; an admin or
  // owner clears without one.
  {
    const withPassword = await pipeOk(ClearDemoDataDto, { password: 'pw' });
    assert.equal(withPassword.password, 'pw', 'clear password survives the pipe');
    const empty = await pipeOk(ClearDemoDataDto, {});
    assert.equal(empty.password, undefined, 'an empty clear body passes — password is optional');
    await pipeRejects(ClearDemoDataDto, { password: 'pw', extra: 1 }, 'an extra field is rejected');
    // A non-string password is COERCED, not rejected (implicit
    // conversion turns the number into the string '123' — pinned).
    const coercedPassword = await pipeOk(ClearDemoDataDto, { password: 123 });
    assert.strictEqual(coercedPassword.password, '123', 'a numeric password coerces to the string "123"');
  }

  // 8. WipeDemoDataDto — caller: demo-data.api.ts wipeAllData sends
  // { password } (a string). password is REQUIRED: the service
  // throws PASSWORD_REQUIRED on an empty one (D5 precedent).
  {
    const transformed = await pipeOk(WipeDemoDataDto, { password: 'pw' });
    assert.equal(transformed.password, 'pw', 'wipe password survives the pipe');
    await pipeRejects(WipeDemoDataDto, {}, 'a missing password is rejected');
    await pipeRejects(WipeDemoDataDto, { password: 'pw', extra: 1 }, 'an extra field is rejected');
    // A non-string password is COERCED, not rejected (implicit
    // conversion turns the number into the string '123' — pinned).
    const coercedPassword = await pipeOk(WipeDemoDataDto, { password: 123 });
    assert.strictEqual(coercedPassword.password, '123', 'a numeric password coerces to the string "123"');
  }

  // 9. ResetStockBalancesDto — caller: settings.api.ts
  // resetStockBalances sends { password } (a string). password is
  // REQUIRED: assertAdminAndPassword throws PASSWORD_REQUIRED on an
  // empty one.
  {
    const transformed = await pipeOk(ResetStockBalancesDto, { password: 'pw' });
    assert.equal(transformed.password, 'pw', 'reset password survives the pipe');
    await pipeRejects(ResetStockBalancesDto, {}, 'a missing password is rejected');
    await pipeRejects(ResetStockBalancesDto, { password: 'pw', extra: 1 }, 'an extra field is rejected');
    // A non-string password is COERCED, not rejected (implicit
    // conversion turns the number into the string '123' — pinned).
    const coercedPassword = await pipeOk(ResetStockBalancesDto, { password: 123 });
    assert.strictEqual(coercedPassword.password, '123', 'a numeric password coerces to the string "123"');
  }

  // 10. WipeCatalogProductsDto — caller: settings.api.ts
  // wipeCatalogProducts sends { password } (a string). password is
  // REQUIRED: assertAdminAndPassword throws PASSWORD_REQUIRED on an
  // empty one.
  {
    const transformed = await pipeOk(WipeCatalogProductsDto, { password: 'pw' });
    assert.equal(transformed.password, 'pw', 'wipe-catalog password survives the pipe');
    await pipeRejects(WipeCatalogProductsDto, {}, 'a missing password is rejected');
    await pipeRejects(WipeCatalogProductsDto, { password: 'pw', extra: 1 }, 'an extra field is rejected');
    // A non-string password is COERCED, not rejected (implicit
    // conversion turns the number into the string '123' — pinned).
    const coercedPassword = await pipeOk(WipeCatalogProductsDto, { password: 123 });
    assert.strictEqual(coercedPassword.password, '123', 'a numeric password coerces to the string "123"');
  }

  // 11. CloudBackupConfigDto — caller: cloud-backup-settings-card
  // sends the full config object (lastBackupAt / lastBackupStatus /
  // lastError round-tripped from GET). All fields optional (Partial).
  // lastBackupStatus is exactly the values the service ever writes
  // ('', 'success', 'failed').
  {
    const transformed = await pipeOk(CloudBackupConfigDto, {
      enabled: true,
      endpoint: 's3.amazonaws.com',
      region: 'us-east-1',
      bucket: 'my-bucket',
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
      retentionDays: 30,
      lastBackupAt: '2026-11-25T10:00:00.000Z',
      lastBackupStatus: 'success',
      lastError: '',
    });
    assert.equal(transformed.bucket, 'my-bucket', 'cloud bucket survives the pipe');
    assert.equal(transformed.retentionDays, 30, 'cloud retentionDays survives the pipe');
    const coerced = await pipeOk(CloudBackupConfigDto, { retentionDays: '30' });
    assert.equal(coerced.retentionDays, 30, 'a numeric-string retentionDays coerces to a number');
    const stringFalse = await pipeOk(CloudBackupConfigDto, { enabled: 'false' });
    assert.equal(stringFalse.enabled, true, 'the string "false" converts to boolean true (implicit conversion)');
    const empty = await pipeOk(CloudBackupConfigDto, {});
    assert.equal(empty.enabled, undefined, 'an empty cloud config passes — every field is optional');
    await pipeRejects(CloudBackupConfigDto, { enabled: true, extra: 1 }, 'an extra field is rejected');
    await pipeRejects(CloudBackupConfigDto, { retentionDays: 'much' }, 'a wrong-typed retentionDays is rejected');
    await pipeRejects(
      CloudBackupConfigDto,
      { lastBackupStatus: 'pending' },
      'an out-of-enum lastBackupStatus is rejected',
    );
  }

  // 12. WhatsAppConfigDto — caller: SettingsWhatsAppGatewaySection
  // sends Partial<WhatsAppGatewayConfig> (the full form). provider
  // is the SERVICE whitelist (sendRawMessage handles exactly
  // ultramsg / greenapi / custom_webhook). webhookSecret has NO
  // @MinLength: the masked '••••••••' placeholder (8 chars) is
  // explicitly skipped by the service — a min-length would 400 the
  // save whenever the user does not change the secret.
  {
    const transformed = await pipeOk(WhatsAppConfigDto, {
      enabled: true,
      provider: 'ultramsg',
      apiUrl: 'https://api.ultramsg.com',
      instanceId: 'instance1',
      token: '••••••••',
      webhookSecret: '••••••••',
      autoSendInvoice: true,
      autoSendOnlineOrder: false,
      invoiceTemplate: 'Hello {customerName}',
      aiBotEnabled: true,
      aiBotPrompt: 'You are helpful',
      aiBotWelcomeMessage: 'Welcome',
      aiBotOffHoursOnly: false,
    });
    assert.equal(transformed.provider, 'ultramsg', 'whatsapp provider survives the pipe');
    assert.equal(transformed.webhookSecret, '••••••••', 'the masked webhook secret passes (no min length)');
    assert.equal(transformed.token, '••••••••', 'the masked token passes');
    const green = await pipeOk(WhatsAppConfigDto, { provider: 'greenapi' });
    assert.equal(green.provider, 'greenapi', 'greenapi passes the enum');
    const custom = await pipeOk(WhatsAppConfigDto, { provider: 'custom_webhook' });
    assert.equal(custom.provider, 'custom_webhook', 'custom_webhook passes the enum');
    const stringFalse = await pipeOk(WhatsAppConfigDto, { aiBotOffHoursOnly: 'false' });
    assert.equal(
      stringFalse.aiBotOffHoursOnly,
      true,
      'the string "false" converts to boolean true (implicit conversion)',
    );
    const empty = await pipeOk(WhatsAppConfigDto, {});
    assert.equal(empty.provider, undefined, 'an empty whatsapp config passes — every field is optional');
    await pipeRejects(WhatsAppConfigDto, { provider: 'ultramsg', extra: 1 }, 'an extra field is rejected');
    await pipeRejects(WhatsAppConfigDto, { provider: 'telegram' }, 'an out-of-enum provider is rejected');
    // A non-string webhookSecret is COERCED, not rejected (implicit
    // conversion turns the number into the string '123' — pinned).
    const coercedSecret = await pipeOk(WhatsAppConfigDto, { webhookSecret: 123 });
    assert.strictEqual(coercedSecret.webhookSecret, '123', 'a numeric webhookSecret coerces to the string "123"');
  }

  // 13. WhatsAppWebhookDto — provider payloads (Meta, UltraMsg,
  // GreenAPI) + the generic/simulator format. The service reads
  // only the top-level keys below; nested contents are NOT
  // validated (unknown[] / object).
  {
    const meta = await pipeOk(WhatsAppWebhookDto, {
      object: 'whatsapp_business_account',
      entry: [{ id: '1', changes: [{ value: { messages: [{ from: '2010', text: { body: 'hi' } }] } }] }],
    });
    assert.equal(meta.object, 'whatsapp_business_account', 'the Meta webhook shape passes');
    assert.equal(meta.entry!.length, 1, 'the Meta entry array survives the pipe');
    const ultra = await pipeOk(WhatsAppWebhookDto, {
      event_type: 'message_received',
      data: { from: '2010', body: 'hi' },
    });
    assert.equal(ultra.event_type, 'message_received', 'the UltraMsg webhook shape passes');
    const green = await pipeOk(WhatsAppWebhookDto, {
      typeWebhook: 'incomingMessageReceived',
      instanceData: { idInstance: 1 },
      timestamp: 1700000000,
      idMessage: 'abc',
      senderData: { sender: '2010' },
      messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: 'hi' } },
    });
    assert.equal(green.timestamp, 1700000000, 'the GreenAPI webhook shape passes');
    const generic = await pipeOk(WhatsAppWebhookDto, { phone: '010', message: 'hi' });
    assert.equal(generic.phone, '010', 'the generic webhook shape passes');
    await pipeRejects(
      WhatsAppWebhookDto,
      { object: 'whatsapp_business_account', extra: 1 },
      'an extra field is rejected',
    );
    await pipeRejects(WhatsAppWebhookDto, { entry: 'nope' }, 'a non-array entry is rejected');
    // A non-string object is COERCED, not rejected (implicit conversion
    // turns the number into the string '9' — pinned).
    const coercedObject = await pipeOk(WhatsAppWebhookDto, { object: 9 });
    assert.strictEqual(coercedObject.object, '9', 'a numeric object coerces to the string "9"');
  }

  // 14. ImportRowsDto — callers: settings.api.ts importProducts /
  // importCustomers / importSuppliers / importOpeningStock and
  // hr.api.ts importEmployees all send { rows } (parsed CSV rows).
  {
    const transformed = await pipeOk(ImportRowsDto, { rows: [{ a: 1 }, { b: 2 }] });
    assert.equal(transformed.rows!.length, 2, 'import rows survive the pipe');
    const empty = await pipeOk(ImportRowsDto, {});
    assert.equal(empty.rows, undefined, 'an empty import body passes — rows is optional');
    await pipeRejects(ImportRowsDto, { rows: [], extra: 1 }, 'an extra field is rejected');
    await pipeRejects(ImportRowsDto, { rows: 'nope' }, 'a non-array rows is rejected');
  }

  // 15. BackupEnvelopeDto — REUSED (it already existed, imported
  // but unused in the backup controller). verify/restore take
  // either a File (FormData — body {} or { confirmation }) or a
  // JSON envelope { meta, tables } (+ confirmation). Legacy compat:
  // normalizeEnvelope also reads meta.exported_at (snake_case).
  {
    const envelope = await pipeOk(BackupEnvelopeDto, {
      meta: {
        version: '1.2.0',
        exportedAt: '2026-11-25T10:00:00.000Z',
        source: 'manual-export',
        tenantId: 't',
        accountId: 'a',
      },
      tables: { products: [{ id: 1 }], settings: [] },
    });
    assert.equal(envelope.meta!.version, '1.2.0', 'the envelope meta survives the pipe');
    const legacy = await pipeOk(BackupEnvelopeDto, {
      meta: { exported_at: '2026-11-25T10:00:00.000Z' },
      tables: { products: [] },
    });
    assert.equal(legacy.meta!.exported_at, '2026-11-25T10:00:00.000Z', 'the legacy snake_case exported_at passes');
    const formRestore = await pipeOk(BackupEnvelopeDto, { confirmation: 'RESTORE BACKUP' });
    assert.equal(formRestore.confirmation, 'RESTORE BACKUP', 'the FormData restore confirmation passes');
    const fileOnly = await pipeOk(BackupEnvelopeDto, {});
    assert.equal(fileOnly.confirmation, undefined, 'a file-only verify body passes — every field is optional');
    await pipeRejects(BackupEnvelopeDto, { meta: {}, tables: {}, extra: 1 }, 'an extra field is rejected');
    await pipeRejects(BackupEnvelopeDto, { tables: 'nope' }, 'a non-object tables is rejected');
  }

  // 16. Source pins: the six controllers take the DTO classes, no
  // whole-body `body: any` is left in them, and the 4 pinned Record
  // exclusions are untouched (still Record<string, unknown>).
  {
    const read = (rel: string): string => readFileSync(resolve(__dirname, '../../src/modules/settings', rel), 'utf8');
    const dailyDigest = read('controllers/daily-digest.controller.ts');
    assert.ok(dailyDigest.includes('DailyDigestConfigDto'), 'daily-digest takes DailyDigestConfigDto');
    const offline = read('controllers/offline-releases.controller.ts');
    for (const name of [
      'SimulateUpdateDto',
      'ApplyLocalUpdateDto',
      'SetReleasePasscodeDto',
      'CreateOfflineReleaseDto',
    ]) {
      assert.ok(offline.includes(name), `offline-releases takes ${name}`);
    }
    const admin = read('controllers/settings-admin.controller.ts');
    for (const name of [
      'SeedDemoDataDto',
      'ClearDemoDataDto',
      'WipeDemoDataDto',
      'ResetStockBalancesDto',
      'WipeCatalogProductsDto',
    ]) {
      assert.ok(admin.includes(name), `settings-admin takes ${name}`);
    }
    const backup = read('controllers/settings-backup.controller.ts');
    assert.ok(backup.includes('CloudBackupConfigDto'), 'settings-backup takes CloudBackupConfigDto');
    assert.ok(backup.includes('BackupEnvelopeDto'), 'settings-backup takes BackupEnvelopeDto');
    const importController = read('controllers/settings-import.controller.ts');
    assert.ok(importController.includes('ImportRowsDto'), 'settings-import takes ImportRowsDto');
    const whatsapp = read('controllers/whatsapp-gateway.controller.ts');
    assert.ok(whatsapp.includes('WhatsAppConfigDto'), 'whatsapp-gateway takes WhatsAppConfigDto');
    assert.ok(whatsapp.includes('WhatsAppWebhookDto'), 'whatsapp-gateway takes WhatsAppWebhookDto');
    for (const [file, src] of [
      ['daily-digest', dailyDigest],
      ['offline-releases', offline],
      ['settings-admin', admin],
      ['settings-backup', backup],
      ['settings-import', importController],
      ['whatsapp-gateway', whatsapp],
    ] as const) {
      assert.ok(!src.includes('body: any'), `no ${file} route takes any anymore`);
    }
    assert.ok(
      backup.includes('Record<string, unknown>'),
      'the backup config/folder-test Record exclusions stay Record',
    );
    const tenantTransfer = read('controllers/tenant-transfer.controller.ts');
    assert.ok(tenantTransfer.includes('Record<string, unknown>'), 'the tenant-transfer Record exclusion stays Record');
    const settings = read('settings.controller.ts');
    assert.ok(settings.includes('Record<string, unknown>'), 'the settings Record exclusion stays Record');
    console.log('  source pins passed');
  }

  // 17. Wiring: this spec is in both critical lists, in identical order
  // (363 specs — the purchases-writer spec is the last entry).
  {
    const specs = JSON.parse(readFileSync(resolve(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
      .specs as string[];
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const serial = String(pkg.scripts['test:critical:serial']);
    const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
    assert.equal(specs.length, 412);
    assert.equal(chain.length, 412);
    assert.deepEqual(chain, specs);
    assert.ok(specs.includes('test/critical/dto-settings.spec.ts'));
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s6-import-fx-payout-idempotency.spec.ts');
    console.log('  evidence spec wired into both critical lists (373 = 373, identical order), passed');
  }

  console.log('DTO settings tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
