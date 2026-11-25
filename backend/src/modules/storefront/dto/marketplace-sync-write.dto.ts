import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/*
 * D8 (INV-DTO-STOREFRONT-14): DTO classes for the marketplace-sync
 * controller's @Body sites. Every field below is caller-verified
 * against the real frontend caller (marketplace-sync.api.ts + the
 * marketplace-* UI components) and against the SERVICE whitelist,
 * not the controller type — see dto-storefront.spec.ts for the
 * per-field evidence.
 *
 * - SaveMarketplaceConfigDto: the configs form round-trips the full
 *   GET config per marketplace, including the masked '••••••••'
 *   secrets. The service SKIPS every masked secret, so NO @MinLength
 *   on any secret (a min-length would 400 the save whenever the user
 *   does not change the secret — D7 WhatsApp precedent). A
 *   non-masked webhookSecret shorter than 32 chars throws in the
 *   SERVICE (marketplace-sync-config.service.ts), not the pipe.
 *   All fields optional: the service merges Partial into the stored
 *   config.
 * - SaveMarketplaceSkuMappingDto: the add form SENDS status:
 *   'synced' (it must be accepted). The other Omit fields
 *   (productName, barcode, costPrice, retailPrice, currentLocalStock,
 *   lastSyncedStock, lastSyncedAt, errorMessage, buyBoxStatus,
 *   lastPriceCheckedAt, repricing*, lastRepricedAt, repricingLog)
 *   are deliberately NOT here: the service builds newMapping
 *   explicitly from the product + the fields below and would
 *   silently drop them (and an edit via saveMapping would wipe
 *   repricing settings — pre-existing service behavior, out of
 *   scope). Edit flows use the competitor-price /
 *   repricing-settings endpoints instead.
 * - CalculateMarketplaceFeesDto.category + fulfillmentType stay
 *   plain strings, NOT enums: the service switch has a default
 *   (unknown category computes at 12%) and the fulfillment check
 *   falls back to the FBM path — an enum would 400 a category the
 *   service handles.
 * - ReconcileMarketplaceSettlementDto.marketplace is amazon|noon
 *   ONLY: the SERVICE whitelist, narrower than the interface's
 *   SupportedMarketplace. periodStart/periodEnd stay REQUIRED, as
 *   do referralFees/fulfillmentFees: the only caller always sends
 *   all four, and the service spreads the input into a
 *   MarketplaceSettlementRecord whose type requires them.
 *   Book-digits precision + the gross-vs-parts identity stay
 *   service checks.
 * - CreateFbaInboundShipmentDto.totalUnits/totalBoxes are optional:
 *   the service recomputes them from items. status stays REQUIRED:
 *   the only caller always sends 'draft', and the service spreads
 *   the input into an FbaInboundShipment whose type requires it.
 * - SaveMarketplaceOnboardingProfileDto: the modal round-trips the
 *   FULL GET check object, so all 22 interface fields are optional
 *   here, including the computed checklist[] / platformGuides[] /
 *   letters / score / name-match fields the service ignores.
 * - GenerateGtinExemptionDto: every field optional — the service
 *   defaults them all.
 * - The :187 marketplace webhook stays `any` (new pinned exclusion):
 *   its payload shape is defined by 4 marketplaces, outside the
 *   repo, and the receive service persists the raw payload first.
 */

export class AmazonConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  sellerId?: string;

  @IsOptional()
  @IsString()
  refreshToken?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  clientSecret?: string;

  /* NO @MinLength: the masked '••••••••' placeholder (8 chars) is
   * explicitly skipped by the service; a min-length would 400 the
   * save whenever the user does not change the secret. A non-masked
   * secret shorter than 32 chars throws in the service. */
  @IsOptional()
  @IsString()
  webhookSecret?: string;

  @IsOptional()
  @IsEnum(['eg', 'sa', 'ae'])
  marketplaceId?: 'eg' | 'sa' | 'ae';

  @IsOptional()
  @IsBoolean()
  autoSyncStock?: boolean;

  @IsOptional()
  @IsBoolean()
  autoPullOrders?: boolean;

  @IsOptional()
  @IsEnum(['fba', 'fbm'])
  fulfillmentType?: 'fba' | 'fbm';
}

