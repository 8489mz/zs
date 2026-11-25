import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Selectable, Kysely, sql } from 'kysely';
import { Database } from '../../../database/database.types';
import { computeTableBillTotals } from '../engines/table-bill.engine';
import { storefrontMoneyDigits } from '../storefront-helpers';

/**
 * StorefrontTableBillService — slice T10 of the storefront split.
 * Pure move of 2 methods from the facade (table bill: the active
 * table check/bill read and the pay endpoint, which throws before any
 * read or write). No behavior change: the bodies are byte-identical,
 * both methods were already public. The facade keeps thin delegates
 * with the same names/signatures.
 * Deps: db + kernel getTenantBySlug + getTenantSettingsMap (stay REAL
 * private methods in the facade, passed bound via the HR kernel
 * pattern). The pay method uses no dep at all. The money-digits helper
 * is imported from the helpers module (created with the T8 merge — T8
 * merges FIRST; the file does not exist on this generation tree,
 * EXPECTED transient, merge-owned; HR H0 precedent).
 * Dates: none of any kind in the moved text (grep-proven) — no clock
 * pin travels with this slice. No rounding, no FX in this slice.
 * Driving spec: table-bill-pay-closed (pay method — reads the facade
 * source text; repoint to this slice file is MERGE-OWNED). No spec
 * repoint travels in this patch — prep section 7.3 rules all eight
 * source-text repoints MERGE-OWNED.
 * MERGE NOTE: T10 is last in merge order (kernel only, no slice deps)
 * and merges anywhere; last is fine.
 */

export interface StorefrontTableBillDeps {
  db: Kysely<Database>;
  getTenantBySlug: (slug: string) => Promise<Selectable<Database['tenants']>>;
  getTenantSettingsMap: (tenantId: string) => Promise<Map<string, string>>;
}

@Injectable()
export class StorefrontTableBillService {
  private readonly db: Kysely<Database>;
  private readonly getTenantBySlug: (slug: string) => Promise<Selectable<Database['tenants']>>;
  private readonly getTenantSettingsMap: (tenantId: string) => Promise<Map<string, string>>;

  constructor(deps: StorefrontTableBillDeps) {
    this.db = deps.db;
    this.getTenantBySlug = deps.getTenantBySlug;
    this.getTenantSettingsMap = deps.getTenantSettingsMap;
  }

