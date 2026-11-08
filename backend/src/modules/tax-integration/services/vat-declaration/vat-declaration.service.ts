import { nextAccountingDay } from '../../../accounting/engines/accounting-date.engine';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../../common/errors/app-error';
import { Kysely, sql } from '../../../../database/kysely';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { KYSELY_DB } from '../../../../database/database.constants';
import { Database } from '../../../../database/database.types';
import { selectConfiguredTaxRow } from '../../engines/configured-tax-id.engine';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../../../accounting/engines/money-minor-units.engine';

export interface VatDeclarationQueryDto {
  from?: string;
  to?: string;
  country?: 'EG' | 'SA';
}

/**
 * INV-VAT-DECLARATION-TENANT-JURISDICTION: a declaration follows the
 * tenant's own configured jurisdiction, never a caller-supplied
 * country. Precedence mirrors the HR statutory inference (an explicit
 * country setting wins, the base currency maps second), but unlike
 * that inference this derivation FAILS CLOSED instead of defaulting:
 * an unresolved jurisdiction, or a supported-currency tenant outside
 * EG/SA (no declaration form exists for KW/QA/OM), is a 409, not a
 * silently Egyptian declaration.
 */
export function deriveDeclarationCountry(
  countrySetting: string | null | undefined,
  currencySetting: string | null | undefined,
): 'EG' | 'SA' {
  const country = String(countrySetting || '').trim().toUpperCase();
  if (country === 'EG' || country === 'SA') return country;
  if (country === 'KW' || country === 'QA' || country === 'OM') {
    throw new AppError('لا يوجد نموذج إقرار ضريبي مدعوم لهذه الدولة', 'VAT_DECLARATION_COUNTRY_UNSUPPORTED', 409);
  }
  const currency = String(currencySetting || '').trim().toUpperCase();
  if (currency === 'EGP') return 'EG';
  if (currency === 'SAR') return 'SA';
  if (currency === 'KWD' || currency === 'QAR' || currency === 'OMR') {
    throw new AppError('لا يوجد نموذج إقرار ضريبي مدعوم لهذه الدولة', 'VAT_DECLARATION_COUNTRY_UNSUPPORTED', 409);
  }
  throw new AppError('لم يتم تحديد بلد المنشأة أو عملتها، لا يمكن إصدار الإقرار', 'VAT_DECLARATION_COUNTRY_UNRESOLVED', 409);
}

const DECLARATION_TAX_PROVIDER: Record<'EG' | 'SA', string> = {
  EG: 'ETA_EGYPT',
  SA: 'ZATCA',
};