export class NoonConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  merchantId?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  appSecret?: string;

  @IsOptional()
  @IsString()
  webhookSecret?: string;

  @IsOptional()
  @IsEnum(['eg', 'sa', 'ae'])
  marketplace?: 'eg' | 'sa' | 'ae';

  @IsOptional()
  @IsBoolean()
  autoSyncStock?: boolean;

  @IsOptional()
  @IsBoolean()
  autoPullOrders?: boolean;

  @IsOptional()
  @IsEnum(['fbn', 'direct'])
  fulfillmentType?: 'fbn' | 'direct';
}

export class JumiaConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  sellerEmail?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  webhookSecret?: string;

  @IsOptional()
  @IsEnum(['eg', 'ng', 'ke'])
  marketplace?: 'eg' | 'ng' | 'ke';

  @IsOptional()
  @IsBoolean()
  autoSyncStock?: boolean;

  @IsOptional()
  @IsBoolean()
  autoPullOrders?: boolean;

  @IsOptional()
  @IsEnum(['express', 'dropshipping'])
  fulfillmentType?: 'express' | 'dropshipping';
}

export class TrendyolConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  apiSecret?: string;

  @IsOptional()
  @IsString()
  webhookSecret?: string;

  @IsOptional()
  @IsBoolean()
  autoSyncStock?: boolean;

  @IsOptional()
  @IsBoolean()
  autoPullOrders?: boolean;

  @IsOptional()
  @IsEnum(['trendyol_cargo', 'merchant_cargo'])
  fulfillmentType?: 'trendyol_cargo' | 'merchant_cargo';
}

export class SaveMarketplaceConfigDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => AmazonConfigDto)
  amazon?: AmazonConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => NoonConfigDto)
  noon?: NoonConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => JumiaConfigDto)
  jumia?: JumiaConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => TrendyolConfigDto)
  trendyol?: TrendyolConfigDto;
}

export class SaveMarketplaceSkuMappingDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsNumber()
  productId!: number;

  @IsEnum(['amazon', 'noon', 'jumia', 'trendyol'])
  marketplace!: 'amazon' | 'noon' | 'jumia' | 'trendyol';

  @IsString()
  marketplaceSku!: string;

  @IsOptional()
  @IsString()
  marketplaceTitle?: string;

  @IsOptional()
  @IsNumber()
  customPrice?: number;

  @IsOptional()
  @IsBoolean()
  syncStock?: boolean;

  /* The add form SENDS status: 'synced' — it must be accepted (the
   * service ignores it and sets 'synced' itself). */
  @IsOptional()
  @IsEnum(['synced', 'pending', 'error'])
  status?: 'synced' | 'pending' | 'error';

  @IsOptional()
  @IsNumber()
  competitorPrice?: number;

  @IsOptional()
  @IsNumber()
  buyBoxPrice?: number;
}

export class CalculateMarketplaceFeesDto {
  @IsEnum(['amazon', 'noon', 'jumia', 'trendyol'])
  marketplace!: 'amazon' | 'noon' | 'jumia' | 'trendyol';

  @IsEnum(['eg', 'sa', 'ae'])
  region!: 'eg' | 'sa' | 'ae';

  /* Plain string, NOT an enum: the service switch has a default
   * (unknown category computes at 12%). */
  @IsString()
  category!: string;

  /* Plain string, NOT an enum: the service compares against
   * fba/fbn/express/trendyol_cargo and falls back to the FBM path. */
  @IsString()
  fulfillmentType!: string;

  @IsEnum(['small', 'standard', 'medium', 'large', 'heavy'])
  weightTier!: 'small' | 'standard' | 'medium' | 'large' | 'heavy';

  @IsNumber()
  sellingPrice!: number;

  @IsNumber()
  itemCost!: number;

  @IsOptional()
  @IsNumber()
  inboundShippingCost?: number;

  @IsOptional()
  @IsNumber()
  packagingCost?: number;
}

