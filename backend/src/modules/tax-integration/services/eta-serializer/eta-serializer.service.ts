import { Injectable, Inject } from '@nestjs/common';
import { KYSELY_DB } from '../../../../database/database.constants';
import { Kysely } from 'kysely';
import { Database } from '../../../../database/database.types';
import { TaxSettingsService } from '../tax-settings/tax-settings.service';
import { buildDocumentTax } from '../../engines/document-tax.engine';
import { selectConfiguredTaxRow } from '../../engines/configured-tax-id.engine';
import { roundMoney } from '../../../accounting/engines/money-minor-units.engine';

@Injectable()
export class EtaSerializerService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly taxSettings: TaxSettingsService,
  ) {}

  async serializeSaleToEtaFormat(tenantId: string, saleId: number): Promise<any> {
    // INV-CONFIGURED-TAX-ID-SINGLE-SOURCE: the ETA row is picked by
    // the shared selector (exact provider, no fallback). A matched
    // row with a blank number keeps the legacy '100000'/'000000000'
    // fallbacks below, exactly as before.
    const configuredTaxRows = await this.db
      .selectFrom('tenant_tax_settings')
      .select(['provider', 'tax_id', 'is_active'])
      .where('tenant_id', '=', tenantId)
      .execute();
    const configuredTax = selectConfiguredTaxRow(configuredTaxRows, {
      provider: 'ETA_EGYPT',
      allowFallback: false,
    });
    if (!configuredTax) throw new Error('ETA Settings not configured');
    const settings = { tax_id: configuredTax.taxId };

    const sale = await this.db
      .selectFrom('sales')
      .selectAll()
      .where('id', '=', saleId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirstOrThrow();

    const items = await this.db.selectFrom('sale_items').selectAll().where('sale_id', '=', saleId).execute();

    const customer = sale.customer_id
      ? await this.db
          .selectFrom('customers')
          .selectAll()
          .where('id', '=', Number(sale.customer_id))
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst()
      : null;

    const isBusinessCustomer = Boolean(customer?.tax_number);

    // Unified document-tax engine (tax unification, package 2): the ETA
    // document attests the POSTED invoice — per-line stored allocations
    // at document precision — never a recomputation at a hardcoded 14%.
    // The stored sale.tax_rate is the document rate; the posting gate
    // (Tax F1) owns whether that rate was lawful, not the serializer.
    const documentTax = buildDocumentTax({
      rate: sale.tax_rate,
      pricesIncludeTax: Boolean(sale.prices_include_tax),
      documentDigits: 2,
      lines: items.map((item) => ({
        lineTotal: Number(item.line_total || Math.max(1, Number(item.qty || 1)) * Number(item.unit_price || 0)),
        netLineTotal: item.net_line_total == null ? null : Number(item.net_line_total),
        allocatedDiscount: item.allocated_discount == null ? null : Number(item.allocated_discount),
        allocatedTax: item.allocated_tax == null ? null : Number(item.allocated_tax),
      })),
    });

    const invoiceLines = items.map((item, index) => {
      const qty = Math.max(1, Number(item.qty || 1));
      const unitPrice = Number(item.unit_price || 0);
      const lineTotal = Number(item.line_total || qty * unitPrice);
      const taxed = documentTax.lines[index];

      return {
        description: item.product_name || `Item ${index + 1}`,
        itemType: 'EGS',
        itemCode: 'EG-' + (settings.tax_id || '100000') + '-' + (item.product_id || index + 1),
        unitType: 'EA',
        quantity: qty,
        internalCode: String(item.product_id || index + 1),
        salesTotal: lineTotal,
        total: taxed.total,
        valueDifference: 0,
        totalTaxableFees: 0,
        netTotal: taxed.base,
        itemsDiscount: roundMoney(Number(item.allocated_discount ?? 0), 2),
        unitValue: {
          currencySold: 'EGP',
          amountEGP: unitPrice,
          currencyExchangeRate: 1,
        },
        discount: { rate: 0, amount: 0 },
        taxableItems: [
          {
            taxType: 'T1',
            amount: taxed.tax,
            subType: 'V009',
            rate: taxed.rate,
          },
        ],
      };
    });

    const netAmount = documentTax.subtotal;
    const totalTax = documentTax.vatTotal;
    const totalAmount = documentTax.totalWithVat;

    const etaDocument = {
      issuer: {
        address: {
          branchID: '0',
          country: 'EG',
          governate: 'Cairo',
          regionCity: 'Cairo',
          street: 'Main Street',
          buildingNumber: '1',
        },
        type: 'B',
        id: String(settings.tax_id || '000000000'),
        name: 'Z-Systems Tenant Business',
      },
      receiver: {
        address: {
          country: 'EG',
          governate: 'Cairo',
          regionCity: 'Cairo',
          street: customer?.address || 'Local Street',
          buildingNumber: '1',
        },
        type: isBusinessCustomer ? 'B' : 'P',
        id: isBusinessCustomer ? String(customer?.tax_number) : customer?.phone || '',
        name: sale.customer_name || customer?.name || 'عميل نقدي',
      },
      documentType: 'I',
      documentTypeVersion: '1.0',
      dateTimeIssued: new Date(sale.created_at || Date.now()).toISOString(),
      taxpayerActivityCode: '4620',
      internalID: sale.doc_no || String(sale.id),
      purchaseOrderReference: '',
      purchaseOrderDescription: '',
      salesOrderReference: '',
      salesOrderDescription: '',
      proformaInvoiceNumber: '',
      payment: {
        bankName: '',
        bankAddress: '',
        bankAccountNo: '',
        bankAccountIBAN: '',
        swiftCode: '',
        terms: '',
      },
      delivery: {
        approach: '',
        packaging: '',
        dateValidity: '',
        exportPort: '',
        grossWeight: 0,
        netWeight: 0,
        terms: '',
      },
      invoiceLines,
      totalDiscountAmount: Number(sale.discount || 0),
      totalSalesAmount: netAmount,
      netAmount: netAmount,
      taxTotals: [
        {
          taxType: 'T1',
          amount: Number(totalTax.toFixed(2)),
        },
      ],
      totalAmount: totalAmount,
      extraDiscountAmount: 0,
      totalItemsDiscountAmount: 0,
    };

    return etaDocument;
  }
}
