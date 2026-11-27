import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import {
  Kysely,
  sql,
  Transaction,
  Updateable,
} from 'kysely';
import { Database, ImportShipmentTable } from '../../../database/database.types';
import { requireImportNumber } from '../import-inventory-cost.engine';
import { CreateShipmentDto, UpdateShipmentCostsDto, AddShipmentItemDto } from '../dto/import-sales.dto';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { resolveSectorPreset } from '../data/sector-presets.data';
import { calculateDemurrageRisk } from '../engines/import-landed-cost.engine';

/**
 * ImportShipmentsService — slice S3 of the import-sales split.
 * Pure move of 8 methods from ImportSalesService
 * (listShipments, createShipment, getShipmentById, addShipmentItem,
 * importProjectItemsToShipment, assertCostComponentPayees,
 * updateShipmentCosts, calculateLandedCost). No behavior change: the
 * bodies are byte-identical; the facade keeps thin delegates with the
 * same names and signatures. Cross-slice calls go through bound facade
 * delegates: calculateLandedCostInTransaction and postShipmentToInventory
 * live in the receipt-posting slice (S4) and are called here via the
 * facade. Date handling travels verbatim: expense dates resolve through
 * resolveBusinessDateKey (tenant day); importProjectItemsToShipment
 * stamps importedAt / catalog_updated_at from the server instant as
 * evidence, never as a pg DATE key. assertCostComponentPayees is public
 * here (private in the facade delegate) — the facade, a different class,
 * cannot call a private slice method (tsc TS2341); the facade delegate
 * stays private, so the facade public surface is unchanged.
 * apportionByBucketShares is NOT here — it travels with S4 (its only
 * caller is postShipmentToInventory).
 */

export interface ImportShipmentsDeps {
  db: Kysely<any>;
  // Bound facade members (same names as the facade members, so the
  // moved bodies are byte-identical). lockShipment +
  // assertShipmentEditable + assertForm4ClearanceGate are the shared
  // shipment guards (kernel, stay in the facade forever);
  // calculateLandedCostInTransaction + postShipmentToInventory are the
  // facade delegates into the receipt-posting slice (S4).
  lockShipment: (...args: any[]) => any;
  assertShipmentEditable: (...args: any[]) => any;
  assertForm4ClearanceGate: (...args: any[]) => any;
  calculateLandedCostInTransaction: (...args: any[]) => any;
  postShipmentToInventory: (...args: any[]) => any;
}

@Injectable()
export class ImportShipmentsService {
  private readonly db: Kysely<any>;
  private readonly inventoryDb: Kysely<Database>;
  private readonly lockShipment: (...args: any[]) => any;
  private readonly assertShipmentEditable: (...args: any[]) => any;
  private readonly assertForm4ClearanceGate: (...args: any[]) => any;
  private readonly calculateLandedCostInTransaction: (...args: any[]) => any;
  private readonly postShipmentToInventory: (...args: any[]) => any;

  constructor(deps: ImportShipmentsDeps) {
    this.db = deps.db;
    this.inventoryDb = deps.db;
    this.lockShipment = deps.lockShipment;
    this.assertShipmentEditable = deps.assertShipmentEditable;
    this.assertForm4ClearanceGate = deps.assertForm4ClearanceGate;
    this.calculateLandedCostInTransaction = deps.calculateLandedCostInTransaction;
    this.postShipmentToInventory = deps.postShipmentToInventory;
  }

  async listShipments(tenantId: string) {
    // I1-P3: the list UI reads supplier_name, not supplier_id — join
    // the supplier so a persisted supplier is visible instead of
    // "غير محدد". Tenant-scoped join: a supplier id belongs to one
    // tenant only, so a same-id supplier in another tenant must
    // never leak its name into this tenant's list.
    const rows = await this.db
      .selectFrom('import_shipments')
      .leftJoin('suppliers', (join) =>
        join
          .onRef('suppliers.id', '=', 'import_shipments.supplier_id')
          .onRef('suppliers.tenant_id', '=', 'import_shipments.tenant_id'),
      )
      .selectAll('import_shipments')
      .select('suppliers.name as supplier_name')
      .where('import_shipments.tenant_id', '=', tenantId)
      .orderBy('import_shipments.created_at', 'desc')
      .execute();
      
    const stats = {
      sea: rows.filter(r => r.status === 'Pending').length,
      customs: rows.filter(r => r.status === 'In Customs').length,
      arrived: rows.filter(r => r.status === 'Arrived').length,
    };
    
    return { rows, stats };
  }

