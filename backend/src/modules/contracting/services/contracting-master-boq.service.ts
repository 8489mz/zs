import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import {
  CreateMasterBoqLibraryItemDto,
  UpdateMasterBoqLibraryItemDto,
  BatchImportMasterBoqDto,
  ImportMasterBoqToProjectDto,
  SaveBoqTakeoffsDto,
} from '../dto/contracting.dto';

/**
 * ContractingMasterBoqService — slice C9 of the contracting split.
 * Pure move of 10 methods from ContractingService (multi-trade master BOQ
 * library (8) + BOQ CAD quantity takeoffs (2)). No behavior change: the
 * bodies are byte-identical; the facade keeps thin delegates with the same
 * names and signatures for all 10 public methods. This slice takes db plus
 * one bound facade delegate — getProjectById (C1 projects slice, reached
 * through the facade delegate; the slice never imports another slice
 * service). It posts no journals (the 2 posting methods live in C4), has
 * no FX sites (resolveFxRate 0 in the whole file), and its 4 inline
 * Math.round(x*100)/100 sites (all in saveTakeoffs) stay as-is
 * (dispositioned in the allowlist, not roundMoney — prep §7.8a). No clock
 * pin follows these methods (zero C9 names in the 5 clock specs,
 * ground-proven); date sites travel verbatim (updated_at server instants
 * only — no tenant-day, no UTC-slice normalizer, no instant comparison).
 */

export interface ContractingMasterBoqDeps {
  db: Kysely<any>;
  // Bound facade delegate (same name as the facade member, so the moved
  // body is byte-identical). getProjectById lives in the C1 projects
  // slice, reached through the facade delegate — the slice never imports
  // another slice service. Real signature:
  // (auth: AuthContext, id: string) => Promise<ContractingProjectSummary>.
  getProjectById: (...args: any[]) => any;
}

@Injectable()
export class ContractingMasterBoqService {
  private readonly db: Kysely<any>;
  private readonly getProjectById: (...args: any[]) => any;

  constructor(deps: ContractingMasterBoqDeps) {
    this.db = deps.db;
    this.getProjectById = deps.getProjectById;
  }

  async getMasterBoqTrades(auth: AuthContext) {
    const { tenantId } = requireTenantScope(auth);
    const rows = await sql<{
      trade_category: string;
      trade_name_ar: string;
      items_count: string;
    }>`
      WITH scoped_items AS (
        SELECT DISTINCT ON (item_code)
          trade_category, trade_name_ar, is_active
        FROM contracting_master_boq_library
        WHERE (tenant_id = ${tenantId} OR tenant_id = '')
        ORDER BY item_code, (CASE WHEN tenant_id = ${tenantId} THEN 1 ELSE 2 END)
      )
      SELECT 
        trade_category,
        MAX(trade_name_ar) as trade_name_ar,
        COUNT(*)::text as items_count
      FROM scoped_items
      WHERE is_active = true
      GROUP BY trade_category
      ORDER BY (
        CASE trade_category
          WHEN 'site_mobilization' THEN 1
          WHEN 'civil_concrete' THEN 2
          WHEN 'masonry_insulation' THEN 3
          WHEN 'steel_structure' THEN 4
          WHEN 'finishing_decor' THEN 5
          WHEN 'doors_windows_aluminum' THEN 6
          WHEN 'electrical_lighting' THEN 7
          WHEN 'smart_elv_systems' THEN 8
          WHEN 'plumbing_sanitary' THEN 9
          WHEN 'hvac_mechanical' THEN 10
          WHEN 'fire_fighting' THEN 11
          WHEN 'site_infrastructure' THEN 12
          ELSE 99
        END
      ) ASC
    `.execute(this.db);

    return rows.rows.map((r) => ({
      tradeCategory: r.trade_category,
      tradeNameAr: r.trade_name_ar,
      itemsCount: Number(r.items_count || 0),
    }));
  }