export class UpdateCompetitorPriceDto {
  @IsOptional()
  @IsNumber()
  competitorPrice?: number;

  @IsOptional()
  @IsNumber()
  buyBoxPrice?: number;
}

export class ReconcileMarketplaceSettlementDto {
  /* amazon|noon ONLY: the SERVICE whitelist
   * (`!['amazon','noon'].includes(...)` throws), narrower than the
   * interface's SupportedMarketplace. */
  @IsEnum(['amazon', 'noon'])
  marketplace!: 'amazon' | 'noon';

  @IsString()
  settlementId!: string;

  /* REQUIRED, though the service never validates them: the only
   * caller (the settlements form) always sends both, and the
   * service spreads the input into a MarketplaceSettlementRecord
   * whose type requires them — making them optional would force a
   * service-code change in money code for a caller that does not
   * exist (contrast the D5 optional precedent, where a REAL caller
   * omitted the field). */
  @IsString()
  periodStart!: string;

  @IsString()
  periodEnd!: string;

  @IsOptional()
  @IsString()
  currency?: string;

  /* The service throws unless grossSales > 0. */
  @IsNumber()
  @IsPositive()
  grossSales!: number;

  /* REQUIRED (like periodStart/periodEnd): the interface requires
   * them, the only caller always sends them (the form defaults
   * both to 0), and the service spreads the input into a
   * MarketplaceSettlementRecord whose type requires them. The
   * service's `|| 0` is a runtime tolerance for a caller that does
   * not exist. */
  @IsNumber()
  @Min(0)
  referralFees!: number;

  @IsNumber()
  @Min(0)
  fulfillmentFees!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  refunds?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  storageOrOtherFees?: number;

  @IsNumber()
  @Min(0)
  netPayout!: number;

  @IsOptional()
  @IsNumber()
  bankAccountId?: number;

  @IsOptional()
  @IsNumber()
  referralFeesAccountId?: number;

  @IsOptional()
  @IsNumber()
  fulfillmentFeesAccountId?: number;

  @IsOptional()
  @IsNumber()
  salesAccountId?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class SaveRepricingSettingsDto {
  @IsBoolean()
  repricingEnabled!: boolean;

  @IsOptional()
  @IsNumber()
  minPrice?: number;

  @IsOptional()
  @IsNumber()
  maxPrice?: number;

  @IsOptional()
  @IsEnum(['match_buy_box', 'undercut_buy_box', 'match_lowest', 'undercut_lowest'])
  repricingRule?: 'match_buy_box' | 'undercut_buy_box' | 'match_lowest' | 'undercut_lowest';

  @IsOptional()
  @IsNumber()
  repricingDelta?: number;
}

export class FbaInboundItemDto {
  @IsNumber()
  productId!: number;

  @IsString()
  marketplaceSku!: string;

  @IsString()
  productName!: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsNumber()
  quantityShipped!: number;

  @IsOptional()
  @IsNumber()
  quantityReceived?: number;

  @IsOptional()
  @IsNumber()
  discrepancy?: number;

  @IsOptional()
  @IsNumber()
  boxNumber?: number;

  @IsOptional()
  @IsNumber()
  unitsPerBox?: number;

  @IsOptional()
  @IsNumber()
  costPrice?: number;
}

export class CreateFbaInboundShipmentDto {
  @IsEnum(['amazon', 'noon'])
  marketplace!: 'amazon' | 'noon';

  @IsString()
  fulfillmentCenterId!: string;

  @IsOptional()
  @IsNumber()
  sourceBranchId?: number | null;

  @IsOptional()
  @IsNumber()
  sourceLocationId?: number | null;

  /* REQUIRED: the only caller always sends 'draft', and the service
   * spreads the input into an FbaInboundShipment whose type
   * requires status — making it optional would force a service-code
   * change for a caller that does not exist. */
  @IsEnum(['draft', 'shipped', 'received', 'cancelled'])
  status!: 'draft' | 'shipped' | 'received' | 'cancelled';

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FbaInboundItemDto)
  items!: FbaInboundItemDto[];

  /* Optional: the service recomputes both from items. */
  @IsOptional()
  @IsNumber()
  totalUnits?: number;