  async createShipment(tenantId: string, dto: CreateShipmentDto) {
    if (dto.supplierId) {
      const supplier = await this.db.selectFrom('suppliers').select('id')
        .where('tenant_id', '=', tenantId).where('id', '=', Number(dto.supplierId)).executeTakeFirst();
      if (!supplier) throw new BadRequestException('المورد لا ينتمي لهذه المنشأة.');
    }
    // INV-IMPORT-LANDED-COST-DUTY-VAT: when the shipment is
    // created from a project, carry the feasibility study's duty
    // % / VAT % / insurance onto it, so both stages agree without
    // re-typing the rates. Precedence: an explicit DTO value wins;
    // then the study's stored value (an explicit 0% is a real 0%,
    // not a missing value); then the feasibility engine's own
    // defaults (5% duty / 14% VAT — the rates the study itself
    // computed with when the operator never touched them).
    // Insurance has no engine default: missing means uninsured.
    // A shipment with no project carries nothing and defaults
    // to 0% / 0% / 0 at the insert below.
    let carriedDutyRate: number | undefined;
    let carriedVatRate: number | undefined;
    let carriedInsuranceUsd: number | undefined;
    if (dto.projectId) {
      const project = await this.db.selectFrom('import_projects').select(['id', 'status', 'feasibility_data'])
        .where('tenant_id', '=', tenantId).where('id', '=', dto.projectId).executeTakeFirst();
      if (!project || project.status === 'closed') throw new BadRequestException('مشروع الاستيراد غير متاح لهذه المنشأة.');
      const feas = typeof project.feasibility_data === 'string'
        ? JSON.parse(project.feasibility_data || '{}')
        : (project.feasibility_data || {});
      const studyRate = (value: unknown, fallback: number): number => {
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 ? n : fallback;
      };
      carriedDutyRate = studyRate(feas.customsDutyRatePercent, 5);
      carriedVatRate = studyRate(feas.vatRatePercent, 14);
      const insurance = Number(feas.insuranceUsd);
      carriedInsuranceUsd = Number.isFinite(insurance) && insurance >= 0 ? insurance : 0;
    }
    // Same container on the same bill of lading is the same
    // shipment recorded twice. One B/L legitimately covers many
    // containers, and container numbers are reused over time, so
    // neither identifier is unique alone; the pair is the
    // duplicate. The existing unique index on (tenant_id,
    // container_number) is the race backstop via the 23505 catch
    // below (createShipment holds no transaction).
    const containerNo = dto.containerNumber?.trim();
    const bolNo = dto.billOfLading?.trim();
    if (containerNo && bolNo) {
      const duplicate = await this.db
        .selectFrom('import_shipments')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where(sql<boolean>`btrim(container_number) = ${containerNo}`)
        .where(sql<boolean>`btrim(bill_of_lading) = ${bolNo}`)
        .executeTakeFirst();
      if (duplicate) {
        throw new ConflictException(`الحاوية (${containerNo}) مسجلة بالفعل على نفس بوليصة الشحن (${bolNo}) لهذه المنشأة.`);
      }
    }
    let result;
    try {
      result = await this.db
        .insertInto('import_shipments')
      .values({
        tenant_id: tenantId,
        container_number: dto.containerNumber,
        arrival_date: dto.arrivalDate,
        shipped_date: dto.shippingDate,
        supplier_id: dto.supplierId ? Number(dto.supplierId) : null,
        bill_of_lading: dto.billOfLading,
        project_id: dto.projectId,
        freight_type: dto.freightType,
        container_size: dto.containerSize,
        port_of_loading: dto.portOfLoading,
        port_of_discharge: dto.portOfDischarge,
        cbm_volume: dto.cbmVolume,
        gross_weight_kg: dto.grossWeightKg,
        carrier_name: dto.carrierName,
        free_demurrage_days: dto.freeDemurrageDays,
        demurrage_start_date: dto.demurrageStartDate,
        demurrage_rate_per_day: dto.demurrageRatePerDay,
        customs_declaration_no: dto.customsDeclarationNo,
        vat_refundable_egp: dto.vatRefundableEgp,
        // INV-IMPORT-LANDED-COST-DUTY-VAT: explicit DTO values
        // win; otherwise the feasibility carry above; otherwise
        // the column DEFAULT 0 (no project, no tax).
        customs_duty_rate_percent: dto.customsDutyRatePercent ?? carriedDutyRate ?? 0,
        vat_rate_percent: dto.vatRatePercent ?? carriedVatRate ?? 0,
        insurance_cost_usd: dto.insuranceCostUsd ?? carriedInsuranceUsd ?? 0,
        is_consolidated: dto.isConsolidated,
        cost_allocation_method: dto.costAllocationMethod,
        exchange_rate_at_arrival: dto.exchangeRateAtArrival !== undefined
          ? requireImportNumber(dto.exchangeRateAtArrival, 'سعر الصرف عند الوصول', Number.MIN_VALUE)
          : undefined,
        pricing_exchange_rate: dto.pricingExchangeRate !== undefined
          ? requireImportNumber(dto.pricingExchangeRate, 'سعر صرف التسعير', Number.MIN_VALUE)
          : undefined,
        // INV-IMPORT-FORM4-CLEARANCE-GATE: persist the funding
        // type, defaulting to bank_transfer — the gate keys on
        // this column, so a shipment must never be stored
        // without one. Spread, not a direct key: funding_type
        // joins the ImportShipmentTable type at merge (the
        // column itself is created by this package's migration).
        ...({ funding_type: dto.fundingType ?? 'bank_transfer' }),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new ConflictException(`رقم الحاوية (${containerNo || dto.containerNumber}) مسجل بالفعل لهذه المنشأة.`);
      }
      throw err;
    }
    return result;
  }

  async getShipmentById(tenantId: string, id: string) {
    // I1-P3: same supplier join as listShipments — the detail page
    // reads supplier_name, which a bare selectAll() never populated,
    // so every shipment showed "غير محدد" even when supplier_id was
    // persisted. Tenant-scoped join, same as the list.
    const shipment = await this.db
      .selectFrom('import_shipments')
      .leftJoin('suppliers', (join) =>
        join
          .onRef('suppliers.id', '=', 'import_shipments.supplier_id')
          .onRef('suppliers.tenant_id', '=', 'import_shipments.tenant_id'),
      )
      .selectAll('import_shipments')
      .select('suppliers.name as supplier_name')
      .where('import_shipments.tenant_id', '=', tenantId)
      .where('import_shipments.id', '=', id)
      .executeTakeFirst();

    if (!shipment) throw new NotFoundException('Shipment not found');

    const items = await this.db
      .selectFrom('import_shipment_items')
      .leftJoin('products', 'products.id', 'import_shipment_items.product_id')
      .select([
        'import_shipment_items.id',
        'import_shipment_items.product_id',
        'import_shipment_items.quantity',
        'import_shipment_items.factory_unit_price_usd',
        'import_shipment_items.allocated_overhead_egp',
        'import_shipment_items.landed_cost_egp',
        'import_shipment_items.received_quantity',
        'import_shipment_items.target_retail_margin',
        'import_shipment_items.target_wholesale_margin',
        'import_shipment_items.shortage_handling_method',
        'import_shipment_items.created_at',
        'products.name as product_name',
      ])
      .where('import_shipment_items.tenant_id', '=', tenantId)
      .where('import_shipment_items.shipment_id', '=', id)
      .orderBy('import_shipment_items.created_at', 'asc')
      .execute();

    const receipt = await this.inventoryDb.selectFrom('import_inventory_receipts')
      .select(['id', 'state', 'posted_at', 'review_reason', 'journal_entry_id'])
      .where('tenant_id', '=', tenantId).where('shipment_id', '=', id).executeTakeFirst();

    const demurrageRisk = calculateDemurrageRisk({
      arrivalDate: shipment.arrival_date,
      demurrageStartDate: shipment.demurrage_start_date,
      // Raw values: the engine owns the 14 / $50 / rate-1 fallbacks AND
      // records which of them it used (INV-IMPORT-ESTIMATES-HONEST). Do
      // not pre-default here — pre-defaulting would hide the assumption.
      freeDays: shipment.free_demurrage_days,
      ratePerDayUsd: shipment.demurrage_rate_per_day,
      exchangeRate: shipment.exchange_rate_at_arrival,
      status: shipment.container_status === 'empty_returned' ? 'empty_returned' : (shipment.status || 'Pending'),
      // Book digits for the estimated fee (U4 W1 canonical wiring).
      moneyDigits: currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId)),
    });