  async getMasterBoqLibrary(auth: AuthContext, query?: { tradeCategory?: string; search?: string; status?: string }) {
    const { tenantId } = requireTenantScope(auth);
    let rawQuery = sql<any>`
      WITH scoped_items AS (
        SELECT DISTINCT ON (item_code)
          id, tenant_id, trade_category, trade_name_ar, item_code, name, description, unit, standard_cost, standard_price, is_active, created_at, updated_at
        FROM contracting_master_boq_library
        WHERE (tenant_id = ${tenantId} OR tenant_id = '')
        ORDER BY item_code, (CASE WHEN tenant_id = ${tenantId} THEN 1 ELSE 2 END)
      )
      SELECT * FROM scoped_items
      WHERE 1=1
    `;

    if (query?.status === 'active') {
      rawQuery = sql`${rawQuery} AND is_active = true`;
    } else if (query?.status === 'inactive') {
      rawQuery = sql`${rawQuery} AND is_active = false`;
    } else {
      // Default: show active items unless specified
      rawQuery = sql`${rawQuery} AND is_active = true`;
    }

    if (query?.tradeCategory && query.tradeCategory !== 'all') {
      const cats = query.tradeCategory.split(',').map((c: string) => c.trim()).filter(Boolean);
      if (cats.length === 1) {
        rawQuery = sql`${rawQuery} AND trade_category = ${cats[0]}`;
      } else if (cats.length > 1) {
        rawQuery = sql`${rawQuery} AND trade_category IN (${sql.join(cats.map((c: string) => sql`${c}`), sql`, `)})`;
      }
    }

    if (query?.search) {
      const s = `%${query.search.trim()}%`;
      rawQuery = sql`${rawQuery} AND (name ILIKE ${s} OR item_code ILIKE ${s} OR description ILIKE ${s} OR trade_name_ar ILIKE ${s})`;
    }

    rawQuery = sql`${rawQuery} ORDER BY trade_category ASC, item_code ASC`;

    const result = await rawQuery.execute(this.db);
    return result.rows.map((it: any) => ({
      id: String(it.id),
      tradeCategory: it.trade_category,
      tradeNameAr: it.trade_name_ar,
      itemCode: it.item_code,
      name: it.name,
      description: it.description,
      unit: it.unit,
      standardCost: Number(it.standard_cost || 0),
      standardPrice: Number(it.standard_price || 0),
      isActive: Boolean(it.is_active),
      isCustom: Boolean(it.tenant_id && it.tenant_id === tenantId),
      createdAt: it.created_at,
    }));
  }

  async createMasterBoqItem(auth: AuthContext, dto: CreateMasterBoqLibraryItemDto) {
    const { tenantId } = requireTenantScope(auth);
    const existing = await (this.db as any)
      .selectFrom('contracting_master_boq_library')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('item_code', '=', dto.itemCode.trim())
      .executeTakeFirst();

    if (existing) {
      throw new BadRequestException(`كود البند المرجعي ${dto.itemCode} موجود مسبقاً`);
    }

    const inserted = await (this.db as any)
      .insertInto('contracting_master_boq_library')
      .values({
        tenant_id: tenantId,
        trade_category: dto.tradeCategory.trim(),
        trade_name_ar: dto.tradeNameAr.trim(),
        item_code: dto.itemCode.trim(),
        name: dto.name.trim(),
        description: dto.description?.trim() || '',
        unit: dto.unit.trim(),
        standard_cost: dto.standardCost,
        standard_price: dto.standardPrice,
        is_active: true,
      })
      .returningAll()
      .executeTakeFirst();

    return inserted;
  }

  async bulkImportMasterBoqItems(auth: AuthContext, dto: BatchImportMasterBoqDto) {
    const { tenantId } = requireTenantScope(auth);
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('لا توجد بنود للاستيراد');
    }

    let insertedCount = 0;
    for (const item of dto.items) {
      if (!item.name || !item.itemCode) continue;
      await sql`
        INSERT INTO contracting_master_boq_library (
          tenant_id, trade_category, trade_name_ar, item_code, name, description, unit, standard_cost, standard_price, is_active
        ) VALUES (
          ${tenantId}, 
          ${item.tradeCategory || 'civil_concrete'}, 
          ${item.tradeNameAr || 'الأعمال المدنية والخرسانات'}, 
          ${item.itemCode.trim()}, 
          ${item.name.trim()}, 
          ${item.description?.trim() || ''}, 
          ${item.unit?.trim() || 'm3'}, 
          ${item.standardCost || 0}, 
          ${item.standardPrice || 0}, 
          true
        )
        ON CONFLICT (tenant_id, item_code) DO UPDATE SET
          name = EXCLUDED.name,
          trade_category = EXCLUDED.trade_category,
          trade_name_ar = EXCLUDED.trade_name_ar,
          description = EXCLUDED.description,
          unit = EXCLUDED.unit,
          standard_cost = EXCLUDED.standard_cost,
          standard_price = EXCLUDED.standard_price,
          is_active = true,
          updated_at = NOW();
      `.execute(this.db);
      insertedCount++;
    }

