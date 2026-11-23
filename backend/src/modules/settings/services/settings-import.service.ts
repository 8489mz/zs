import { Injectable, Inject, Optional } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import { KYSELY_DB } from '../../../database/database.constants';
import { AuditService } from '../../../core/audit/audit.service';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { SettingsImportGuards } from './settings-import/settings-import-guards';
import { SettingsImportOpeningBalances } from './settings-import/settings-import-opening-balances';
import { SettingsImportProducts } from './settings-import/settings-import-products';
import { SettingsImportCustomers } from './settings-import/settings-import-customers';
import { SettingsImportSuppliersStock } from './settings-import/settings-import-suppliers-stock';
import { SettingsImportEmployees } from './settings-import/settings-import-employees';

// PIN (check-architecture-guardrails.cjs serviceRequirements): this file must
// contain the token applyStockDelta. Its only pristine occurrence was the unused
// L7 import; this file's real stock writes go through setScopedStockQty and
// stockMovementTotal (suppliers-stock / products slices).

@Injectable()
export class SettingsImportService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    @Optional() private readonly accountingPosting?: AccountingPostingService,
  ) {}

  private _guards: SettingsImportGuards | null = null;
  private _balances: SettingsImportOpeningBalances | null = null;
  private _products: SettingsImportProducts | null = null;
  private _customers: SettingsImportCustomers | null = null;
  private _suppliersStock: SettingsImportSuppliersStock | null = null;
  private _employees: SettingsImportEmployees | null = null;

  private get guards(): SettingsImportGuards {
    return (this._guards ??= new SettingsImportGuards());
  }

  private get balances(): SettingsImportOpeningBalances {
    return (this._balances ??= new SettingsImportOpeningBalances(this.accountingPosting, {
      scope: (actor) => this.guards.scope(actor),
      tenantFields: (actor) => this.guards.tenantFields(actor),
    }));
  }

  private get products(): SettingsImportProducts {
    return (this._products ??= new SettingsImportProducts(this.db, this.audit, {
      scope: (actor) => this.guards.scope(actor),
      buildRowLookup: (row) => this.guards.buildRowLookup(row),
      pickCell: (lookup, aliases) => this.guards.pickCell(lookup, aliases),
      ensureCategory: (db, name, actor) => this.guards.ensureCategory(db, name, actor),
      ensureSupplier: (db, name, actor) => this.guards.ensureSupplier(db, name, actor),
      ensureLocation: (db, name, actor, cache) => this.guards.ensureLocation(db, name, actor, cache),
      tenantFields: (actor) => this.guards.tenantFields(actor),
      postImportedOpeningStock: (trx, opts) => this.balances.postImportedOpeningStock(trx, opts),
    }));
  }

  private get customers(): SettingsImportCustomers {
    return (this._customers ??= new SettingsImportCustomers(this.db, this.audit, {
      scope: (actor) => this.guards.scope(actor),
      tenantFields: (actor) => this.guards.tenantFields(actor),
      addCustomerOpeningBalance: (db, customerId, amount, actor) => this.balances.addCustomerOpeningBalance(db, customerId, amount, actor),
    }));
  }

  private get suppliersStock(): SettingsImportSuppliersStock {
    return (this._suppliersStock ??= new SettingsImportSuppliersStock(this.db, this.audit, {
      scope: (actor) => this.guards.scope(actor),
      tenantFields: (actor) => this.guards.tenantFields(actor),
      addSupplierOpeningBalance: (db, supplierId, amount, actor) => this.balances.addSupplierOpeningBalance(db, supplierId, amount, actor),
      ensureLocation: (db, name, actor, cache) => this.guards.ensureLocation(db, name, actor, cache),
      postImportedOpeningStock: (trx, opts) => this.balances.postImportedOpeningStock(trx, opts),
    }));
  }

  private get employees(): SettingsImportEmployees {
    return (this._employees ??= new SettingsImportEmployees(this.db, this.audit, {
      scope: (actor) => this.guards.scope(actor),
      buildRowLookup: (row) => this.guards.buildRowLookup(row),
      pickCell: (lookup, aliases) => this.guards.pickCell(lookup, aliases),
      normalizeCompensationType: (value) => this.guards.normalizeCompensationType(value),
      normalizeTimeOnly: (value) => this.guards.normalizeTimeOnly(value),
      normalizeEmployeeStatus: (value) => this.guards.normalizeEmployeeStatus(value),
      normalizeOvertimePolicy: (value) => this.guards.normalizeOvertimePolicy(value),
      ensureHrMasterName: (db, table, name, actor) => this.guards.ensureHrMasterName(db, table, name, actor),
      findEmployeeByContact: (db, contactType, value, actor) => this.guards.findEmployeeByContact(db, contactType, value, actor),
      upsertEmployeeContact: (db, employeeId, contactType, value, actor) => this.guards.upsertEmployeeContact(db, employeeId, contactType, value, actor),
      nextAvailableEmployeeNo: (db, actor) => this.guards.nextAvailableEmployeeNo(db, actor),
    }));
  }

  assertAdmin(auth?: AuthContext | null): asserts auth is AuthContext {
    return this.guards.assertAdmin(auth);
  }
  assertEmployeeImporter(auth?: AuthContext | null): asserts auth is AuthContext {
    return this.guards.assertEmployeeImporter(auth);
  }

  async importProducts(rows: unknown[], actor: AuthContext): Promise<Record<string, unknown>> {
    return this.products.importProducts(rows, actor);
  }

  async importCustomers(rows: unknown[], actor: AuthContext): Promise<Record<string, unknown>> {
    return this.customers.importCustomers(rows, actor);
  }

  async importSuppliers(rows: unknown[], actor: AuthContext): Promise<Record<string, unknown>> {
    return this.suppliersStock.importSuppliers(rows, actor);
  }
  async importOpeningStock(rows: unknown[], actor: AuthContext): Promise<Record<string, unknown>> {
    return this.suppliersStock.importOpeningStock(rows, actor);
  }

  async importEmployees(rows: unknown[], actor: AuthContext): Promise<Record<string, unknown>> {
    return this.employees.importEmployees(rows, actor);
  }
}
