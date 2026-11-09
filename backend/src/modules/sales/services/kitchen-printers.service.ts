import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import * as net from 'node:net';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { CreateKitchenPrinterDto, UpdateKitchenPrinterDto } from '../dto/kitchen-printer.dto';
import { mapPrinterStationToKdsStation, resolveItemStation } from '../helpers/kds-station.helper';

/**
 * R4-E I12: the ticket a network kitchen printer receives. Items carry the
 * category id and the resolved KDS station when the caller knows them
 * (printTicketForPostedSale loads both from the DB); the sender derives
 * stations from names when they are absent.
 */
export interface KitchenPrintTicketItem {
  name: string;
  qty: number;
  notes?: string;
  categoryId?: number;
  station?: string;
  modifiers?: Array<{ name: string; qty?: number }>;
}

export interface KitchenPrintTicket {
  id: number;
  docNo?: string;
  tableNumber?: string;
  orderType?: string;
  date?: string;
  cashierName?: string;
  note?: string;
  items: KitchenPrintTicketItem[];
}

export interface KitchenPrintResult {
  printerId: number;
  printerName: string;
  station: string;
  ok: boolean;
  error?: string;
}

/**
 * Plain-text KOT, same shape as the frontend's formatSaleForHardwarePrinter
 * pattern (header, order/table, item lines with notes, no prices): the
 * 9100 raw-print path takes plain text, not HTML. No ESC/POS driver is
 * invented here — plain UTF-8 bytes only.
 */
export function formatKitchenTicketText(ticket: KitchenPrintTicket): string {
  const orderTypeLabel: Record<string, string> = {
    dine_in: 'محلي (داخل المطعم)',
    takeaway: 'سفري / استلام',
    delivery: 'توصيل',
  };
  const lines: string[] = [];
  lines.push('تذكرة المطبخ (KOT)');
  lines.push(`طلب #${ticket.docNo || ticket.id}`);
  if (ticket.tableNumber) lines.push(`طاولة: ${ticket.tableNumber}`);
  lines.push(`النوع: ${orderTypeLabel[String(ticket.orderType || '').toLowerCase()] || ticket.orderType || 'سفري'}`);
  if (ticket.cashierName) lines.push(`المسؤول: ${ticket.cashierName}`);
  if (ticket.date) lines.push(`التاريخ: ${ticket.date}`);
  if (ticket.note) lines.push(`ملاحظات الطلب: ${ticket.note}`);
  lines.push('--------------------------------');
  for (const item of ticket.items) {
    lines.push(`${Number(item.qty) || 1}x ${item.name}`);
    for (const mod of item.modifiers || []) {
      if (mod?.name) lines.push(`  + ${mod.name}${mod.qty && mod.qty > 1 ? ` (x${mod.qty})` : ''}`);
    }
    if (item.notes) lines.push(`  ملاحظة: ${item.notes}`);
  }
  lines.push('--------------------------------');
  lines.push('');
  lines.push('');
  return lines.join('\n');
}

function parsePrinterCategoryIds(value: unknown): number[] {
  try {
    const raw = Array.isArray(value) ? value : JSON.parse(String(value || '[]'));
    if (!Array.isArray(raw)) return [];
    return raw.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0);
  } catch {
    return [];
  }
}

const PRINTER_TIMEOUT_MS = 2000;

/** One raw TCP write to ip:port. Never silent: any failure rejects. */
function sendRawToPrinter(ip: string, port: number, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };
    socket.setTimeout(PRINTER_TIMEOUT_MS);
    socket.once('timeout', () => done(new Error(`printer ${ip}:${port} timed out after ${PRINTER_TIMEOUT_MS}ms`)));
    socket.once('error', (err) => done(err));
    socket.connect(port, ip, () => {
      socket.write(text, 'utf8', (err) => done(err ?? undefined));
    });
  });
}

@Injectable()
export class KitchenPrintersService {
  private readonly logger = new Logger(KitchenPrintersService.name);

  constructor(
    @Inject(KYSELY_DB)
    private readonly db: Kysely<Database>,
  ) {}

