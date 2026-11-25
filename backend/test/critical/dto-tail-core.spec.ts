/*
 * New file: backend/test/critical/dto-tail-core.spec.ts
 *
 * WHAT THIS PINS (INV-DTO-TAIL-30, D10): the tail controller routes in
 * addons (modifier groups create/update), ai-copilot (agent chat +
 * knowledge sources + config + test-key + models), bosta (settings +
 * ship-order), catalog (category transfer + bulk icons + serials +
 * toggle-archive) and gcc-shipping (settings + ship-order) now take
 * DTO classes, so the real global requestValidationPipe validates and
 * whitelists them. Before D10 they took `any`, inline object types, or
 * interfaces — and the pipe does nothing for those, so any extra field
 * (or a wrong-typed field) reached the service untouched.
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
 * - ModifierGroupDto: the ProductModifiersPage save payload carries NO
 *   group id (id is in the URL on update); options are `...opt` spreads,
 *   so an edited option KEEPS id/groupId/componentProductName/
 *   portionAllowed/preparationTimeMinutes when present in form state —
 *   all accepted as optional. name is the only required field (the
 *   service defaults everything else); option price/costPrice carry
 *   @Min(0) (the service asserts non-negative prices).
 * - AgentChatDto: message is REQUIRED (plain string — the service trims
 *   and never throws on empty); sessionId optional (sent only when set).
 * - AddKnowledgeSourceDto: title + rawText REQUIRED (the service throws
 *   when either is missing); sourceType stays a PLAIN STRING (the service
 *   defaults an unknown type to 'document'); fileUrl/metadata optional.
 * - SaveAiConfigDto: ALL fields optional; apiKey '' is an explicit
 *   delete (NO @IsNotEmpty); provider enum gemini|openai|custom.
 * - BostaCreateDeliveryDto / GccCreateShipmentDto: ALL fields optional
 *   (both services default every field from the order + settings);
 *   the caller always sends specs.itemsCount + description for Bosta,
 *   but the service defaults them — optional per whitelist.
 * - TransferCategoryProductsDto: productIds is NEVER read by the
 *   controller/service (transferProducts moves ALL category products)
 *   but the caller (products.api transferCategory) SENDS it — accepted
 *   as optional (Package C trap; pre-existing mismatch, recorded here).
 * - BulkUpdateIconsDto.updates is OPTIONAL (the service tolerates
 *   missing — payload?.updates || []), though the only caller always
 *   sends it.
 * - AddProductSerialsDto: PRE-EXISTING MISMATCH (recorded, NOT fixed):
 *   the ONLY caller (product-serials.api addSerials) sends { serials }
 *   while the controller reads payload.items — so today every call adds
 *   0 serials (the slice returns { count: 0 } on empty items). The DTO
 *   accepts BOTH field names so the caller's shape still passes the
 *   pipe; the service still reads items only.
 * - ToggleProductArchiveDto: ALL fields optional — the caller
 *   (products.api toggleArchive) may send NO body at all.
 *
 * NOT DRIVEN: a live HTTP request through Nest (needs a booted app);
 * the services themselves (their own throws stay the backstop — e.g.
 * the modifier price asserts, the distributor invoice engine, the
 * super-admin password checks); the frontend screens (untouched).
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
import { ModifierGroupDto } from '../../src/modules/addons/dto/modifier-group-write.dto';
import {
  AddKnowledgeSourceDto,
  AgentChatDto,
  GetAiModelsDto,
  SaveAiConfigDto,
  TestAiKeyDto,
} from '../../src/modules/ai-copilot/dto/ai-copilot-write.dto';
import { SaveBostaSettingsDto } from '../../src/modules/bosta/dto/bosta-write.dto';
import { BostaCreateDeliveryDto } from '../../src/modules/bosta/bosta.types';
import {
  AddProductSerialsDto,
  BulkUpdateIconsDto,
  ToggleProductArchiveDto,
  TransferCategoryProductsDto,
} from '../../src/modules/catalog/dto/catalog-write.dto';
import { SaveGccShippingSettingsDto } from '../../src/modules/gcc-shipping/dto/gcc-shipping-write.dto';
import { GccCreateShipmentDto } from '../../src/modules/gcc-shipping/gcc-shipping.types';

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
  // 1. ModifierGroupDto — caller: ProductModifiersPage handleSaveGroup
  // sends { name, nameEn?, selectionType, isMandatory, minSelections,
  // maxSelections, displayOrder, isActive, isSplittableInHalf, options }.
  {
    const transformed = await pipeOk(ModifierGroupDto, {
      name: 'إضافات',
      nameEn: 'Extras',
      selectionType: 'multiple',
      isMandatory: false,
      minSelections: 0,
      maxSelections: 3,
      displayOrder: 1,
      isActive: true,
      isSplittableInHalf: false,
      options: [
        {
          id: 7,
          groupId: 2,
          name: 'جبنة',
          nameEn: 'Cheese',
          price: 10,
          costPrice: 4,
          isDefault: false,
          isActive: true,
          displayOrder: 0,
          componentProductId: 12,
          componentProductName: 'جبنة موزاريلا',
          consumptionQty: 0.05,
          unitName: 'قطعة',
          portionAllowed: 'both',
          preparationTimeMinutes: 2,
        },
      ],
    });
    assert.equal(transformed.name, 'إضافات', 'modifier group name survives the pipe');
    assert.equal(transformed.options?.[0].name, 'جبنة', 'modifier option survives the pipe');
    assert.equal(transformed.options?.[0].id, 7, 'an edited option id passes (kept by the ...opt spread)');
    const minimal = await pipeOk(ModifierGroupDto, { name: 'صوصات' });
    assert.equal(minimal.selectionType, undefined, 'a minimal group passes — everything but name is optional');
    await pipeRejects(ModifierGroupDto, {}, 'a missing group name is rejected');
    await pipeRejects(ModifierGroupDto, { name: 'x', selectionType: 'any' }, 'an unknown selectionType is rejected');
    await pipeRejects(
      ModifierGroupDto,
      { name: 'x', options: [{ name: 'a', price: -1 }] },
      'a negative option price is rejected',
    );
    await pipeRejects(ModifierGroupDto, { name: 'x', extra: 1 }, 'an extra field is rejected');
    await pipeRejects(ModifierGroupDto, { name: 'x', options: [{ price: 5 }] }, 'an option without a name is rejected');
  }

  // 2. AgentChatDto — caller: AiBusinessCopilotModal chatMutation sends
  // { message, ...(sessionId ? { sessionId } : {}) }.
  {
    const transformed = await pipeOk(AgentChatDto, { message: 'كم مبيعات اليوم؟', sessionId: 'sess-1' });
    assert.equal(transformed.message, 'كم مبيعات اليوم؟', 'chat message survives the pipe');
    assert.equal(transformed.sessionId, 'sess-1', 'chat sessionId survives the pipe');
    const noSession = await pipeOk(AgentChatDto, { message: 'مرحبا' });
    assert.equal(noSession.sessionId, undefined, 'a chat without sessionId passes');
    await pipeRejects(AgentChatDto, {}, 'a missing chat message is rejected');
    const coerced = await pipeOk(AgentChatDto, { message: 42 });
    assert.strictEqual(coerced.message, '42', 'a numeric chat message coerces to the string "42"');
    await pipeRejects(AgentChatDto, { message: 'x', extra: 1 }, 'an extra field is rejected');
  }

  // 3. AddKnowledgeSourceDto — caller: AiBusinessCopilotModal
  // addDocMutation sends { title, sourceType, rawText }.
  {
    const transformed = await pipeOk(AddKnowledgeSourceDto, {
      title: 'سياسة الإرجاع',
      sourceType: 'document',
      rawText: 'الإرجاع خلال 14 يوما',
      fileUrl: 'https://example.com/policy.pdf',
      metadata: { author: 'admin' },
    });
    assert.equal(transformed.title, 'سياسة الإرجاع', 'knowledge title survives the pipe');
    assert.equal(transformed.metadata?.author, 'admin', 'knowledge metadata survives the pipe');
    await pipeRejects(AddKnowledgeSourceDto, { rawText: 'x' }, 'a missing knowledge title is rejected');
    await pipeRejects(AddKnowledgeSourceDto, { title: 't' }, 'a missing knowledge rawText is rejected');
    await pipeRejects(AddKnowledgeSourceDto, { title: 't', rawText: 'x', extra: 1 }, 'an extra field is rejected');
    const unknownType = await pipeOk(AddKnowledgeSourceDto, { title: 't', rawText: 'x', sourceType: 'manual' });
    assert.equal(unknownType.sourceType, 'manual', 'an unknown sourceType passes (the service defaults it)');
  }

  // 4. SaveAiConfigDto — caller: SettingsWhatsAppGatewaySection
  // saveAiKeyMutation sends { apiKey?, provider, model?, baseUrl? };
  // deleteAiKeyMutation sends { apiKey: '' }.
  {
    const transformed = await pipeOk(SaveAiConfigDto, {
      apiKey: 'AIza-xyz',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      baseUrl: 'https://example.com/v1',
      geminiApiKey: 'AIza-abc',
    });
    assert.equal(transformed.provider, 'gemini', 'AI provider survives the pipe');
    const deleted = await pipeOk(SaveAiConfigDto, { apiKey: '' });
    assert.equal(deleted.apiKey, '', 'an empty apiKey passes (explicit delete)');
    const empty = await pipeOk(SaveAiConfigDto, {});
    assert.equal(empty.provider, undefined, 'an empty config passes — every field is optional');
    await pipeRejects(SaveAiConfigDto, { provider: 'claude' }, 'an unknown AI provider is rejected');
    await pipeRejects(SaveAiConfigDto, { apiKey: 'x', extra: 1 }, 'an extra field is rejected');
  }

  // 5. TestAiKeyDto — caller: SettingsWhatsAppGatewaySection
  // testAiKeyMutation sends { provider, apiKey?, model?, baseUrl? }.
  {
    const transformed = await pipeOk(TestAiKeyDto, {
      provider: 'openai',
      apiKey: 'sk-xyz',
      model: 'gpt-4o',
    });
    assert.equal(transformed.provider, 'openai', 'test-key provider survives the pipe');
    const empty = await pipeOk(TestAiKeyDto, {});
    assert.equal(empty.apiKey, undefined, 'an empty test-key passes — every field is optional');
    await pipeRejects(TestAiKeyDto, { provider: 'claude' }, 'an unknown test-key provider is rejected');
    await pipeRejects(TestAiKeyDto, { apiKey: 'x', extra: 1 }, 'an extra field is rejected');
  }

  // 6. GetAiModelsDto — caller: SettingsWhatsAppGatewaySection
  // fetchKeyModels sends { apiKey: k || undefined, provider }.
  {
    const transformed = await pipeOk(GetAiModelsDto, { apiKey: 'AIza-xyz', provider: 'gemini' });
    assert.equal(transformed.provider, 'gemini', 'models provider survives the pipe');
    const empty = await pipeOk(GetAiModelsDto, {});
    assert.equal(empty.apiKey, undefined, 'an empty models request passes — every field is optional');
    await pipeRejects(GetAiModelsDto, { provider: 'claude' }, 'an unknown models provider is rejected');
    await pipeRejects(GetAiModelsDto, { apiKey: 'x', extra: 1 }, 'an extra field is rejected');
  }

  // 7. SaveBostaSettingsDto — caller: bosta.api saveSettings sends a
  // Partial<BostaSettings>; every field is optional (Partial merge).
  {
    const transformed = await pipeOk(SaveBostaSettingsDto, {
      enabled: true,
      environment: 'production',
      apiKey: 'bosta-key',
      pickupBusinessName: 'المتجر',
      pickupPhone: '01000000000',
      pickupCity: 'القاهرة',
      pickupAddress: 'شارع التحرير',
    });
    assert.equal(transformed.enabled, true, 'bosta enabled survives the pipe');
    assert.equal(transformed.environment, 'production', 'bosta environment survives the pipe');
    const empty = await pipeOk(SaveBostaSettingsDto, {});
    assert.equal(empty.apiKey, undefined, 'an empty bosta settings body passes — every field is optional');
    await pipeRejects(SaveBostaSettingsDto, { environment: 'staging' }, 'an unknown bosta environment is rejected');
    await pipeRejects(SaveBostaSettingsDto, { enabled: true, extra: 1 }, 'an extra field is rejected');
    const stringFalse = await pipeOk(SaveBostaSettingsDto, { enabled: 'false' });
    assert.equal(stringFalse.enabled, true, 'the string "false" converts to boolean true');
  }

  // 8. BostaCreateDeliveryDto — caller: bosta.api shipOrder sends
  // BostaShipmentPayload { specs?, cod?, notes?, receiverAddress?,
  // receiverCity? }; the service defaults every field.
  {
    const transformed = await pipeOk(BostaCreateDeliveryDto, {
      specs: { packageType: 'Parcel', size: 'MEDIUM', itemsCount: 2, description: 'طلب متجر #5', weight: 1.5 },
      cod: 250,
      notes: 'اتصل قبل التوصيل',
      receiverAddress: 'شارع النيل',
      receiverCity: 'الجيزة',
    });
    assert.equal(transformed.cod, 250, 'bosta COD survives the pipe');
    assert.equal(transformed.specs?.itemsCount, 2, 'bosta specs survive the pipe');
    const empty = await pipeOk(BostaCreateDeliveryDto, {});
    assert.equal(empty.cod, undefined, 'an empty delivery passes — every field is optional');
    await pipeRejects(BostaCreateDeliveryDto, { specs: { packageType: 'Box' } }, 'an unknown packageType is rejected');
    await pipeRejects(BostaCreateDeliveryDto, { specs: { size: 'HUGE' } }, 'an unknown size is rejected');
    await pipeRejects(BostaCreateDeliveryDto, { cod: 'much' }, 'a wrong-typed COD is rejected');
    await pipeRejects(BostaCreateDeliveryDto, { extra: 1 }, 'an extra field is rejected');
  }

  // 9. TransferCategoryProductsDto — caller: products.api
  // transferCategory sends { targetCategoryId, productIds? }.
  {
    const transformed = await pipeOk(TransferCategoryProductsDto, { targetCategoryId: 9, productIds: [1, 2] });
    assert.equal(transformed.targetCategoryId, 9, 'transfer target survives the pipe');
    assert.deepEqual(transformed.productIds, [1, 2], 'transfer productIds pass (caller-sent, service ignores them)');
    await pipeRejects(TransferCategoryProductsDto, {}, 'a missing targetCategoryId is rejected');
    await pipeRejects(
      TransferCategoryProductsDto,
      { targetCategoryId: 'nine' },
      'a wrong-typed targetCategoryId is rejected',
    );
    await pipeRejects(TransferCategoryProductsDto, { targetCategoryId: 9, extra: 1 }, 'an extra field is rejected');
    const coerced = await pipeOk(TransferCategoryProductsDto, { targetCategoryId: '9' });
    assert.strictEqual(coerced.targetCategoryId, 9, 'a numeric target string coerces to 9');
  }

  // 10. BulkUpdateIconsDto — caller: products.api bulkUpdateIcons sends
  // { updates: [{ id, icon }] }; the service tolerates a missing updates.
  {
    const transformed = await pipeOk(BulkUpdateIconsDto, {
      updates: [
        { id: 1, icon: 'box' },
        { id: 2, icon: 'tag' },
      ],
    });
    assert.equal(transformed.updates?.length, 2, 'icon updates survive the pipe');
    const empty = await pipeOk(BulkUpdateIconsDto, {});
    assert.equal(empty.updates, undefined, 'a missing updates passes — the service tolerates it');
    await pipeRejects(BulkUpdateIconsDto, { updates: [{ id: 1 }] }, 'an icon update without icon is rejected');
    await pipeRejects(BulkUpdateIconsDto, { updates: [{ icon: 'box' }] }, 'an icon update without id is rejected');
    await pipeRejects(BulkUpdateIconsDto, { updates: [], extra: 1 }, 'an extra field is rejected');
  }

  // 11. AddProductSerialsDto — caller: product-serials.api addSerials
  // sends { serials: [{ serialNumber, imei2?, costPrice?, branchId?,
  // locationId?, notes? }] } while the controller reads `items` (see the
  // header trap). BOTH field names are accepted.
  {
    const transformed = await pipeOk(AddProductSerialsDto, {
      serials: [{ serialNumber: 'SN-001', imei2: '123', costPrice: 100, branchId: 1, locationId: 2, notes: 'new' }],
    });
    assert.equal(transformed.serials?.[0].serialNumber, 'SN-001', 'the caller serials shape survives the pipe');
    const itemsShape = await pipeOk(AddProductSerialsDto, { items: [{ serialNumber: 'SN-002' }] });
    assert.equal(itemsShape.items?.[0].serialNumber, 'SN-002', 'the controller items shape survives the pipe');
    const empty = await pipeOk(AddProductSerialsDto, {});
    assert.equal(empty.items, undefined, 'an empty serials body passes — the service tolerates it');
    await pipeRejects(
      AddProductSerialsDto,
      { items: [{ imei2: 'x' }] },
      'a serial item without serialNumber is rejected',
    );
    await pipeRejects(AddProductSerialsDto, { items: [], extra: 1 }, 'an extra field is rejected');
  }

  // 12. ToggleProductArchiveDto — caller: products.api toggleArchive
  // sends { zeroStock?, archiveEntireGroup? } or NO body at all.
  {
    const transformed = await pipeOk(ToggleProductArchiveDto, { zeroStock: true, archiveEntireGroup: true });
    assert.equal(transformed.zeroStock, true, 'toggle zeroStock survives the pipe');
    const empty = await pipeOk(ToggleProductArchiveDto, {});
    assert.equal(empty.archiveEntireGroup, undefined, 'an empty toggle body passes — every field is optional');
    await pipeRejects(ToggleProductArchiveDto, { extra: 1 }, 'an extra field is rejected');
    const stringFalse = await pipeOk(ToggleProductArchiveDto, { zeroStock: 'false' });
    assert.equal(stringFalse.zeroStock, true, 'the string "false" converts to boolean true');
  }

  // 13. SaveGccShippingSettingsDto — caller: gcc-shipping.api
  // saveSettings sends a Partial<GccShippingSettings>; every field is
  // optional (Partial merge).
  {
    const transformed = await pipeOk(SaveGccShippingSettingsDto, {
      enabled: true,
      activeCarrier: 'aramex',
      environment: 'sandbox',
      aramexAccountNumber: '123',
      aramexAccountPin: '456',
      pickupCity: 'الرياض',
    });
    assert.equal(transformed.activeCarrier, 'aramex', 'GCC carrier survives the pipe');
    const empty = await pipeOk(SaveGccShippingSettingsDto, {});
    assert.equal(empty.enabled, undefined, 'an empty GCC settings body passes — every field is optional');
    await pipeRejects(SaveGccShippingSettingsDto, { activeCarrier: 'dhl' }, 'an unknown GCC carrier is rejected');
    await pipeRejects(SaveGccShippingSettingsDto, { environment: 'staging' }, 'an unknown GCC environment is rejected');
    await pipeRejects(SaveGccShippingSettingsDto, { enabled: true, extra: 1 }, 'an extra field is rejected');
  }

  // 14. GccCreateShipmentDto — caller: gcc-shipping.api shipOrder sends
  // GccCreateShipmentPayload; the service defaults every field.
  {
    const transformed = await pipeOk(GccCreateShipmentDto, {
      carrier: 'smsa',
      packageType: 'Document',
      weight: 2,
      piecesCount: 1,
      description: 'مستندات',
      codAmount: 100,
      currency: 'SAR',
      receiverName: 'أحمد',
      receiverPhone: '0500000000',
      receiverCountry: 'المملكة العربية السعودية',
      receiverCity: 'جدة',
      receiverAddress: 'شارع الملك',
      notes: 'عاجل',
    });
    assert.equal(transformed.carrier, 'smsa', 'GCC shipment carrier survives the pipe');
    assert.equal(transformed.codAmount, 100, 'GCC shipment COD survives the pipe');
    const empty = await pipeOk(GccCreateShipmentDto, {});
    assert.equal(empty.carrier, undefined, 'an empty shipment passes — every field is optional');
    await pipeRejects(GccCreateShipmentDto, { carrier: 'dhl' }, 'an unknown shipment carrier is rejected');
    await pipeRejects(GccCreateShipmentDto, { packageType: 'Box' }, 'an unknown shipment packageType is rejected');
    await pipeRejects(GccCreateShipmentDto, { weight: 'heavy' }, 'a wrong-typed weight is rejected');
    await pipeRejects(GccCreateShipmentDto, { extra: 1 }, 'an extra field is rejected');
  }

  // 15. Source pins: the controllers reference the DTO classes.
  {
    const addons = readSrc('modules/addons/addons.controller.ts');
    assert.ok(addons.includes('ModifierGroupDto'), 'the modifier-group handlers take the DTO class');
    const copilot = readSrc('modules/ai-copilot/ai-copilot.controller.ts');
    assert.ok(copilot.includes('AgentChatDto'), 'the agent-chat handler takes the DTO class');
    assert.ok(copilot.includes('AddKnowledgeSourceDto'), 'the knowledge-source handler takes the DTO class');
    assert.ok(copilot.includes('SaveAiConfigDto'), 'the config handler takes the DTO class');
    assert.ok(copilot.includes('TestAiKeyDto'), 'the test-key handler takes the DTO class');
    assert.ok(copilot.includes('GetAiModelsDto'), 'the models handler takes the DTO class');
    const bosta = readSrc('modules/bosta/bosta.controller.ts');
    assert.ok(bosta.includes('SaveBostaSettingsDto'), 'the bosta settings handler takes the DTO class');
    assert.ok(bosta.includes('BostaCreateDeliveryDto'), 'the bosta ship-order handler takes the DTO class');
    const catalog = readSrc('modules/catalog/catalog.controller.ts');
    assert.ok(catalog.includes('TransferCategoryProductsDto'), 'the transfer handler takes the DTO class');
    assert.ok(catalog.includes('BulkUpdateIconsDto'), 'the bulk-icons handler takes the DTO class');
    assert.ok(catalog.includes('AddProductSerialsDto'), 'the serials handler takes the DTO class');
    assert.ok(catalog.includes('ToggleProductArchiveDto'), 'the toggle-archive handler takes the DTO class');
    const gcc = readSrc('modules/gcc-shipping/gcc-shipping.controller.ts');
    assert.ok(gcc.includes('SaveGccShippingSettingsDto'), 'the GCC settings handler takes the DTO class');
    assert.ok(gcc.includes('GccCreateShipmentDto'), 'the GCC ship-order handler takes the DTO class');
    console.log('  source pins passed');
  }

  console.log('DTO tail-core tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
