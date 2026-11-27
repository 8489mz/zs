import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { convertFxAmount } from '../accounting/engines/fx-conversion.engine';
import { resolveSaleTaxRate } from '../sales/engines/sale-tax-rate.engine';
import { currencyMoneyDigits } from '../accounting/engines/money-minor-units.engine';
import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { CreateMaritimeQuotationDto } from './dto/create-quotation.dto';
import { calculateAirChargeableWeight } from './engines/air-freight.engine';
import * as crypto from 'crypto';
import { formatDailyDocumentNumber } from '../../common/utils/document-number.util';
import { getTenantTimezone } from '../../common/utils/tenant-timezone.util';

/**
 * MaritimeFreightQuotationsService — slice S3 of the maritime-freight split.
 * Pure move of 5 methods from MaritimeFreightService (client quotations:
 * the tenant tax-rate resolver, the auto-quote FX resolver, quotation
 * creation + reads + status). No behavior change: the bodies are
 * byte-identical; the facade keeps thin delegates with the same names
 * and signatures. Deps are kernel only (db + the bound kernel helper
 * resolveFreightExchangeRate); no cross-slice deps, no mail/WhatsApp/
 * posting. The section banner "5. Client Quotations Engine" travels
 * with createQuotation (prep §2, file #8 S9 precedent). Date handling
 * travels verbatim: createQuotation carries new Date() for the final
 * document number (tenant-tz via getTenantTimezone on the tx handle)
 * + tenantBaseCurrency for the book digits; no instant comparison,
 * no UTC-slice normalizer. resolveTenantConfiguredTaxRate is public
 * here (private in the facade delegate) — S12 + S17 call it through
 * their bound slice instance (tsc TS2341); the facade delegate stays
 * private, so the facade public surface is unchanged. Its tx caller
 * (createQuotation) passes the transaction handle, never the pool.
 * createQuotation is in the PGlite-safe pinned set (RED anchor
 * candidate at merge — record it; this patch breaks nothing).
 * Driving specs: maritime-freight-tax (tax-rate counts 3x),
 * maritime-autoquote-shared-resolver (resolveAutoQuoteExchangeRate).
 * No spec repoint travels in this patch — merge-owned (FX pin
 * multi-file read + tax pin rework).
 */

export interface MaritimeFreightQuotationsDeps {
  db: Kysely<Database>;
  // Bound kernel helper (same name as the facade member, so the moved
  // bodies are byte-identical). resolveFreightExchangeRate stays in the
  // facade forever (kernel).
  resolveFreightExchangeRate: (
    tenantId: string,
    currency: string | undefined,
    suppliedRate?: number,
  ) => Promise<number>;
}

@Injectable()
export class MaritimeFreightQuotationsService {
  private readonly db: Kysely<Database>;
  private readonly resolveFreightExchangeRate: (
    tenantId: string,
    currency: string | undefined,
    suppliedRate?: number,
  ) => Promise<number>;

  constructor(deps: MaritimeFreightQuotationsDeps) {
    this.db = deps.db;
    this.resolveFreightExchangeRate = deps.resolveFreightExchangeRate;
  }

  /**
   * T2: the tenant's configured tax rate for freight charges, read
   * on the caller-supplied queryable (the transaction handle inside
   * createQuotation / createJob / updateJobCharges -- never the pool
   * handle inside an open transaction). Mirrors the sale flow's
   * `taxRate` first, legacy `tax_rate` fallback, with the same
   * JSON-parse-with-raw-fallback read as the settings rows are
   * JSON-encoded. Returns unknown: resolveSaleTaxRate coerces and
   * treats an absent / unparseable configured rate as 0, so only
   * an exempt (0) charge passes until the tenant configures a rate.
   */
  async resolveTenantConfiguredTaxRate(queryable: Kysely<Database>, tenantId: string): Promise<unknown> {
    const rows = await queryable
      .selectFrom('settings')
      .select(['key', 'value'])
      .where('tenant_id', '=', tenantId)
      .where('key', 'in', ['taxRate', 'tax_rate'])
      .execute();
    const byKey = new Map<string, unknown>();
    for (const row of rows) {
      try {
        byKey.set(row.key, JSON.parse(row.value));
      } catch {
        byKey.set(row.key, row.value);
      }
    }
    return byKey.get('taxRate') ?? byKey.get('tax_rate');
  }

