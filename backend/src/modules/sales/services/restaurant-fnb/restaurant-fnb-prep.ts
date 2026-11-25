import { Database } from '../../../../database/database.types';
import { Kysely } from 'kysely';
import { AppError } from '../../../../common/errors/app-error';
import { resolveBusinessDateKey } from '../../../accounting/engines/accounting-date.engine';
import { TenantScope, GeneratePrepSheetDto } from './restaurant-fnb-types';

export class RestaurantFnbPrepSlice {
  constructor(private readonly db: Kysely<Database>) {}

  // ==========================================
  // 4. CENTRAL PREP KITCHEN & DAILY PREP SHEETS
  // ==========================================

  async getPrepSheets(scope: TenantScope, prepDate?: string) {
    let query = this.db.selectFrom('restaurant_prep_sheets').selectAll().where('tenant_id', '=', scope.tenantId);

    if (prepDate) {
      query = query.where('prep_date', '=', prepDate);
    }

    const sheets = await query.orderBy('created_at', 'desc').limit(15).execute();
    const sheetIds = sheets.map((s) => s.id);

    let items: any[] = [];
    if (sheetIds.length > 0) {
      items = await this.db
        .selectFrom('restaurant_prep_sheet_items')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .where('prep_sheet_id', 'in', sheetIds)
        .execute();
    }

    const itemsMap = new Map<number, any[]>();
    for (const item of items) {
      if (!itemsMap.has(item.prep_sheet_id)) itemsMap.set(item.prep_sheet_id, []);
      itemsMap.get(item.prep_sheet_id)!.push(item);
    }

    return sheets.map((s) => ({
      ...s,
      items: itemsMap.get(s.id) || [],
    }));
  }

  async generateDailyPrepSheet(scope: TenantScope, dto: GeneratePrepSheetDto) {
    const prepDate = dto.prepDate || (await resolveBusinessDateKey(this.db, scope.tenantId, new Date()));

    // Create header
    const [sheet] = await this.db
      .insertInto('restaurant_prep_sheets')
      .values({
        tenant_id: scope.tenantId,
        branch_id: scope.branchId || null,
        prep_date: prepDate,
        shift_type: dto.shiftType || 'morning',
        status: 'in_progress',
        prepared_by: scope.userId || null,
        notes: dto.notes || null,
        created_at: new Date(),
      })
      .returningAll()
      .execute();

    // Default prep templates if no items passed
    const prepItems =
      dto.items && dto.items.length > 0
        ? dto.items
        : [
            { productId: 101, productName: 'تتبيل شاورما ولحم البرجر', unitName: 'كجم', parLevel: 25 },
            { productId: 102, productName: 'تحضير صوص الثومية والباربيكيو', unitName: 'لتر', parLevel: 15 },
            { productId: 103, productName: 'تقطيع بطاطس وخضار السلطة', unitName: 'كجم', parLevel: 30 },
            { productId: 104, productName: 'عجين البيتزا والمخبوزات', unitName: 'قطعة', parLevel: 50 },
            { productId: 105, productName: 'تجهيز صوص الشوكولاتة والكراميل', unitName: 'لتر', parLevel: 8 },
          ];

    const insertedItems = [];
    for (const item of prepItems) {
      const parLevel = Number(item.parLevel || 10);
      const onHand = 0; // can fetch live stock if available
      const prepRequired = Math.max(0, parLevel - onHand);

      const [row] = await this.db
        .insertInto('restaurant_prep_sheet_items')
        .values({
          tenant_id: scope.tenantId,
          prep_sheet_id: sheet.id,
          product_id: item.productId,
          product_name: item.productName,
          unit_name: item.unitName || 'كجم',
          par_level: parLevel,
          current_on_hand: onHand,
          prep_required: prepRequired,
          prep_actual: 0,
          status: 'pending',
          updated_at: new Date(),
        })
        .returningAll()
        .execute();

      insertedItems.push(row);
    }

    return { sheet, items: insertedItems };
  }

  async recordPrepProduction(scope: TenantScope, itemId: number, actualQty: number) {
    const item = await this.db
      .selectFrom('restaurant_prep_sheet_items')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('id', '=', itemId)
      .executeTakeFirst();

    if (!item) {
      throw new AppError('بند ورقة التحضير غير موجود', 'PREP_ITEM_NOT_FOUND', 404);
    }

    await this.db
      .updateTable('restaurant_prep_sheet_items')
      .set({
        prep_actual: actualQty,
        status: actualQty >= Number(item.prep_required) ? 'prepped' : 'pending',
        updated_at: new Date(),
      })
      .where('id', '=', itemId)
      .execute();

    return {
      success: true,
      message: `تم تسجيل تحضير ${actualQty} ${item.unit_name} من [${item.product_name}] بنجاح`,
    };
  }
}