  /**
   * R4-E I12: send a kitchen ticket to every ACTIVE network printer that
   * serves it — by station_code (mapped to KDS stations) or by category_ids
   * match. A browser cannot open a raw TCP socket to 192.168.1.200:9100, so
   * this backend sender is the only network path; the frontend keeps the
   * Electron/browser print as the fallback when no printer matches.
   * Per-printer success/failure is returned, never a silent success: a
   * configured printer that fails reports ok:false with its reason.
   */
  async printTicketForSale(
    tenantId: string,
    ticket: KitchenPrintTicket,
    stations: string[] = [],
  ): Promise<KitchenPrintResult[]> {
    const rows = await this.db
      .selectFrom('pos_kitchen_printers')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .orderBy('id', 'asc')
      .execute();

    const ticketStations = stations.length > 0
      ? stations
      : [...new Set(ticket.items.map((item) =>
          item.station && item.station !== 'all' && item.station !== 'expo'
            ? item.station
            : resolveItemStation({ productName: item.name }),
        ))];

    const matched = rows.filter((row) => {
      if (!row.ip_address) return false;
      const categoryIds = parsePrinterCategoryIds(row.category_ids);
      const byCategory = categoryIds.length > 0
        && ticket.items.some((item) => item.categoryId != null && categoryIds.includes(Number(item.categoryId)));
      const mapped = mapPrinterStationToKdsStation(row.station_code);
      const byStation = mapped !== null && ticketStations.includes(mapped);
      return byCategory || byStation;
    });

    if (matched.length === 0) return [];

    const text = formatKitchenTicketText(ticket);
    return Promise.all(matched.map(async (row) => {
      const port = Number(row.port) || 9100;
      const base = {
        printerId: Number(row.id),
        printerName: String(row.name),
        station: String(row.station_code),
      };
      try {
        await sendRawToPrinter(String(row.ip_address), port, text);
        return { ...base, ok: true };
      } catch (e: any) {
        const error = e?.message || String(e);
        this.logger.warn(`Kitchen printer ${row.name} (${row.ip_address}:${port}) failed: ${error}`);
        return { ...base, ok: false, error };
      }
    }));
  }

  /**
   * R4-E I12: the endpoint path. Loads the posted sale + items from the DB,
   * resolves each item's station from product + category config, and sends
   * to the matched printers.
   */
  async printTicketForPostedSale(tenantId: string, saleId: number): Promise<KitchenPrintResult[]> {
    if (!Number.isSafeInteger(saleId) || saleId <= 0) {
      throw new NotFoundException('Kitchen ticket sale not found');
    }
    const sale = await this.db
      .selectFrom('sales')
      .select(['id', 'doc_no', 'table_number', 'order_type', 'created_at', 'note'])
      .where('id', '=', saleId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!sale) throw new NotFoundException('Kitchen ticket sale not found');

    const itemRows = await this.db
      .selectFrom('sale_items as si')
      .leftJoin('products as p', (join) => join
        .onRef('p.id', '=', 'si.product_id')
        .onRef('p.tenant_id', '=', 'si.tenant_id'))
      .leftJoin('product_categories as pc', (join) => join
        .onRef('pc.id', '=', 'p.category_id')
        .onRef('pc.tenant_id', '=', 'si.tenant_id'))
      .select([
        'si.product_name', 'si.qty', 'si.notes', 'si.modifiers',
        'p.kitchen_station as configured_station',
        'p.category_id as category_id',
        'pc.kitchen_station as category_station',
        'pc.name as category_name',
      ])
      .where('si.sale_id', '=', saleId)
      .where('si.tenant_id', '=', tenantId)
      .orderBy('si.id', 'asc')
      .execute();

    const ticketItems: KitchenPrintTicketItem[] = itemRows.map((row: any) => {
      let modifiers: Array<{ name: string; qty?: number }> = [];
      if (typeof row.modifiers === 'string') {
        try { modifiers = JSON.parse(row.modifiers); } catch { modifiers = []; }
      } else if (Array.isArray(row.modifiers)) {
        modifiers = row.modifiers;
      }
      return {
        name: String(row.product_name || ''),
        qty: Number(row.qty) || 1,
        notes: row.notes || undefined,
        categoryId: row.category_id != null ? Number(row.category_id) : undefined,
        station: resolveItemStation({
          productStation: row.configured_station,
          categoryStation: row.category_station,
          productName: String(row.product_name || ''),
          categoryName: row.category_name,
        }),
        modifiers: modifiers
          .map((m: any) => ({ name: String(m?.name || ''), qty: m?.qty != null ? Number(m.qty) : undefined }))
          .filter((m) => m.name),
      };
    });

    const ticket: KitchenPrintTicket = {
      id: Number(sale.id),
      docNo: sale.doc_no || undefined,
      tableNumber: sale.table_number || undefined,
      orderType: sale.order_type || undefined,
      date: sale.created_at instanceof Date ? sale.created_at.toISOString() : String(sale.created_at || ''),
      note: sale.note || undefined,
      items: ticketItems,
    };
    const stations = [...new Set(ticketItems.map((item) => item.station).filter((s): s is string => Boolean(s)))];
    return this.printTicketForSale(tenantId, ticket, stations);
  }

