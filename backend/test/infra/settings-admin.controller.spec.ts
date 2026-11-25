import { strict as assert } from 'node:assert';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SettingsAdminController } from '../../src/modules/settings/controllers/settings-admin.controller';
import { SessionAuthGuard } from '../../src/core/auth/guards/session-auth.guard';
import { AdminRoleGuard } from '../../src/core/auth/guards/admin-role.guard';

(() => {
  const controllerGuards = Reflect.getMetadata(GUARDS_METADATA, SettingsAdminController) as unknown[] | undefined;
  assert.ok(controllerGuards, 'controller should declare guards metadata');
  assert.equal(controllerGuards?.[0], SessionAuthGuard, 'controller should require session auth');
  assert.equal(controllerGuards?.[1], AdminRoleGuard, 'controller should require admin role guard');

  const serviceCalls: string[] = [];
  const service = {
    getDiagnostics() {
      serviceCalls.push('getDiagnostics');
      return { ok: true };
    },
    getMaintenanceReport() {
      serviceCalls.push('getMaintenanceReport');
      return { ok: true };
    },
    getLaunchReadiness() {
      serviceCalls.push('getLaunchReadiness');
      return { ok: true };
    },
    getOperationalReadiness() {
      serviceCalls.push('getOperationalReadiness');
      return { ok: true };
    },
    getSupportSnapshot() {
      serviceCalls.push('getSupportSnapshot');
      return { ok: true };
    },
    getUatReadiness() {
      serviceCalls.push('getUatReadiness');
      return { ok: true };
    },
    cleanupExpiredSessions() {
      serviceCalls.push('cleanupExpiredSessions');
      return { ok: true };
    },
    reconcileAll() {
      serviceCalls.push('reconcileAll');
      return { ok: true };
    },
    reconcileCustomers() {
      serviceCalls.push('reconcileCustomers');
      return { ok: true };
    },
    reconcileSuppliers() {
      serviceCalls.push('reconcileSuppliers');
      return { ok: true };
    },
  };

  const controller = new SettingsAdminController(service as any, {} as any);
  controller.getDiagnostics({} as any);
  controller.getMaintenanceReport({} as any);
  controller.getLaunchReadiness({} as any);
  controller.getOperationalReadiness({} as any);
  controller.getSupportSnapshot({} as any);
  controller.getUatReadiness({} as any);

  assert.deepEqual(serviceCalls, [
    'getDiagnostics',
    'getMaintenanceReport',
    'getLaunchReadiness',
    'getOperationalReadiness',
    'getSupportSnapshot',
    'getUatReadiness',
  ]);

  console.log('settings-admin.controller.spec: ok');
})();
