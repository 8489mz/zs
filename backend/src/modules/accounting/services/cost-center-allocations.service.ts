import { Inject, Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { KYSELY_DB } from '../../../database/database.constants';
import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

// D6 (INV-DTO-ACCOUNTING-25): converted from interfaces to decorated
// classes in place (DTO contract Rule 5). The service enforces >= 2
// splits, costCenterId a safe int > 0 and unique, percentage in (0, 100]
// and the splits totalling EXACTLY 100 — the DTO enforces the per-item
// bounds and the minimum count; the total==100 and uniqueness checks
// stay service-side.
export class CostCenterAllocationSplitDto {
  @IsInt()
  @Min(1)
  costCenterId!: number;

  @IsNumber()
  @IsPositive()
  @Max(100)
  percentage!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateCostCenterAllocationDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => CostCenterAllocationSplitDto)
  splits!: CostCenterAllocationSplitDto[];
}

@Injectable()
export class CostCenterAllocationsService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  private normalizeSplits(
    splits: CostCenterAllocationSplitDto[] | undefined,
  ): Array<{ costCenterId: number; percentage: number; notes: string | null }> {
    if (!Array.isArray(splits) || splits.length < 2) {
      throw new BadRequestException('يجب إضافة مركزين تكلفة على الأقل في مصفوفة التوزيع.');
    }
    const seen = new Set<number>();
    const normalized = splits.map((split) => {
      const costCenterId = Number(split?.costCenterId);
      const percentage = Number(split?.percentage);
      if (!Number.isSafeInteger(costCenterId) || costCenterId <= 0 || seen.has(costCenterId)) {
        throw new BadRequestException('مراكز التكلفة يجب أن تكون صحيحة وغير مكررة.');
      }
      if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
        throw new BadRequestException('كل نسبة توزيع يجب أن تكون موجبة وصالحة.');
      }
      seen.add(costCenterId);
      return { costCenterId, percentage, notes: split.notes || null };
    });
    const total = normalized.reduce((sum, split) => sum + split.percentage, 0);
    if (Math.abs(total - 100) > 0.000001) {
      throw new BadRequestException('يجب أن يساوي مجموع نسب توزيع التكلفة 100% بالضبط.');
    }
    return normalized;
  }

  private async assertOwnedCenters(db: Kysely<Database>, tenantId: string, centers: number[]): Promise<void> {
    const rows = await db
      .selectFrom('cost_centers')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('id', 'in', centers)
      .execute();
    if (rows.length !== centers.length) {
      throw new BadRequestException('أحد مراكز التكلفة غير موجود أو لا يتبع المنشأة.');
    }
  }

  async listAllocations(auth: AuthContext) {
    const { tenantId } = requireTenantScope(auth);
    const allocations = await this.db
      .selectFrom('cost_center_allocations')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('code', 'asc')
      .execute();

    if (allocations.length === 0) return [];

    const allocationIds = allocations.map((a) => String(a.id));
    const splits = await this.db
      .selectFrom('cost_center_allocation_splits as ccas')
      .leftJoin('cost_centers as cc', (join) =>
        join.onRef('cc.id', '=', 'ccas.cost_center_id').on('cc.tenant_id', '=', tenantId),
      )
      .select([
        'ccas.id',
        'ccas.allocation_id',
        'ccas.cost_center_id',
        'ccas.percentage',
        'ccas.notes',
        'cc.name as cost_center_name',
        'cc.code as cost_center_code',
      ])
      .where('ccas.tenant_id', '=', tenantId)
      .where('ccas.allocation_id', 'in', allocationIds)
      .execute();

    const splitsMap = new Map<string, any[]>();
    for (const s of splits) {
      const arr = splitsMap.get(String(s.allocation_id)) || [];
      arr.push({
        id: s.id,
        costCenterId: Number(s.cost_center_id),
        costCenterName: s.cost_center_name,
        costCenterCode: s.cost_center_code,
        percentage: Number(s.percentage),
        notes: s.notes,
      });
      splitsMap.set(String(s.allocation_id), arr);
    }

    return allocations.map((a) => ({
      id: String(a.id),
      code: a.code,
      name: a.name,
      description: a.description,
      isActive: a.is_active,
      createdAt: a.created_at,
      splits: splitsMap.get(String(a.id)) || [],
    }));
  }

  async createAllocation(dto: CreateCostCenterAllocationDto, auth: AuthContext) {
    const { tenantId } = requireTenantScope(auth);
    const code = String(dto.code || '')
      .trim()
      .toUpperCase();
    const name = String(dto.name || '').trim();
    if (!code || !name) throw new BadRequestException('كود واسم مصفوفة التوزيع مطلوبان.');
    const splits = this.normalizeSplits(dto.splits);

    return this.db.transaction().execute(async (trx) => {
      await this.assertOwnedCenters(
        trx,
        tenantId,
        splits.map((s) => s.costCenterId),
      );
      const created = await trx
        .insertInto('cost_center_allocations')
        .values({ tenant_id: tenantId, code, name, description: dto.description || null, is_active: true })
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('cost_center_allocation_splits')
        .values(
          splits.map((split) => ({
            tenant_id: tenantId,
            allocation_id: String(created.id),
            cost_center_id: String(split.costCenterId),
            percentage: split.percentage,
            notes: split.notes,
          })),
        )
        .execute();
      return { ok: true, allocationId: created.id };
    });
  }

  async updateAllocation(id: string, dto: CreateCostCenterAllocationDto, auth: AuthContext) {
    const { tenantId } = requireTenantScope(auth);
    const code = String(dto.code || '')
      .trim()
      .toUpperCase();
    const name = String(dto.name || '').trim();
    if (!code || !name) throw new BadRequestException('كود واسم مصفوفة التوزيع مطلوبان.');
    const splits = this.normalizeSplits(dto.splits);

    return this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('cost_center_allocations')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!existing) throw new NotFoundException('مصفوفة التوزيع غير موجودة.');
      await this.assertOwnedCenters(
        trx,
        tenantId,
        splits.map((s) => s.costCenterId),
      );
      await trx
        .updateTable('cost_center_allocations')
        .set({ code, name, description: dto.description || null, updated_at: sql`NOW()` })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .execute();
      await trx
        .deleteFrom('cost_center_allocation_splits')
        .where('tenant_id', '=', tenantId)
        .where('allocation_id', '=', id)
        .execute();
      await trx
        .insertInto('cost_center_allocation_splits')
        .values(
          splits.map((split) => ({
            tenant_id: tenantId,
            allocation_id: id,
            cost_center_id: String(split.costCenterId),
            percentage: split.percentage,
            notes: split.notes,
          })),
        )
        .execute();
      return { ok: true };
    });
  }

  async deleteAllocation(id: string, auth: AuthContext) {
    const { tenantId } = requireTenantScope(auth);
    const deleted = await this.db
      .deleteFrom('cost_center_allocations')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();

    if (!deleted) throw new NotFoundException('مصفوفة التوزيع غير موجودة.');
    return { ok: true };
  }

  async calculateSplitAmounts(allocationId: string, totalAmount: number, auth: AuthContext) {
    const { tenantId } = requireTenantScope(auth);
    const allocation = await this.db
      .selectFrom('cost_center_allocations')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', allocationId)
      .executeTakeFirst();

    if (!allocation) throw new NotFoundException('مصفوفة التوزيع غير موجودة.');

    const splits = await this.db
      .selectFrom('cost_center_allocation_splits as ccas')
      .leftJoin('cost_centers as cc', (join) =>
        join.onRef('cc.id', '=', 'ccas.cost_center_id').on('cc.tenant_id', '=', tenantId),
      )
      .select(['ccas.cost_center_id', 'ccas.percentage', 'cc.name as cost_center_name', 'cc.code as cost_center_code'])
      .where('ccas.tenant_id', '=', tenantId)
      .where('ccas.allocation_id', '=', allocationId)
      .execute();

    if (!Number.isFinite(totalAmount) || Math.abs(totalAmount) > Number.MAX_SAFE_INTEGER / 100) {
      throw new BadRequestException('قيمة التوزيع غير صالحة.');
    }
    const sign = totalAmount < 0 ? -1 : 1;
    const cents = Math.round(Math.abs(totalAmount) * 100);
    const parts = splits.map((split: any, index: number) => {
      const percentage = Number(split.percentage);
      const exactCents = (cents * percentage) / 100;
      const wholeCents = Math.floor(exactCents);
      return { split, index, percentage, wholeCents, remainder: exactCents - wholeCents };
    });
    if (!parts.length) throw new BadRequestException('مصفوفة التوزيع لا تحتوي على مراكز تكلفة.');
    const pctTotal = parts.reduce((sum, part) => sum + part.percentage, 0);
    if (!parts.every((p) => Number.isFinite(p.percentage) && p.percentage > 0) || Math.abs(pctTotal - 100) > 0.000001) {
      throw new BadRequestException('نسب توزيع مراكز التكلفة غير صالحة.');
    }
    const residual = cents - parts.reduce((sum, part) => sum + part.wholeCents, 0);
    const ranked = [...parts].sort(
      (a, b) => b.remainder - a.remainder || Number(a.split.cost_center_id) - Number(b.split.cost_center_id),
    );
    for (let i = 0; i < residual; i++) ranked[i % ranked.length].wholeCents += 1;
    const splitResults = parts.map(({ split, percentage, wholeCents }) => ({
      costCenterId: Number(split.cost_center_id),
      costCenterName: split.cost_center_name,
      costCenterCode: split.cost_center_code,
      percentage,
      allocatedAmount: (sign * wholeCents) / 100,
    }));

    return {
      allocationName: allocation.name,
      totalAmount,
      splits: splitResults,
    };
  }
}
