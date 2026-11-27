import { Injectable, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { getDailyDocumentPrefix } from '../../../common/utils/document-number.util';
import { getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import {
  CreateBoqItemDto,
  UpdateBoqItemDto,
  CreateChangeOrderDto,
  UpdateChangeOrderStatusDto,
  CreateCostSnapshotDto,
} from '../dto/contracting.dto';

/**
 * ContractingBoqService — slice C2 of the contracting split.
 * Pure move of 10 methods from ContractingService (BOQ items (5) + change
 * orders (3) + cost baseline snapshots (2)). No behavior change: the bodies
 * are byte-identical; the facade keeps thin delegates with the same names and
 * signatures for all 10 public methods. This slice takes db + a bound
 * getProjectById (createCostSnapshot calls this.getProjectById(auth,
 * projectId) — the C1 slice's method, bound via the facade delegate; the
 * import-sales S3 pattern). It posts no journals (the 2 posting methods live
 * in C4), has no FX sites (resolveFxRate 0 in the whole file), and moves
 * toFixed2 0 + inlineRound 0 (facade stays 3/24). No clock pin follows these
 * methods (zero C2 names in the 5 clock specs, ground-proven); date sites
 * travel verbatim (getTenantTimezone 1, new Date() 6, Date.now() 1 temp-code
 * token; the business-date-tenant-local §8 pin still holds — 18
 * getTenantTimezone hits remain in the facade after C2).
 */

export interface ContractingBoqDeps {
  db: Kysely<any>;
  // Bound facade member (same name as the facade member, so the moved body
  // is byte-identical): getProjectById lives in the C1 slice
  // (ContractingProjectsService) and is called here via the facade
  // delegate. Signature: (auth: AuthContext, id: string) =>
  // Promise<ContractingProjectSummary>.
  getProjectById: (...args: any[]) => any;
}

@Injectable()
export class ContractingBoqService {
  private readonly db: Kysely<any>;
  private readonly getProjectById: (...args: any[]) => any;

  constructor(deps: ContractingBoqDeps) {
    this.db = deps.db;
    this.getProjectById = deps.getProjectById;
  }

  async getBoqItems(auth: AuthContext, projectId: string) {
    const { tenantId } = requireTenantScope(auth);
    const rows = await this.db
      .selectFrom('contracting_boq_items')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .orderBy('item_code', 'asc')
      .execute();

    return rows.map((r: any) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      itemCode: r.item_code,
      description: r.description,
      category: r.category,
      unit: r.unit,
      contractQty: Number(r.contract_qty ?? 0),
      revisedQty: Number(r.revised_qty ?? r.contract_qty ?? 0),
      unitPrice: Number(r.unit_price ?? 0),
      totalPrice: Number(r.total_price ?? Number(r.contract_qty ?? 0) * Number(r.unit_price ?? 0)),
      estimatedUnitCost: Number(r.estimated_unit_cost ?? 0),
      executedQty: Number(r.executed_qty ?? 0),
      notes: r.notes,
      createdAt: r.created_at,
    }));
  }

  async createBoqItem(auth: AuthContext, projectId: string, dto: CreateBoqItemDto) {
    const { tenantId } = requireTenantScope(auth);
    const contractQty = Number(dto.contractQty || 0);
    const unitPrice = Number(dto.unitPrice || 0);
    const totalPrice = contractQty * unitPrice;
    const estimatedUnitCost = Number(dto.estimatedUnitCost || 0);

    const baseCode = (dto.itemCode || 'ITEM').trim();
    let finalCode = baseCode;

    // Check if code already exists in this project to prevent uq_contracting_boq_tenant_proj_code collision
    const existing = await this.db
      .selectFrom('contracting_boq_items')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .where('item_code', '=', finalCode)
      .executeTakeFirst();

    if (existing) {
      let counter = 2;
      finalCode = `${baseCode}-${counter}`;
      while (
        await this.db
          .selectFrom('contracting_boq_items')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('project_id', '=', projectId)
          .where('item_code', '=', finalCode)
          .executeTakeFirst()
      ) {
        counter++;
        finalCode = `${baseCode}-${counter}`;
      }
    }

    const [item] = await this.db
      .insertInto('contracting_boq_items')
      .values({
        tenant_id: tenantId,
        project_id: projectId,
        item_code: finalCode,
        description: dto.description.trim(),
        category: dto.category || 'general',
        unit: dto.unit || 'm3',
        contract_qty: contractQty,
        revised_qty: contractQty,
        unit_price: unitPrice,
        total_price: totalPrice,
        estimated_unit_cost: estimatedUnitCost,
        executed_qty: 0,
        notes: dto.notes || null,
      })
      .returningAll()
      .execute();
    if (!item) return null;
    return {
      id: String(item.id),
      projectId: String(item.project_id),
      itemCode: item.item_code,
      description: item.description,
      category: item.category,
      unit: item.unit,
      contractQty: Number(item.contract_qty ?? 0),
      revisedQty: Number(item.revised_qty ?? item.contract_qty ?? 0),
      unitPrice: Number(item.unit_price ?? 0),
      totalPrice: Number(item.total_price ?? 0),
      estimatedUnitCost: Number(item.estimated_unit_cost ?? 0),
      executedQty: Number(item.executed_qty ?? 0),
      notes: item.notes,
      createdAt: item.created_at,
    };
  }

  async batchCreateBoqItems(auth: AuthContext, projectId: string, items: CreateBoqItemDto[]) {
    const { tenantId } = requireTenantScope(auth);
    if (!items || items.length === 0) {
      return { success: true, count: 0, items: [] };
    }

    const project = await this.db
      .selectFrom('contracting_projects')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', projectId)
      .executeTakeFirst();

    if (!project) {
      throw new NotFoundException(`المشروع برقم ${projectId} غير موجود`);
    }

    // Get existing item codes to avoid collisions
    const existing = await this.db
      .selectFrom('contracting_boq_items')
      .select('item_code')
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .execute();
    const existingCodes = new Set(existing.map((e) => e.item_code.toUpperCase()));

    const insertedItems: any[] = [];

    for (let i = 0; i < items.length; i++) {
      const dto = items[i];
      let itemCode = (dto.itemCode || `ITEM-${String(i + 1).padStart(3, '0')}`).trim().toUpperCase();
      if (existingCodes.has(itemCode)) {
        itemCode = `${itemCode}-${i + 1}`;
      }
      existingCodes.add(itemCode);

      const contractQty = Number(dto.contractQty || 0);
      const unitPrice = Number(dto.unitPrice || 0);
      const totalPrice = contractQty * unitPrice;
      const estimatedUnitCost = Number(dto.estimatedUnitCost || 0);

      const [item] = await this.db
        .insertInto('contracting_boq_items')
        .values({
          tenant_id: tenantId,
          project_id: projectId,
          item_code: itemCode,
          description: (dto.description || `بند عمل ${itemCode}`).trim(),
          category: dto.category || 'general',
          unit: dto.unit || 'm3',
          contract_qty: contractQty,
          revised_qty: contractQty,
          unit_price: unitPrice,
          total_price: totalPrice,
          estimated_unit_cost: estimatedUnitCost,
          executed_qty: 0,
          notes: dto.notes || null,
        })
        .returningAll()
        .execute();

      if (item) insertedItems.push(item);
    }

    return {
      success: true,
      count: insertedItems.length,
      items: insertedItems,
    };
  }

  async updateBoqItem(auth: AuthContext, id: string, dto: UpdateBoqItemDto) {
    const { tenantId } = requireTenantScope(auth);
    const existing = await this.db
      .selectFrom('contracting_boq_items')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException(`بند المقايسة برقم ${id} غير موجود`);
    }

    const contractQty = dto.contractQty !== undefined ? Number(dto.contractQty) : Number(existing.contract_qty);
    const unitPrice = dto.unitPrice !== undefined ? Number(dto.unitPrice) : Number(existing.unit_price);
    const totalPrice = contractQty * unitPrice;

    const [updated] = await this.db
      .updateTable('contracting_boq_items')
      .set({
        description: dto.description !== undefined ? dto.description.trim() : existing.description,
        category: dto.category !== undefined ? dto.category : existing.category,
        unit: dto.unit !== undefined ? dto.unit : existing.unit,
        contract_qty: contractQty,
        revised_qty: contractQty,
        unit_price: unitPrice,
        total_price: totalPrice,
        estimated_unit_cost:
          dto.estimatedUnitCost !== undefined ? Number(dto.estimatedUnitCost) : existing.estimated_unit_cost,
        notes: dto.notes !== undefined ? dto.notes : existing.notes,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .returningAll()
      .execute();

    if (!updated) return null;
    return {
      id: String(updated.id),
      projectId: String(updated.project_id),
      itemCode: updated.item_code,
      description: updated.description,
      category: updated.category,
      unit: updated.unit,
      contractQty: Number(updated.contract_qty ?? 0),
      revisedQty: Number(updated.revised_qty ?? updated.contract_qty ?? 0),
      unitPrice: Number(updated.unit_price ?? 0),
      totalPrice: Number(updated.total_price ?? 0),
      estimatedUnitCost: Number(updated.estimated_unit_cost ?? 0),
      executedQty: Number(updated.executed_qty ?? 0),
      notes: updated.notes,
      createdAt: updated.created_at,
    };
  }

  async deleteBoqItem(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    await this.db.deleteFrom('contracting_boq_items').where('tenant_id', '=', tenantId).where('id', '=', id).execute();

    return { success: true };
  }

  async getChangeOrders(auth: AuthContext, projectId: string) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db
      .selectFrom('contracting_change_orders')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .orderBy('created_at', 'desc')
      .execute();
  }

  async createChangeOrder(auth: AuthContext, projectId: string, dto: CreateChangeOrderDto) {
    const { tenantId } = requireTenantScope(auth);
    const businessTz = await getTenantTimezone(this.db, tenantId);
    // INV-CONTRACTING-ID-DERIVED-NUMBERS: the number is derived from
    // the row id inside one transaction (DRG/MOM pattern), never
    // from a COUNT(*) that races and reuses numbers after deletions.
    const prefix = getDailyDocumentPrefix('CO', undefined, businessTz);
    const tempNumber = `CO-TMP-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const co = await this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('contracting_change_orders')
        .values({
          tenant_id: tenantId,
          project_id: projectId,
          change_order_number: tempNumber,
          title: dto.title.trim(),
          reason: dto.reason || 'client_request',
          impact_type: dto.impactType || 'cost_and_time',
          cost_impact: Number(dto.costImpact || 0),
          time_impact_days: Number(dto.timeImpactDays || 0),
          status: 'draft',
          notes: dto.notes || null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const updated = await trx
        .updateTable('contracting_change_orders')
        .set({
          change_order_number: `${prefix}${String(inserted.id).padStart(4, '0')}`,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(inserted.id))
        .returningAll()
        .executeTakeFirstOrThrow();
      return updated;
    });

    return co;
  }

  async updateChangeOrderStatus(auth: AuthContext, id: string, dto: UpdateChangeOrderStatusDto) {
    const { tenantId } = requireTenantScope(auth);
    const co = await this.db
      .selectFrom('contracting_change_orders')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!co) {
      throw new NotFoundException(`أمر التغيير برقم ${id} غير موجود`);
    }

    const [updated] = await this.db
      .updateTable('contracting_change_orders')
      .set({
        status: dto.status,
        approved_by: dto.status === 'approved' ? auth.username || 'الإدارة' : null,
        approved_at: dto.status === 'approved' ? new Date() : null,
        notes: dto.notes ? `${co.notes || ''}\n${dto.notes}`.trim() : co.notes,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .returningAll()
      .execute();

    // If approved, update project revised contract value & timeline
    if (dto.status === 'approved') {
      const project = await this.db
        .selectFrom('contracting_projects')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', co.project_id)
        .executeTakeFirst();

      if (project) {
        const approvedSum = await this.db
          .selectFrom('contracting_change_orders')
          .select(sql<number>`COALESCE(SUM(cost_impact), 0)`.as('sum'))
          .where('tenant_id', '=', tenantId)
          .where('project_id', '=', co.project_id)
          .where('status', '=', 'approved')
          .executeTakeFirst();

        const newRevisedValue = Number(project.contract_value) + Number(approvedSum?.sum || 0);

        await this.db
          .updateTable('contracting_projects')
          .set({
            revised_contract_value: newRevisedValue,
            updated_at: new Date(),
          })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', co.project_id)
          .execute();
      }
    }

    return updated;
  }

  async getCostSnapshots(auth: AuthContext, projectId: string) {
    const { tenantId } = requireTenantScope(auth);
    const rows = await this.db
      .selectFrom('contracting_cost_snapshots')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .orderBy('created_at', 'desc')
      .execute();

    return rows.map((r: any) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      snapshotName: r.snapshot_name,
      totalBudgetCost: Number(r.total_budget_cost || 0),
      totalContractValue: Number(r.total_contract_value || 0),
      isLocked: Boolean(r.is_locked),
      lockedAt: r.locked_at?.toISOString?.() || String(r.locked_at),
      lockedBy: r.locked_by || null,
      boqSnapshot: Array.isArray(r.boq_snapshot_json) ? r.boq_snapshot_json : [],
      createdAt: r.created_at?.toISOString?.() || String(r.created_at),
    }));
  }

  async createCostSnapshot(auth: AuthContext, projectId: string, dto: CreateCostSnapshotDto) {
    const { tenantId } = requireTenantScope(auth);
    const userEmail = (auth as any)?.user?.email || (auth as any)?.email || 'system_admin';
    // Fetch project and BOQ items
    const project = await this.getProjectById(auth, projectId);
    const boqItems = await this.getBoqItems(auth, projectId);

    const totalBudgetCost = (boqItems as any[]).reduce(
      (acc: number, it: any) =>
        acc +
        Number(it.estimated_unit_cost || it.estimatedUnitCost || 0) * Number(it.contract_qty || it.contractQty || 0),
      0,
    );
    const totalContractValue = (boqItems as any[]).reduce(
      (acc: number, it: any) => acc + Number(it.total_price || it.totalPrice || 0),
      0,
    );

    const [inserted] = await this.db
      .insertInto('contracting_cost_snapshots')
      .values({
        tenant_id: tenantId,
        project_id: projectId,
        snapshot_name: dto.snapshotName.trim(),
        total_budget_cost: totalBudgetCost,
        total_contract_value: totalContractValue || project.contractValue,
        is_locked: true,
        locked_at: new Date(),
        locked_by: userEmail,
        boq_snapshot_json: JSON.stringify(boqItems),
      })
      .returningAll()
      .execute();

    return {
      id: String(inserted.id),
      projectId: String(inserted.project_id),
      snapshotName: inserted.snapshot_name,
      totalBudgetCost: Number(inserted.total_budget_cost || 0),
      totalContractValue: Number(inserted.total_contract_value || 0),
      isLocked: Boolean(inserted.is_locked),
      lockedAt: inserted.locked_at?.toISOString?.() || String(inserted.locked_at),
      lockedBy: inserted.locked_by,
      boqSnapshot: boqItems,
      createdAt: inserted.created_at?.toISOString?.() || String(inserted.created_at),
    };
  }
}