  /**
   * INV-MARITIME-AUTOQUOTE-SHARED-RESOLVER: the rate an automated
   * quotation converts at. It is always the live registered rate
   * from the shared resolver -- the base currency resolves to 1,
   * and a currency with no registered rate fails closed. There is
   * deliberately no default, no fallback and no hardcoded rate:
   * the old 48.5 default priced real quotes at a rate that moved
   * to 56 while the config still said 48.5. Callers that cannot
   * afford a throw (the automated pipeline) catch it and skip
   * that RFQ with a recorded reason instead of quoting blind.
   */
  async resolveAutoQuoteExchangeRate(tenantId: string, bidCurrency: string): Promise<number> {
    return this.resolveFreightExchangeRate(tenantId, bidCurrency);
  }

  // --------------------------------------------------------------------------
  // 5. Client Quotations Engine
  // --------------------------------------------------------------------------
  async createQuotation(auth: AuthContext, dto: CreateMaritimeQuotationDto) {
    const { tenantId } = requireTenantScope(auth);

    const baseCost = Number(dto.baseCost || 0);
    const marginType = dto.marginType || 'fixed';
    const marginValue = Number(dto.marginValue || 0);
    // INV-MARITIME-QUOTATION-FX-RESOLVED: the quotation rate resolves
    // through the shared resolver, never from the client alone. A
    // supplied rate stands after validation; an omitted rate resolves
    // to the live registered rate; the base currency resolves to 1;
    // a currency with no registered rate fails closed. The old inline
    // read took the base currency from settings with a fail-open
    // 'EGP' default and trusted Number(dto.exchangeRate) unchecked,
    // so a quotation with no rate threw a bare positivity error while
    // a quotation with a stale client rate priced at that rate. The
    // automated pipeline keeps working: it passes the resolver's own
    // rate in as the supplied rate.
    const currency = (dto.currency || 'USD').trim().toUpperCase();
    const exchangeRate = await this.resolveFreightExchangeRate(tenantId, currency, dto.exchangeRate);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));

    let finalTotal = baseCost;
    if (marginType === 'percentage') {
      finalTotal = baseCost * (1 + marginValue / 100);
    } else {
      finalTotal = baseCost + marginValue;
    }
    finalTotal = Math.round(finalTotal * 10_000) / 10_000;
    // INV-MARITIME-QUOTATION-FX-CONVERSION: the local total converts
    // at the base currency's book digits through the shared engine,
    // not at a fixed 4dp cut.
    const finalTotalLocal = convertFxAmount(finalTotal, exchangeRate, digits);

    const transportMode = dto.transportMode || 'sea';
    const grossWeightKg = Number(dto.grossWeightKg || 0);
    const totalCbm = Number(dto.totalCbm || 0);
    let volumetricWeightKg = Number(dto.volumetricWeightKg || 0);
    let chargeableWeightKg = Number(dto.chargeableWeightKg || 0);

    if (transportMode === 'air' && (grossWeightKg > 0 || totalCbm > 0)) {
      const airCalc = calculateAirChargeableWeight({ grossWeightKg, cbm: totalCbm });
      volumetricWeightKg = Math.max(volumetricWeightKg, airCalc.volumetricWeightKg);
      chargeableWeightKg = Math.max(chargeableWeightKg, airCalc.chargeableWeightKg);
    }

    return await this.db.transaction().execute(async (trx) => {
      const tempNumber = `QUO-TMP-${crypto.randomUUID()}`;
      const [quote] = await trx
        .insertInto('maritime_quotations')
        .values({
          tenant_id: tenantId,
          quotation_number: tempNumber,
          inquiry_id: dto.inquiryId ? String(dto.inquiryId) : null,
          rfq_id: dto.rfqId || null,
          bid_id: dto.bidId || null,
          customer_id: dto.customerId || null,
          customer_name: dto.customerName,
          customer_phone: dto.customerPhone || null,
          customer_email: dto.customerEmail || null,
          transport_mode: transportMode,
          air_cargo_type: dto.airCargoType || null,
          gross_weight_kg: grossWeightKg,
          volumetric_weight_kg: volumetricWeightKg,
          chargeable_weight_kg: chargeableWeightKg,
          total_cbm: totalCbm,
          package_count: dto.packageCount ? Number(dto.packageCount) : 0,
          flight_number: dto.flightNumber || null,
          flight_date: dto.flightDate || null,
          mawb_number: dto.mawbNumber || null,
          hawb_number: dto.hawbNumber || null,
          payment_term: dto.paymentTerm || 'prepaid',
          base_cost: baseCost,
          currency: dto.currency || 'USD',
          margin_type: marginType,
          margin_value: marginValue,
          final_total: finalTotal,
          exchange_rate: exchangeRate,
          final_total_local: finalTotalLocal,
          valid_until: dto.validUntil || null,
          quote_roe: dto.quoteRoe ? Number(dto.quoteRoe) : exchangeRate,
          roe_clause_text: dto.roeClauseText || null,
          is_split_currency: Boolean(dto.isSplitCurrency),
          foreign_currency: dto.foreignCurrency || dto.currency || 'USD',
          foreign_currency_amount: dto.foreignCurrencyAmount ? Number(dto.foreignCurrencyAmount) : 0,
          local_currency_amount: dto.localCurrencyAmount ? Number(dto.localCurrencyAmount) : 0,
          acid_number: dto.acidNumber || null,
          status: 'draft',
          notes: dto.notes || null,
          created_by: auth.userId ? Number(auth.userId) : null,
        })
        .returningAll()
        .execute();

      const finalNumber = formatDailyDocumentNumber(
        'QUO',
        Number(quote.id),
        new Date(),
        4,
        await getTenantTimezone(trx, tenantId),
      );
      const [updatedQuote] = await trx
        .updateTable('maritime_quotations')
        .set({ quotation_number: finalNumber })
        .where('id', '=', quote.id)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .execute();

      if (dto.charges && Array.isArray(dto.charges) && dto.charges.length > 0) {
        // T2: the charge tax rate is the tenant's configured rate
        // (or 0 = exempt) through the canonical engine -- never
        // whatever the client sent. Resolved once per quotation on
        // the transaction handle; the cost basis (tot) is unchanged.
        const configuredTaxRate = await this.resolveTenantConfiguredTaxRate(trx, tenantId);
        for (const chg of dto.charges) {
          const qty = Number(chg.quantity || 1);
          const rate = Number(chg.unitRate || 0);
          const tot = Number(chg.totalAmount || qty * rate);
          const taxPct = resolveSaleTaxRate(chg.taxRatePercent, configuredTaxRate);
          const taxAmt = Number(chg.taxAmount ?? (tot * taxPct) / 100);
          await trx
            .insertInto('maritime_quotation_charges')
            .values({
              tenant_id: tenantId,
              quotation_id: String(quote.id),
              charge_code: chg.chargeCode || 'CHG',
              charge_name_ar: chg.chargeNameAr || 'رسوم نولون / خدمات',
              charge_name_en: chg.chargeNameEn || 'Freight / Logistics Charge',
              currency: chg.currency || dto.currency || 'USD',
              unit_rate: rate,
              quantity: qty,
              total_amount: tot,
              is_local_charge: Boolean(chg.isLocalCharge),
              tax_rate_percent: taxPct,
              tax_amount: taxAmt,
            })
            .execute();
        }
      }

      if (dto.inquiryId) {
        await trx
          .updateTable('maritime_inquiries')
          .set({
            status: 'quoted',
            quotation_id: String(quote.id),
            updated_at: sql`NOW()`,
          })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', dto.inquiryId)
          .execute();
      }

      return updatedQuote;
    });
  }

  async getQuotations(auth: AuthContext, filters?: { status?: string; search?: string }) {
    const { tenantId } = requireTenantScope(auth);
    let query = this.db.selectFrom('maritime_quotations').selectAll().where('tenant_id', '=', tenantId);

    if (filters?.status && filters.status !== 'all') {
      query = query.where('status', '=', filters.status as any);
    }

    if (filters?.search) {
      const term = `%${filters.search}%`;
      query = query.where((eb) =>
        eb.or([
          eb('quotation_number', 'ilike', term),
          eb('customer_name', 'ilike', term),
          eb('customer_phone', 'ilike', term),
        ]),
      );
    }

    return await query.orderBy('id', 'desc').execute();
  }

  async updateQuotationStatus(auth: AuthContext, id: string, status: 'approved' | 'rejected' | 'sent') {
    const { tenantId } = requireTenantScope(auth);
    const [updated] = await this.db
      .updateTable('maritime_quotations')
      .set({ status, updated_at: sql`NOW()` })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .returningAll()
      .execute();

    return updated;
  }
}
