import { Database } from '../../../../database/database.types';
import { Kysely } from 'kysely';
import { AppError } from '../../../../common/errors/app-error';
import { TenantScope } from './restaurant-fnb-types';
import type { TableLayoutItemDto } from '../../dto/restaurant-fnb.dto';

export class RestaurantFnbUpsellLayoutsSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly assertManagerCaller: (scope: TenantScope) => void,
  ) {}

  // ==========================================
  // 11. SMART UPSELLING & CROSS-SELLING ENGINE
  // ==========================================

  async getUpsellRecommendations(scope: TenantScope, triggerProductId?: number, categoryName?: string) {
    let query = this.db
      .selectFrom('restaurant_upsell_rules')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('is_active', '=', true);

    if (triggerProductId) {
      query = query.where('trigger_product_id', '=', Number(triggerProductId));
    } else if (categoryName) {
      query = query.where('trigger_category_name', '=', categoryName);
    }

    const rules = await query.limit(5).execute();
    return rules;
  }

  async createUpsellRule(
    scope: TenantScope,
    dto: {
      triggerProductId?: number;
      triggerCategoryName?: string;
      suggestedProductId: number;
      suggestedProductName: string;
      title: string;
      discountAmount?: number;
    },
  ) {
    const [rule] = await this.db
      .insertInto('restaurant_upsell_rules')
      .values({
        tenant_id: scope.tenantId,
        trigger_product_id: dto.triggerProductId ? Number(dto.triggerProductId) : null,
        trigger_category_name: dto.triggerCategoryName || null,
        suggested_product_id: Number(dto.suggestedProductId),
        suggested_product_name: dto.suggestedProductName,
        title: dto.title,
        discount_amount: dto.discountAmount || 0,
        is_active: true,
        created_at: new Date(),
      })
      .returningAll()
      .execute();

    return { success: true, rule, message: 'تم حفظ قاعدة الاقتراح الذكي بنجاح' };
  }

  // ==========================================
  // 12. VISUAL FLOOR PLAN CANVAS & TABLE LAYOUTS
  // ==========================================

  async getTableLayouts(scope: TenantScope, branchId?: number | null) {
    let query = this.db
      .selectFrom('restaurant_table_layouts')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('is_active', '=', true);

    if (branchId) {
      query = query.where((eb) => eb.or([eb('branch_id', '=', branchId), eb('branch_id', 'is', null)]));
    }

    const layouts = await query.orderBy('id', 'asc').execute();
    return layouts.map((l) => ({
      ...l,
      x_pos: Number(l.x_pos || 10),
      y_pos: Number(l.y_pos || 10),
      width: Number(l.width || 80),
      height: Number(l.height || 80),
      seats: Number(l.seats || 4),
      rotation: Number(l.rotation || 0),
    }));
  }

  async saveTableLayouts(
    scope: TenantScope,
    // D5: same widening as the facade (see there) — the body
    // tolerates a missing table_number (skips the item) and
    // missing coordinates (default 10), so the type now says
    // what the body does. Type-only change.
    layouts: TableLayoutItemDto[],
    branchId?: number | null,
  ) {
    // INV-REST-FLOOR-STATE-TRUTH (R5-D, R-I37): design mode is
    // manager-only. A cashier overwriting the shared floor layout could
    // hide live orders; the gate lives here (not in a decorator) because
    // the manager definition is admin role OR pos_manager /
    // manage_restaurant permission — the same definition the POS uses for
    // its manager tiles — and PermissionsGuard checks permission strings
    // only. Read stays authenticated-any.
    this.assertManagerCaller(scope);
    if (!Array.isArray(layouts)) return [];

    return await this.db.transaction().execute(async (trx) => {
      const saved: any[] = [];
      for (const item of layouts) {
        if (!item.table_number) continue;

        const existing = await trx
          .selectFrom('restaurant_table_layouts')
          .select(['id'])
          .where('tenant_id', '=', scope.tenantId)
          .where('table_number', '=', String(item.table_number).trim())
          .executeTakeFirst();

        if (existing) {
          const [updated] = await trx
            .updateTable('restaurant_table_layouts')
            .set({
              zone_code: item.zone_code || 'main',
              shape: item.shape || 'square',
              x_pos: Number(item.x_pos || 10),
              y_pos: Number(item.y_pos || 10),
              width: Number(item.width || 80),
              height: Number(item.height || 80),
              seats: Number(item.seats || 4),
              rotation: Number(item.rotation || 0),
              updated_at: new Date(),
            })
            .where('id', '=', existing.id)
            .returningAll()
            .execute();
          saved.push(updated);
        } else {
          const [created] = await trx
            .insertInto('restaurant_table_layouts')
            .values({
              tenant_id: scope.tenantId,
              branch_id: branchId ? Number(branchId) : null,
              table_number: String(item.table_number).trim(),
              zone_code: item.zone_code || 'main',
              shape: item.shape || 'square',
              x_pos: Number(item.x_pos || 10),
              y_pos: Number(item.y_pos || 10),
              width: Number(item.width || 80),
              height: Number(item.height || 80),
              seats: Number(item.seats || 4),
              rotation: Number(item.rotation || 0),
              is_active: true,
              created_at: new Date(),
              updated_at: new Date(),
            })
            .returningAll()
            .execute();
          saved.push(created);
        }
      }
      return saved;
    });
  }

  async deleteTableLayout(scope: TenantScope, id: number) {
    // INV-REST-FLOOR-DESIGN-GATES (B2): deleting a layout is a design
    // write like saving one — manager-only (R5-D). At base any
    // authenticated caller could delete the shared floor through the API.
    this.assertManagerCaller(scope);
    await this.db
      .deleteFrom('restaurant_table_layouts')
      .where('tenant_id', '=', scope.tenantId)
      .where('id', '=', id)
      .execute();
    return { success: true };
  }

  /*
   * INV-REST-FLOOR-STATE-TRUTH (R5-D, R-I35): real whole-table transfer
   * for a held draft. The rename updates ONLY held_sales.table_number —
   * no other column is touched — so it needs no dependency on the
   * hold/recall snapshot work (R5-B): the draft's cart, totals and
   * discounts are never re-saved, only re-pointed at the target table.
   * A target table that already holds a draft is refused (409), the
   * same one-draft-per-table rule saveHeldSale enforces (R4-D I42).
   */
  async renameHeldDraftTable(scope: TenantScope, draftId: number, toTableNumber: string) {
    // INV-REST-FLOOR-DESIGN-GATES (B2, decision): deliberately NOT
    // manager-gated. This is the whole-table TRANSFER engine
    // (transferTableOrder + the held-drafts dialog rename, both open to
    // any POS role in the UI) — it changes ONLY held_sales.table_number,
    // no amounts or cart contents, is fully reversible, and the 409
    // occupied-table guard prevents collisions. Gating it would block
    // every waiter/cashier table move; a table move is neither loss nor
    // fraud. Pinned by restaurant-floor-state.spec.ts check (13).
    const to = String(toTableNumber || '').trim();
    if (!to) {
      throw new AppError('رقم الطاولة الجديدة إلزامي.', 'HELD_DRAFT_TABLE_REQUIRED', 400);
    }
    const draft = await this.db
      .selectFrom('held_sales')
      .selectAll()
      .where('id', '=', Number(draftId))
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (!draft) {
      throw new AppError('الطلب المحفوظ غير موجود.', 'HELD_DRAFT_NOT_FOUND', 404);
    }
    if (String(draft.table_number).trim() === to) return draft;
    const occupant = await this.db
      .selectFrom('held_sales')
      .select('id')
      .where('tenant_id', '=', scope.tenantId)
      .where('table_number', '=', to)
      .where('id', '!=', Number(draftId))
      .executeTakeFirst();
    if (occupant) {
      throw new AppError(`الطاولة ${to} مشغولة بالفعل بطلب محفوظ.`, 'HELD_DRAFT_TABLE_OCCUPIED', 409);
    }
    const [renamed] = await this.db
      .updateTable('held_sales')
      .set({ table_number: to, updated_at: new Date() })
      .where('id', '=', Number(draftId))
      .where('tenant_id', '=', scope.tenantId)
      .returningAll()
      .execute();
    return renamed;
  }
}