    return { ...shipment, items, inventory_receipt: receipt ?? null, demurrageRisk };
  }

  async addShipmentItem(tenantId: string, shipmentId: string, dto: AddShipmentItemDto) {
    return this.inventoryDb.transaction().execute(async (trx) => {
      const state = await this.lockShipment(trx, tenantId, shipmentId);
      this.assertShipmentEditable(state);
      const productId = requireImportNumber(dto.productId, 'الصنف', 1);
      if (!Number.isSafeInteger(productId)) throw new BadRequestException('معرف الصنف غير صالح');
      const product = await trx.selectFrom('products').select('id')
        .where('tenant_id', '=', tenantId).where('id', '=', productId).executeTakeFirst();
      if (!product) throw new NotFoundException('الصنف غير موجود في المنشأة');
      requireImportNumber(dto.quantity, 'الكمية', 1);
      requireImportNumber(dto.factoryUnitPriceUsd, 'سعر المصنع');
      if (!Number.isInteger(dto.quantity)) throw new BadRequestException('الكمية يجب أن تكون عددًا صحيحًا');
      const item = await trx.insertInto('import_shipment_items').values({
        tenant_id: tenantId, shipment_id: shipmentId, product_id: productId,
        quantity: dto.quantity, factory_unit_price_usd: dto.factoryUnitPriceUsd,
        gross_weight_kg_unit: requireImportNumber(dto.unitWeightKg ?? 0, 'وزن الوحدة'),
        cbm_unit: requireImportNumber(dto.unitCbm ?? 0, 'حجم الوحدة'),
      }).returningAll().executeTakeFirstOrThrow();
      await this.calculateLandedCostInTransaction(trx, state.shipment);
      return trx.selectFrom('import_shipment_items').selectAll()
        .where('tenant_id', '=', tenantId).where('id', '=', item.id).executeTakeFirstOrThrow();
    });
  }

  async importProjectItemsToShipment(tenantId: string, userId: number, shipmentId: string) {
    return this.inventoryDb.transaction().execute(async (trx) => {
      const state = await this.lockShipment(trx, tenantId, shipmentId);
      this.assertShipmentEditable(state);
      const { shipment } = state;

      if (!shipment.project_id) {
        throw new BadRequestException('هذه الحاوية غير مربوطة بمشروع استيراد. يرجى ربطها بالمشروع أولاً.');
      }

      const project = await trx
        .selectFrom('import_projects')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', shipment.project_id)
        .executeTakeFirst();

      if (!project) {
        throw new NotFoundException('مشروع الاستيراد المرتبط بالحاوية غير موجود.');
      }

      const feas = typeof project.feasibility_data === 'string'
        ? JSON.parse(project.feasibility_data || '{}')
        : (project.feasibility_data || {});

      const items = Array.isArray(feas.items) && feas.items.length > 0
        ? feas.items
        : (Array.isArray((project as any).items) ? (project as any).items : []);

      if (items.length === 0) {
        throw new BadRequestException('دراسة جدوى المشروع لا تحتوي على أصناف مسجلة لاستيرادها.');
      }

      const existingItems = await trx
        .selectFrom('import_shipment_items')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('shipment_id', '=', shipmentId)
        .execute();

      if (existingItems.length > 0) {
        throw new BadRequestException('الحاوية تحتوي بالفعل على أصناف مسجلة. قم بحذفها أولاً أو أضف الأصناف يدوياً لمنع التكرار.');
      }

      let scopeAccountId = tenantId;
      const rawShipmentSupplier = (shipment)?.supplier_id;
      if (rawShipmentSupplier) {
        const sup = await trx.selectFrom('suppliers').select('account_id')
          .where('tenant_id', '=', tenantId).where('id', '=', Number(rawShipmentSupplier)).executeTakeFirst();
        if (sup?.account_id) scopeAccountId = sup.account_id;
      }

      // INV-IMPORT-SECTOR-PRESET: sector conventions apply only
      // when the project chose a preset. A generic project gets
      // no category, no OEM map, no invented identifiers and no
      // markup; an unknown stored key fails closed.
      const presetKey = (project)?.sector_preset;
      const preset = resolveSectorPreset(presetKey ? String(presetKey) : null);
      if (presetKey && String(presetKey).trim() && !preset) {
        throw new BadRequestException(
          `قطاع المشروع المخزن (${presetKey}) غير معروف؛ حدد قطاعاً معتمداً قبل استيراد الأصناف. [IMPORT_UNKNOWN_SECTOR_PRESET]`,
        );
      }

      let categoryId: number | null = null;
      if (preset) {
        let cat = await trx
          .selectFrom('product_categories')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('name', '=', preset.categoryName)
          .executeTakeFirst();
        if (!cat) {
          cat = await trx
            .insertInto('product_categories')
            .values({
              tenant_id: tenantId,
              account_id: scopeAccountId,
              name: preset.categoryName,
              is_active: true,
            })
            .returning('id')
            .executeTakeFirst();
        }
        if (cat) categoryId = Number(cat.id);
      }

      const rawSupplierId = (project as any)?.supplier_id || rawShipmentSupplier || feas?.supplierId || null;
      const projectSupplierId = rawSupplierId ? Number(rawSupplierId) : null;

      // No silent || 50: the import needs a real rate — arrival
      // first, then the feasibility commercial rate — or it fails
      // closed, the same rule as every other money path.
      const arrivalRate = Number((shipment).exchange_rate_at_arrival);
      const feasRate = Number(feas?.exchangeRateCommercial);
      const exchangeRate =
        Number.isFinite(arrivalRate) && arrivalRate > 0
          ? arrivalRate
          : Number.isFinite(feasRate) && feasRate > 0
            ? feasRate
            : NaN;
      if (!Number.isFinite(exchangeRate)) {
        throw new BadRequestException(
          'لا يمكن استيراد أصناف المشروع بلا سعر صرف صالح؛ حدد سعر الصرف عند الوصول أو السعر التجاري على دراسة الجدوى قبل الاستيراد. [IMPORT_EXCHANGE_RATE_REQUIRED]',
        );
      }

      const insertedItems: any[] = [];
      let itemIndex = 0;
      for (const it of items) {
        itemIndex++;
        const itemName = String(it.name || it.productName || '').trim();
        const qty = Math.max(1, Math.round(Number(it.qty ?? it.quantity ?? 1)));
        const foreignPrice = Number(it.factoryPriceUsd ?? it.unitPriceForeign ?? it.unitPriceUsd ?? 0);
        const weightKg = Number(it.unitWeightKg || 0);
        const cbm = Number(it.unitCbm || 0);

        // Preset conventions apply only under a preset: the OEM
        // map, fabricated SKU/barcode and metadata defaults are
        // the preset's explicit conventions. The generic path
        // keeps only what the item itself supplied, plus
        // provenance — nothing is invented.
        const suppliedOem = it.oemNumber || it.partNumber || it.part_number || null;
        const oemNumber = preset
          ? suppliedOem || preset.oemMap[itemName] || `TRK-OEM-${String(itemIndex).padStart(4, '0')}`
          : suppliedOem;
        const sku = preset
          ? it.sku || oemNumber || `TRK-${project.project_no?.replace('IMP-', '') || '2610'}-${String(itemIndex).padStart(3, '0')}`
          : it.sku || null;
        const barcode = preset
          ? it.barcode || `200${String(project.project_no || '').replace(/\D/g, '').slice(-4)}${String(itemIndex).padStart(4, '0')}`
          : it.barcode || null;
        const metadata: Record<string, any> = {
          ...(oemNumber ? { oemNumber, partNumber: oemNumber } : {}),
          projectNo: project.project_no,
          containerNo: shipment.container_number,
          importedAt: new Date().toISOString(),
        };
        if (preset) {
          metadata.carBrand = it.brand || it.carBrand || preset.defaultBrand;
          metadata.carModel = it.model || it.carModel || preset.defaultModel;
          metadata.carYearFrom = it.carYearFrom || preset.defaultYearFrom;
          metadata.carYearTo = it.carYearTo || preset.defaultYearTo;
          metadata.origin = preset.defaultOrigin;
        } else {
          if (it.brand || it.carBrand) metadata.carBrand = it.brand || it.carBrand;
          if (it.model || it.carModel) metadata.carModel = it.model || it.carModel;
          if (it.carYearFrom) metadata.carYearFrom = it.carYearFrom;
          if (it.carYearTo) metadata.carYearTo = it.carYearTo;
          if (it.origin) metadata.origin = it.origin;
        }

        let productId = Number(it.productId ?? it.product_id);
        let product: any = null;

        if (Number.isSafeInteger(productId) && productId > 0) {
          product = await trx
            .selectFrom('products')
            .selectAll()
            .where('tenant_id', '=', tenantId)
            .where('id', '=', productId)
            .executeTakeFirst();
        }

        if (!product && itemName) {
          product = await trx
            .selectFrom('products')
            .selectAll()
            .where('tenant_id', '=', tenantId)
            .where(sql`LOWER(name)`, '=', itemName.toLowerCase())
            .executeTakeFirst();

          if (!product) {
            const estimatedCost = Number((foreignPrice * exchangeRate).toFixed(3));
            // Fixed markups are a preset convention only. The
            // generic path prices a new product at its estimated
            // cost (retail/wholesale columns are NOT NULL) —
            // no silent margin is invented.
            const retailPrice = preset
              ? Number((estimatedCost * preset.retailMarkup).toFixed(3))
              : estimatedCost;
            const wholesalePrice = preset
              ? Number((estimatedCost * preset.wholesaleMarkup).toFixed(3))
              : estimatedCost;
            product = await trx
              .insertInto('products')
              .values({
                tenant_id: tenantId,
                account_id: scopeAccountId,
                name: itemName,
                sku,
                barcode,
                supplier_id: projectSupplierId,
                category_id: categoryId,
                cost_price: estimatedCost,
                retail_price: retailPrice,
                wholesale_price: wholesalePrice,
                stock_qty: 0,
                min_stock_qty: 0,
                notes: `صنف استيراد من مشروع ${project.project_no} - حاوية ${shipment.container_number}`,
                is_active: true,
                item_kind: 'standard',
                item_type: 'product',
                track_serials: false,
                reserved_qty: 0,
                metadata,
                catalog_updated_at: new Date(),
              })
              .returning(['id', 'name'])
              .executeTakeFirstOrThrow();
          }
          // An existing product is linked as-is: importing a
          // shipment never rewrites catalog data (supplier,
          // category, SKU, barcode, notes, metadata) on the
          // strength of a name match, under any preset.
          productId = Number(product.id);
        }

        if (productId) {
          const inserted = await trx
            .insertInto('import_shipment_items')
            .values({
              tenant_id: tenantId,
              shipment_id: shipmentId,
              product_id: productId,
              quantity: qty,
              factory_unit_price_usd: foreignPrice,
              gross_weight_kg_unit: weightKg,
              cbm_unit: cbm,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

          insertedItems.push(inserted);
        }
      }

      await this.calculateLandedCostInTransaction(trx, state.shipment);

      return {
        success: true,
        importedCount: insertedItems.length,
        items: insertedItems,
      };
    });
  }

  /**
   * I1-P5 early payee validation (INV-IMPORT-PAYEE-VALIDATION-EARLY):
   * the arrival path resolves a payee only for a nonzero overhead
   * share, and a share is nonzero exactly when its net bucket
   * weight is positive (bucket less the broker-folded portion of
   * that bucket). This helper applies that SAME rule to the
   * effective (post-save) cost state, so a cost save that would
   * leave a postable component unattributed fails here — before
   * any expense, landed-cost or journal write — instead of
   * surfacing only after the irreversible arrival confirm. The
   * one deliberate divergence: the arrival share also scales with
   * the receipt's total overhead residual, which needs the grouped
   * landed cost and is not computable before the save; a residual
   * at or below zero cannot post at all (the arrival split fails
   * closed on it), so requiring the payee there is fail-fast,
   * never a mis-posting.
   */
  async assertCostComponentPayees(
    trx: Transaction<Database>,
    tenantId: string,
    shipmentId: string,
    effective: {
      shippingCostUsd: number;
      customsCostEgp: number;
      internalTransportCostEgp: number;
      actualDemurrageFees: number;
      exchangeRateAtArrival: number | null;
      freightSupplierId: number;
      customsSupplierId: number;
      transportSupplierId: number;
      demurrageSupplierId: number;
      unallocableCostReason: string;
      // INV-IMPORT-LANDED-COST-DUTY-VAT: the itemized tax rates
      // and the CIF insurance. Duty/VAT are rate-derived (CIF x
      // rate), so the payee check keys on the rates, not on a
      // stored amount; insurance rides with the freight payee
      // (the forwarder arranges it), duty/VAT with the customs
      // payee (the broker settles them). No new payee type.
      customsDutyRatePercent: number;
      vatRatePercent: number;
      insuranceCostUsd: number;
    },
  ): Promise<void> {
    // The folded sums are only read when a foldable bucket is
    // nonzero: freight has no folded bucket, and a zero bucket
    // nets to zero either way. This keeps the validation usable
    // on call paths (and minimal harnesses) that never touch
    // broker capitalisation, instead of failing them on a table
    // they never needed.
    const needsFolded =
      effective.customsCostEgp > 0 ||
      effective.internalTransportCostEgp > 0 ||
      effective.actualDemurrageFees > 0;
    const foldedByBucket = new Map<string, number>();
    if (needsFolded) {
      const foldedRows = await trx.selectFrom('import_broker_capitalizations')
        .select(['cost_bucket', sql<number>`coalesce(sum(amount_egp), 0)`.as('folded_total')])
        .where('tenant_id', '=', tenantId).where('shipment_id', '=', shipmentId).where('state', '=', 'folded')
        .groupBy('cost_bucket')
        .execute();
      for (const row of foldedRows) {
        foldedByBucket.set(String((row).cost_bucket || ''), Number((row).folded_total || 0));
      }
    }
    const rate = effective.exchangeRateAtArrival;
    const components: Array<{ label: string; netAmount: number; payeeId: number }> = [
      {
        label: 'شحن بحري',
        // Freight has no broker-folded bucket: its net weight is
        // the USD cost converted at the effective arrival rate. A
        // nonzero USD cost with no usable rate yet is still a real
        // cost — the rate itself is guarded separately before arrival.
        // INV-IMPORT-LANDED-COST-DUTY-VAT: the CIF insurance
        // rides with the freight (same forwarder, same payee).
        netAmount: rate !== null && Number.isFinite(rate) && rate > 0
          ? (effective.shippingCostUsd + effective.insuranceCostUsd) * rate
          : effective.shippingCostUsd + effective.insuranceCostUsd,
        payeeId: effective.freightSupplierId,
      },
      {
        label: 'جمارك وتخليص',
        netAmount: Math.max(0, effective.customsCostEgp - (foldedByBucket.get('customs_cost_egp') || 0)),
        payeeId: effective.customsSupplierId,
      },
      {
        label: 'نقل داخلي',
        netAmount: Math.max(0, effective.internalTransportCostEgp - (foldedByBucket.get('internal_transport_cost_egp') || 0)),
        payeeId: effective.transportSupplierId,
      },
      {
        label: 'غرامات تأخير وأرضيات',
        netAmount: Math.max(0, effective.actualDemurrageFees - (foldedByBucket.get('actual_demurrage_fees') || 0)),
        payeeId: effective.demurrageSupplierId,
      },
    ];
    for (const component of components) {
      if (!(component.netAmount > 0)) continue;
      if (Number.isSafeInteger(component.payeeId) && component.payeeId > 0) {
        const supplier = await trx.selectFrom('suppliers').select('id')
          .where('tenant_id', '=', tenantId).where('id', '=', component.payeeId).executeTakeFirst();
        if (supplier) continue;
        throw new BadRequestException(`مورد بند التكلفة (${component.label}) غير موجود في هذه المنشأة؛ حدد مورداً حقيقياً قبل الترحيل. [IMPORT_COMPONENT_PAYEE_REQUIRED]`);
      }
      if (effective.unallocableCostReason) continue;
      throw new BadRequestException(`لا يمكن ترحيل بند التكلفة (${component.label}) بلا مورد محدد: حدد مورد البند أو سجل سبب عدم قابلية التخصيص قبل الترحيل. [IMPORT_COMPONENT_PAYEE_REQUIRED]`);
    }
    // INV-IMPORT-LANDED-COST-DUTY-VAT: duty/VAT are customs dues
    // even when the flat customs fee is zero, so the flat-fee
    // component above cannot be the gate for them. A nonzero
    // rate needs the customs payee (or a recorded unallocable
    // reason), with the same existence check as every other
    // component. The amounts are derived at receipt time (CIF x
    // rate), so this pre-flight keys on the rates.
    if (effective.customsDutyRatePercent > 0 || effective.vatRatePercent > 0) {
      if (Number.isSafeInteger(effective.customsSupplierId) && effective.customsSupplierId > 0) {
        const supplier = await trx.selectFrom('suppliers').select('id')
          .where('tenant_id', '=', tenantId).where('id', '=', effective.customsSupplierId).executeTakeFirst();
        if (!supplier) {
          throw new BadRequestException(`مورد بند التكلفة (ضريبة جمركية وقيمة مضافة) غير موجود في هذه المنشأة؛ حدد مورداً حقيقياً قبل الترحيل. [IMPORT_COMPONENT_PAYEE_REQUIRED]`);
        }
      } else if (!effective.unallocableCostReason) {
        throw new BadRequestException(`لا يمكن ترحيل بند التكلفة (ضريبة جمركية وقيمة مضافة) بلا مورد محدد: حدد مورد البند أو سجل سبب عدم قابلية التخصيص قبل الترحيل. [IMPORT_COMPONENT_PAYEE_REQUIRED]`);
      }
    }
  }

  async updateShipmentCosts(tenantId: string, userId: number, shipmentId: string, dto: UpdateShipmentCostsDto) {
    await this.inventoryDb.transaction().execute(async (trx) => {
      const state = await this.lockShipment(trx, tenantId, shipmentId);
      const { shipment, receipt } = state;
      const numericFields = [
        ['shippingCostUsd', 'shipping_cost_usd'], ['customsCostEgp', 'customs_cost_egp'],
        ['internalTransportCostEgp', 'internal_transport_cost_egp'],
        ['exchangeRateAtArrival', 'exchange_rate_at_arrival'],
        // INV-IMPORT-LANDED-COST-DUTY-VAT: itemized tax rates (%
        // at 2dp, same scale as the other EGP costs) and the CIF
        // insurance in USD (2dp, like the freight).
        ['customsDutyRatePercent', 'customs_duty_rate_percent'],
        ['vatRatePercent', 'vat_rate_percent'],
        ['insuranceCostUsd', 'insurance_cost_usd'],
      ] as const;
      const payload: Updateable<ImportShipmentTable> = {};
      let financialChange = false;
      for (const [input, column] of numericFields) {
        if (dto[input] !== undefined) {
          const value = requireImportNumber(dto[input], input, input === 'exchangeRateAtArrival' ? Number.MIN_VALUE : 0);
          const scale = input === 'exchangeRateAtArrival' ? 4 : 2;
          if (value !== Number(value.toFixed(scale))) throw new BadRequestException(`دقة غير صالحة: ${input}`);
          payload[column] = value;
          if (value !== Number(shipment[column])) financialChange = true;
        }
      }
      if (dto.status !== undefined) {
        if (!['Pending', 'In Customs', 'Arrived'].includes(dto.status)) throw new BadRequestException('حالة الشحنة غير صالحة');
        payload.status = dto.status;
      }
      if (dto.pricingExchangeRate !== undefined) payload.pricing_exchange_rate = requireImportNumber(dto.pricingExchangeRate, 'سعر صرف التسعير', Number.MIN_VALUE);
      if (dto.shippedDate !== undefined) payload.shipped_date = dto.shippedDate;
      if (dto.etaDate !== undefined) payload.eta_date = dto.etaDate;
      if (dto.clearanceDate !== undefined) payload.clearance_date = dto.clearanceDate;
      if (dto.form4Number !== undefined) payload.form4_number = dto.form4Number || null;
      if (dto.form4Date !== undefined) payload.form4_date = dto.form4Date || null;
      // INV-IMPORT-FORM4-CLEARANCE-GATE: the funding type may be
      // corrected before clearance/receipt; it feeds the gate on
      // a status transition in this same call. Written through
      // (payload as any) like the payee columns: funding_type
      // joins the ImportShipmentTable type at merge (the column
      // is created by this package's migration).
      if (dto.fundingType !== undefined) (payload as any).funding_type = dto.fundingType;
      if (dto.projectId !== undefined) {
        if (dto.projectId) {
          const matchingProject = await trx.selectFrom('import_projects').select('id')
            .where('tenant_id', '=', tenantId).where('id', '=', dto.projectId).executeTakeFirst();
          if (!matchingProject) throw new BadRequestException('مشروع الاستيراد غير موجود في هذه المنشأة.');
        }
        payload.project_id = dto.projectId || null;
      }
      if (dto.freightType !== undefined) payload.freight_type = dto.freightType;
      if (dto.containerSize !== undefined) payload.container_size = dto.containerSize;
      if (dto.portOfLoading !== undefined) payload.port_of_loading = dto.portOfLoading;
      if (dto.portOfDischarge !== undefined) payload.port_of_discharge = dto.portOfDischarge;
      if (dto.cbmVolume !== undefined) payload.cbm_volume = dto.cbmVolume;
      if (dto.grossWeightKg !== undefined) payload.gross_weight_kg = dto.grossWeightKg;
      if (dto.carrierName !== undefined) payload.carrier_name = dto.carrierName;
      if (dto.freeDemurrageDays !== undefined) payload.free_demurrage_days = dto.freeDemurrageDays;
      if (dto.demurrageStartDate !== undefined) payload.demurrage_start_date = dto.demurrageStartDate;
      if (dto.demurrageRatePerDay !== undefined) payload.demurrage_rate_per_day = dto.demurrageRatePerDay;
      if (dto.actualDemurrageFees !== undefined) payload.actual_demurrage_fees = dto.actualDemurrageFees;
      if (dto.customsDeclarationNo !== undefined) payload.customs_declaration_no = dto.customsDeclarationNo;
      if (dto.vatRefundableEgp !== undefined) payload.vat_refundable_egp = dto.vatRefundableEgp;
      if (dto.isConsolidated !== undefined) payload.is_consolidated = dto.isConsolidated;
      if (dto.costAllocationMethod !== undefined) payload.cost_allocation_method = dto.costAllocationMethod;
      // INV-IMPORT-SUPPLIER-ATTRIBUTION: explicit payee per cost
      // component, recorded before posting. A changed payee is
      // validated against the tenant's suppliers now; an unchanged
      // replay skips the lookup so a later supplier deletion can
      // never break replaying an identical posted request. The
      // frozen-fields block below strips these columns once the
      // receipt is posted: attribution is part of the posted
      // record, corrected only through reversal + re-posting.
      const payeeFields = [
        ['freightSupplierId', 'freight_supplier_id'],
        ['customsSupplierId', 'customs_supplier_id'],
        ['transportSupplierId', 'transport_supplier_id'],
        ['demurrageSupplierId', 'demurrage_supplier_id'],
      ] as const;
      for (const [input, column] of payeeFields) {
        if (dto[input] !== undefined) {
          const supplierId = Number(dto[input]);
          if (supplierId !== Number((shipment)[column])) {
            const supplier = await trx.selectFrom('suppliers').select('id')
              .where('tenant_id', '=', tenantId).where('id', '=', supplierId).executeTakeFirst();
            if (!supplier) {
              throw new BadRequestException(`مورد بند التكلفة (${input}) غير موجود في هذه المنشأة؛ حدد مورداً حقيقياً قبل الترحيل. [IMPORT_COMPONENT_PAYEE_REQUIRED]`);
            }
          }
          (payload)[column] = supplierId;
        }
      }
      if (dto.unallocableCostReason !== undefined) payload.unallocable_cost_reason = dto.unallocableCostReason || null;

      // I1-P5 early payee validation (INV-IMPORT-PAYEE-VALIDATION-EARLY):
      // runs BEFORE any expense, landed-cost or journal write, on
      // the effective (post-save) state. It fires when the call
      // marks the shipment Arrived (the pre-flight for the
      // irreversible confirm) or when it changes a cost amount, a
      // payee, the unallocable reason or the arrival rate. An
      // identical re-save is a no-op and skips validation, the
      // same convention as the payee loop above and the broker
      // floor (a below-floor change nets to zero here, so the
      // floor error keeps its precedence). A posted receipt is
      // immutable, so no validation runs once one exists.
      if (!receipt) {
        const numOrZero = (value: unknown): number => {
          const n = Number(value ?? 0);
          return Number.isFinite(n) ? n : 0;
        };
        const storedRate = shipment.exchange_rate_at_arrival === null || shipment.exchange_rate_at_arrival === undefined
          ? null
          : numOrZero(shipment.exchange_rate_at_arrival);
        const costTouched =
          (dto.shippingCostUsd !== undefined && numOrZero(dto.shippingCostUsd) !== numOrZero(shipment.shipping_cost_usd)) ||
          (dto.customsCostEgp !== undefined && numOrZero(dto.customsCostEgp) !== numOrZero(shipment.customs_cost_egp)) ||
          (dto.internalTransportCostEgp !== undefined && numOrZero(dto.internalTransportCostEgp) !== numOrZero(shipment.internal_transport_cost_egp)) ||
          (dto.actualDemurrageFees !== undefined && numOrZero(dto.actualDemurrageFees) !== numOrZero(shipment.actual_demurrage_fees)) ||
          (dto.customsDutyRatePercent !== undefined && numOrZero(dto.customsDutyRatePercent) !== numOrZero(shipment.customs_duty_rate_percent)) ||
          (dto.vatRatePercent !== undefined && numOrZero(dto.vatRatePercent) !== numOrZero(shipment.vat_rate_percent)) ||
          (dto.insuranceCostUsd !== undefined && numOrZero(dto.insuranceCostUsd) !== numOrZero(shipment.insurance_cost_usd)) ||
          (dto.exchangeRateAtArrival !== undefined && (storedRate === null || numOrZero(dto.exchangeRateAtArrival) !== storedRate)) ||
          (dto.freightSupplierId !== undefined && numOrZero(dto.freightSupplierId) !== numOrZero((shipment).freight_supplier_id)) ||
          (dto.customsSupplierId !== undefined && numOrZero(dto.customsSupplierId) !== numOrZero((shipment).customs_supplier_id)) ||
          (dto.transportSupplierId !== undefined && numOrZero(dto.transportSupplierId) !== numOrZero((shipment).transport_supplier_id)) ||
          (dto.demurrageSupplierId !== undefined && numOrZero(dto.demurrageSupplierId) !== numOrZero((shipment).demurrage_supplier_id)) ||
          (dto.unallocableCostReason !== undefined && String(dto.unallocableCostReason ?? '').trim() !== String((shipment).unallocable_cost_reason ?? '').trim());
        if (dto.status === 'Arrived' || costTouched) {
          if (dto.status === 'Arrived') {
            // The arrival rate keeps precedence over the payee
            // check: an Arrived call without a rate must still fail
            // on the rate, exactly as before.
            const effectiveRate = dto.exchangeRateAtArrival !== undefined ? numOrZero(dto.exchangeRateAtArrival) : storedRate;
            if (effectiveRate === null || !Number.isFinite(effectiveRate) || effectiveRate <= 0) {
              throw new BadRequestException(
                'لا يمكن تمييز الشحنة كواصلة بلا سعر صرف وصول حقيقي وموجب؛ حدد سعر الصرف عند الوصول أولاً. [IMPORT_ARRIVAL_RATE_REQUIRED]',
              );
            }
          }
          await this.assertCostComponentPayees(trx, tenantId, shipmentId, {
            shippingCostUsd: dto.shippingCostUsd !== undefined ? numOrZero(dto.shippingCostUsd) : numOrZero(shipment.shipping_cost_usd),
            customsCostEgp: dto.customsCostEgp !== undefined ? numOrZero(dto.customsCostEgp) : numOrZero(shipment.customs_cost_egp),
            internalTransportCostEgp: dto.internalTransportCostEgp !== undefined ? numOrZero(dto.internalTransportCostEgp) : numOrZero(shipment.internal_transport_cost_egp),
            actualDemurrageFees: dto.actualDemurrageFees !== undefined ? numOrZero(dto.actualDemurrageFees) : numOrZero(shipment.actual_demurrage_fees),
            exchangeRateAtArrival: dto.exchangeRateAtArrival !== undefined ? numOrZero(dto.exchangeRateAtArrival) : storedRate,
            freightSupplierId: dto.freightSupplierId !== undefined ? numOrZero(dto.freightSupplierId) : numOrZero((shipment).freight_supplier_id),
            customsSupplierId: dto.customsSupplierId !== undefined ? numOrZero(dto.customsSupplierId) : numOrZero((shipment).customs_supplier_id),
            transportSupplierId: dto.transportSupplierId !== undefined ? numOrZero(dto.transportSupplierId) : numOrZero((shipment).transport_supplier_id),
            demurrageSupplierId: dto.demurrageSupplierId !== undefined ? numOrZero(dto.demurrageSupplierId) : numOrZero((shipment).demurrage_supplier_id),
            unallocableCostReason: dto.unallocableCostReason !== undefined ? String(dto.unallocableCostReason ?? '').trim() : String((shipment).unallocable_cost_reason ?? '').trim(),
            customsDutyRatePercent: dto.customsDutyRatePercent !== undefined ? numOrZero(dto.customsDutyRatePercent) : numOrZero(shipment.customs_duty_rate_percent),
            vatRatePercent: dto.vatRatePercent !== undefined ? numOrZero(dto.vatRatePercent) : numOrZero(shipment.vat_rate_percent),
            insuranceCostUsd: dto.insuranceCostUsd !== undefined ? numOrZero(dto.insuranceCostUsd) : numOrZero(shipment.insurance_cost_usd),
          });
        }
      }

      const expenseInputs = [
        [dto.shippingAccountId, shipment.shipping_expense_id, shipment.shipping_cost_usd],
        [dto.customsAccountId, shipment.customs_expense_id, shipment.customs_cost_egp],
        [dto.transportAccountId, shipment.transport_expense_id, shipment.internal_transport_cost_egp],
      ] as const;
      // Replaying an identical posted request is a no-op, including its expense selections.
      if (receipt?.state === 'posted') {
        // Valuation and provenance become immutable when the inventory receipt is posted.
        const frozenFields: Array<[keyof UpdateShipmentCostsDto, keyof ImportShipmentTable]> = [
          ['actualDemurrageFees','actual_demurrage_fees'], ['vatRefundableEgp','vat_refundable_egp'],
          ['costAllocationMethod','cost_allocation_method'], ['projectId','project_id'],
          // INV-IMPORT-LANDED-COST-DUTY-VAT: the tax rates and
          // the CIF insurance freeze with the receipt — the
          // receipt journal was posted on them.
          ['customsDutyRatePercent','customs_duty_rate_percent'], ['vatRatePercent','vat_rate_percent'],
          ['insuranceCostUsd','insurance_cost_usd'],
          ['freightType','freight_type'], ['containerSize','container_size'],
          ['portOfLoading','port_of_loading'], ['portOfDischarge','port_of_discharge'],
          ['cbmVolume','cbm_volume'], ['grossWeightKg','gross_weight_kg'],
          ['carrierName','carrier_name'], ['freeDemurrageDays','free_demurrage_days'],
          ['demurrageStartDate','demurrage_start_date'], ['demurrageRatePerDay','demurrage_rate_per_day'],
          ['customsDeclarationNo','customs_declaration_no'], ['isConsolidated','is_consolidated'],
          // Attribution is part of the posted record: payees and
          // the unallocable reason freeze with the receipt.
          ['freightSupplierId','freight_supplier_id'], ['customsSupplierId','customs_supplier_id'],
          ['transportSupplierId','transport_supplier_id'], ['demurrageSupplierId','demurrage_supplier_id'],
          ['unallocableCostReason','unallocable_cost_reason'],
        ];
        for (const [input, column] of frozenFields) {
          const submitted = dto[input];
          const stored = shipment[column];
          const unchanged = typeof submitted === 'number' && Number.isFinite(Number(stored))
            ? submitted === Number(stored)
            : String(submitted ?? '') === String(stored ?? '');
          if (submitted !== undefined && !unchanged) {
            this.assertShipmentEditable(state);
          }
          delete (payload)[column];
        }
        // INV-IMPORT-FORM4-CLEARANCE-GATE: the funding type
        // freezes with the posted receipt too — the gate decision
        // that allowed the receipt was taken on it, so it is part
        // of the posted record, not a free edit. (Not in
        // frozenFields above: funding_type joins the
        // ImportShipmentTable type at merge.)
        if (dto.fundingType !== undefined) {
          const storedFundingType = (shipment).funding_type || 'bank_transfer';
          if (dto.fundingType !== storedFundingType) {
            this.assertShipmentEditable(state);
          }
          delete (payload as any).funding_type;
        }
        for (const [accountId, expenseId, cost] of expenseInputs) {
          if (accountId === undefined) continue;
          if (expenseId === null && Number(cost) === 0) continue;
          const expense = expenseId === null ? undefined : await trx.selectFrom('expenses').select('account_id')
            .where('tenant_id', '=', tenantId).where('id', '=', expenseId).executeTakeFirst();
          if (accountId !== expense?.account_id) financialChange = true;
        }
        if (financialChange || (dto.status !== undefined && dto.status !== 'Arrived')) {
          this.assertShipmentEditable(state);
        }
        // Only tracking dates and sales-pricing inputs can change after receipt.
        delete payload.shipping_cost_usd;
        delete payload.customs_cost_egp;
        delete payload.internal_transport_cost_egp;
        delete payload.customs_duty_rate_percent;
        delete payload.vat_rate_percent;
        delete payload.insurance_cost_usd;
        delete payload.exchange_rate_at_arrival;
        delete payload.status;
      } else {
        this.assertShipmentEditable(state);
        const handleExpense = async (cost: number, accountId: string | undefined, existingId: number | null, title: string) => {
          if (!accountId || cost <= 0) return existingId;
          if (existingId !== null) {
            await trx.updateTable('expenses').set({ amount: cost, account_id: accountId })
              .where('tenant_id', '=', tenantId).where('id', '=', existingId).execute();
            return existingId;
          }
          const expense = await trx.insertInto('expenses').values({
            tenant_id: tenantId, account_id: accountId, title: `${title} للحاوية ${shipment.container_number}`,
            amount: cost, expense_date: await resolveBusinessDateKey(trx, tenantId, new Date()), created_by: userId,
            note: '', branch_id: null, location_id: null,
          }).returning('id').executeTakeFirstOrThrow();
          return expense.id;
        };
        if (dto.shippingCostUsd !== undefined || dto.shippingAccountId !== undefined) {
          payload.shipping_expense_id = await handleExpense(
            Number(dto.shippingCostUsd ?? shipment.shipping_cost_usd ?? 0) * requireImportNumber(dto.exchangeRateAtArrival ?? shipment.exchange_rate_at_arrival, 'سعر الصرف', Number.MIN_VALUE),
            dto.shippingAccountId, shipment.shipping_expense_id, 'مصاريف شحن');
        }
        if (dto.customsCostEgp !== undefined || dto.customsAccountId !== undefined) {
          payload.customs_expense_id = await handleExpense(Number(dto.customsCostEgp ?? shipment.customs_cost_egp ?? 0), dto.customsAccountId, shipment.customs_expense_id, 'مصاريف جمارك');
        }
        if (dto.internalTransportCostEgp !== undefined || dto.transportAccountId !== undefined) {
          payload.transport_expense_id = await handleExpense(Number(dto.internalTransportCostEgp ?? shipment.internal_transport_cost_egp ?? 0), dto.transportAccountId, shipment.transport_expense_id, 'مصاريف نقل داخلي');
        }
      }
      // Broker-capitalisation floor (INV-IMPORT-BROKER-CAPITALISATION):
      // a cost bucket that already carries folded broker expenses
      // can never be set below their sum: lowering it would silently
      // remove a cost the receipt journal is about to recognise
      // against the broker advance. Post-receipt the buckets are
      // frozen above, so this floor only binds pre-receipt writes.
      const bucketFloorColumns = ['customs_cost_egp', 'actual_demurrage_fees', 'internal_transport_cost_egp'] as const;
      const flooredBuckets = bucketFloorColumns.filter((column) => (payload)[column] !== undefined);
      if (flooredBuckets.length > 0) {
        const foldedSums = await trx.selectFrom('import_broker_capitalizations')
          .select(['cost_bucket', sql<number>`coalesce(sum(amount_egp), 0)`.as('folded_total')])
          .where('tenant_id', '=', tenantId).where('shipment_id', '=', shipmentId).where('state', '=', 'folded')
          .groupBy('cost_bucket')
          .execute();
        for (const column of flooredBuckets) {
          const folded = Number(foldedSums.find((row) => row.cost_bucket === column)?.folded_total || 0);
          if (Number((payload)[column]) < folded - 0.001) {
            throw new BadRequestException(`لا يمكن تخفيض بند التكلفة (${column}) دون إجمالي مصروفات المخلص المرسملة فيه (${folded.toFixed(2)} ج.م). [IMPORT_BROKER_CAPITALIZATION_FLOOR]`);
          }
        }
      }
      const updated = Object.keys(payload).length ? await trx.updateTable('import_shipments').set(payload)
        .where('tenant_id', '=', tenantId).where('id', '=', shipmentId).returningAll().executeTakeFirstOrThrow() : shipment;
      // Marking Arrived requires a real arrival rate on the stored
      // row (set in this same call or earlier): the recalculation
      // below would catch a missing rate only when items exist, so
      // the transition itself is guarded explicitly.
      if (dto.status === 'Arrived') {
        const effectiveArrivalRate = dto.exchangeRateAtArrival ?? updated.exchange_rate_at_arrival;
        if (effectiveArrivalRate === null || effectiveArrivalRate === undefined || !Number.isFinite(Number(effectiveArrivalRate)) || Number(effectiveArrivalRate) <= 0) {
          throw new BadRequestException(
            'لا يمكن تمييز الشحنة كواصلة بلا سعر صرف وصول حقيقي وموجب؛ حدد سعر الصرف عند الوصول أولاً. [IMPORT_ARRIVAL_RATE_REQUIRED]',
          );
        }
      }
      // Form 4 clearance gate (INV-IMPORT-FORM4-CLEARANCE-GATE):
      // evaluated on a status TRANSITION into clearance or receipt,
      // after the row reflects this call's Form 4 fields and before
      // any landed-cost recalculation or inventory posting. The
      // gate reads the updated row (Form 4 supplied in this same
      // call satisfies it) and the project-linked funding.
      if (dto.status !== undefined && dto.status !== shipment.status && (dto.status === 'In Customs' || dto.status === 'Arrived')) {
        await this.assertForm4ClearanceGate(trx, tenantId, updated);
      }
      if (!receipt) {
        await this.calculateLandedCostInTransaction(trx, updated);
        if (dto.status === 'Arrived') await this.postShipmentToInventory(trx, tenantId, shipmentId, userId, dto.receiptLocationId);
      }
    });
    return this.getShipmentById(tenantId, shipmentId);
  }

  async calculateLandedCost(tenantId: string, shipmentId: string) {
    return this.inventoryDb.transaction().execute(async (trx) => {
      const state = await this.lockShipment(trx, tenantId, shipmentId);
      this.assertShipmentEditable(state);
      return this.calculateLandedCostInTransaction(trx, state.shipment);
    });
  }
}
