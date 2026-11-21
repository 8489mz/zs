import { sql } from 'kysely';
import { Kysely } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { Database } from '../../../database/database.types';
import { validateDistributorInvoiceLines } from '../engines/distributor-invoice-validation.engine';
import { buildDistributorPurchaseItem } from '../engines/distributor-purchase.engine';
import { PurchasesService } from '../../purchases/purchases.service';
import { AppError } from '../../../common/errors/app-error';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, toMinorUnits, fromMinorUnits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

export class DistributorInvoiceSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly purchases: PurchasesService,
  ) {}

  // -------------------------------------------------------------
  // 2. DISTRIBUTOR INVOICE IMPORTER (مستورد فواتير المتحدة، ابن سينا، فارما أوفرسيز)
  // -------------------------------------------------------------
  async importDistributorInvoice(
    auth: AuthContext,
    dto: {
      distributor: string; supplierId?: number; locationId?: number;
      invoiceNumber?: string; invoiceDate?: string;
      paymentType?: 'credit' | 'cash';
      lines: Array<{
        productName: string; barcode?: string;
        quantity: number; bonusQuantity?: number;
        publicPrice: number; costPrice: number;
        expiryDate: string; batchNumber?: string;
      }>;
    },
  ) {
    const scope = requireTenantScope(auth);
    validateDistributorInvoiceLines(dto.lines);
    const distributor = String(dto.distributor || '').trim();
    const invoiceNo = String(dto.invoiceNumber || '').trim();
    if (!distributor || !invoiceNo || invoiceNo.length > 100) {
      throw new AppError('A named supplier and unique distributor invoice number are required',
        'PHARMACY_SUPPLIER_INVOICE_REQUIRED', 422);
    }
    // This endpoint is an adapter to the existing purchase/GRN engine; it MUST
    // NOT create independent inventory, cash, or batch rows.
    let supplierQuery = this.db.selectFrom('suppliers')
      .select(['id', 'name']).where('tenant_id', '=', scope.tenantId)
      .where('is_active', '=', true);
    if (dto.supplierId) {
      supplierQuery = supplierQuery.where('id', '=', Number(dto.supplierId));
    } else {
      supplierQuery = supplierQuery.where(sql<boolean>`lower(trim(name)) = lower(${distributor})`);
    }
    const suppliers = await supplierQuery.limit(2).execute();
    if (suppliers.length !== 1) {
      throw new AppError('Distributor must match exactly one active tenant supplier',
        'PHARMACY_SUPPLIER_NOT_LINKED', 422);
    }
    const supplierId = Number(suppliers[0].id);
    let locationQuery = this.db.selectFrom('stock_locations')
      .select(['id', 'branch_id']).where('tenant_id', '=', scope.tenantId)
      .where('is_active', '=', true);
    if (dto.locationId) locationQuery = locationQuery.where('id', '=', Number(dto.locationId));
    const locations = await locationQuery.limit(2).execute();
    if (locations.length !== 1 || !locations[0].branch_id) {
      throw new AppError('Select a single active tenant receiving location',
        'PHARMACY_RECEIPT_LOCATION_REQUIRED', 422);
    }
    const locationId = Number(locations[0].id);
    const branchId = Number(locations[0].branch_id);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));

    const items: ReturnType<typeof buildDistributorPurchaseItem>[] = [];
    let totalQuantity = 0;
    let totalCostMinor = 0;
    let totalPublicSum = 0;
    for (const line of dto.lines) {
      let query = this.db.selectFrom('pharmacy_drugs').select(['id', 'product_id'])
        .where('tenant_id', '=', scope.tenantId);
      if (line.barcode?.trim()) {
        const barcode = line.barcode.trim();
        query = query.where((eb) => eb.or([
          eb('barcode', '=', barcode), eb('trade_name', '=', line.productName.trim()),
        ]));
      } else {
        query = query.where('trade_name', '=', line.productName.trim());
      }
      let productId: number;
      let isDrug = false;
      const matches = await query.limit(2).execute();
      if (matches.length === 1 && matches[0].product_id) {
        productId = Number(matches[0].product_id);
        isDrug = true;
      } else {
        let prodQuery = this.db.selectFrom('products').select('id')
          .where('tenant_id', '=', scope.tenantId).where('is_active', '=', true);
        if (line.barcode?.trim()) {
          const barcode = line.barcode.trim();
          prodQuery = prodQuery.where((eb) => eb.or([
            eb('barcode', '=', barcode), eb('name', '=', line.productName.trim()),
          ]));
        } else {
          prodQuery = prodQuery.where('name', '=', line.productName.trim());
        }
        const prodMatches = await prodQuery.limit(2).execute();
        if (prodMatches.length !== 1) {
          throw new AppError('Link the imported drug to exactly one inventory product before purchasing',
            'PHARMACY_PRODUCT_NOT_LINKED', 422);
        }
        productId = Number(prodMatches[0].id);
      }
      const product = await this.db.selectFrom('products').select('id')
        .where('tenant_id', '=', scope.tenantId).where('id', '=', productId)
        .where('is_active', '=', true).executeTakeFirst();
      if (!product) {
        throw new AppError('Linked inventory product is missing or inactive',
          'PHARMACY_PRODUCT_NOT_LINKED', 422);
      }
      let item: ReturnType<typeof buildDistributorPurchaseItem>;
      try {
        item = buildDistributorPurchaseItem(line, productId, locationId, moneyDigits, isDrug);
        const payableMinor = toMinorUnits(Number(line.quantity) * Number(line.costPrice), moneyDigits);
        const roundedPurchaseMinor = toMinorUnits(roundMoney(item.qty * item.cost, moneyDigits), moneyDigits);
        const varianceMinor = Math.abs(payableMinor - roundedPurchaseMinor);
        if (varianceMinor > 0) {
          // If bonus units diluted the cost, allow fractional cent/fil rounding tolerance
          const maxAllowedVariance = Math.max(2, Math.ceil(item.qty));
          if (varianceMinor > maxAllowedVariance) {
            throw new Error('Drug bonus unit dilution exceeds permitted vendor invoice precision');
          }
        }
        totalCostMinor += payableMinor;
      } catch (error) {
        throw new AppError((error as Error).message, 'PHARMACY_INVOICE_LINE_INVALID', 422);
      }
      if (!Number.isSafeInteger(totalCostMinor)) {
        throw new AppError('Distributor invoice monetary total exceeds safe range',
          'PHARMACY_INVOICE_TOTAL_INVALID', 422);
      }
      totalQuantity += item.qty;
      totalPublicSum += item.qty * Number(line.publicPrice);
      items.push(item);
    }
    // The canonical purchasing path now persists the same 2/3-digit tenant
    // invoice amount in supplier AP, inventory and journal entries.

    const recorded = await this.purchases.createPurchase({
      supplierId, supplierInvoiceNo: invoiceNo,
      paymentType: dto.paymentType === 'cash' ? 'cash' : 'credit',
      branchId, locationId, items, taxRate: 0, pricesIncludeTax: false,
      note: `Imported pharmacy distributor invoice ${distributor} / ${invoiceNo}`,
    }, auth, `pharmacy:${supplierId}:${invoiceNo}`);
    const purchaseId = Number(recorded.purchaseId);
    if (!Number.isSafeInteger(purchaseId) || purchaseId <= 0) {
      throw new AppError('Purchase creation did not return a valid source document',
        'PHARMACY_PURCHASE_RECOVERY_REQUIRED', 422);
    }
    return {
      success: true, distributor, invoiceNumber: invoiceNo, purchaseId,
      importedLinesCount: items.length, totalQuantity,
      totalCostSum: fromMinorUnits(totalCostMinor, moneyDigits), totalPublicSum,
      message: 'Distributor invoice was posted through canonical purchasing, supplier, inventory and GL',
    };
  }
}