  @IsOptional()
  @IsNumber()
  totalReceivedUnits?: number;

  @IsOptional()
  @IsNumber()
  totalDiscrepancyUnits?: number;

  @IsOptional()
  @IsNumber()
  discrepancyLossAmount?: number;

  @IsOptional()
  @IsNumber()
  totalBoxes?: number;

  @IsOptional()
  @IsString()
  trackingNumber?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  shippedAt?: string;

  @IsOptional()
  @IsString()
  receivedAt?: string;
}

export class OnboardingChecklistItemDto {
  @IsString()
  key!: string;

  @IsString()
  label!: string;

  @IsBoolean()
  required!: boolean;

  @IsEnum(['ready', 'missing', 'warning'])
  status!: 'ready' | 'missing' | 'warning';

  @IsString()
  notes!: string;
}

export class OnboardingPlatformGuideStepDto {
  @IsNumber()
  stepNumber!: number;

  @IsString()
  title!: string;

  @IsString()
  instruction!: string;

  @IsOptional()
  @IsString()
  tip?: string;
}

export class OnboardingPlatformGuideDto {
  @IsEnum(['amazon', 'noon', 'jumia', 'trendyol'])
  marketplace!: 'amazon' | 'noon' | 'jumia' | 'trendyol';

  @IsString()
  nameAr!: string;

  @IsString()
  portalUrl!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OnboardingPlatformGuideStepDto)
  steps!: OnboardingPlatformGuideStepDto[];
}

export class SaveMarketplaceOnboardingProfileDto {
  /* All 22 interface fields optional: the service takes Partial and
   * reads only the 16 scalars below — but the modal round-trips the
   * full GET check object, so the computed fields must be accepted
   * too (Package C trap). */
  @IsOptional()
  @IsString()
  companyLegalName?: string;

  @IsOptional()
  @IsString()
  tradeName?: string;

  @IsOptional()
  @IsString()
  ownerName?: string;

  @IsOptional()
  @IsString()
  ownerNationalId?: string;

  @IsOptional()
  @IsEnum(['business', 'individual'])
  legalEntityType?: 'business' | 'individual';

  @IsOptional()
  @IsBoolean()
  hasCreditCard?: boolean;

  @IsOptional()
  @IsString()
  commercialRegister?: string;

  @IsOptional()
  @IsString()
  taxNumber?: string;

  @IsOptional()
  @IsBoolean()
  vatRegistered?: boolean;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  bankAccountName?: string;

  @IsOptional()
  @IsString()
  bankIban?: string;

  @IsOptional()
  @IsString()
  bankSwift?: string;

  @IsOptional()
  @IsString()
  businessAddress?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsNumber()
  overallReadinessScore?: number;

  @IsOptional()
  @IsEnum(['perfect_match', 'name_mismatch', 'missing_info'])
  nameMatchStatus?: 'perfect_match' | 'name_mismatch' | 'missing_info';

  @IsOptional()
  @IsString()
  nameMatchDetails?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OnboardingChecklistItemDto)
  checklist?: OnboardingChecklistItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OnboardingPlatformGuideDto)
  platformGuides?: OnboardingPlatformGuideDto[];

  @IsOptional()
  @IsString()
  letterOfAuthorizationAr?: string;

  @IsOptional()
  @IsString()
  letterOfAuthorizationEn?: string;
}

export class GenerateGtinExemptionDto {
  /* All optional: the service defaults every field (marketplace
   * 'amazon', reason 'unbranded', brandName 'Generic / Generic
   * Brand', category 'Home / Fashion / General Goods'). */
  @IsOptional()
  @IsNumber()
  productId?: number;

  @IsOptional()
  @IsString()
  brandName?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsEnum(['amazon', 'noon', 'jumia', 'trendyol'])
  marketplace?: 'amazon' | 'noon' | 'jumia' | 'trendyol';

  @IsOptional()
  @IsEnum(['unbranded', 'private_label', 'custom_manufacturing', 'parts_accessories'])
  reason?: 'unbranded' | 'private_label' | 'custom_manufacturing' | 'parts_accessories';
}