  /**
   * Next-Gen F&B: Get active table check / bill for Pay-at-Table via QR code
   */
  async getActiveTableBill(slug: string, tableNumber: string) {
    const cleanSlug = String(slug || '')
      .trim()
      .toLowerCase();
    const cleanTable = String(tableNumber || '').trim();
    const tenant = await this.getTenantBySlug(cleanSlug);

    // 1. Look for active held sale draft for this table
    const heldSale = await this.db
      .selectFrom('held_sales as hs')
      .select([
        'hs.id',
        'hs.table_number',
        'hs.order_type',
        'hs.discount',
        'hs.note',
        'hs.delivery_fee',
        'hs.paid_online',
        'hs.paid_online_amount',
        'hs.paid_online_ref',
        'hs.created_at',
      ])
      .where(sql<boolean>`hs.tenant_id = ${tenant.id}`)
      .where('hs.table_number', '=', cleanTable)
      .orderBy('hs.id', 'desc')
      .executeTakeFirst();

    if (!heldSale) {
      // Also check if there is an active unpaid dine-in sale in sales
      const activeSale = await this.db
        .selectFrom('sales as s')
        .select([
          's.id',
          's.doc_no',
          's.table_number',
          's.total',
          's.subtotal',
          's.tax_amount',
          's.discount',
          's.service_charge',
          's.tip_amount',
          's.status',
          's.created_at',
        ])
        .where(sql<boolean>`s.tenant_id = ${tenant.id}`)
        .where('s.table_number', '=', cleanTable)
        .where('s.order_type', '=', 'dine_in')
        .where('s.status', 'not in', ['cancelled', 'completed'])
        .orderBy('s.id', 'desc')
        .executeTakeFirst();

      if (!activeSale) {
        return {
          hasActiveBill: false,
          tableNumber: cleanTable,
          message: 'لا توجد فواتير أو طلبات نشطة مسجلة على هذه الطاولة حالياً.',
        };
      }

      const saleItems = await this.db
        .selectFrom('sale_items')
        .select(['id', 'product_name', 'qty', 'unit_price', 'line_total', 'notes'])
        .where(sql<boolean>`tenant_id = ${tenant.id}`)
        .where('sale_id', '=', activeSale.id)
        .execute();

      return {
        hasActiveBill: true,
        source: 'sale',
        billId: Number(activeSale.id),
        invoiceNo: activeSale.doc_no || `SALE-${activeSale.id}`,
        tableNumber: cleanTable,
        isPaidOnline: false,
        paidOnlineAmount: 0,
        paidOnlineRef: null,
        items: saleItems.map((it) => ({
          name: it.product_name,
          qty: Number(it.qty),
          unitPrice: Number(it.unit_price),
          total: Number(it.line_total),
          notes: it.notes || '',
        })),
        subtotal: Number(activeSale.subtotal || 0),
        discount: Number(activeSale.discount || 0),
        serviceCharge: Number(activeSale.service_charge || 0),
        tax: Number(activeSale.tax_amount || 0),
        total: Number(activeSale.total || 0),
        currency: (tenant as any).currency || 'SAR',
      };
    }

    // Held draft found
    const items = await this.db
      .selectFrom('held_sale_items')
      .select(['id', 'product_name', 'qty', 'unit_price', 'modifiers'])
      .where(sql<boolean>`tenant_id = ${tenant.id}`)
      .where('held_sale_id', '=', heldSale.id)
      .execute();

    const formattedItems = items.map((it) => {
      let mods: any[] = [];
      try {
        if (typeof it.modifiers === 'string' && it.modifiers.trim()) {
          mods = JSON.parse(it.modifiers);
        } else if (Array.isArray(it.modifiers)) {
          mods = it.modifiers;
        }
      } catch {}
      const itemTotal = Number(it.qty) * Number(it.unit_price);
      return {
        name: it.product_name,
        qty: Number(it.qty),
        unitPrice: Number(it.unit_price),
        total: itemTotal,
        modifiers: mods,
      };
    });

    const subtotal = formattedItems.reduce((acc, it) => acc + it.total, 0);
    const discount = Number(heldSale.discount || 0);

    // Read settings to check service charge and tax. Rates arrive raw so
    // the table-bill engine can tell "never set" from "garbled": only an
    // absent rate falls back (0 tax, 12 service percent); a present but
    // invalid rate fails closed inside the engine.
    const settings = await this.getTenantSettingsMap(tenant.id);
    const serviceChargeEnabled =
      settings.get('restaurant_service_charge_enabled') === 'true' ||
      settings.get('restaurantServiceChargeEnabled') === 'true';
    const totals = computeTableBillTotals({
      subtotal,
      discount,
      serviceChargeEnabled,
      serviceChargePercent:
        settings.get('restaurant_service_charge_rate') ?? settings.get('restaurantServiceChargePercent'),
      taxRate: settings.get('tax_rate') ?? settings.get('taxRate'),
      digits: storefrontMoneyDigits(settings, tenant),
    });
    const serviceCharge = totals.serviceCharge;
    const tax = totals.tax;
    const grandTotal = totals.total;

    return {
      hasActiveBill: true,
      source: 'held_draft',
      billId: Number(heldSale.id),
      tableNumber: cleanTable,
      isPaidOnline: Boolean(heldSale.paid_online),
      paidOnlineAmount: Number(heldSale.paid_online_amount || 0),
      paidOnlineRef: heldSale.paid_online_ref || null,
      items: formattedItems,
      subtotal,
      discount,
      serviceCharge,
      tax,
      total: grandTotal,
      currency: (tenant as any).currency || 'SAR',
    };
  }

  /**
   * Next-Gen F&B: Pay active table check / bill via QR online checkout.
   *
   * INV-TABLE-BILL-PAY-CLOSED: this endpoint is CLOSED until a verified
   * gateway capture exists. It used to mark the bill paid_online with a
   * generated TAB-PAY reference and no payment of any kind, on a public
   * route anyone could call with a shop slug and a table number — a
   * guest could close a check and walk out with the food unpaid. The
   * throw below runs before any read or write, so no bill state and no
   * service-call row can ever be produced from this route. Re-enable
   * only through a gateway charge plus webhook-verified capture; never
   * by restoring the generated-reference marking. Viewing the bill
   * (getActiveTableBill) is unchanged.
   */
  async payActiveTableBill(
    slug: string,
    tableNumber: string,
    dto: { tipAmount?: number; paymentMethod?: string; guestName?: string; guestPhone?: string },
  ) {
    void slug;
    void tableNumber;
    void dto;
    throw new ServiceUnavailableException('الدفع الإلكتروني لفاتورة الطاولة غير متاح حالياً — ادفع عند الكاشير.');
  }
}