    return {
      success: true,
      count: insertedCount,
      message: `تم استيراد وتحديث ${insertedCount} بند في بنك البنود بنجاح`,
    };
  }

  async updateMasterBoqItem(auth: AuthContext, id: string, dto: UpdateMasterBoqLibraryItemDto) {
    const { tenantId } = requireTenantScope(auth);
    const item = await (this.db as any)
      .selectFrom('contracting_master_boq_library')
      .selectAll()
      .where('id', '=', id as any)
      .where((eb: any) => eb.or([eb('tenant_id', '=', tenantId), eb('tenant_id', '=', '')]))
      .executeTakeFirst();

    if (!item) {
      throw new NotFoundException(`البند المرجعي برقم ${id} غير موجود`);
    }

    const updates: any = { updated_at: new Date() };
    if (dto.name !== undefined) updates.name = dto.name.trim();
    if (dto.tradeCategory !== undefined) updates.trade_category = dto.tradeCategory.trim();
    if (dto.tradeNameAr !== undefined) updates.trade_name_ar = dto.tradeNameAr.trim();
    if (dto.description !== undefined) updates.description = dto.description.trim();
    if (dto.unit !== undefined) updates.unit = dto.unit.trim();
    if (dto.standardCost !== undefined) updates.standard_cost = dto.standardCost;
    if (dto.standardPrice !== undefined) updates.standard_price = dto.standardPrice;
    if (dto.isActive !== undefined) updates.is_active = dto.isActive;

    if (item.tenant_id === tenantId) {
      const updated = await (this.db as any)
        .updateTable('contracting_master_boq_library')
        .set(updates)
        .where('id', '=', id as any)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .executeTakeFirst();
      return updated;
    } else {
      // Standard item: create/update tenant-specific override
      const merged = {
        trade_category: updates.trade_category || item.trade_category,
        trade_name_ar: updates.trade_name_ar || item.trade_name_ar,
        item_code: item.item_code,
        name: updates.name || item.name,
        description: updates.description !== undefined ? updates.description : item.description,
        unit: updates.unit || item.unit,
        standard_cost: updates.standard_cost !== undefined ? updates.standard_cost : item.standard_cost,
        standard_price: updates.standard_price !== undefined ? updates.standard_price : item.standard_price,
        is_active: updates.is_active !== undefined ? updates.is_active : item.is_active,
      };

      const override = await sql<any>`
        INSERT INTO contracting_master_boq_library (
          tenant_id, trade_category, trade_name_ar, item_code, name, description, unit, standard_cost, standard_price, is_active
        ) VALUES (
          ${tenantId}, ${merged.trade_category}, ${merged.trade_name_ar}, ${merged.item_code}, ${merged.name}, ${merged.description}, ${merged.unit}, ${merged.standard_cost}, ${merged.standard_price}, ${merged.is_active}
        )
        ON CONFLICT (tenant_id, item_code) DO UPDATE SET
          name = EXCLUDED.name,
          trade_category = EXCLUDED.trade_category,
          trade_name_ar = EXCLUDED.trade_name_ar,
          description = EXCLUDED.description,
          unit = EXCLUDED.unit,
          standard_cost = EXCLUDED.standard_cost,
          standard_price = EXCLUDED.standard_price,
          is_active = EXCLUDED.is_active,
          updated_at = NOW()
        RETURNING *;
      `.execute(this.db);
      return override.rows[0];
    }
  }

  async toggleMasterBoqItemStatus(auth: AuthContext, id: string, targetActive?: boolean) {
    const { tenantId } = requireTenantScope(auth);
    const item = await (this.db as any)
      .selectFrom('contracting_master_boq_library')
      .selectAll()
      .where('id', '=', id as any)
      .where((eb: any) => eb.or([eb('tenant_id', '=', tenantId), eb('tenant_id', '=', '')]))
      .executeTakeFirst();

    if (!item) {
      throw new NotFoundException('البند المرجعي غير موجود');
    }

    const newStatus = targetActive !== undefined ? targetActive : !item.is_active;

    if (item.tenant_id === tenantId) {
      const updated = await (this.db as any)
        .updateTable('contracting_master_boq_library')
        .set({ is_active: newStatus, updated_at: new Date() })
        .where('id', '=', id as any)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .executeTakeFirst();
      return { success: true, isActive: newStatus, item: updated };
    } else {
      const override = await sql<any>`
        INSERT INTO contracting_master_boq_library (
          tenant_id, trade_category, trade_name_ar, item_code, name, description, unit, standard_cost, standard_price, is_active
        ) VALUES (
          ${tenantId}, ${item.trade_category}, ${item.trade_name_ar}, ${item.item_code}, ${item.name}, ${item.description}, ${item.unit}, ${item.standard_cost}, ${item.standard_price}, ${newStatus}
        )
        ON CONFLICT (tenant_id, item_code) DO UPDATE SET
          is_active = ${newStatus},
          updated_at = NOW()
        RETURNING *;
      `.execute(this.db);
      return { success: true, isActive: newStatus, item: override.rows[0] };
    }
  }

  async deleteMasterBoqItem(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    const item = await (this.db as any)
      .selectFrom('contracting_master_boq_library')
      .selectAll()
      .where('id', '=', id as any)
      .where((eb: any) => eb.or([eb('tenant_id', '=', tenantId), eb('tenant_id', '=', '')]))
      .executeTakeFirst();

    if (!item) {
      throw new NotFoundException('البند المرجعي غير موجود');
    }

    if (item.tenant_id === tenantId) {
      await (this.db as any)
        .deleteFrom('contracting_master_boq_library')
        .where('id', '=', id as any)
        .where('tenant_id', '=', tenantId)
        .execute();
      return { success: true, message: 'تم حذف البند المرجعي المخصص بنجاح' };
    } else {
      // Standard item: deactivating it for this tenant acts as hiding/excluding it from their company library
      await sql`
        INSERT INTO contracting_master_boq_library (
          tenant_id, trade_category, trade_name_ar, item_code, name, description, unit, standard_cost, standard_price, is_active
        ) VALUES (
          ${tenantId}, ${item.trade_category}, ${item.trade_name_ar}, ${item.item_code}, ${item.name}, ${item.description}, ${item.unit}, ${item.standard_cost}, ${item.standard_price}, false
        )
        ON CONFLICT (tenant_id, item_code) DO UPDATE SET
          is_active = false,
          updated_at = NOW();
      `.execute(this.db);
      return { success: true, message: 'تم استبعاد وإخفاء البند القياسي من مكتبة بنود الشركة' };
    }
  }

  async importMasterBoqItemsToProject(auth: AuthContext, projectId: string, dto: ImportMasterBoqToProjectDto) {
    const { tenantId } = requireTenantScope(auth);
    await this.getProjectById(auth, projectId);

    if (!dto.itemIds || dto.itemIds.length === 0) {
      throw new BadRequestException('يرجى تحديد بند واحد على الأقل للاستيراد');
    }

    const masterItems = await (this.db as any)
      .selectFrom('contracting_master_boq_library')
      .selectAll()
      .where('id', 'in', dto.itemIds as any)
      .where((eb: any) => eb.or([eb('tenant_id', '=', tenantId), eb('tenant_id', '=', '')]))
      .execute();

    if (!masterItems || new Set(masterItems.map((item: any) => String(item.id))).size !== new Set(dto.itemIds.map(String)).size) {
      throw new NotFoundException('لم يتم العثور على البنود المحددة في بنك البنود المرجعي');
    }

    const existingBoq = await (this.db as any)
      .selectFrom('contracting_boq_items')
      .select('item_code')
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .execute();

    const existingCodes = new Set(existingBoq.map((b: any) => b.item_code));

    let importedCount = 0;
    const insertedItems: any[] = [];

    for (const m of masterItems) {
      let candidateCode = m.item_code;
      let counter = 1;
      while (existingCodes.has(candidateCode)) {
        candidateCode = `${m.item_code}-${counter++}`;
      }
      existingCodes.add(candidateCode);

      const inserted = await (this.db as any)
        .insertInto('contracting_boq_items')
        .values({
          tenant_id: tenantId,
          project_id: projectId as any,
          item_code: candidateCode,
          description: m.name + (m.description ? ` - ${m.description}` : ''),
          category: m.trade_category || 'general',
          unit: m.unit || 'm3',
          contract_qty: 0,
          revised_qty: 0,
          unit_price: Number(m.standard_price || 0),
          total_price: 0,
          estimated_unit_cost: Number(m.standard_cost || 0),
          executed_qty: 0,
          notes: `مستورد من بنك البنود المرجعي [${m.trade_name_ar}]`,
        })
        .returningAll()
        .executeTakeFirst();

      if (inserted) {
        insertedItems.push(inserted);
        importedCount++;
      }
    }

    return {
      success: true,
      importedCount,
      projectId,
      items: insertedItems,
    };
  }

  async getTakeoffsByBoqItem(auth: AuthContext, boqItemId: string) {
    const { tenantId } = requireTenantScope(auth);
    const rows = await (this.db as any)
      .selectFrom('contracting_boq_takeoffs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('boq_item_id', '=', boqItemId as any)
      .orderBy('id', 'asc')
      .execute();

    return rows.map((r: any) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      boqItemId: String(r.boq_item_id),
      drawingRef: r.drawing_ref || '',
      axisRef: r.axis_ref || '',
      description: r.description || '',
      length: Number(r.length || 0),
      width: Number(r.width || 0),
      height: Number(r.height || 0),
      countMultiplier: Number(r.count_multiplier || 1),
      voidDeduction: Number(r.void_deduction || 0),
      netQty: Number(r.net_qty || 0),
      wastePercent: Number(r.waste_percent || 0),
      totalWithWaste: Number(r.total_with_waste || 0),
      notes: r.notes || null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async saveTakeoffs(auth: AuthContext, boqItemId: string, dto: SaveBoqTakeoffsDto) {
    const { tenantId } = requireTenantScope(auth);
    const boqItem = await (this.db as any)
      .selectFrom('contracting_boq_items')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', boqItemId as any)
      .executeTakeFirst();

    if (!boqItem) {
      throw new NotFoundException('بند المقايسة غير موجود');
    }

    // Delete existing takeoffs for this item
    await (this.db as any)
      .deleteFrom('contracting_boq_takeoffs')
      .where('tenant_id', '=', tenantId)
      .where('boq_item_id', '=', boqItemId as any)
      .execute();

    let totalCalculatedQty = 0;
    const insertedList: any[] = [];

    for (const t of dto.takeoffs || []) {
      const len = Number(t.length || 0);
      const wid = Number(t.width || 1);
      const hgt = Number(t.height || 1);
      const count = Number(t.countMultiplier || 1);
      const voidDed = Number(t.voidDeduction || 0);
      const waste = Number(t.wastePercent || 0);

      // Geometric volume/area calculation
      const baseProduct = len * wid * hgt * count;
      const net = Math.max(0, baseProduct - voidDed);
      const total = net * (1 + waste / 100);
      totalCalculatedQty += total;

      const ins = await (this.db as any)
        .insertInto('contracting_boq_takeoffs')
        .values({
          tenant_id: tenantId,
          project_id: boqItem.project_id,
          boq_item_id: boqItemId as any,
          drawing_ref: t.drawingRef || '',
          axis_ref: t.axisRef || '',
          description: t.description,
          length: len,
          width: wid,
          height: hgt,
          count_multiplier: count,
          void_deduction: voidDed,
          net_qty: Math.round((net + Number.EPSILON) * 1000) / 1000,
          waste_percent: waste,
          total_with_waste: Math.round((total + Number.EPSILON) * 1000) / 1000,
          notes: t.notes || null,
        })
        .returningAll()
        .executeTakeFirst();

      if (ins) insertedList.push(ins);
    }

    // If sync requested or default, update BOQ contract_qty and total_price
    if (dto.syncToBoqQuantity !== false && insertedList.length > 0) {
      const roundedQty = Math.round((totalCalculatedQty + Number.EPSILON) * 1000) / 1000;
      const unitPrice = Number(boqItem.unit_price || 0);
      const totalPrice = roundedQty * unitPrice;

      await (this.db as any)
        .updateTable('contracting_boq_items')
        .set({
          contract_qty: roundedQty,
          revised_qty: roundedQty,
          total_price: totalPrice,
          updated_at: new Date() as any,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', boqItemId as any)
        .execute();
    }

    return {
      success: true,
      totalCalculatedQty: Math.round((totalCalculatedQty + Number.EPSILON) * 1000) / 1000,
      count: insertedList.length,
      takeoffs: insertedList,
    };
  }
}
