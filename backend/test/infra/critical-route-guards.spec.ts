import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { REQUIRED_PERMISSIONS_KEY } from '../../src/core/auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../src/core/auth/guards/permissions.guard';
import { SessionAuthGuard } from '../../src/core/auth/guards/session-auth.guard';
import { CashDrawerController } from '../../src/modules/cash-drawer/cash-drawer.controller';
import { PurchasesController } from '../../src/modules/purchases/purchases.controller';
import { ReturnsController } from '../../src/modules/returns/returns.controller';
import { SalesController } from '../../src/modules/sales/sales.controller';

function readClassGuards(controller: { name: string }): string[] {
  const guards = Reflect.getMetadata(GUARDS_METADATA, controller) || [];
  return guards.map((guard: { name?: string }) => guard?.name || '');
}

function assertProtectedClass(controller: { name: string }): void {
  const guards = readClassGuards(controller);
  assert.ok(guards.includes(SessionAuthGuard.name), `${controller.name} must use SessionAuthGuard`);
  assert.ok(guards.includes(PermissionsGuard.name), `${controller.name} must use PermissionsGuard`);
}

function readPermissions(target: Record<string, unknown>, methodName: string): string[] {
  return Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, target[methodName] as object) || [];
}

(() => {
  assertProtectedClass(SalesController);
  assertProtectedClass(PurchasesController);
  assertProtectedClass(ReturnsController);
  assertProtectedClass(CashDrawerController);

  assert.deepEqual(readPermissions(SalesController.prototype as any, 'createSale'), ['sales']);
  assert.deepEqual(readPermissions(SalesController.prototype as any, 'cancelSale'), ['canEditInvoices']);
  assert.deepEqual(readPermissions(PurchasesController.prototype as any, 'createPurchase'), ['purchases']);
  assert.deepEqual(readPermissions(PurchasesController.prototype as any, 'updatePurchase'), ['canEditInvoices']);
  assert.deepEqual(readPermissions(PurchasesController.prototype as any, 'cancelPurchase'), ['canEditInvoices']);
  assert.deepEqual(readPermissions(ReturnsController.prototype as any, 'createReturn'), ['returns']);
  assert.deepEqual(readPermissions(CashDrawerController.prototype as any, 'open'), ['cashDrawer']);
  assert.deepEqual(readPermissions(CashDrawerController.prototype as any, 'movement'), ['cashDrawer']);
  assert.deepEqual(readPermissions(CashDrawerController.prototype as any, 'close'), ['cashDrawer']);

  console.log('critical-route-guards.spec: ok');
})();
