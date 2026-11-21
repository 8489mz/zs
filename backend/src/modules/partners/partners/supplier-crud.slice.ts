import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AppError } from '../../../common/errors/app-error';
import { UpsertSupplierDto } from '../dto/upsert-supplier.dto';
import { buildSupplierSearchPredicate, calculatePagination, mapSupplierRow, parsePartnersListQuery } from '../helpers/partners-listing.helper';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import type { RawBuilder } from 'kysely';

export interface SupplierCrudSliceBoundDeps {
  tenantPredicate: (actor: AuthContext, alias?: string) => RawBuilder<boolean>;
  tenantId: (actor: AuthContext) => string;
  tenantFields: (actor: AuthContext) => { tenant_id: string; account_id: string };
  supplierNameExists: (name: string, actor: AuthContext, excludeId?: number) => Promise<boolean>;
  addSupplierOpeningBalance: (supplierId: number, amount: number, actor: AuthContext, db: Kysely<Database>) => Promise<void>;
}

export class SupplierCrudSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly bound: SupplierCrudSliceBoundDeps,
  ) {}

  private tenantPredicate(actor: AuthContext, alias?: string) {
    return this.bound.tenantPredicate(actor, alias);
  }

  private tenantId(actor: AuthContext): string {
    return this.bound.tenantId(actor);
  }

  private tenantFields(actor: AuthContext) {
    return this.bound.tenantFields(actor);
  }

  private async supplierNameExists(name: string, actor: AuthContext, excludeId?: number): Promise<boolean> {
    return this.bound.supplierNameExists(name, actor, excludeId);
  }

  private async addSupplierOpeningBalance(supplierId: number, amount: number, actor: AuthContext, db: Kysely<Database>): Promise<void> {
    return this.bound.addSupplierOpeningBalance(supplierId, amount, actor, db);
  }
  async listSuppliers(query: Record<string, unknown>, actor: AuthContext): Promise<Record<string, unknown>> {
    const { page, pageSize, q, filter, isUnpagedDefault } = parsePartnersListQuery(query);

    let listQuery = this.db.selectFrom('suppliers').selectAll().where('is_active', '=', true).where(this.tenantPredicate(actor));
    let countQuery = this.db.selectFrom('suppliers').select((eb) => eb.fn.countAll<number>().as('count')).where('is_active', '=', true).where(this.tenantPredicate(actor));
    let summaryQuery = this.db.selectFrom('suppliers').select((eb) => [
      eb.fn.countAll<number>().as('total_suppliers'),
      sql<number>`coalesce(sum(balance), 0)`.as('total_balance'),
      sql<number>`coalesce(sum(case when trim(notes) <> '' then 1 else 0 end), 0)`.as('with_notes'),
    ]).where('is_active', '=', true).where(this.tenantPredicate(actor));

    const searchPredicate = buildSupplierSearchPredicate(q);
    if (searchPredicate) {
      listQuery = listQuery.where(searchPredicate);
      countQuery = countQuery.where(searchPredicate);
      summaryQuery = summaryQuery.where(searchPredicate);
    }

    if (filter === 'balance' || filter === 'debt') {
      listQuery = listQuery.where('balance', '>', 0);
      countQuery = countQuery.where('balance', '>', 0);
      summaryQuery = summaryQuery.where('balance', '>', 0);
    } else if (filter === 'withNotes') {
      const notesPredicate = sql<boolean>`trim(notes) <> ''`;
      listQuery = listQuery.where(notesPredicate);
      countQuery = countQuery.where(notesPredicate);
      summaryQuery = summaryQuery.where(notesPredicate);
    }

    if (isUnpagedDefault) {
      const rows = await listQuery.orderBy('id', 'asc').execute();
      return { suppliers: rows.map((row) => mapSupplierRow(row)) };
    }

    const [rows, countRow, summaryRow] = await Promise.all([
      listQuery.orderBy('id', 'asc').limit(pageSize).offset((page - 1) * pageSize).execute(),
      countQuery.executeTakeFirstOrThrow(),
      summaryQuery.executeTakeFirstOrThrow(),
    ]);

    const totalItems = Number(countRow.count || 0);

    return {
      suppliers: rows.map((row) => mapSupplierRow(row)),
      pagination: calculatePagination(page, pageSize, totalItems),
      summary: {
        totalSuppliers: Number(summaryRow.total_suppliers || 0),
        totalBalance: Number(summaryRow.total_balance || 0),
        withNotes: Number(summaryRow.with_notes || 0),
      },
    };
  }

  /* INV-SUPPLIER-ADVANCE-OVERDRAFT-LIMIT: validate the supplier type and
   * overdraft limit in the service, not only in the DTO — the service is
   * the real path, and a caller flag must never be trusted on its own.
   * Returns the values to persist; undefined means "leave unchanged".
   * A null limit clears the cap back to uncapped. The limit must fit
   * tenant book precision, like every money amount. */
  private async validateSupplierTypeAndLimit(payload: UpsertSupplierDto, actor: AuthContext): Promise<{ supplierType?: 'supplier' | 'freelancer'; overdraftLimit?: number | null }> {
    let supplierType: 'supplier' | 'freelancer' | undefined;
    if (payload.supplierType !== undefined) {
      if (payload.supplierType !== 'supplier' && payload.supplierType !== 'freelancer') {
        throw new AppError('Supplier type must be supplier or freelancer', 'SUPPLIER_TYPE_INVALID', 400);
      }
      supplierType = payload.supplierType;
    }
    let overdraftLimit: number | null | undefined;
    if (payload.overdraftLimit !== undefined) {
      if (payload.overdraftLimit === null) {
        overdraftLimit = null;
      } else {
        const limit = Number(payload.overdraftLimit);
        const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, this.tenantId(actor)));
        const scale = 10 ** digits;
        if (!Number.isFinite(limit) || limit < 0 || Math.abs(limit * scale - Math.round(limit * scale)) > 0.000001) {
          throw new AppError('Overdraft limit must be zero or more with at most tenant currency minor-unit precision', 'SUPPLIER_OVERDRAFT_LIMIT_INVALID', 400);
        }
        overdraftLimit = limit;
      }
    }
    return { supplierType, overdraftLimit };
  }

  async createSupplier(payload: UpsertSupplierDto, actor: AuthContext): Promise<Record<string, unknown>> {
    const name = String(payload.name || '').trim();
    if (!name) throw new AppError('Supplier name is required', 'SUPPLIER_NAME_REQUIRED', 400);
    if (await this.supplierNameExists(name, actor)) throw new AppError('Supplier already exists', 'SUPPLIER_EXISTS', 400);
    const { supplierType, overdraftLimit } = await this.validateSupplierTypeAndLimit(payload, actor);

    const inserted = await this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('suppliers')
        .values({
          name,
          phone: String(payload.phone || '').trim(),
          address: String(payload.address || '').trim(),
          balance: 0,
          notes: String(payload.notes || '').trim(),
          metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
          supplier_type: supplierType ?? 'supplier',
          overdraft_limit: overdraftLimit ?? null,
          is_active: true,
          ...this.tenantFields(actor),
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      await this.addSupplierOpeningBalance(Number(inserted.id), Number(payload.balance || 0), actor, trx);
      return inserted;
    });
    await this.audit.log('إضافة مورد', `تم إضافة المورد ${name} بواسطة ${actor.username}`, actor);

    const listing = await this.listSuppliers({}, actor);
    return { ok: true, suppliers: listing.suppliers, id: inserted.id, supplier: { id: inserted.id, name } };
  }

  async updateSupplier(id: number, payload: UpsertSupplierDto, actor: AuthContext): Promise<Record<string, unknown>> {
    const existing = await this.db
      .selectFrom('suppliers')
      .select(['id', 'balance'])
      .where('id', '=', id)
      .where('is_active', '=', true)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();

    if (!existing) throw new AppError('Supplier not found', 'SUPPLIER_NOT_FOUND', 404);

    const name = String(payload.name || '').trim();
    if (!name) throw new AppError('Supplier name is required', 'SUPPLIER_NAME_REQUIRED', 400);
    if (await this.supplierNameExists(name, actor, id)) throw new AppError('Supplier already exists', 'SUPPLIER_EXISTS', 400);

    const requestedBalance = Number(payload.balance ?? existing.balance ?? 0);
    if (Math.abs(Number(existing.balance || 0) - requestedBalance) > 0.0001) {
      throw new AppError('Balance cannot be edited from supplier form; use opening balance/import/reconcile flow', 'SUPPLIER_BALANCE_EDIT_FORBIDDEN', 400);
    }
    const { supplierType, overdraftLimit } = await this.validateSupplierTypeAndLimit(payload, actor);

    await this.db
      .updateTable('suppliers')
      .set({
        name,
        phone: String(payload.phone || '').trim(),
        address: String(payload.address || '').trim(),
        notes: String(payload.notes || '').trim(),
        metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
        ...(supplierType !== undefined ? { supplier_type: supplierType } : {}),
        ...(overdraftLimit !== undefined ? { overdraft_limit: overdraftLimit } : {}),
        updated_at: sql`NOW()`,
      })
      .where('id', '=', id)
      .where(this.tenantPredicate(actor))
      .execute();

    await this.audit.log('تعديل مورد', `تم تحديث المورد #${id} بواسطة ${actor.username}`, actor);
    const listing = await this.listSuppliers({}, actor);
    return { ok: true, suppliers: listing.suppliers };
  }

  async deleteSupplier(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const supplier = await this.db
      .selectFrom('suppliers')
      .select(['id', 'balance'])
      .where('id', '=', id)
      .where('is_active', '=', true)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();

    if (!supplier) throw new AppError('Supplier not found', 'SUPPLIER_NOT_FOUND', 404);
    if (Math.abs(Number(supplier.balance || 0)) > 0.0001) throw new AppError('Supplier has outstanding balance', 'SUPPLIER_HAS_BALANCE', 400);

    const [purchaseCount, paymentCount, ledgerCount] = await Promise.all([
      this.db.selectFrom('purchases').select((eb) => eb.fn.countAll<number>().as('count')).where('supplier_id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirstOrThrow(),
      this.db.selectFrom('supplier_payments').select((eb) => eb.fn.countAll<number>().as('count')).where('supplier_id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirstOrThrow(),
      this.db.selectFrom('supplier_ledger').select((eb) => eb.fn.countAll<number>().as('count')).where('supplier_id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirstOrThrow(),
    ]);

    if (Number(purchaseCount.count || 0) || Number(paymentCount.count || 0) || Number(ledgerCount.count || 0)) {
      throw new AppError('Supplier has financial history and cannot be deleted', 'SUPPLIER_HAS_HISTORY', 400);
    }

    await this.db.updateTable('suppliers').set({ is_active: false, updated_at: sql`NOW()` }).where('id', '=', id).where(this.tenantPredicate(actor)).execute();
    await this.audit.log('حذف مورد', `تم تعطيل المورد #${id} بواسطة ${actor.username}`, actor);

    const listing = await this.listSuppliers({}, actor);
    return { ok: true, suppliers: listing.suppliers };
  }
}
