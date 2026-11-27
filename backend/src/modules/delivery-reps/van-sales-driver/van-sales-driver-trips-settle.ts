import { AppError } from '../../../common/errors/app-error';
import { AUDIT_EVENT_CODES } from '../../../core/audit/audit.service';
import { DeliveryRepsService } from '../delivery-reps.service';
import { VanSalesService } from '../van-sales.service';

export class VanSalesDriverTripsSettleSlice {
  constructor(
    private readonly vanSalesService: VanSalesService,
    private readonly deliveryRepsService: DeliveryRepsService,
    private readonly verifyDriver: (authHeader: string) => Promise<{
      repId: number;
      tenantId: string;
      accountId: string;
      name: string;
      phone: string;
    }>,
  ) {}

  async getActiveTrip(authHeader: string) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.getActiveTrip(driver.repId, driver.tenantId, driver.accountId);
  }

  // INV-VAN-DAILY-SPLIT-SETTLEMENT: per-day cash due for one trip —
  // the settle tab's per-day inputs read this; the server settles
  // from the same buckets, so the two can never disagree.
  async getTripDueByDay(authHeader: string, id: number) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.getTripDueByDay(driver.repId, driver.tenantId, id);
  }

  async openTrip(
    authHeader: string,
    body: {
      sourceWarehouseId?: number;
      items?: { productId: number; qty: number }[];
      notes?: string;
      startOdometer?: number;
      vehicleId?: number;
    },
  ) {
    const driver = await this.verifyDriver(authHeader);
    if (body?.items && Array.isArray(body.items) && body.items.length > 0) {
      await this.vanSalesService.recordSuspicionEvent({
        tenantId: driver.tenantId,
        accountId: driver.accountId,
        repId: driver.repId,
        eventCode: AUDIT_EVENT_CODES.VAN_SUSPICION_UNAUTHORIZED_LOAD_OR_SETTLE,
        severity: 'critical',
        titleAr: 'محاولة سحب بضاعة مباشرة من المستودع بدون إذن صرف معتمد',
        detailsAr: `حاول المندوب فتح رحلة وتحميل (${body.items.length}) أصناف مباشرة من المستودع بدون اعتماد أمين المستودع أو المشرف.`,
        metadata: {
          itemsCount: body.items.length,
          sourceWarehouseId: body.sourceWarehouseId,
        },
      });
      throw new AppError(
        'سحب البضاعة المباشر من المستودع غير مسموح للمندوب؛ يرجى رفع طلب تحميل (إذن صرف) لاعتماده من أمين المستودع أو المشرف',
        'DIRECT_WAREHOUSE_LOAD_FORBIDDEN',
        403,
      );
    }
    return this.vanSalesService.openTripAndLoad(driver.repId, driver.tenantId, driver.accountId, {
      ...body,
      items: [],
    });
  }

  async settleTrip(
    authHeader: string,
    body: {
      tripId: number;
      countedCash: number;
      // INV-VAN-DAILY-SPLIT-SETTLEMENT: per-day counted cash.
      perDayCash?: { businessDay: string; countedCash: number }[];
      endOdometer?: number;
      unloadRemainingToWarehouse: boolean;
      countedStock?: { productId: number; countedQty: number }[];
      // INV-VAN-SELF-SETTLE-PIN-REQUIRED: a driver-supplied value here
      // is IGNORED — the rep never decides whether his own shortage is
      // charged or waived. The field stays in the type so older phone
      // builds keep sending it without a 400; the service treats the
      // shortage as pending until a supervisor decides.
      chargeStockVarianceToRep?: boolean;
      // Explicit supervisor-approved overnight retention, requested by
      // the rep and authorized by the supervisor PIN below. Merely not
      // unloading is NOT approval.
      nightStockApproved?: boolean;
      activeVisitCustomerId?: number;
      notes?: string;
      supervisorPin?: string;
      supervisorOverridePin?: string;
    },
  ) {
    // INV-PORTAL-TENANT-STATUS-ENFORCED: finish-and-settle only. A
    // suspended tenant's driver may settle his already-open trip; the
    // settle service enforces open-trip + rep ownership. New trips and
    // sales stay blocked by the strict verifier elsewhere.
    const driver = await this.deliveryRepsService.verifyDriverTokenForSettlement(authHeader);
    await this.deliveryRepsService.assertDriverPinChanged(driver);
    const pinToVerify = String(body?.supervisorPin || body?.supervisorOverridePin || '').trim();

    // INV-VAN-SELF-SETTLE-PIN-REQUIRED: self-settlement from the
    // driver's phone ALWAYS requires a supervisor PIN — mandatory, not
    // opt-in by default. The old path let the PIN be skipped whenever
    // the tenant setting was absent (default false), so the service
    // received no authContext and its maker-checker check never ran.
    // A missing PIN fails closed here, and a verified PIN always
    // produces the supervisor authContext below, so maker-checker runs
    // on every driver settle. The rep's own PIN is refused inside
    // verifySupervisorPin (MAKER_CHECKER_SELF_APPROVAL).
    if (!pinToVerify) {
      await this.vanSalesService.recordSuspicionEvent({
        tenantId: driver.tenantId,
        accountId: driver.accountId,
        repId: driver.repId,
        tripId: body?.tripId,
        eventCode: AUDIT_EVENT_CODES.VAN_SUSPICION_UNAUTHORIZED_LOAD_OR_SETTLE,
        severity: 'critical',
        titleAr: 'محاولة إغلاق وتصفية رحلة ذاتياً بدون رمز اعتماد المشرف (PIN)',
        detailsAr: `حاول المندوب اعتماد وتصفية الرحلة #${body?.tripId} نهائياً من تطبيق المندوب دون إدخال رمز اعتماد المشرف.`,
        metadata: {
          tripId: body?.tripId,
          countedCash: body?.countedCash,
        },
      });
      throw new AppError(
        'إغلاق وتصفية رحلة التوزيع نهائياً من تطبيق المندوب يتطلب رمز اعتماد المشرف (Supervisor PIN)؛ أو يمكنك مراجعة المشرف لاعتمادها من لوحة الإدارة',
        'SETTLEMENT_REQUIRES_SUPERVISOR_PIN',
        403,
      );
    }
    const pinVerification = await this.vanSalesService.verifySupervisorPin(
      driver.tenantId,
      pinToVerify,
      driver.repId,
      undefined,
      driver.accountId,
    );

    // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): the shared manager
    // PIN carries no user id — verifySupervisorPin returns no
    // supervisorId in PIN mode, and the old `Number(... || 0)`
    // silently turned that absence into userId 0. The approval is
    // now passed explicitly: the identified supervisor's id when
    // approval came from a login password, null plus the
    // 'shared_manager_pin' method when it came from the shared PIN,
    // so the settlement records supervisor_id NULL plus the method
    // instead of a fabricated id. The AuthContext below still needs
    // a number userId (its type); 0 there means "no identified
    // supervisor" and the service treats it that way (every id
    // writer guards `> 0` / `|| null`, and the settlement audit row
    // records created_by null in PIN mode).
    const supervisorId =
      pinVerification.supervisorId && Number(pinVerification.supervisorId) > 0
        ? Number(pinVerification.supervisorId)
        : null;
    const supervisorApprovalMethod: 'shared_manager_pin' | 'account' =
      pinVerification.approvalMode === 'account' ? 'account' : 'shared_manager_pin';
    const supervisorAuthContext = {
      userId: supervisorId ?? 0,
      sessionId: 'supervisor-pin-settlement',
      username: String(pinVerification.supervisorName || 'supervisor'),
      role: pinVerification.supervisorRole || 'supervisor',
      permissions: ['deliveryReps', 'sales', 'inventory', 'accounting'],
      tenantId: driver.tenantId,
      accountId: driver.accountId,
    };

    // Night stock is approved only when the rep explicitly asks to keep
    // the stock overnight AND the supervisor PIN authorizes it. Not
    // unloading, on its own, never approves overnight retention — the
    // engine fails closed (NIGHT_STOCK_UNAPPROVED) without both.
    const nightStockApproved = Boolean(body.nightStockApproved) && Boolean(pinVerification);

    return this.vanSalesService.settleTrip(
      driver.repId,
      driver.tenantId,
      driver.accountId,
      {
        tripId: body.tripId,
        countedCash: body.countedCash,
        perDayCash: body.perDayCash,
        unloadRemainingToWarehouse: body.unloadRemainingToWarehouse,
        countedStock: body.countedStock,
        chargeStockVarianceDecidedBySupervisor: false,
        // M18: the approval is passed explicitly (see above) — never
        // a fabricated supervisor 0.
        supervisorApprovalMethod,
        supervisorId,
        nightStockApproved,
        nightStockNotes: nightStockApproved
          ? `تم الإبقاء على البضاعة في سيارة التوزيع لليوم التالي باعتماد المشرف (${pinVerification.supervisorName})`
          : undefined,
        endOdometer: body.endOdometer,
        activeVisitCustomerId: body.activeVisitCustomerId,
        notes: body.notes,
      },
      supervisorAuthContext,
    );
  }

  async submitTripSettlement(
    authHeader: string,
    body: {
      tripId: number;
      countedCash: number;
      // INV-VAN-DAILY-SPLIT-SETTLEMENT: per-day counted cash.
      perDayCash?: { businessDay: string; countedCash: number }[];
      endOdometer?: number;
      unloadRemainingToWarehouse: boolean;
      notes?: string;
    },
  ) {
    // INV-PORTAL-TENANT-STATUS-ENFORCED: finish-and-settle only (see
    // settleTrip above).
    const driver = await this.deliveryRepsService.verifyDriverTokenForSettlement(authHeader);
    await this.deliveryRepsService.assertDriverPinChanged(driver);
    return this.vanSalesService.submitTripSettlement(driver.repId, driver.tenantId, driver.accountId, body);
  }
}
