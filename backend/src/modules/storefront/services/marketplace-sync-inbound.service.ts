/**
 * MarketplaceSyncInboundService — slice S8 of the marketplace-sync split.
 * Pure move of 5 methods from MarketplaceSyncService (FBA/FBN inbound
 * shipments: list, create, packing-slip export, receiving, discrepancy
 * claim report). No behavior change: the bodies are byte-identical; the
 * facade keeps thin delegates with the same names and signatures. Deps
 * are db + audit + the bound kernel helpers getSettingJson/setSettingJson
 * (S10 form); getInboundShipments is called 4x from inside the span, so
 * it stays an in-slice method — no cross-slice dep. NO logger in this
 * span (prep §4 correct here — grep-verified 0 uses, unlike S3/S4).
 * Types come from ./marketplace-sync.types (S0). Clock travels verbatim:
 * createInboundShipment uses getTenantTimezone for the tenant-local doc
 * number; no instant comparison, no UTC normalizer.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AuditService } from '../../../core/audit/audit.service';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import { getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import type { FbaDiscrepancyClaimReport, FbaInboundShipment } from './marketplace-sync.types';

export interface MarketplaceSyncInboundDeps {
  db: Kysely<Database>;
  audit: AuditService;
  // Bound kernel helpers (S10 form): the facade binds its own private
  // kernel methods so bodies stay byte-identical. getSettingJson is
  // generic in the facade (getSettingJson<T>(…)) — the call sites use
  // getSettingJson<FbaInboundShipment[]>(…), so the dep type is generic.
  getSettingJson: <T>(key: string, tenantId: string, defaultValue: T, executor?: Kysely<Database>) => Promise<T>;
  setSettingJson: <T>(key: string, tenantId: string, value: T) => Promise<void>;
}

@Injectable()
export class MarketplaceSyncInboundService {
  private readonly db: Kysely<Database>;
  private readonly audit: AuditService;
  private readonly getSettingJson: <T>(
    key: string,
    tenantId: string,
    defaultValue: T,
    executor?: Kysely<Database>,
  ) => Promise<T>;
  private readonly setSettingJson: <T>(key: string, tenantId: string, value: T) => Promise<void>;

  constructor(deps: MarketplaceSyncInboundDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.getSettingJson = deps.getSettingJson;
    this.setSettingJson = deps.setSettingJson;
  }

  // =========================================================================
  // FBA / FBN INBOUND SHIPMENTS ("أذونات توريد لمستودعات أمازون ونون")
  // =========================================================================

  async getInboundShipments(auth: AuthContext): Promise<FbaInboundShipment[]> {
    const scope = requireTenantScope(auth);
    return this.getSettingJson<FbaInboundShipment[]>('marketplace_inbound_shipments', scope.tenantId, []);
  }

  async createInboundShipment(
    input: Omit<FbaInboundShipment, 'id' | 'shipmentNumber' | 'createdAt'>,
    auth: AuthContext,
  ): Promise<FbaInboundShipment> {
    const scope = requireTenantScope(auth);
    if (!input.items || !input.items.length) {
      throw new BadRequestException('يجب إضافة صنف واحد على الأقل لإذن التوريد');
    }

    const existing = await this.getInboundShipments(auth);
    const prefix = input.marketplace === 'noon' ? 'FBN' : 'FBA';
    const shipmentNumber = formatDailyDocumentNumber(
      prefix,
      existing.length + 1,
      new Date(),
      4,
      await getTenantTimezone(this.db, scope.tenantId),
    );

    const totalUnits = input.items.reduce((sum, item) => sum + Number(item.quantityShipped || 0), 0);
    const totalBoxes = input.items.reduce((max, item) => Math.max(max, Number(item.boxNumber || 1)), 1);

    const newShipment: FbaInboundShipment = {
      ...input,
      id: `inb_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      shipmentNumber,
      totalUnits,
      totalBoxes,
      createdAt: new Date().toISOString(),
      shippedAt: input.status === 'shipped' ? new Date().toISOString() : undefined,
    };

    existing.unshift(newShipment);
    await this.setSettingJson('marketplace_inbound_shipments', scope.tenantId, existing);

    await this.audit.log(
      'إنشاء إذن توريد مستودعات المنصات',
      `تم إصدار إذن توريد ${input.marketplace.toUpperCase()} رقم ${shipmentNumber} بإجمالي ${totalUnits} قطعة إلى مركز ${input.fulfillmentCenterId} بواسطة ${auth.username}`,
      auth,
    );

    return newShipment;
  }

  async exportPackingSlip(
    shipmentId: string,
    auth: AuthContext,
  ): Promise<{ filename: string; contentType: string; data: string }> {
    const shipments = await this.getInboundShipments(auth);
    const shipment = shipments.find((s) => s.id === shipmentId);
    if (!shipment) {
      throw new NotFoundException('إذن التوريد غير موجود');
    }

    const headers = [
      'ShipmentId',
      'FulfillmentCenter',
      'MerchantSKU',
      'Title',
      'Barcode',
      'UnitsShipped',
      'BoxNumber',
      'UnitsPerBox',
    ];

    const rows = shipment.items.map((item) =>
      [
        shipment.shipmentNumber,
        shipment.fulfillmentCenterId,
        item.marketplaceSku,
        `"${(item.productName || '').replace(/"/g, '""')}"`,
        item.barcode || '',
        item.quantityShipped,
        item.boxNumber || 1,
        item.unitsPerBox || item.quantityShipped,
      ].join(','),
    );

    const data = [headers.join(','), ...rows].join('\n');
    return {
      filename: `${shipment.shipmentNumber}_Carton_Packing_Slip.csv`,
      contentType: 'text/csv;charset=utf-8',
      data,
    };
  }

  async recordShipmentReceiving(
    shipmentId: string,
    receivedItems: { productId: number; marketplaceSku: string; quantityReceived: number }[],
    auth: AuthContext,
  ): Promise<FbaInboundShipment> {
    const scope = requireTenantScope(auth);
    // D6a: the persisted discrepancy loss rounds at the tenant's book
    // digits (see runRepricingBot above); this method opens no
    // transaction, so the pool handle is the caller's own handle.
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const shipments = await this.getInboundShipments(auth);
    const index = shipments.findIndex((s) => s.id === shipmentId);
    if (index === -1) {
      throw new NotFoundException('إذن التوريد غير موجود');
    }

    const shipment = shipments[index];
    let totalReceived = 0;
    let totalDiscrepancy = 0;
    let lossAmount = 0;

    const productIds = shipment.items.map((it) => it.productId);
    const products = productIds.length
      ? await this.db
          .selectFrom('products')
          .select(['id', 'cost_price', 'retail_price'])
          .where('id', 'in', productIds)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .execute()
      : [];

    const costMap = new Map<number, number>();
    for (const p of products) {
      costMap.set(p.id, Number(p.cost_price || 0));
    }

    shipment.items = shipment.items.map((item) => {
      const match = receivedItems.find(
        (r) => r.productId === item.productId || r.marketplaceSku === item.marketplaceSku,
      );
      const received = match !== undefined ? Number(match.quantityReceived || 0) : item.quantityShipped;
      const discrepancy = Math.max(0, item.quantityShipped - received);
      const unitCost = item.costPrice || costMap.get(item.productId) || 0;

      totalReceived += received;
      totalDiscrepancy += discrepancy;
      lossAmount += discrepancy * unitCost;

      return {
        ...item,
        quantityReceived: received,
        discrepancy,
        costPrice: unitCost,
      };
    });

    shipment.status = 'received';
    shipment.receivedAt = new Date().toISOString();
    shipment.totalReceivedUnits = totalReceived;
    shipment.totalDiscrepancyUnits = totalDiscrepancy;
    shipment.discrepancyLossAmount = roundMoney(lossAmount, bookDigits);

    shipments[index] = shipment;
    await this.setSettingJson('marketplace_inbound_shipments', scope.tenantId, shipments);

    await this.audit.log(
      'تسجيل استلام إذن توريد المستودعات ومطابقة الفواقد',
      `تم فحص إذن التوريد ${shipment.shipmentNumber} بمركز ${shipment.fulfillmentCenterId}. إجمالي المشحون: ${shipment.totalUnits}، المستلم: ${totalReceived}، الفاقد: ${totalDiscrepancy} قطعة (خسارة تقديرية: ${shipment.discrepancyLossAmount.toFixed(bookDigits)} ج.م)`,
      auth,
    );

    return shipment;
  }

  async getDiscrepancyClaimReport(shipmentId: string, auth: AuthContext): Promise<FbaDiscrepancyClaimReport> {
    const scope = requireTenantScope(auth);
    // D6a: claim losses are money the tenant claims back, so each
    // item loss and the claim total round at the book digits.
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const shipments = await this.getInboundShipments(auth);
    const shipment = shipments.find((s) => s.id === shipmentId);
    if (!shipment) {
      throw new NotFoundException('إذن التوريد غير موجود');
    }

    const missingItems = shipment.items
      .filter((it) => (it.discrepancy || 0) > 0)
      .map((it) => ({
        productId: it.productId,
        marketplaceSku: it.marketplaceSku,
        productName: it.productName,
        barcode: it.barcode,
        quantityShipped: it.quantityShipped,
        quantityReceived: it.quantityReceived ?? it.quantityShipped,
        missingQuantity: it.discrepancy || 0,
        unitCost: it.costPrice || 0,
        totalLoss: roundMoney((it.discrepancy || 0) * (it.costPrice || 0), bookDigits),
      }));

    const totalMissing = missingItems.reduce((s, it) => s + it.missingQuantity, 0);
    const totalLoss = roundMoney(
      missingItems.reduce((s, it) => s + it.totalLoss, 0),
      bookDigits,
    );

    const claimTitle =
      shipment.marketplace === 'amazon'
        ? `Inbound Discrepancy Investigation & Reimbursement Claim - ${shipment.shipmentNumber}`
        : `FBN Inbound Shipment Shortage Ticket - ${shipment.shipmentNumber}`;

    const itemsSummaryEn = missingItems
      .map(
        (it) =>
          `- SKU: ${it.marketplaceSku} | Title: ${it.productName} | Shipped: ${it.quantityShipped} | Received: ${it.quantityReceived} | Missing: ${it.missingQuantity} units (Loss: ${it.totalLoss} EGP)`,
      )
      .join('\n');

    const itemsSummaryAr = missingItems
      .map(
        (it) =>
          `- كود المنصة: ${it.marketplaceSku} | الصنف: ${it.productName} | المشحون: ${it.quantityShipped} | المستلم: ${it.quantityReceived} | العجز المفقود: ${it.missingQuantity} قطعة (قيمة الخسارة: ${it.totalLoss} ج.م)`,
      )
      .join('\n');

    const generatedClaimTemplateEn = `Subject: ${claimTitle}

Dear ${shipment.marketplace === 'amazon' ? 'Amazon Seller Support' : 'Noon Seller Partner Team'},

We are writing to request an investigation and financial reimbursement for inventory discrepancy in our inbound shipment:
- Shipment ID: ${shipment.shipmentNumber}
- Fulfillment Center: ${shipment.fulfillmentCenterId}
- Tracking Number: ${shipment.trackingNumber || 'N/A'}
- Shipped Date: ${shipment.shippedAt || shipment.createdAt}

Summary of Discrepancies:
- Total Units Shipped: ${shipment.totalUnits}
- Total Units Checked-In: ${shipment.totalReceivedUnits ?? shipment.totalUnits - totalMissing}
- Missing / Lost Units: ${totalMissing}
- Total Claim Amount: ${totalLoss} EGP

Discrepancy Details:
${itemsSummaryEn}

We have attached our stamped Carton Packing Slip and carrier dispatch confirmation proving the exact unit count dispatched. Please investigate the FC receiving scan logs and process the reimbursement for the missing units to our account.

Sincerely,
Inventory & Logistics Operations`;

    const generatedClaimTemplateAr = `الموضوع: ${shipment.marketplace === 'amazon' ? 'طلب تعويض وبحث فواقد شحنة واردة لمستودع أمازون FBA' : 'تذكرة عجز استلام شحنة واردة لمستودع نون FBN'}

السادة فريق دعم الشركاء والبائعين (${shipment.marketplace === 'amazon' ? 'أمازون' : 'نون'}) المحترمين،

نحيطكم علماً بوجود عجز وفارق بين الكميات المشحونة والمستلمة فعلياً في مستودعكم للشحنة التالية:
- رقم إذن الشحن: ${shipment.shipmentNumber}
- مركز التوزيع المستلم: ${shipment.fulfillmentCenterId}
- رقم البوليصة / التتبع: ${shipment.trackingNumber || 'غير متوفر'}
- تاريخ الشحن: ${shipment.shippedAt || shipment.createdAt}

بيان الفواقد والعجز:
- إجمالي القطع المشحونة: ${shipment.totalUnits} قطعة
- إجمالي القطع المستلمة والمفحوصة: ${shipment.totalReceivedUnits ?? shipment.totalUnits - totalMissing} قطعة
- عدد القطع المفقودة / العجز: ${totalMissing} قطعة
- إجمالي قيمة التعويض المطلوب: ${totalLoss} ج.م

تفاصيل الأصناف المفقودة:
${itemsSummaryAr}

مرفق صورة كشف التعبئة للكراتين (Packing Slip) وإشعار تسليم الشاحن المثبت لكامل الكميات. يرجى مراجعة سجلات الفحص والمسح الداخلي وتعويضنا مالياً عن القطع المفقودة.

شاكرين تعاونكم،
إدارة العمليات والمخازن`;

    return {
      shipmentId: shipment.id,
      shipmentNumber: shipment.shipmentNumber,
      marketplace: shipment.marketplace,
      fulfillmentCenterId: shipment.fulfillmentCenterId,
      trackingNumber: shipment.trackingNumber,
      shippedDate: shipment.shippedAt || shipment.createdAt,
      totalShippedUnits: shipment.totalUnits,
      totalReceivedUnits: shipment.totalReceivedUnits ?? shipment.totalUnits - totalMissing,
      missingUnits: totalMissing,
      estimatedReimbursementAmount: totalLoss,
      items: missingItems,
      generatedClaimTemplateAr,
      generatedClaimTemplateEn,
    };
  }
}
