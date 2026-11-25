import { strict as assert } from 'node:assert';
import { ForbiddenException } from '@nestjs/common';
import {
  canManagePriceLists,
  canManageShippingConfig,
  canOperateShipping,
  canWriteQuotations,
} from '../../src/core/auth/utils/commerce-operation-guards';
import { BostaService } from '../../src/modules/bosta/bosta.service';
import { GccShippingService } from '../../src/modules/gcc-shipping/gcc-shipping.service';
import { PriceListsService } from '../../src/modules/sales/services/price-lists.service';
import { QuotationsService } from '../../src/modules/sales/services/quotations.service';

async function run() {
  const base = {
    userId: 9,
    role: 'cashier',
    tenantId: 'merchant-a',
    accountId: 'merchant-a:main',
    permissions: [],
  } as any;
  for (const check of [canManagePriceLists, canManageShippingConfig, canOperateShipping, canWriteQuotations]) {
    assert.throws(() => check(base), ForbiddenException);
  }
  assert.doesNotThrow(() => canManagePriceLists({ ...base, permissions: ['pricingCenterManage'] }));
  assert.doesNotThrow(() => canManageShippingConfig({ ...base, permissions: ['canManageSettings'] }));
  assert.doesNotThrow(() => canOperateShipping({ ...base, permissions: ['deliveryReps'] }));
  assert.doesNotThrow(() => canWriteQuotations({ ...base, permissions: ['sales'] }));

  const bosta = new BostaService({} as any);
  const gcc = new GccShippingService({} as any);
  const pricing = new PriceListsService({} as any);
  const quotes = new QuotationsService({} as any, {} as any);
  // All must fail before first DB query / shipping HTTP call.
  await assert.rejects(() => bosta.saveSettings({ enabled: true }, base), ForbiddenException);
  await assert.rejects(() => gcc.saveSettings({ enabled: true }, base), ForbiddenException);
  await assert.rejects(() => bosta.createDelivery(10, {} as any, base), ForbiddenException);
  await assert.rejects(() => gcc.createShipment(10, {} as any, base), ForbiddenException);
  await assert.rejects(() => pricing.createPriceList(base, {} as any), ForbiddenException);
  await assert.rejects(() => quotes.createQuotation({} as any, base), ForbiddenException);
  await assert.rejects(() => quotes.convertToSale(10, base), ForbiddenException);
}
run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
