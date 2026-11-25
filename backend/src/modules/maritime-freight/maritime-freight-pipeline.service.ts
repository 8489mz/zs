import { Injectable, Logger } from '@nestjs/common';
import { sql, type Kysely } from '../../database/kysely';
import { type Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { type CreateMaritimeQuotationDto } from './dto/create-quotation.dto';
import { MaritimePipelineConfig, DEFAULT_PIPELINE_CONFIG } from './maritime-freight.types';
import { type WhatsAppGatewayService } from '../settings/services/whatsapp-gateway.service';

/**
 * MaritimeFreightPipelineService — slice S10 of the maritime-freight split.
 * Pure move of 4 methods from MaritimeFreightService (Maritime Automation
 * Pipeline & Checkpoints Engine). No behavior change: the bodies are
 * byte-identical; the facade keeps thin delegates with the same names
 * and signatures. Deps are db + the REQUIRED whatsAppGatewayService +
 * the 3 BOUND CROSS-SLICE deps (S2 awardBid, S3 createQuotation +
 * resolveAutoQuoteExchangeRate) + the slice's own Logger (S10 is one of
 * the 6 logger slices); no mail/posting/kernel. On the generation tree
 * the facade binds its OWN methods (this.awardBid.bind(this) etc.) —
 * the S2/S3 slice instances do not exist yet; MERGE-OWNED REPOINT: when
 * S2/S3 land (they merge before S10), repoint the binds to
 * this.rfqBidsService.awardBid.bind(this.rfqBidsService) /
 * this.quotationsService.createQuotation.bind(this.quotationsService) /
 * this.quotationsService.resolveAutoQuoteExchangeRate.bind(
 * this.quotationsService). Functionally identical either way (the facade
 * methods become thin delegates after S2/S3 merge). No visibility change
 * — all 4 methods are public; getTenantPipelineConfig is called
 * cross-slice by S11 createRfq and stays public. processAutomated-
 * PipelineForTenant + getTenantPipelineConfig + savePipelineSettings are
 * PINNED (maritime-autoquote-shared-resolver drives them) — no spec
 * repoint travels in this patch, merge-owned. TRAP: processAutomated-
 * PipelineForTenant is the LAST method in S10, so the autoquote pin's
 * slice-to-next-async repoint must fall back to EOF. Clock travels
 * verbatim: 1 bare new Date() + 1 with-args new Date() (both in
 * processAutomatedPipelineForTenant) — pure moves, no UTC-slice
 * normalizer, no instant comparison. Guard: no tx, no posting, no money
 * helpers in the moved text — no PGlite hang shape in S10. The Pipeline
 * banner travels byte-identical into the slice (file #8 S9 precedent);
 * the Rate Management banner stays in the facade (it precedes
 * mapRateCardRow, S4).
 */

export interface MaritimeFreightPipelineDeps {
  db: Kysely<Database>;
  whatsAppGatewayService: WhatsAppGatewayService;
  // Bound cross-slice deps (same names as the facade members, so the
  // moved bodies are byte-identical). awardBid lives in S2, createQuotation
  // + resolveAutoQuoteExchangeRate live in S3; the facade binds them.
  awardBid: (auth: AuthContext, bidId: string) => Promise<any>;
  createQuotation: (auth: AuthContext, dto: CreateMaritimeQuotationDto) => Promise<any>;
  resolveAutoQuoteExchangeRate: (tenantId: string, bidCurrency: string) => Promise<number>;
}

@Injectable()
export class MaritimeFreightPipelineService {
  private readonly db: Kysely<Database>;
  private readonly whatsAppGatewayService: WhatsAppGatewayService;
  private readonly awardBid: (auth: AuthContext, bidId: string) => Promise<any>;
  private readonly createQuotation: (auth: AuthContext, dto: CreateMaritimeQuotationDto) => Promise<any>;
  private readonly resolveAutoQuoteExchangeRate: (tenantId: string, bidCurrency: string) => Promise<number>;
  private readonly logger = new Logger(MaritimeFreightPipelineService.name);

  constructor(deps: MaritimeFreightPipelineDeps) {
    this.db = deps.db;
    this.whatsAppGatewayService = deps.whatsAppGatewayService;
    this.awardBid = deps.awardBid;
    this.createQuotation = deps.createQuotation;
    this.resolveAutoQuoteExchangeRate = deps.resolveAutoQuoteExchangeRate;
  }

  // --------------------------------------------------------------------------
  // 11. Maritime Automation Pipeline & Checkpoints Engine
  // --------------------------------------------------------------------------
  async getTenantPipelineConfig(tenantId: string): Promise<MaritimePipelineConfig> {
    const row = await this.db
      .selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', 'maritime_pipeline_config')
      .executeTakeFirst();

    if (!row?.value) {
      return { ...DEFAULT_PIPELINE_CONFIG };
    }

    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      // A stored config may still carry the removed defaultExchangeRate
      // key (auto-quotes used to read a hardcoded 48.5 from it); the
      // key is dropped here so it can never resurface as a rate.
      const { defaultExchangeRate: _legacyDefaultExchangeRate, ...rest } = parsed || {};
      return { ...DEFAULT_PIPELINE_CONFIG, ...rest };
    } catch {
      return { ...DEFAULT_PIPELINE_CONFIG };
    }
  }

  async getPipelineSettings(auth: AuthContext): Promise<MaritimePipelineConfig> {
    const { tenantId } = requireTenantScope(auth);
    return this.getTenantPipelineConfig(tenantId);
  }

  async savePipelineSettings(auth: AuthContext, dto: Partial<MaritimePipelineConfig>): Promise<MaritimePipelineConfig> {
    const { tenantId } = requireTenantScope(auth);
    const current = await this.getTenantPipelineConfig(tenantId);
    const updated: MaritimePipelineConfig = { ...current, ...dto };
    // Never persist the removed defaultExchangeRate key again, even
    // if an old client still sends it: auto-quotes resolve the live
    // rate through the shared resolver, never a stored default.
    delete (updated as any).defaultExchangeRate;

    const existing = await this.db
      .selectFrom('settings')
      .select('key')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', 'maritime_pipeline_config')
      .executeTakeFirst();

    if (existing) {
      await this.db
        .updateTable('settings')
        .set({ value: JSON.stringify(updated) })
        .where('tenant_id', '=', tenantId)
        .where('key', '=', 'maritime_pipeline_config')
        .execute();
    } else {
      await this.db
        .insertInto('settings')
        .values({
          tenant_id: tenantId,
          key: 'maritime_pipeline_config',
          value: JSON.stringify(updated),
        })
        .execute();
    }

    return updated;
  }

  async processAutomatedPipelineForTenant(auth: AuthContext): Promise<{
    processedRfqs: number;
    awardedCount: number;
    quotesGenerated: number;
    details: string[];
  }> {
    const { tenantId } = requireTenantScope(auth);
    const config = await this.getTenantPipelineConfig(tenantId);

    if (config.automationMode === 'manual') {
      return {
        processedRfqs: 0,
        awardedCount: 0,
        quotesGenerated: 0,
        details: ['الوضع التشغيلي مضبوط على يدوي بالكامل'],
      };
    }

    const openRfqs = await this.db
      .selectFrom('maritime_rfqs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['sent', 'bids_received'])
      .where('auto_awarded', '=', false)
      .execute();

    if (openRfqs.length === 0) {
      return { processedRfqs: 0, awardedCount: 0, quotesGenerated: 0, details: [] };
    }

    const currencySetting = await this.db
      .selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', 'currency')
      .executeTakeFirst();
    let systemCurrency = 'EGP';
    if (currencySetting) {
      try {
        systemCurrency = String(JSON.parse(currencySetting.value));
      } catch {
        systemCurrency = String(currencySetting.value);
      }
    }
    systemCurrency = systemCurrency.trim().toUpperCase();

    let awardedCount = 0;
    let quotesGenerated = 0;
    const details: string[] = [];
    const now = new Date();

    for (const rfq of openRfqs) {
      const bids = await this.db
        .selectFrom('maritime_rfq_bids')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('rfq_id', '=', String(rfq.id))
        .execute();

      if (bids.length === 0) continue;

      const bidCurrencies = new Set(bids.map((b) => String(b.currency).toUpperCase()));
      const bidCurrency = String(bids[0].currency).toUpperCase();
      if (bidCurrencies.size !== 1 || (bidCurrency !== systemCurrency && bidCurrency !== 'USD')) {
        details.push(`طلب ${rfq.rfq_number}: يلزم مراجعة عملات العروض وسعر الصرف قبل الترسية`);
        continue;
      }

      const isDeadlineReached = rfq.cut_off_deadline ? now >= new Date(rfq.cut_off_deadline) : false;
      const minFreeDays = config.earlyAwardingMinFreeDays || 14;
      const targetRate = rfq.target_rate_max ? Number(rfq.target_rate_max) : null;

      const earlyBid = config.earlyAwardingEnabled
        ? bids.find(
            (b) =>
              Number(b.free_days) >= minFreeDays && (targetRate ? Number(b.total_freight_cost) <= targetRate : false),
          )
        : null;

      if (!isDeadlineReached && !earlyBid) {
        // Still within bidding window and no early trigger satisfied
        continue;
      }

      // If checkpoint 2 (requireManualAwardAndMargin) is enabled, do NOT auto-award; just notify/update status
      if (config.requireManualAwardAndMargin) {
        if (rfq.status !== 'bids_received') {
          await this.db
            .updateTable('maritime_rfqs')
            .set({ status: 'bids_received', updated_at: sql`NOW()` })
            .where('tenant_id', '=', tenantId)
            .where('id', '=', rfq.id)
            .execute();
        }
        details.push(
          `طلب ${rfq.rfq_number}: العروض مكتملة، بانتظار الاعتماد والمراجعة البشرية للهامش (محطة توقف مفعلة)`,
        );
        continue;
      }

      // Pick best bid: Early bid if triggered, or lowest total freight cost
      const sortedBids = [...bids].sort((a, b) => {
        const costDiff = Number(a.total_freight_cost || 0) - Number(b.total_freight_cost || 0);
        if (costDiff !== 0) return costDiff;
        return Number(b.free_days || 0) - Number(a.free_days || 0);
      });
      const bestBid = earlyBid || sortedBids[0];
      if (!bestBid) continue;

      // The quote's exchange rate is resolved BEFORE any award or
      // quote write, through the shared resolver. A missing rate
      // skips this RFQ only, with a recorded reason -- it never
      // aborts the remaining RFQs and never falls back to a
      // hardcoded rate.
      let exchangeRate: number;
      try {
        exchangeRate = await this.resolveAutoQuoteExchangeRate(tenantId, bidCurrency);
      } catch {
        details.push(
          `طلب ${rfq.rfq_number}: لا يوجد سعر صرف مسجل لعملة العرض (${bidCurrency})؛ لم يصدر عرض آلي، سجّل السعر ثم أعد التشغيل`,
        );
        continue;
      }

      try {
        // 1. Award bid
        await this.awardBid(auth, String(bestBid.id));
        await this.db
          .updateTable('maritime_rfqs')
          .set({ auto_awarded: true, updated_at: sql`NOW()` })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', rfq.id)
          .execute();
        awardedCount++;

        // 2. Compute margin
        const baseCost = Number(bestBid.total_freight_cost || 0);
        let profit = 0;
        if (config.defaultMarginType === 'percentage') {
          profit = baseCost * (config.defaultMarginValue / 100);
        } else {
          profit = Number(config.defaultMarginValue ?? 200);
        }
        const marginFloor = Number(config.marginFloor ?? 150);
        if (profit < marginFloor) {
          profit = marginFloor;
        }
        const marginType =
          config.defaultMarginType === 'percentage' &&
          baseCost > 0 &&
          profit === baseCost * (config.defaultMarginValue / 100)
            ? 'percentage'
            : 'fixed';

        // 3. Issue quotation
        const quote = await this.createQuotation(auth, {
          rfqId: String(rfq.id),
          bidId: String(bestBid.id),
          customerId: rfq.customer_id ? Number(rfq.customer_id) : undefined,
          customerName: rfq.customer_name || 'عميل الشحنة',
          customerPhone: rfq.customer_phone || undefined,
          customerEmail: rfq.customer_email || undefined,
          paymentTerm: rfq.payment_term || 'prepaid',
          baseCost,
          currency: bestBid.currency || 'USD',
          marginType,
          marginValue: marginType === 'percentage' ? config.defaultMarginValue : profit,
          exchangeRate,
          notes: `عرض صادر آلياً وفقاً لمسار الأتمتة (${config.automationMode === 'full_autonomous' ? 'أتمتة كاملة' : 'هجين ذكي'}). العرض الفائز من ${bestBid.shipping_line_name}`,
        });
        quotesGenerated++;

        // 4. Quote dispatch checkpoint
        if (!config.requireManualQuoteDispatch) {
          await this.db
            .updateTable('maritime_quotations')
            .set({ status: 'sent' })
            .where('tenant_id', '=', tenantId)
            .where('id', '=', quote.id as any)
            .execute();

          if (config.autoSendWhatsAppQuote && rfq.customer_phone) {
            try {
              const cleanPhone = rfq.customer_phone.replace(/[^0-9]/g, '');
              const totalClient = baseCost + profit;
              const msg =
                `مرحباً ${rfq.customer_name || 'عميلنا العزيز'}، يسعدنا تقديم عرض سعر الشحن البحري:\n` +
                `• مسار: من ${rfq.pol_name} إلى ${rfq.pod_name}\n` +
                `• الحاويات: ${rfq.container_count}x ${rfq.container_type}\n` +
                `• الخط الملاحي: ${bestBid.shipping_line_name}\n` +
                `• فترة السماح بالميناء: ${bestBid.free_days} يوم\n` +
                `• السعر الإجمالي: $${totalClient.toLocaleString()} USD\n` +
                `• رقم العرض المرجعي: ${quote.quotation_number}`;
              await this.whatsAppGatewayService.sendRawMessage(tenantId, cleanPhone, msg);
            } catch (err: any) {
              this.logger.warn(`Failed auto WhatsApp quote dispatch for RFQ [${rfq.rfq_number}]: ${err?.message}`);
            }
          }
        }

        details.push(
          `طلب ${rfq.rfq_number}: تمت الترسية آلياً على خط ${bestBid.shipping_line_name} بسعر ${baseCost}$ مع هامش ربح ${profit}$ وإصدار عرض ${quote.quotation_number}`,
        );
      } catch (err: any) {
        this.logger.error(`Error in automated RFQ pipeline for RFQ [${rfq.rfq_number}]: ${err?.message}`);
      }
    }

    return {
      processedRfqs: openRfqs.length,
      awardedCount,
      quotesGenerated,
      details,
    };
  }
}