@Injectable()
export class VatDeclarationService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  private tenantScope(auth: AuthContext) {
    return requireTenantScope(auth);
  }

  private tenantPredicate(auth: AuthContext, tableAlias?: string) {
    const scope = this.tenantScope(auth);
    return tableAlias
      ? sql<boolean>`${sql.ref(`${tableAlias}.tenant_id`)} = ${scope.tenantId}`
      : sql<boolean>`tenant_id = ${scope.tenantId}`;
  }

  private roundCurrency(value: number, digits: MoneyDigits): number {
    const n = Number(value) || 0;
    return Number.isFinite(n) ? roundMoney(n, digits) : 0;
  }

  private async returnTaxTotals(auth: AuthContext, type: 'sale' | 'purchase', from: Date, to: Date) {
    const tenantId = requireTenantScope(auth).tenantId;
    const result = await sql<{ total: number; tax: number; missing: number }>`
      select coalesce(sum(d.total), 0) as total, coalesce(sum(i.tax), 0) as tax,
             count(*) filter (where i.item_count = 0 or i.missing > 0)::int as missing
      from return_documents d
      left join lateral (
        select count(*) as item_count, count(*) filter (where allocated_tax is null) as missing,
               coalesce(sum(allocated_tax), 0) as tax
        from return_items where tenant_id = ${tenantId} and return_document_id = d.id
      ) i on true
      where d.tenant_id = ${tenantId} and d.return_type = ${type} and d.created_at >= ${from} and d.created_at < ${to}
    `.execute(this.db);
    if (Number(result.rows[0]?.missing || 0)) throw new BadRequestException('توجد مرتجعات قديمة بدون ضريبة سطر مثبتة؛ يلزم مطابقتها قبل إصدار الإقرار.');
    return result.rows[0] || { total: 0, tax: 0, missing: 0 };
  }

  async getDeclaration(query: VatDeclarationQueryDto, auth: AuthContext) {
    const now = new Date();
    const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    const fromDate = query.from ? new Date(query.from) : defaultFrom;
    const toDate = query.to ? nextAccountingDay(query.to) : defaultTo;
    if (!Number.isFinite(fromDate.getTime()) || toDate <= fromDate) throw new BadRequestException('فترة الإقرار غير صالحة.');
    // The caller's country is deliberately ignored: the declaration
    // follows the tenant's configured jurisdiction (see
    // deriveDeclarationCountry). A request for another country's form
    // is not an option the API offers.
    const scope = this.tenantScope(auth);
    const jurisdictionSettings = await this.db
      .selectFrom('settings')
      .select(['key', 'value'])
      .where('tenant_id', '=', scope.tenantId)
      .where('key', 'in', ['country', 'currency'])
      .execute();
    const settingByKey = new Map(jurisdictionSettings.map((row) => [row.key, row.value]));
    const country = deriveDeclarationCountry(settingByKey.get('country'), settingByKey.get('currency'));
    const standardRate = country === 'SA' ? 15 : 14;
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));

    // 1. Sales query
    const salesStats = await this.db
      .selectFrom('sales')
      .select([
        sql<number>`COALESCE(COUNT(*), 0)`.as('invoices_count'),
        sql<number>`COALESCE(SUM(subtotal - discount + coalesce(service_charge, 0)), 0)`.as('net_sales'),
        sql<number>`COALESCE(SUM(tax_amount), 0)`.as('total_tax'),
        sql<number>`COALESCE(SUM(total), 0)`.as('gross_sales'),
        sql<number>`COALESCE(SUM(
          CASE
            WHEN tax_rate > 0 AND prices_include_tax = TRUE THEN ((subtotal - discount + coalesce(service_charge, 0)) - tax_amount)
            WHEN tax_rate > 0 THEN (subtotal - discount + coalesce(service_charge, 0))
            ELSE 0
          END
        ), 0)`.as('standard_rated_base'),
        sql<number>`COALESCE(SUM(CASE WHEN tax_rate > 0 THEN tax_amount ELSE 0 END), 0)`.as('standard_rated_tax'),
        sql<number>`COALESCE(SUM(CASE WHEN tax_rate = 0 THEN (subtotal - discount + coalesce(service_charge, 0)) ELSE 0 END), 0)`.as('zero_rated_base'),
      ])
      .where(this.tenantPredicate(auth))
      .where('created_at', '>=', fromDate)
      .where('created_at', '<', toDate)
      .where('status', '=', 'posted')
      .executeTakeFirst();

    const salesReturns = await this.returnTaxTotals(auth, 'sale', fromDate, toDate);

    // 3. Purchases query
    const purchaseStats = await this.db
      .selectFrom('purchases')
      .select([
        sql<number>`COALESCE(COUNT(*), 0)`.as('bills_count'),
        sql<number>`COALESCE(SUM(subtotal - discount), 0)`.as('net_purchases'),
        sql<number>`COALESCE(SUM(tax_amount), 0)`.as('total_tax'),
        sql<number>`COALESCE(SUM(total), 0)`.as('gross_purchases'),
        sql<number>`COALESCE(SUM(
          CASE
            WHEN tax_rate > 0 AND prices_include_tax = TRUE THEN ((subtotal - discount) - tax_amount)
            WHEN tax_rate > 0 THEN (subtotal - discount)
            ELSE 0
          END
        ), 0)`.as('standard_rated_base'),
        sql<number>`COALESCE(SUM(CASE WHEN tax_rate > 0 THEN tax_amount ELSE 0 END), 0)`.as('standard_rated_tax'),
        sql<number>`COALESCE(SUM(CASE WHEN tax_rate = 0 THEN (subtotal - discount) ELSE 0 END), 0)`.as('zero_rated_base'),
      ])
      .where(this.tenantPredicate(auth))
      .where('created_at', '>=', fromDate)
      .where('created_at', '<', toDate)
      .where('status', '=', 'posted')
      .executeTakeFirst();

    const purchaseReturns = await this.returnTaxTotals(auth, 'purchase', fromDate, toDate);
    const salesReturnsTax = this.roundCurrency(Number(salesReturns.tax), bookDigits);
    const salesReturnsBase = this.roundCurrency(Number(salesReturns.total) - salesReturnsTax, bookDigits);
    const purchaseReturnsTax = this.roundCurrency(Number(purchaseReturns.tax), bookDigits);
    const purchaseReturnsBase = this.roundCurrency(Number(purchaseReturns.total) - purchaseReturnsTax, bookDigits);

    const salesStandardBase = this.roundCurrency(Number(salesStats?.standard_rated_base || 0), bookDigits);
    const salesStandardTax = this.roundCurrency(Number(salesStats?.standard_rated_tax || 0), bookDigits);
    const salesZeroBase = this.roundCurrency(Number(salesStats?.zero_rated_base || 0), bookDigits);

    const purchasesStandardBase = this.roundCurrency(Number(purchaseStats?.standard_rated_base || 0), bookDigits);
    const purchasesStandardTax = this.roundCurrency(Number(purchaseStats?.standard_rated_tax || 0), bookDigits);
    const purchasesZeroBase = this.roundCurrency(Number(purchaseStats?.zero_rated_base || 0), bookDigits);

    const totalOutputVat = this.roundCurrency(salesStandardTax - salesReturnsTax, bookDigits);
    const totalInputVat = this.roundCurrency(purchasesStandardTax - purchaseReturnsTax, bookDigits);
    const netVatDue = this.roundCurrency(totalOutputVat - totalInputVat, bookDigits);

    // Tenant info
    const tenant = await this.db
      .selectFrom('tenants')
      .select(['business_name', 'owner_name', 'owner_phone'])
      .where('id', '=', scope.tenantId)
      .executeTakeFirst();

    // A tax declaration must carry the tenant's own registered tax
    // number. There is no placeholder: a missing registration fails
    // closed instead of printing a fabricated number on the form.
    // The row matching this declaration's jurisdiction wins; any
    // other active row with a registered number is the fallback.
    const taxSettingsRows = await this.db
      .selectFrom('tenant_tax_settings')
      .select(['tax_id', 'provider'])
      .where('tenant_id', '=', scope.tenantId)
      .where('is_active', '=', true)
      .execute();
    const expectedProvider = DECLARATION_TAX_PROVIDER[country];
    // INV-CONFIGURED-TAX-ID-SINGLE-SOURCE: row selection is the
    // shared pure rule; only the fail-closed error stays local.
    const selected = selectConfiguredTaxRow(taxSettingsRows, {
      provider: expectedProvider,
      allowFallback: true,
    });
    const taxId = selected?.taxId ?? '';
    if (!taxId) {
      throw new AppError('لم يتم تسجيل رقم ضريبي لهذه المنشأة، لا يمكن إصدار الإقرار', 'VAT_DECLARATION_TAX_ID_MISSING', 409);
    }

    return {
      period: {
        from: fromDate.toISOString().split('T')[0],
        to: new Date(toDate.getTime() - 86_400_000).toISOString().split('T')[0],
        country,
        standard_rate_percent: standardRate,
      },
      entity: {
        business_name: tenant?.business_name || 'شركة تجارية',
        tax_id: taxId,
        owner_name: tenant?.owner_name || '',
      },
      output_tax: {
        standard_rated_base: salesStandardBase,
        standard_rated_tax: salesStandardTax,
        zero_rated_base: salesZeroBase,
        exempt_base: 0,
        returns_base: salesReturnsBase,
        returns_tax: salesReturnsTax,
        invoices_count: Number(salesStats?.invoices_count || 0),
        total_sales_base: this.roundCurrency(salesStandardBase + salesZeroBase - salesReturnsBase, bookDigits),
        total_output_vat: Math.max(0, totalOutputVat),
      },
      input_tax: {
        standard_rated_base: purchasesStandardBase,
        standard_rated_tax: purchasesStandardTax,
        zero_rated_base: purchasesZeroBase,
        exempt_base: 0,
        returns_base: purchaseReturnsBase,
        returns_tax: purchaseReturnsTax,
        bills_count: Number(purchaseStats?.bills_count || 0),
        total_purchases_base: this.roundCurrency(purchasesStandardBase + purchasesZeroBase - purchaseReturnsBase, bookDigits),
        total_input_vat: Math.max(0, totalInputVat),
      },
      summary: {
        gross_output_vat: totalOutputVat,
        deductible_input_vat: totalInputVat,
        net_vat_due: netVatDue,
        status: netVatDue >= 0 ? 'payable' : 'refundable',
        currency: country === 'SA' ? 'SAR' : 'EGP',
      },
      egypt_form_10: {
        sales_general_rate_base: salesStandardBase,
        sales_general_rate_tax: salesStandardTax,
        sales_exports_base: salesZeroBase,
        sales_exempt_base: 0,
        sales_credit_notes_tax: salesReturnsTax,
        total_output_tax: Math.max(0, totalOutputVat),
        purchases_general_rate_base: purchasesStandardBase,
        purchases_general_rate_tax: purchasesStandardTax,
        purchases_debit_notes_tax: purchaseReturnsTax,
        total_input_tax: Math.max(0, totalInputVat),
        net_tax_payable: netVatDue >= 0 ? netVatDue : 0,
        net_tax_credit: netVatDue < 0 ? Math.abs(netVatDue) : 0,
      },
      zatca_return: {
        standard_rated_supplies_amount: salesStandardBase,
        standard_rated_supplies_tax: salesStandardTax,
        zero_rated_supplies_amount: salesZeroBase,
        exempt_supplies_amount: 0,
        sales_adjustments_tax: -salesReturnsTax,
        total_sales_tax: Math.max(0, totalOutputVat),
        standard_rated_purchases_amount: purchasesStandardBase,
        standard_rated_purchases_tax: purchasesStandardTax,
        imports_amount: 0,
        purchases_adjustments_tax: -purchaseReturnsTax,
        total_purchases_tax: Math.max(0, totalInputVat),
        net_vat_due: netVatDue,
      },
    };
  }
}
