/**
 * MarketplaceSyncRepricingService — slice S7 of the marketplace-sync split.
 * Pure move of 5 methods from MarketplaceSyncService (NestJS lifecycle hooks
 * + background scheduled repricing + repricing settings + the repricing bot)
 * plus the repricingTimer field. No behavior change: the bodies are
 * byte-identical; the facade keeps thin delegates with the same names and
 * signatures (runBackgroundScheduledRepricing is private with in-slice-only
 * callers, so it gets NO delegate — file #9 precedent). Deps are db + audit
 * + the bound kernel helpers getSettingJson/setSettingJson (S10 form).
 * Types come from ./marketplace-sync.types (S0).
 * Corrections to the prep (ground-proven): (1) the brief's line numbers for
 * the last three methods were wrong — the prep table spans are authoritative
 * (runBackgroundScheduledRepricing L479–506, saveRepricingSettings
 * L1792–1828, runRepricingBot L1830–1930); (2) prep §4's "no logger use" is
 * WRONG for this slice — onModuleInit logs an error and
 * runBackgroundScheduledRepricing logs a warn (this.logger x2), so the slice
 * declares its own Logger (same class as the S3 correction); (3) prep §3's
 * S7 row omits db — db IS a dep (the background job reads settings via
 * this.db.selectFrom, runRepricingBot passes this.db to tenantBaseCurrency).
 * Lifecycle: the facade keeps implementing OnModuleInit/OnModuleDestroy and
 * delegating; the 20-minute setInterval moves with onModuleInit and the
 * timer field moves to this slice. PINNED: runRepricingBot
 * (storefront-catalog-book-digits.spec.ts drives it). Clock travels
 * verbatim: runRepricingBot stamps lastRepricedAt + log timestamps with
 * new Date().toISOString(); no instant comparison, no UTC normalizer.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AuditService } from '../../../core/audit/audit.service';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import type {
  MarketplaceSkuMapping,
  RepricingBotLog,
  RepricingBotResult,
  SupportedMarketplace,
} from './marketplace-sync.types';

export interface MarketplaceSyncRepricingDeps {
  db: Kysely<Database>;
  audit: AuditService;
  // Bound kernel helpers (S10 form): the facade binds its own private
  // getSettingJson/setSettingJson so the bodies stay byte-identical.
  getSettingJson: <T>(key: string, tenantId: string, defaultValue: T, executor?: Kysely<Database>) => Promise<T>;
  setSettingJson: <T>(key: string, tenantId: string, value: T) => Promise<void>;
}

@Injectable()
export class MarketplaceSyncRepricingService {
  private readonly logger = new Logger(MarketplaceSyncRepricingService.name);
  private repricingTimer?: NodeJS.Timeout;
  private readonly db: Kysely<Database>;
  private readonly audit: AuditService;
  private readonly getSettingJson: <T>(
    key: string,
    tenantId: string,
    defaultValue: T,
    executor?: Kysely<Database>,
  ) => Promise<T>;
  private readonly setSettingJson: <T>(key: string, tenantId: string, value: T) => Promise<void>;

  constructor(deps: MarketplaceSyncRepricingDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.getSettingJson = deps.getSettingJson;
    this.setSettingJson = deps.setSettingJson;
  }

  onModuleInit() {
    // Run background scheduled repricer every 20 minutes safely
    this.repricingTimer = setInterval(
      async () => {
        try {
          await this.runBackgroundScheduledRepricing();
        } catch (err) {
          this.logger.error('Background repricing scheduler error', err);
        }
      },
      20 * 60 * 1000,
    );
  }

  onModuleDestroy() {
    if (this.repricingTimer) {
      clearInterval(this.repricingTimer);
    }
  }

  private async runBackgroundScheduledRepricing(): Promise<void> {
    try {
      const rows = await this.db
        .selectFrom('settings')
        .select(['tenant_id', 'value'])
        .where('key', '=', 'marketplace_sku_mappings')
        .execute();

      for (const row of rows) {
        if (!row.value) continue;
        try {
          const mappings = JSON.parse(String(row.value)) as MarketplaceSkuMapping[];
          const hasEnabled = mappings.some((m) => m.repricingEnabled);
          if (!hasEnabled) continue;

          await this.runRepricingBot(undefined, {
            tenantId: row.tenant_id,
            role: 'admin',
            username: 'system-repricing-bot',
          } as any);
        } catch {
          // Ignore per-tenant errors
        }
      }
    } catch (err) {
      this.logger.warn('Failed in background scheduled repricing batch: ' + (err as any)?.message);
    }
  }

  // =========================================================================
  // AUTOMATED REPRICING BOT ("روبوت إعادة التسعير الآلي")
  // =========================================================================

  async saveRepricingSettings(
    mappingId: string,
    settings: {
      repricingEnabled: boolean;
      minPrice?: number;
      maxPrice?: number;
      repricingRule?: 'match_buy_box' | 'undercut_buy_box' | 'match_lowest' | 'undercut_lowest';
      repricingDelta?: number;
    },
    auth: AuthContext,
  ): Promise<MarketplaceSkuMapping> {
    const scope = requireTenantScope(auth);
    const mappings = await this.getSettingJson<MarketplaceSkuMapping[]>('marketplace_sku_mappings', scope.tenantId, []);
    const mapping = mappings.find((m) => m.id === mappingId);
    if (!mapping) {
      throw new NotFoundException('كود ربط الصنف غير موجود');
    }

    mapping.repricingEnabled = settings.repricingEnabled;
    if (settings.minPrice != null) mapping.minPrice = Number(settings.minPrice);
    if (settings.maxPrice != null) mapping.maxPrice = Number(settings.maxPrice);
    if (settings.repricingRule) mapping.repricingRule = settings.repricingRule;
    if (settings.repricingDelta != null) mapping.repricingDelta = Number(settings.repricingDelta);

    await this.setSettingJson('marketplace_sku_mappings', scope.tenantId, mappings);
    await this.audit.log(
      'تحديث إعدادات روبوت التسعير',
      `تم تحديث إعدادات إعادة التسعير الآلي للصنف ${mapping.productName} (${mapping.marketplaceSku}) بواسطة ${auth.username}`,
      auth,
    );

    return mapping;
  }

  async runRepricingBot(marketplace?: SupportedMarketplace, auth?: AuthContext): Promise<RepricingBotResult> {
    const scope = auth ? requireTenantScope(auth) : { tenantId: 'default' };
    // D6a: repriced prices are persisted as the mapping's customPrice,
    // so the floor and the target round at the tenant's book digits
    // (3 for KWD/OMR/BHD/JOD/TND/IQD/LYD), fail-closed on a
    // base-currency/rate mismatch via tenantBaseCurrency.
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const mappings = await this.getSettingJson<MarketplaceSkuMapping[]>('marketplace_sku_mappings', scope.tenantId, []);

    const eligible = mappings.filter((m) => {
      if (!m.repricingEnabled) return false;
      if (marketplace && m.marketplace !== marketplace) return false;
      return true;
    });

    const logs: RepricingBotLog[] = [];
    let repricedCount = 0;

    for (const m of eligible) {
      const currentPrice = Number(m.customPrice ?? m.retailPrice ?? 0);
      const rule = m.repricingRule || 'undercut_buy_box';
      const delta = Number(m.repricingDelta ?? 1);

      let referencePrice: number | undefined;
      if (rule === 'match_buy_box' || rule === 'undercut_buy_box') {
        referencePrice = m.buyBoxPrice || m.competitorPrice;
      } else {
        referencePrice = m.competitorPrice || m.buyBoxPrice;
      }

      if (!referencePrice || referencePrice <= 0) {
        continue;
      }

      let targetPrice = referencePrice;
      if (rule === 'undercut_buy_box' || rule === 'undercut_lowest') {
        targetPrice = referencePrice - delta;
      }

      const calculatedFloor = m.costPrice ? roundMoney(m.costPrice * 1.05, bookDigits) : 10;
      const minPrice = m.minPrice && m.minPrice > 0 ? m.minPrice : calculatedFloor;

      let reason = `تطبيق قاعدة ${rule} بمقدار ${delta}`;
      if (targetPrice < minPrice) {
        targetPrice = minPrice;
        reason = `تم الالتزام بالحد الأدنى (${minPrice} ج.م) لحماية الهامش الربحي ومنع البيع بخسارة`;
      }

      if (m.maxPrice && m.maxPrice > 0 && targetPrice > m.maxPrice) {
        targetPrice = m.maxPrice;
        reason = `تم الالتزام بالحد الأقصى للسعر (${m.maxPrice} ج.م)`;
      }

      targetPrice = roundMoney(targetPrice, bookDigits);

      if (Math.abs(targetPrice - currentPrice) >= 0.25) {
        m.customPrice = targetPrice;
        m.lastRepricedAt = new Date().toISOString();
        m.repricingLog = reason;

        if (m.buyBoxPrice) {
          m.buyBoxStatus =
            targetPrice <= m.buyBoxPrice
              ? 'winning'
              : targetPrice - m.buyBoxPrice <= m.buyBoxPrice * 0.05
                ? 'at_risk'
                : 'losing';
        }

        logs.push({
          sku: m.marketplaceSku,
          marketplace: m.marketplace,
          productName: m.productName || m.marketplaceTitle || m.marketplaceSku,
          oldPrice: currentPrice,
          newPrice: targetPrice,
          competitorPrice: m.competitorPrice,
          buyBoxPrice: m.buyBoxPrice,
          rule,
          reason,
          timestamp: new Date().toISOString(),
        });

        repricedCount++;
      }
    }

    if (repricedCount > 0) {
      await this.setSettingJson('marketplace_sku_mappings', scope.tenantId, mappings);
      if (auth) {
        await this.audit.log(
          'تشغيل روبوت إعادة التسعير',
          `قام روبوت إعادة التسعير الآلي بفحص ${eligible.length} صنفاً وإعادة تسعير ${repricedCount} صنفاً بنجاح`,
          auth,
        );
      }
    }

    return {
      totalEvaluated: eligible.length,
      totalRepriced: repricedCount,
      logs,
    };
  }
}
