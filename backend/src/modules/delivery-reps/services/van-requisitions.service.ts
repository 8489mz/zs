import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AppError } from '../../../common/errors/app-error';
import { generateDailySequenceNumber } from './van-common.util';
import { evaluateBatchExpiryStatus } from '../rep-target.engine';

@Injectable()
export class VanRequisitionsService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  private get anyDb(): any {
    return this.db as any;
  }

  async submitLoadRequisition(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      sourceWarehouseId?: number;
      items: { productId: number; qty: number; sourceWarehouseId?: number; sourceWarehouseName?: string }[];
      notes?: string;
      allowMultiplePending?: boolean;
    },
  ) {
    if (!payload.items || !payload.items.length) {
      throw new AppError('يجب تحديد صنف واحد على الأقل لطلب التحميل', 'EMPTY_LOAD_ITEMS', 400);
    }

    // Single Pending Requisition Invariant: prevent driver from spamming pending requests
    if (!payload.allowMultiplePending) {
      const pendingReq = await this.anyDb
        .selectFrom('van_load_requisitions')
        .select(['id', 'doc_no'])
        .where('tenant_id', '=', tenantId)
        .where('rep_id', '=', repId)
        .where('status', '=', 'pending')
        .orderBy('id', 'desc')
        .executeTakeFirst();

      if (pendingReq) {
        throw new AppError(
          `لديك طلب إذن تحميل معلق بالفعل (#${pendingReq.doc_no}) قيد مراجعة المشرف، يمكنك إلغاؤه وتعديل أصنافه أو انتظار اعتماده وصرفه`,
          'PENDING_REQUISITION_EXISTS',
          400,
        );
      }
    }

    let defaultWhId: number | undefined;
    const defaultWh = await this.anyDb
      .selectFrom('stock_locations')
      .select(['id'])
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .where('location_type', '!=', 'van_stock')
      .orderBy('id', 'asc')
      .executeTakeFirst();
    if (defaultWh) defaultWhId = Number(defaultWh.id);

    // If sourceWarehouseId is explicitly specified, all items belong to this warehouse:
    if (payload.sourceWarehouseId && Number(payload.sourceWarehouseId) > 0) {
      const sourceWarehouseId = Number(payload.sourceWarehouseId);
      // INV-SEQUENCE-NUMBER-FAIL-CLOSED: the insert, the locked MAX+1
      // numbering, and the rename run in one transaction, so a crash
      // rolls the TMP row back with the number instead of leaving a
      // TMP-REQ row, and the advisory lock is held across the read.
      return await this.db.transaction().execute(async (trx) => {
        const trxAny = trx as any;
        const tempDocNo = `TMP-REQ-${Date.now()}`;
        const [inserted] = await trxAny
          .insertInto('van_load_requisitions')
          .values({
            tenant_id: tenantId,
            account_id: accountId,
            doc_no: tempDocNo,
            rep_id: repId,
            source_warehouse_id: sourceWarehouseId,
            status: 'pending',
            requested_items: JSON.stringify(payload.items.map((it) => ({ ...it, sourceWarehouseId }))),
            approved_items: JSON.stringify(payload.items.map((it) => ({ ...it, sourceWarehouseId }))),
            notes: payload.notes || null,
          })
          .returning(['id'])
          .execute();

        const requisitionId = Number(inserted.id);
        const docNo = await generateDailySequenceNumber(trxAny, this.db, 'van_load_requisitions', 'doc_no', 'REQ', tenantId);
        await trxAny
          .updateTable('van_load_requisitions')
          .set({ doc_no: docNo })
          .where('id', '=', requisitionId)
          .where('tenant_id', '=', tenantId)
          .execute();

        return { ok: true, docNo, requisitionId };
      });
    }

    // Otherwise (e.g. driver submitted across all warehouses), group items by their source warehouse
    const itemsByWarehouse = new Map<number, typeof payload.items>();
    for (const item of payload.items) {
      const whId = item.sourceWarehouseId ? Number(item.sourceWarehouseId) : (defaultWhId || 1);
      const list = itemsByWarehouse.get(whId) || [];
      list.push({ ...item, sourceWarehouseId: whId });
      itemsByWarehouse.set(whId, list);
    }

    const createdDocNos: string[] = [];
    let firstRequisitionId = 0;
    const allRequisitionIds: number[] = [];

    for (const [whId, groupItems] of itemsByWarehouse.entries()) {
      // INV-SEQUENCE-NUMBER-FAIL-CLOSED: one transaction per warehouse
      // group, covering the insert, the locked numbering, and the rename.
      const created = await this.db.transaction().execute(async (trx) => {
        const trxAny = trx as any;
        const tempDocNo = `TMP-REQ-${Date.now()}-${whId}`;
        const [inserted] = await trxAny
          .insertInto('van_load_requisitions')
          .values({
            tenant_id: tenantId,
            account_id: accountId,
            doc_no: tempDocNo,
            rep_id: repId,
            source_warehouse_id: whId,
            status: 'pending',
            requested_items: JSON.stringify(groupItems),
            approved_items: JSON.stringify(groupItems),
            notes: payload.notes || null,
          })
          .returning(['id'])
          .execute();

        const requisitionId = Number(inserted.id);
        const docNo = await generateDailySequenceNumber(trxAny, this.db, 'van_load_requisitions', 'doc_no', 'REQ', tenantId);
        await trxAny
          .updateTable('van_load_requisitions')
          .set({ doc_no: docNo })
          .where('id', '=', requisitionId)
          .where('tenant_id', '=', tenantId)
          .execute();

        return { requisitionId, docNo };
      });

      if (!firstRequisitionId) firstRequisitionId = created.requisitionId;
      allRequisitionIds.push(created.requisitionId);
      createdDocNos.push(created.docNo);
    }

    return {
      ok: true,
      docNo: createdDocNos.join('، '),
      requisitionId: firstRequisitionId,
      requisitionIds: allRequisitionIds,
    };
  }

  async listLoadRequisitions(tenantId: string, filters: { status?: string; repId?: number } = {}) {
    let q = this.anyDb
      .selectFrom('van_load_requisitions as vlr')
      .leftJoin('delivery_representatives as dr', 'dr.id', 'vlr.rep_id')
      .leftJoin('stock_locations as src', 'src.id', 'vlr.source_warehouse_id')
      .leftJoin('users as u', 'u.id', 'vlr.reviewed_by')
      .select([
        'vlr.id',
        'vlr.doc_no as docNo',
        'vlr.rep_id as repId',
        sql<string>`coalesce(dr.name, '')`.as('repName'),
        sql<string>`coalesce(
          dr.vehicle_plate,
          (SELECT fv.plate_number 
           FROM fleet_vehicle_drivers fvd 
           JOIN fleet_vehicles fv ON fv.id = fvd.vehicle_id 
           WHERE fvd.rep_id = vlr.rep_id AND fvd.tenant_id = vlr.tenant_id AND fvd.is_active = true 
           ORDER BY fvd.id DESC LIMIT 1),
          (SELECT fv2.plate_number 
           FROM fleet_vehicles fv2 
           WHERE fv2.assigned_rep_id = vlr.rep_id AND fv2.tenant_id = vlr.tenant_id 
           ORDER BY fv2.id DESC LIMIT 1),
          ''
        )`.as('vehiclePlate'),
        'vlr.source_warehouse_id as sourceWarehouseId',
        sql<string>`coalesce(src.name, '')`.as('sourceWarehouseName'),
        'vlr.status',
        'vlr.requested_items as requestedItems',
        'vlr.approved_items as approvedItems',
        'vlr.notes',
        'vlr.rejection_reason as rejectionReason',
        'vlr.trip_id as tripId',
        sql<string>`coalesce(u.username, '')`.as('reviewedByName'),
        'vlr.reviewed_at as reviewedAt',
        'vlr.created_at as createdAt',
      ])
      .where('vlr.tenant_id', '=', tenantId);

    if (filters.status) q = q.where('vlr.status', '=', filters.status);
    if (filters.repId) q = q.where('vlr.rep_id', '=', filters.repId);

    const rows = await q.orderBy('vlr.id', 'desc').limit(50).execute();

    const allProductIds = new Set<number>();
    const parsedRows = rows.map((r: any) => {
      const req = typeof r.requestedItems === 'string' ? JSON.parse(r.requestedItems) : (r.requestedItems || []);
      const app = typeof r.approvedItems === 'string' ? JSON.parse(r.approvedItems) : (r.approvedItems || req);
      req.forEach((it: any) => allProductIds.add(Number(it.productId)));
      app.forEach((it: any) => allProductIds.add(Number(it.productId)));
      return { ...r, requestedItems: req, approvedItems: app };
    });

    if (allProductIds.size > 0) {
      const pids = Array.from(allProductIds);
      const prods = await this.anyDb
        .selectFrom('products')
        .select(['id', 'name', 'barcode', 'retail_price as retailPrice'])
        .where('id', 'in', pids)
        .where('tenant_id', '=', tenantId)
        .execute();
      const prodMap = new Map<number, any>();
      prods.forEach((p: any) => prodMap.set(Number(p.id), p));

      const unitRows = await this.anyDb
        .selectFrom('product_units')
        .select(['product_id', 'name', 'multiplier', 'is_base_unit'])
        .where('tenant_id', '=', tenantId)
        .where('product_id', 'in', pids)
        .orderBy('multiplier', 'desc')
        .execute();

      const unitsMap = new Map<number, {
        baseUnitName: string;
        packagingUnit?: { name: string; multiplier: number };
        isWeight: boolean;
      }>();

      for (const u of unitRows) {
        const pid = Number(u.product_id);
        let entry = unitsMap.get(pid);
        if (!entry) {
          entry = { baseUnitName: 'قطعة', isWeight: false };
          unitsMap.set(pid, entry);
        }
        const mult = Number(u.multiplier || 1);
        const name = (u.name || '').trim();
        const isBase = Boolean(u.is_base_unit) || mult === 1;

        if (isBase) {
          entry.baseUnitName = name || 'قطعة';
          const lower = name.toLowerCase();
          if (
            lower.includes('كجم') ||
            lower.includes('كيلو') ||
            lower.includes('جرام') ||
            lower.includes('جم') ||
            lower.includes('طن') ||
            lower.includes('kg') ||
            lower.includes('gram')
          ) {
            entry.isWeight = true;
          }
        } else if (mult > 1) {
          if (!entry.packagingUnit || name.includes('كرتون') || name.includes('صندوق') || name.includes('طرد') || name.includes('شيكارة')) {
            entry.packagingUnit = { name: name || 'كرتونة', multiplier: mult };
          }
        }
      }

      for (const r of parsedRows) {
        const stocks = await this.anyDb
          .selectFrom('product_location_stock')
          .select(['product_id', 'qty'])
          .where('location_id', '=', r.sourceWarehouseId)
          .where('product_id', 'in', pids)
          .where('tenant_id', '=', tenantId)
          .execute();
        const stockMap = new Map<number, number>();
        stocks.forEach((s: any) => stockMap.set(Number(s.product_id), Number(s.qty || 0)));

        const enrichItem = (it: any) => {
          const pid = Number(it.productId);
          const p = prodMap.get(pid);
          const uInfo = unitsMap.get(pid);
          const packUnit = it.packagingUnit || uInfo?.packagingUnit;
          const baseName = it.unitName || uInfo?.baseUnitName || 'قطعة';
          const isWeight = it.isWeight !== undefined
            ? Boolean(it.isWeight)
            : Boolean(uInfo?.isWeight || /كجم|كيلو|جرام|جم|وزن|kg/i.test(p?.name || ''));

          let cartons = it.cartons !== undefined ? Number(it.cartons) : undefined;
          let pieces = it.pieces !== undefined ? Number(it.pieces) : undefined;
          const qty = Number(it.qty || 0);

          if (cartons === undefined && packUnit && packUnit.multiplier > 1) {
            cartons = Math.floor(qty / packUnit.multiplier);
            pieces = qty % packUnit.multiplier;
          }

          let packingText = it.packingText;
          if (!packingText) {
            if (packUnit && (cartons !== undefined || pieces !== undefined)) {
              const c = cartons || 0;
              const pCount = pieces || 0;
              if (c > 0 && pCount > 0) {
                packingText = `${c} ${packUnit.name} + ${pCount} ${baseName}`;
              } else if (c > 0) {
                packingText = `${c} ${packUnit.name}`;
              } else {
                packingText = `${pCount} ${baseName}`;
              }
            } else if (isWeight) {
              packingText = `${qty} ${baseName}`;
            } else {
              packingText = `${qty} ${baseName}`;
            }
          }

          return {
            ...it,
            productName: p?.name || `صنف #${pid}`,
            barcode: p?.barcode || '',
            retailPrice: Number(p?.retailPrice || 0),
            warehouseAvailQty: stockMap.get(pid) || 0,
            unitName: baseName,
            packagingUnit: packUnit,
            isWeight,
            cartons,
            pieces,
            packingText,
          };
        };

        r.requestedItems = r.requestedItems.map(enrichItem);
        r.approvedItems = r.approvedItems.map(enrichItem);
      }
    }

    return parsedRows;
  }

  async reviewLoadRequisition(
    tenantId: string,
    requisitionId: number,
    approvedItems: { productId: number; qty: number }[],
    notes?: string,
    sourceWarehouseId?: number,
  ) {
    const req = await this.anyDb
      .selectFrom('van_load_requisitions')
      .select(['id', 'status'])
      .where('id', '=', requisitionId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!req) throw new AppError('طلب التحميل غير موجود', 'REQUISITION_NOT_FOUND', 404);
    if (req.status !== 'pending') {
      throw new AppError('لا يمكن تعديل طلب تمت معالجته بالفعل', 'ALREADY_PROCESSED', 400);
    }

    const updateSet: any = {
      approved_items: JSON.stringify(approvedItems),
      notes: notes || undefined,
      updated_at: sql`NOW()`,
    };
    if (sourceWarehouseId && Number(sourceWarehouseId) > 0) {
      updateSet.source_warehouse_id = Number(sourceWarehouseId);
    }

    await this.anyDb
      .updateTable('van_load_requisitions')
      .set(updateSet)
      .where('id', '=', requisitionId)
      .where('tenant_id', '=', tenantId)
      .execute();

    return { ok: true, requisitionId };
  }

  async getRequisitionForDispatch(tenantId: string, requisitionId: number) {
    const req = await this.anyDb
      .selectFrom('van_load_requisitions')
      .selectAll()
      .where('id', '=', requisitionId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!req) throw new AppError('طلب التحميل غير موجود', 'REQUISITION_NOT_FOUND', 404);
    if (req.status !== 'pending') {
      throw new AppError('طلب التحميل تمت معالجته بالفعل', 'ALREADY_PROCESSED', 400);
    }

    const itemsToLoad = typeof req.approved_items === 'string'
      ? JSON.parse(req.approved_items)
      : (req.approved_items || (typeof req.requested_items === 'string' ? JSON.parse(req.requested_items) : req.requested_items));

    return {
      ...req,
      itemsToLoad,
    };
  }

  async markRequisitionDispatched(tenantId: string, requisitionId: number, tripId: number, reviewedByUserId: number) {
    await this.anyDb
      .updateTable('van_load_requisitions')
      .set({
        status: 'dispatched',
        trip_id: tripId,
        reviewed_by: reviewedByUserId,
        reviewed_at: sql`NOW()`,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', requisitionId)
      .where('tenant_id', '=', tenantId)
      .execute();
  }

  async rejectLoadRequisition(tenantId: string, requisitionId: number, rejectionReason: string, reviewedByUserId: number) {
    const req = await this.anyDb
      .selectFrom('van_load_requisitions')
      .select(['id', 'status'])
      .where('id', '=', requisitionId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!req) throw new AppError('طلب التحميل غير موجود', 'REQUISITION_NOT_FOUND', 404);
    if (req.status !== 'pending') {
      throw new AppError('طلب التحميل تمت معالجته بالفعل', 'ALREADY_PROCESSED', 400);
    }

    await this.anyDb
      .updateTable('van_load_requisitions')
      .set({
        status: 'rejected',
        rejection_reason: rejectionReason || 'تم الرفض بواسطة المشرف',
        reviewed_by: reviewedByUserId,
        reviewed_at: sql`NOW()`,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', requisitionId)
      .where('tenant_id', '=', tenantId)
      .execute();

    return { ok: true, requisitionId, status: 'rejected' };
  }

  async deleteLoadRequisition(tenantId: string, requisitionId: number) {
    const req = await this.anyDb
      .selectFrom('van_load_requisitions')
      .select(['id', 'status', 'doc_no'])
      .where('id', '=', requisitionId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!req) throw new AppError('طلب التحميل غير موجود', 'REQUISITION_NOT_FOUND', 404);
    if (req.status === 'dispatched') {
      throw new AppError('لا يمكن حذف إذن تحميل تم صرفه وتحميله بالفعل على السيارة، يمكنك تصفية الرحلة من شاشة الرحلات', 'CANNOT_DELETE_DISPATCHED', 400);
    }
    await this.anyDb
      .deleteFrom('van_load_requisitions')
      .where('id', '=', requisitionId)
      .where('tenant_id', '=', tenantId)
      .execute();
    return { ok: true, requisitionId, docNo: req.doc_no };
  }

  async cancelLoadRequisitionByDriver(tenantId: string, repId: number, requisitionId: number) {
    const req = await this.anyDb
      .selectFrom('van_load_requisitions')
      .selectAll()
      .where('id', '=', requisitionId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!req) {
      throw new AppError('طلب التحميل غير موجود', 'REQUISITION_NOT_FOUND', 404);
    }

    if (Number(req.rep_id) !== Number(repId)) {
      throw new AppError('غير مصرح لك بإلغاء هذا الطلب', 'FORBIDDEN', 403);
    }

    if (req.status !== 'pending') {
      if (req.status === 'dispatched') {
        throw new AppError('لا يمكن إلغاء إذن تحميل تم اعتماده وصرفه بالفعل للسيارة', 'ALREADY_DISPATCHED', 400);
      }
      throw new AppError('لا يمكن إلغاء طلب تمت معالجته بالفعل', 'ALREADY_PROCESSED', 400);
    }

    const previousItems = typeof req.requested_items === 'string'
      ? JSON.parse(req.requested_items)
      : (req.requested_items || []);

    await this.anyDb
      .deleteFrom('van_load_requisitions')
      .where('id', '=', requisitionId)
      .where('tenant_id', '=', tenantId)
      .execute();

    return {
      ok: true,
      requisitionId,
      docNo: req.doc_no,
      previousItems,
      notes: req.notes,
      sourceWarehouseId: req.source_warehouse_id ? Number(req.source_warehouse_id) : undefined,
    };
  }

  async getDriverWarehouses(tenantId: string) {
    const rows = await this.anyDb
      .selectFrom('stock_locations')
      .select(['id', 'name', 'code', 'location_type'])
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .where('location_type', '!=', 'van_stock')
      .orderBy('id', 'asc')
      .execute();

    return rows.map((r: any) => ({
      id: Number(r.id),
      name: r.name,
      code: r.code || '',
      locationType: r.location_type,
    }));
  }

  async getDriverAvailableProducts(tenantId: string, warehouseId?: number) {
    const products = await this.anyDb
      .selectFrom('products as p')
      .leftJoin('suppliers as s', 's.id', 'p.supplier_id')
      .leftJoin('product_categories as pc', 'pc.id', 'p.category_id')
      .select([
        'p.id',
        'p.name',
        'p.barcode',
        'p.retail_price',
        'p.is_active',
        'p.supplier_id',
        's.name as supplier_name',
        'p.category_id',
        'pc.name as category_name',
        'p.metadata',
      ])
      .where('p.tenant_id', '=', tenantId)
      .where('p.is_active', '=', true)
      .orderBy('p.name', 'asc')
      .execute();

    const stockQuery = this.anyDb
      .selectFrom('product_location_stock as pls')
      .innerJoin('stock_locations as sl', 'sl.id', 'pls.location_id')
      .select([
        'pls.product_id',
        'pls.location_id',
        'sl.name as location_name',
        sql<number>`cast(coalesce(pls.qty, 0) as numeric)`.as('qty'),
      ])
      .where('pls.tenant_id', '=', tenantId)
      .where('sl.is_active', '=', true)
      .where('sl.location_type', '!=', 'van_stock');

    const stockRows = await stockQuery.execute();

    const stockMap = new Map<number, Array<{ warehouseId: number; warehouseName: string; qty: number }>>();
    for (const row of stockRows) {
      const pid = Number(row.product_id);
      const qty = Number(row.qty || 0);
      if (qty > 0) {
        const list = stockMap.get(pid) || [];
        list.push({
          warehouseId: Number(row.location_id),
          warehouseName: row.location_name,
          qty,
        });
        stockMap.set(pid, list);
      }
    }

    const productIds = products.map((p: any) => Number(p.id));
    const unitsMap = new Map<number, {
      baseUnitName: string;
      packagingUnit?: { name: string; multiplier: number };
      isWeight: boolean;
    }>();
    const fefoBatchMap = new Map<number, { batchNumber: string | null; expiryDate: string }>();

    if (productIds.length > 0) {
      const [unitRows, batchRows] = await Promise.all([
        this.anyDb
          .selectFrom('product_units')
          .select(['product_id', 'name', 'multiplier', 'is_base_unit'])
          .where('tenant_id', '=', tenantId)
          .where('product_id', 'in', productIds)
          .orderBy('multiplier', 'desc')
          .execute(),
        this.anyDb
          .selectFrom('pharmacy_batches')
          .select(['product_id', 'batch_number', 'expiry_date', 'quantity', 'location_id'])
          .where('tenant_id', '=', tenantId)
          .where('product_id', 'in', productIds)
          .where(sql<boolean>`cast(coalesce(quantity, 0) as numeric) > 0`)
          .orderBy('expiry_date', 'asc')
          .execute()
          .catch(() => []),
      ]);

      for (const b of batchRows || []) {
        const pid = Number(b.product_id);
        if (!pid || !b.expiry_date) continue;
        if (warehouseId && b.location_id && Number(b.location_id) !== Number(warehouseId)) continue;
        if (!fefoBatchMap.has(pid)) {
          fefoBatchMap.set(pid, {
            batchNumber: b.batch_number ? String(b.batch_number) : null,
            expiryDate: String(b.expiry_date),
          });
        }
      }

      for (const u of unitRows) {
        const pid = Number(u.product_id);
        let entry = unitsMap.get(pid);
        if (!entry) {
          entry = { baseUnitName: 'قطعة', isWeight: false };
          unitsMap.set(pid, entry);
        }
        const mult = Number(u.multiplier || 1);
        const name = (u.name || '').trim();
        const isBase = Boolean(u.is_base_unit) || mult === 1;

        if (isBase) {
          entry.baseUnitName = name || 'قطعة';
          const lower = name.toLowerCase();
          if (
            lower.includes('كجم') ||
            lower.includes('كيلو') ||
            lower.includes('جرام') ||
            lower.includes('جم') ||
            lower.includes('طن') ||
            lower.includes('kg') ||
            lower.includes('gram')
          ) {
            entry.isWeight = true;
          }
        } else if (mult > 1) {
          if (!entry.packagingUnit || name.includes('كرتون') || name.includes('صندوق') || name.includes('طرد') || name.includes('شيكارة')) {
            entry.packagingUnit = { name: name || 'كرتونة', multiplier: mult };
          }
        }
      }
    }

    const targetWhId = warehouseId && Number(warehouseId) > 0 ? Number(warehouseId) : undefined;
    const nowRef = new Date();

    return products.map((p: any) => {
      const pId = Number(p.id);
      const whStocks = stockMap.get(pId) || [];
      const totalStock = targetWhId
        ? (whStocks.find((w) => w.warehouseId === targetWhId)?.qty || 0)
        : whStocks.reduce((sum, w) => sum + w.qty, 0);
      const unitInfo = unitsMap.get(pId);
      const baseUnit = unitInfo?.baseUnitName || 'قطعة';
      const isWeight = Boolean(unitInfo?.isWeight || /كجم|كيلو|جرام|جم|وزن|kg/i.test(p.name || ''));

      let metaObj: any = null;
      if (p.metadata) {
        if (typeof p.metadata === 'string') {
          try { metaObj = JSON.parse(p.metadata); } catch { metaObj = null; }
        } else if (typeof p.metadata === 'object') {
          metaObj = p.metadata;
        }
      }

      const fefoBatch = fefoBatchMap.get(pId);
      const rawExpiry = fefoBatch?.expiryDate || metaObj?.expiry_date || metaObj?.expiryDate || null;
      const rawBatchNo = fefoBatch?.batchNumber || metaObj?.batch_number || metaObj?.batchNumber || null;
      const expiryInfo = evaluateBatchExpiryStatus(rawExpiry, nowRef, 60);

      return {
        id: pId,
        name: p.name,
        barcode: p.barcode || '',
        sku: p.barcode || '',
        retailPrice: Number(p.retail_price || 0),
        unit: baseUnit,
        packagingUnit: unitInfo?.packagingUnit,
        isWeight,
        totalStock,
        warehouseStocks: whStocks,
        supplierId: p.supplier_id ? Number(p.supplier_id) : undefined,
        supplierName: (p.supplier_name || '').trim() || 'الشركة العامة',
        categoryId: p.category_id ? Number(p.category_id) : undefined,
        categoryName: (p.category_name || '').trim() || undefined,
        earliestExpiryDate: expiryInfo.earliestExpiryDate,
        batchNumber: rawBatchNo ? String(rawBatchNo) : null,
        expiryStatus: expiryInfo.status,
        daysToExpiry: expiryInfo.daysRemaining,
      };
    });
  }
}