  async listPrinters(tenantId: string, branchId?: number) {
    let query = this.db
      .selectFrom('pos_kitchen_printers')
      .selectAll()
      .where('tenant_id', '=', tenantId);

    if (branchId) {
      query = query.where((eb) =>
        eb.or([
          eb('branch_id', '=', branchId),
          eb('branch_id', 'is', null),
        ]),
      );
    }

    const rows = await query.orderBy('id', 'asc').execute();
    return rows.map((r) => ({
      ...r,
      categoryIds: Array.isArray(r.category_ids) ? r.category_ids : JSON.parse((r.category_ids as string) || '[]'),
    }));
  }

  async createPrinter(tenantId: string, dto: CreateKitchenPrinterDto) {
    const [created] = await this.db
      .insertInto('pos_kitchen_printers')
      .values({
        tenant_id: tenantId,
        branch_id: dto.branchId ?? null,
        name: dto.name,
        station_code: dto.stationCode || 'kitchen',
        ip_address: dto.ipAddress ?? null,
        port: dto.port ?? 9100,
        paper_width: dto.paperWidth ?? '80mm',
        is_active: dto.isActive !== undefined ? dto.isActive : true,
        category_ids: JSON.stringify(dto.categoryIds || []),
      })
      .returningAll()
      .execute();

    return {
      ...created,
      categoryIds: dto.categoryIds || [],
    };
  }

  async updatePrinter(tenantId: string, id: number, dto: UpdateKitchenPrinterDto) {
    const existing = await this.db
      .selectFrom('pos_kitchen_printers')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException('Kitchen printer not found');
    }

    const updates: Record<string, any> = {
      updated_at: new Date(),
    };

    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.stationCode !== undefined) updates.station_code = dto.stationCode;
    if (dto.ipAddress !== undefined) updates.ip_address = dto.ipAddress;
    if (dto.port !== undefined) updates.port = dto.port;
    if (dto.paperWidth !== undefined) updates.paper_width = dto.paperWidth;
    if (dto.branchId !== undefined) updates.branch_id = dto.branchId;
    if (dto.isActive !== undefined) updates.is_active = dto.isActive;
    if (dto.categoryIds !== undefined) updates.category_ids = JSON.stringify(dto.categoryIds);

    const [updated] = await this.db
      .updateTable('pos_kitchen_printers')
      .set(updates)
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .returningAll()
      .execute();

    return {
      ...updated,
      categoryIds: Array.isArray(updated.category_ids)
        ? updated.category_ids
        : JSON.parse((updated.category_ids as string) || '[]'),
    };
  }

  async deletePrinter(tenantId: string, id: number) {
    const result = await this.db
      .deleteFrom('pos_kitchen_printers')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    return { success: Number(result.numDeletedRows || 0) > 0 };
  }
}
