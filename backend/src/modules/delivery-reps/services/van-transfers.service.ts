import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AppError } from '../../../common/errors/app-error';
import { moveVanStock, sortItemsByProductId, generateDailySequenceNumber, getOrCreateVanLocation } from './van-common.util';

@Injectable()
export class VanTransfersService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  private get anyDb(): any {
    return this.db as any;
  }

  async createInterVanTransfer(
    tenantId: string,
    accountId: string,
    fromRepId: number,
    payload: {
      toRepId: number;
      fromTripId?: number;
      toTripId?: number;
      items: { productId: number; qty: number }[];
      notes?: string;
    },
  ) {
    if (!payload.toRepId || payload.toRepId === fromRepId) {
      throw new AppError('يرجى اختيار مندوب مستلم مختلف عن المندوب المحوّل', 'INVALID_TARGET_REP', 400);
    }
    if (!payload.items || !payload.items.length) {
      throw new AppError('يرجى إضافة صنف واحد على الأقل للتحويل', 'EMPTY_ITEMS', 400);
    }

    const fromRep = await this.anyDb
      .selectFrom('delivery_representatives')
      .selectAll()
      .where('id', '=', fromRepId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    const toRep = await this.anyDb
      .selectFrom('delivery_representatives')
      .selectAll()
      .where('id', '=', payload.toRepId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!fromRep) throw new AppError('المندوب المحوّل غير موجود', 'FROM_REP_NOT_FOUND', 404);
    if (!toRep) throw new AppError('المندوب المستلم غير موجود', 'TO_REP_NOT_FOUND', 404);

    const fromVanLoc = await getOrCreateVanLocation(this.db, fromRepId, tenantId, accountId);
    const toVanLoc = await getOrCreateVanLocation(this.db, payload.toRepId, tenantId, accountId);

    for (const item of payload.items) {
      const pid = Number(item.productId);
      const qty = Number(item.qty || 0);
      if (qty <= 0) continue;

      const currentStock = await this.anyDb
        .selectFrom('product_location_stock')
        .select(['qty'])
        .where('product_id', '=', pid)
        .where('location_id', '=', fromVanLoc.id)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      const avail = Number(currentStock?.qty || 0);
      if (avail < qty) {
        const prod = await this.anyDb.selectFrom('products').select(['name']).where('id', '=', pid).where('tenant_id', '=', tenantId).executeTakeFirst();
        throw new AppError(
          `رصيد السيارة غير كافٍ لتحويل الصنف "${prod?.name || pid}". المتوفر: ${avail}، المطلوب تحويله: ${qty}`,
          'INSUFFICIENT_STOCK_FOR_TRANSFER',
          400,
        );
      }
    }

    // INV-SEQUENCE-NUMBER-FAIL-CLOSED: the insert, the locked MAX+1
    // numbering, and the rename run in one transaction. The transfer
    // line inserts below stay outside; only the numbering unit is atomic.
    const totalQty = payload.items.reduce((s: number, it: any) => s + Number(it.qty || 0), 0);
    const created = await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;
      const tempDoc = `TMP-XFR-${Date.now()}`;
      const inserted = await trxAny
        .insertInto('van_stock_transfers')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          transfer_no: tempDoc,
          from_rep_id: fromRepId,
          from_trip_id: payload.fromTripId || null,
          from_van_location_id: fromVanLoc.id,
          to_rep_id: payload.toRepId,
          to_trip_id: payload.toTripId || null,
          to_van_location_id: toVanLoc.id,
          status: 'pending',
          total_items_count: payload.items.length,
          total_qty: totalQty,
          notes: payload.notes || null,
          created_at: sql`NOW()`,
          updated_at: sql`NOW()`,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      const transferId = Number(inserted.id);
      const transferNo = await generateDailySequenceNumber(trxAny, this.db, 'van_stock_transfers', 'transfer_no', 'XFR', tenantId);

      await trxAny
        .updateTable('van_stock_transfers')
        .set({ transfer_no: transferNo })
        .where('id', '=', transferId)
        .where('tenant_id', '=', tenantId)
        .execute();

      return { transferId, transferNo };
    });

    const transferId = created.transferId;
    const transferNo = created.transferNo;

    for (const item of payload.items) {
      const pid = Number(item.productId);
      const qty = Number(item.qty || 0);
      const prod = await this.anyDb.selectFrom('products').select(['cost_price', 'retail_price']).where('id', '=', pid).where('tenant_id', '=', tenantId).executeTakeFirst();

      await this.anyDb
        .insertInto('van_stock_transfer_items')
        .values({
          transfer_id: transferId,
          tenant_id: tenantId,
          product_id: pid,
          qty,
          unit_cost: Number(prod?.cost_price || 0),
          unit_price: Number(prod?.retail_price || 0),
        })
        .execute();
    }

    return {
      ok: true,
      transferId,
      transferNo,
      status: 'pending',
    };
  }

  async acceptInterVanTransfer(tenantId: string, accountId: string, toRepId: number, transferId: number) {
    const items = await this.anyDb
      .selectFrom('van_stock_transfer_items')
      .selectAll()
      .where('transfer_id', '=', transferId)
      .where('tenant_id', '=', tenantId)
      .execute();

    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;

      const transfer = await trxAny
        .selectFrom('van_stock_transfers')
        .selectAll()
        .where('id', '=', transferId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!transfer) {
        throw new AppError('طلب التحويل غير موجود', 'TRANSFER_NOT_FOUND', 404);
      }
      if (Number(transfer.to_rep_id) !== toRepId) {
        throw new AppError('غير مصرح لك بقبول هذا التحويل', 'UNAUTHORIZED_TRANSFER', 403);
      }
      if (transfer.status !== 'pending') {
        throw new AppError(`طلب التحويل تمت معالجته مسبقاً (${transfer.status})`, 'ALREADY_PROCESSED', 400);
      }

      const sortedItems = sortItemsByProductId<{ productId: number; qty: number }>(
        items.map((it: any) => ({ productId: Number(it.product_id), qty: Number(it.qty) })),
      );

      let totalTransferRetailValue = 0;

      for (const item of sortedItems) {
        const pid = Number(item.productId);
        const qty = Number(item.qty);
        if (qty <= 0) continue;

        // CANONICAL LOCK ORDER: Lock products first!
        const prod = await trxAny
          .selectFrom('products')
          .select(['id', 'name', 'retail_price', 'cost_price'])
          .where('id', '=', pid)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();

        const senderStock = await trxAny
          .selectFrom('product_location_stock')
          .select(['qty'])
          .where('product_id', '=', pid)
          .where('location_id', '=', Number(transfer.from_van_location_id))
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();

        const avail = Number(senderStock?.qty || 0);
        if (avail < qty) {
          throw new AppError(
            `رصيد السيارة المحوِّلة غير كافٍ للصنف "${prod?.name || pid}". المتوفر حالياً: ${avail}، المطلوب تحويله: ${qty}`,
            'INSUFFICIENT_STOCK_FOR_TRANSFER',
            400,
          );
        }

        totalTransferRetailValue += qty * Number(prod?.retail_price || 0);

        await moveVanStock(trx, {
          productId: pid,
          delta: -qty,
          locationId: Number(transfer.from_van_location_id),
          tenantId,
          accountId,
          userId: null,
          movementType: 'van_transfer_out',
          note: `تحويل بضاعة بين سيارتين (${transfer.transfer_no})`,
          referenceType: 'van_stock_transfers',
          referenceId: Number(transfer.id),
          skipGlobalUpdate: false,
          unitCost: Number(prod?.cost_price || 0),
        });

        await moveVanStock(trx, {
          productId: pid,
          delta: qty,
          locationId: Number(transfer.to_van_location_id),
          tenantId,
          accountId,
          userId: null,
          movementType: 'van_transfer_in',
          note: `استلام بضاعة محولة من سيارة (${transfer.transfer_no})`,
          referenceType: 'van_stock_transfers',
          referenceId: Number(transfer.id),
          skipGlobalUpdate: false,
          unitCost: Number(prod?.cost_price || 0),
        });
      }

      if (totalTransferRetailValue > 0) {
        const roundedRetail = Number(totalTransferRetailValue.toFixed(2));
        // Adjust sender's open trip loaded_amount
        const senderTrip = await trxAny
          .selectFrom('van_sales_trips')
          .select(['id'])
          .where('tenant_id', '=', tenantId)
          .where('rep_id', '=', Number(transfer.from_rep_id))
          .where('status', '=', 'open')
          .orderBy('id', 'desc')
          .executeTakeFirst();
        if (senderTrip?.id) {
          await trxAny
            .updateTable('van_sales_trips')
            .set({
              loaded_amount: sql`GREATEST(0, COALESCE(loaded_amount, 0) - ${roundedRetail})`,
              updated_at: sql`NOW()`,
            })
            .where('id', '=', Number(senderTrip.id))
            .where('tenant_id', '=', tenantId)
            .execute();
        }

        // Adjust receiver's open trip loaded_amount
        const receiverTrip = await trxAny
          .selectFrom('van_sales_trips')
          .select(['id'])
          .where('tenant_id', '=', tenantId)
          .where('rep_id', '=', Number(transfer.to_rep_id))
          .where('status', '=', 'open')
          .orderBy('id', 'desc')
          .executeTakeFirst();
        if (receiverTrip?.id) {
          await trxAny
            .updateTable('van_sales_trips')
            .set({
              loaded_amount: sql`COALESCE(loaded_amount, 0) + ${roundedRetail}`,
              updated_at: sql`NOW()`,
            })
            .where('id', '=', Number(receiverTrip.id))
            .where('tenant_id', '=', tenantId)
            .execute();
        }
      }

      await trxAny
        .updateTable('van_stock_transfers')
        .set({
          status: 'accepted',
          accepted_at: sql`NOW()`,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', transferId)
        .where('tenant_id', '=', tenantId)
        .execute();
    });

    return { ok: true, transferId, status: 'accepted' };
  }

  async rejectInterVanTransfer(tenantId: string, toRepId: number, transferId: number, reason?: string) {
    const transfer = await this.anyDb
      .selectFrom('van_stock_transfers')
      .selectAll()
      .where('id', '=', transferId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!transfer) {
      throw new AppError('طلب التحويل غير موجود', 'TRANSFER_NOT_FOUND', 404);
    }
    if (Number(transfer.to_rep_id) !== toRepId) {
      throw new AppError('غير مصرح لك برفض هذا التحويل', 'UNAUTHORIZED_TRANSFER', 403);
    }
    if (transfer.status !== 'pending') {
      throw new AppError(`طلب التحويل تمت معالجته مسبقاً (${transfer.status})`, 'ALREADY_PROCESSED', 400);
    }

    await this.anyDb
      .updateTable('van_stock_transfers')
      .set({
        status: 'rejected',
        rejected_at: sql`NOW()`,
        notes: sql`concat(coalesce(notes, ''), ' [تم الرفض: ', ${reason || 'بواسطة المندوب المستلم'}, ']')`,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', transferId)
      .where('tenant_id', '=', tenantId)
      .execute();

    return { ok: true, transferId, status: 'rejected' };
  }

  async listInterVanTransfers(
    tenantId: string,
    filters?: { repId?: number; status?: string },
  ) {
    let query = this.anyDb
      .selectFrom('van_stock_transfers as vst')
      .innerJoin('delivery_representatives as from_rep', 'from_rep.id', 'vst.from_rep_id')
      .innerJoin('delivery_representatives as to_rep', 'to_rep.id', 'vst.to_rep_id')
      .select([
        'vst.id',
        'vst.transfer_no as transferNo',
        'vst.from_rep_id as fromRepId',
        'from_rep.name as fromRepName',
        'vst.to_rep_id as toRepId',
        'to_rep.name as toRepName',
        'vst.status',
        sql<number>`cast(vst.total_items_count as integer)`.as('totalItemsCount'),
        sql<number>`cast(vst.total_qty as numeric)`.as('totalQty'),
        'vst.notes',
        'vst.created_at as createdAt',
        'vst.accepted_at as acceptedAt',
        'vst.rejected_at as rejectedAt',
      ])
      .where('vst.tenant_id', '=', tenantId);

    if (filters?.repId) {
      query = query.where((eb: any) =>
        eb.or([
          eb('vst.from_rep_id', '=', filters.repId),
          eb('vst.to_rep_id', '=', filters.repId),
        ]),
      );
    }
    if (filters?.status) {
      query = query.where('vst.status', '=', filters.status);
    }

    const rows = await query.orderBy('vst.created_at', 'desc').limit(200).execute();

    const transferIds = rows.map((r: any) => Number(r.id));
    const itemsMap = new Map<number, any[]>();
    if (transferIds.length > 0) {
      const items = await this.anyDb
        .selectFrom('van_stock_transfer_items as vsti')
        .innerJoin('products as p', 'p.id', 'vsti.product_id')
        .select([
          'vsti.transfer_id as transferId',
          'vsti.product_id as productId',
          'p.name as productName',
          'p.barcode as barcode',
          sql<number>`cast(vsti.qty as numeric)`.as('qty'),
          sql<number>`cast(vsti.unit_price as numeric)`.as('unitPrice'),
        ])
        .where('vsti.transfer_id', 'in', transferIds)
        .where('vsti.tenant_id', '=', tenantId)
        .execute();

      for (const it of items) {
        const tId = Number(it.transferId);
        const list = itemsMap.get(tId) || [];
        list.push(it);
        itemsMap.set(tId, list);
      }
    }

    return rows.map((r: any) => ({
      ...r,
      items: itemsMap.get(Number(r.id)) || [],
    }));
  }

  async getPeerReps(tenantId: string, currentRepId: number) {
    const rows = await this.anyDb
      .selectFrom('delivery_representatives')
      .select(['id', 'name', 'phone', 'vehicle_plate'])
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .where('id', '!=', currentRepId)
      .orderBy('name', 'asc')
      .execute();

    return rows.map((r: any) => ({
      id: Number(r.id),
      name: r.name,
      phone: r.phone || '',
      vehiclePlate: r.vehicle_plate || '',
    }));
  }
}
