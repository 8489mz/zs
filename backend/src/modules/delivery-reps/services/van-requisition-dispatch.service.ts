/*
 * Requisition dispatch (van-sales split-9 out of VanSalesService).
 * Pure move: createLoadRequisitionByAdmin + approveAndDispatchRequisition,
 * unchanged, behind the VanSalesService delegating facade. The two are
 * coupled (the first calls the second), so they move together. The
 * facade owns the injected services; this service receives them bound
 * via VanRequisitionDispatchDeps, so the moved bodies are byte-identical
 * to the originals except for ONE documented deviation:
 * createLoadRequisitionByAdmin calls the injected dispatchRequisition
 * dep (bound to the facade's approveAndDispatchRequisition delegate)
 * instead of the sibling method directly, because the
 * driver-requisition-dto-whitelist spec case (d) monkey-patches
 * approveAndDispatchRequisition on the facade instance after
 * construction — routing through the dep preserves that mock (the S2
 * rapid-fire precedent, adapted to a moved method; S7's deviation,
 * reused). The accessor in the facade is LAZY-ONLY by design (S2
 * pattern) for the same reason.
 */
import { Injectable } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { Database } from '../../../database/database.types';
import { VanRequisitionsService } from './van-requisitions.service';
import { VanTripLifecycleService } from './van-trip-lifecycle.service';

export type VanRequisitionDispatchDeps = {
  db: Kysely<Database>;
  vanRequisitionsService: VanRequisitionsService;
  submitLoadRequisition: VanRequisitionsService['submitLoadRequisition'];
  dispatchRequisition: (
    tenantId: string,
    accountId: string,
    requisitionId: number,
    reviewedByUserId: number,
  ) => Promise<{ ok: boolean; requisitionId: number; tripId: number; docNo: string; isSupplementary: boolean }>;
  loadSupplementaryStockToActiveTrip: VanTripLifecycleService['loadSupplementaryStockToActiveTrip'];
  openTripAndLoad: VanTripLifecycleService['openTripAndLoad'];
};

@Injectable()
export class VanRequisitionDispatchService {
  private readonly db: Kysely<Database>;
  private readonly vanRequisitionsService: VanRequisitionsService;
  private readonly submitLoadRequisition: VanRequisitionDispatchDeps['submitLoadRequisition'];
  private readonly dispatchRequisition: VanRequisitionDispatchDeps['dispatchRequisition'];
  private readonly loadSupplementaryStockToActiveTrip: VanRequisitionDispatchDeps['loadSupplementaryStockToActiveTrip'];
  private readonly openTripAndLoad: VanRequisitionDispatchDeps['openTripAndLoad'];

  constructor(deps: VanRequisitionDispatchDeps) {
    this.db = deps.db;
    this.vanRequisitionsService = deps.vanRequisitionsService;
    this.submitLoadRequisition = deps.submitLoadRequisition;
    this.dispatchRequisition = deps.dispatchRequisition;
    this.loadSupplementaryStockToActiveTrip = deps.loadSupplementaryStockToActiveTrip;
    this.openTripAndLoad = deps.openTripAndLoad;
  }

  private get anyDb(): any {
    return this.db as any;
  }

  // =========================================================================
  // LOAD REQUISITIONS — DISPATCH (admin funnel + dispatch)
  // =========================================================================

  async createLoadRequisitionByAdmin(
    tenantId: string,
    accountId: string,
    userId: number,
    payload: {
      repId: number;
      sourceWarehouseId?: number;
      items: { productId: number; qty: number; sourceWarehouseId?: number; sourceWarehouseName?: string }[];
      notes?: string;
      dispatchImmediately?: boolean;
    },
  ) {
    const repId = Number(payload.repId);
    if (!repId) {
      throw new AppError('يرجى تحديد مندوب التوزيع أولاً', 'REP_REQUIRED', 400);
    }
    const subRes = await this.submitLoadRequisition(repId, tenantId, accountId, {
      sourceWarehouseId: payload.sourceWarehouseId,
      items: payload.items,
      notes: payload.notes,
      allowMultiplePending: Boolean(payload.dispatchImmediately),
    });

    if (payload.dispatchImmediately) {
      const dispatchRes = await this.dispatchRequisition(
        tenantId,
        accountId,
        subRes.requisitionId,
        userId,
      );
      return {
        ok: true,
        docNo: subRes.docNo,
        requisitionId: subRes.requisitionId,
        dispatched: true,
        tripId: dispatchRes.tripId,
        isSupplementary: dispatchRes.isSupplementary,
      };
    }

    return {
      ok: true,
      docNo: subRes.docNo,
      requisitionId: subRes.requisitionId,
      dispatched: false,
    };
  }

  async approveAndDispatchRequisition(tenantId: string, accountId: string, requisitionId: number, reviewedByUserId: number) {
    const req = await this.vanRequisitionsService.getRequisitionForDispatch(tenantId, requisitionId);

    // Check if the rep already has an active open trip
    const existingTrip = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .select(['vt.id'])
      .where('vt.rep_id', '=', Number(req.rep_id))
      .where('vt.tenant_id', '=', tenantId)
      .where('vt.status', '=', 'open')
      .orderBy('vt.id', 'desc')
      .executeTakeFirst();

    let tripId: number;
    let isSupplementary = false;

    if (existingTrip) {
      // Driver already has an open trip -> Supplementary load into active trip!
      const loadResult = await this.loadSupplementaryStockToActiveTrip(
        Number(req.rep_id),
        tenantId,
        accountId,
        Number(existingTrip.id),
        {
          sourceWarehouseId: Number(req.source_warehouse_id),
          items: req.itemsToLoad,
          notes: req.notes || `صرف وتحميل إضافي (استعواض) بناءً على طلب إذن تحميل #${req.doc_no}`,
        },
      );
      tripId = loadResult.tripId;
      isSupplementary = true;
    } else {
      // Open a fresh trip for the rep
      const tripResult = await this.openTripAndLoad(
        Number(req.rep_id),
        tenantId,
        accountId,
        {
          sourceWarehouseId: Number(req.source_warehouse_id),
          items: req.itemsToLoad,
          notes: req.notes || `صرف وتحميل بناءً على طلب إذن تحميل #${req.doc_no}`,
        },
      );
      tripId = tripResult.tripId;
    }

    await this.vanRequisitionsService.markRequisitionDispatched(tenantId, requisitionId, tripId, reviewedByUserId);

    return { ok: true, requisitionId, tripId, docNo: req.doc_no, isSupplementary };
  }
}
