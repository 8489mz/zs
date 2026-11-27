import { assertHierarchyParent } from '../accounting-boundaries';
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { type Database } from '../../../database/database.types';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { lockAccountingPeriod } from '../accounting-period-lock';

/**
 * AccountingCostCentersService — slice S9 of the accounting split.
 * Pure move of 4 methods from AccountingService (cost-center CRUD:
 * list, create, update, delete). No behavior change: the bodies are
 * byte-identical; the facade keeps thin delegates with the same names
 * and signatures. Deps are kernel only (db + the bound kernel helper
 * assertAccountingAccess); no cross-slice deps, no posting (no
 * accountingPosting dep). The COST CENTERS ENGINE section banner
 * travels with the move (prep §2). No clock sites and no guard sites
 * in this slice: new Date() x0, toISOString() x0, Date.now() x0,
 * toFixed( x0, inlineRound( x0, roundMoney( x0, currencyMoneyDigits(
 * x0. The two tx methods (create/update) call lockAccountingPeriod +
 * assertHierarchyParent as free functions on the passed trx handle —
 * no tx-internal method calls (prep §9). All 4 methods are
 * controller-only (0 driving specs — unpinned per prep §7); the merge
 * proof for S9 is the merged-tree critical run + ci-fast, not a RED.
 * No spec reads S9's source text (ground-proven: none of the 8 pin
 * specs mentions these methods), so no pin repoint.
 */

export interface AccountingCostCentersDeps {
  db: Kysely<Database>;
  // Bound kernel helper (stays in the facade; passed bound so the moved
  // bodies stay byte-identical). assertAccountingAccess is the only
  // kernel method the moved bodies call (besides this.db).
  assertAccountingAccess: (auth: AuthContext) => void;
}

@Injectable()
export class AccountingCostCentersService {
  private readonly db: Kysely<Database>;
  private readonly assertAccountingAccess: (auth: AuthContext) => void;

  constructor(deps: AccountingCostCentersDeps) {
    this.db = deps.db;
    this.assertAccountingAccess = deps.assertAccountingAccess;
  }

  // ---------------------------------------------------------------------------
  // COST CENTERS ENGINE
  // ---------------------------------------------------------------------------

  async listCostCenters(auth: AuthContext): Promise<{ ok: boolean; costCenters: Record<string, unknown>[] }> {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);
    const rows = await this.db
      .selectFrom('cost_centers as cc')
      .leftJoin('cost_centers as p', (join: any) =>
        join.onRef('cc.parent_id', '=', 'p.id').onRef('cc.tenant_id', '=', 'p.tenant_id'),
      )
      .select([
        'cc.id',
        'cc.code',
        'cc.name',
        'cc.dimension',
        'cc.budget_amount as budgetAmount',
        'cc.parent_id as parentId',
        'p.name as parentName',
        'cc.is_active as isActive',
        'cc.description',
        'cc.created_at as createdAt',
        'cc.updated_at as updatedAt',
      ])
      .where('cc.tenant_id', '=', scope.tenantId)
      .orderBy('cc.code', 'asc')
      .execute();

    return {
      ok: true,
      costCenters: rows.map((r: any) => ({
        ...r,
        id: Number(r.id),
        dimension: r.dimension || 'operational',
        budgetAmount: Number(r.budgetAmount || 0),
        parentId: r.parentId ? Number(r.parentId) : null,
        isActive: Boolean(r.isActive),
      })),
    };
  }

  async createCostCenter(
    body: {
      code: string;
      name: string;
      dimension?: string;
      budgetAmount?: number;
      parentId?: number | null;
      description?: string;
      isActive?: boolean;
    },
    auth: AuthContext,
  ) {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);
    return this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, scope.tenantId);
      await assertHierarchyParent(
        trx,
        'cost_centers',
        scope.tenantId,
        null,
        body.parentId == null ? null : Number(body.parentId),
      );
      const code = String(body.code || '')
        .trim()
        .toUpperCase();
      const name = String(body.name || '').trim();
      if (!code || !name) {
        throw new BadRequestException('كود واسم مركز التكلفة مطلوبان.');
      }
      const dimension = body.dimension ? String(body.dimension).trim() : 'operational';
      const budgetAmount = body.budgetAmount !== undefined ? Number(body.budgetAmount) : 0;
      const parentId = body.parentId ? Number(body.parentId) : null;
      const description = body.description ? String(body.description).trim() : null;
      const isActive = body.isActive !== false;

      const inserted = await trx
        .insertInto('cost_centers')
        .values({
          tenant_id: scope.tenantId,
          code,
          name,
          dimension,
          budget_amount: budgetAmount,
          parent_id: parentId,
          description,
          is_active: isActive,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
        ok: true,
        costCenter: {
          ...inserted,
          id: Number(inserted.id),
          dimension: inserted.dimension || 'operational',
          budgetAmount: Number(inserted.budget_amount || 0),
          parentId: inserted.parent_id ? Number(inserted.parent_id) : null,
          isActive: Boolean(inserted.is_active),
        },
      };
    });
  }

  async updateCostCenter(
    id: number,
    body: {
      code?: string;
      name?: string;
      dimension?: string;
      budgetAmount?: number;
      parentId?: number | null;
      description?: string;
      isActive?: boolean;
    },
    auth: AuthContext,
  ) {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);
    return this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, scope.tenantId);
      await assertHierarchyParent(
        trx,
        'cost_centers',
        scope.tenantId,
        id,
        body.parentId == null ? null : Number(body.parentId),
      );
      const updates: Record<string, unknown> = {
        updated_at: sql`NOW()`,
      };
      if (body.code !== undefined) updates.code = String(body.code).trim().toUpperCase();
      if (body.name !== undefined) updates.name = String(body.name).trim();
      if (body.dimension !== undefined) updates.dimension = String(body.dimension).trim();
      if (body.budgetAmount !== undefined) updates.budget_amount = Number(body.budgetAmount);
      if (body.parentId !== undefined) updates.parent_id = body.parentId ? Number(body.parentId) : null;
      if (body.description !== undefined)
        updates.description = body.description ? String(body.description).trim() : null;
      if (body.isActive !== undefined) updates.is_active = Boolean(body.isActive);

      const updated = await trx
        .updateTable('cost_centers')
        .set(updates)
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .returningAll()
        .executeTakeFirst();

      if (!updated) {
        throw new NotFoundException('مركز التكلفة غير موجود.');
      }

      return {
        ok: true,
        costCenter: {
          ...updated,
          id: Number(updated.id),
          dimension: updated.dimension || 'operational',
          budgetAmount: Number(updated.budget_amount || 0),
          parentId: updated.parent_id ? Number(updated.parent_id) : null,
          isActive: Boolean(updated.is_active),
        },
      };
    });
  }

  async deleteCostCenter(id: number, auth: AuthContext) {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);

    const linkedLines = await this.db
      .selectFrom('journal_entry_lines')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('tenant_id', '=', scope.tenantId)
      .where('cost_center_id', '=', id)
      .executeTakeFirst();

    if (Number(linkedLines?.count || 0) > 0) {
      await this.db
        .updateTable('cost_centers')
        .set({ is_active: false, updated_at: sql`NOW()` })
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .execute();
      return { ok: true, message: 'تم تعطيل مركز التكلفة لارتباطه بحركات محاسبية سابقة.' };
    }

    await this.db.deleteFrom('cost_centers').where('id', '=', id).where('tenant_id', '=', scope.tenantId).execute();

    return { ok: true, message: 'تم حذف مركز التكلفة بنجاح.' };
  }
}
