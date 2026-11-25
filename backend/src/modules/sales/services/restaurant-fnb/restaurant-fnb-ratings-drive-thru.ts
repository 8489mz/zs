import { Database } from '../../../../database/database.types';
import { Kysely } from 'kysely';
import { AppError } from '../../../../common/errors/app-error';
import { TenantScope } from './restaurant-fnb-types';

export class RestaurantFnbRatingsDriveThruSlice {
  constructor(private readonly db: Kysely<Database>) {}

  // ==========================================
  // 8. TABLE QR RATING & RESCUE ALERT ENGINE
  // ==========================================

  async recordTableRating(
    scope: TenantScope,
    dto: {
      tableNumber: string;
      saleId?: number;
      rating: number;
      feedbackCategory?: string;
      notes?: string;
    },
  ) {
    if (!dto.tableNumber || !dto.rating) {
      throw new AppError('رقم الطاولة والتقييم مطلوبان', 'INVALID_RATING_DATA', 400);
    }

    const isNegative = dto.rating <= 2;

    const [rating] = await this.db
      .insertInto('restaurant_table_ratings')
      .values({
        tenant_id: scope.tenantId,
        branch_id: scope.branchId || null,
        table_number: dto.tableNumber,
        sale_id: dto.saleId || null,
        rating: dto.rating,
        feedback_category: dto.feedbackCategory || 'food_quality',
        notes: dto.notes || null,
        is_rescued: false,
        created_at: new Date(),
      })
      .returningAll()
      .execute();

    // If customer rated <= 2 stars, instantly dispatch a high-priority rescue service call!
    if (isNegative) {
      await this.db
        .insertInto('restaurant_table_service_calls')
        .values({
          tenant_id: scope.tenantId,
          branch_id: scope.branchId || null,
          table_number: dto.tableNumber,
          call_type: 'rescue',
          status: 'pending',
          created_at: new Date(),
        })
        .execute();
    }

    return {
      success: true,
      rating,
      isRescueAlertTriggered: isNegative,
      message: isNegative
        ? 'شكراً لملاحظاتك! مدير الصالة في طريقه إليك فوراً لحل أي إزعاج.'
        : 'شكراً لتقييمك الرائع! نتطلع لزيارتك القادمة.',
    };
  }

  async resolveRescueAlert(scope: TenantScope, ratingId: number, managerName: string) {
    // INV-REST-FLOOR-DESIGN-GATES (B2, decision): deliberately NOT
    // manager-gated. This only flips is_rescued on a guest rating with a
    // free-text managerName attribution — a service-recovery note, not a
    // floor-state or money write. The name is a label, not a verified
    // identity, and the staff member who actually soothed the guest is
    // the one who records it. Pinned by restaurant-floor-state.spec.ts
    // check (14).
    await this.db
      .updateTable('restaurant_table_ratings')
      .set({
        is_rescued: true,
        rescued_by: managerName,
      })
      .where('tenant_id', '=', scope.tenantId)
      .where('id', '=', ratingId)
      .execute();

    return { success: true, message: 'تم توثيق حل وتدارك الموقف مع الضيف بنجاح' };
  }

  // ==========================================
  // 9. TABLE MINIMUM SPEND CALCULATION ENGINE
  // ==========================================

  calculateMinimumSpend(currentTotal: number, minimumSpend: number) {
    const validTotal = Math.max(0, Number(currentTotal || 0));
    const validMin = Math.max(0, Number(minimumSpend || 0));
    const hasDeficit = validMin > 0 && validTotal < validMin;
    const deficitAmount = hasDeficit ? Math.round((validMin - validTotal) * 100) / 100 : 0;
    const finalTotal = hasDeficit ? validMin : validTotal;

    return {
      hasDeficit,
      deficitAmount,
      minimumSpend: validMin,
      foodAndBeverageTotal: validTotal,
      finalTotal,
    };
  }

  // ==========================================
  // 10. DRIVE-THRU LANE & SPEED OF SERVICE (SOS)
  // ==========================================

  async getDriveThruOrders(scope: TenantScope) {
    const orders = await this.db
      .selectFrom('restaurant_drive_thru_orders')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('created_at', 'desc')
      .limit(30)
      .execute();

    const now = Date.now();
    const enriched = orders.map((o) => {
      let currentSos = o.sos_seconds;
      if (!currentSos && o.order_time) {
        currentSos = Math.round((now - new Date(o.order_time).getTime()) / 1000);
      }
      return {
        ...o,
        liveSosSeconds: currentSos,
        sosSeverity: (currentSos || 0) < 90 ? 'normal' : (currentSos || 0) <= 180 ? 'warning' : 'critical',
      };
    });

    const completedWithSos = orders.filter((o) => o.status === 'completed' && o.sos_seconds);
    const avgSosSeconds =
      completedWithSos.length > 0
        ? Math.round(completedWithSos.reduce((sum, o) => sum + (o.sos_seconds || 0), 0) / completedWithSos.length)
        : 0;

    return {
      orders: enriched,
      activeCount: enriched.filter((o) => o.status === 'order_taken' || o.status === 'at_window').length,
      averageSosSeconds: avgSosSeconds,
    };
  }

  async createDriveThruOrder(
    scope: TenantScope,
    dto: {
      vehiclePlate: string;
      vehicleDesc?: string;
      totalAmount?: number;
      notes?: string;
    },
  ) {
    if (!dto.vehiclePlate) {
      throw new AppError('رقم لوحة السيارة مطلوب', 'VEHICLE_PLATE_REQUIRED', 400);
    }

    const [order] = await this.db
      .insertInto('restaurant_drive_thru_orders')
      .values({
        tenant_id: scope.tenantId,
        branch_id: scope.branchId || null,
        vehicle_plate: dto.vehiclePlate,
        vehicle_desc: dto.vehicleDesc || null,
        status: 'order_taken',
        order_time: new Date(),
        total_amount: dto.totalAmount || 0,
        notes: dto.notes || null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returningAll()
      .execute();

    return { success: true, order, message: 'تم إدراج سيارة جديدة في مسار طلبات السيارات' };
  }

  async updateDriveThruStatus(
    scope: TenantScope,
    id: number,
    status: 'order_taken' | 'at_window' | 'completed' | 'cancelled',
  ) {
    const existing = await this.db
      .selectFrom('restaurant_drive_thru_orders')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existing) {
      throw new AppError('طلب مسار السيارات غير موجود', 'DRIVE_THRU_NOT_FOUND', 404);
    }

    const now = new Date();
    const updatePayload: any = {
      status,
      updated_at: now,
    };

    if (status === 'at_window' && !existing.window_arrival_time) {
      updatePayload.window_arrival_time = now;
    } else if (status === 'completed') {
      updatePayload.completed_time = now;
      const startMs = new Date(existing.order_time).getTime();
      updatePayload.sos_seconds = Math.round((now.getTime() - startMs) / 1000);
    }

    await this.db
      .updateTable('restaurant_drive_thru_orders')
      .set(updatePayload)
      .where('tenant_id', '=', scope.tenantId)
      .where('id', '=', id)
      .execute();

    return {
      success: true,
      message:
        status === 'completed'
          ? `تم تسليم الطلب وخروج السيارة من المسار (${updatePayload.sos_seconds || 0} ثانية)`
          : 'تم تحديث حالة السيارة في المسار بنجاح',
    };
  }
}
