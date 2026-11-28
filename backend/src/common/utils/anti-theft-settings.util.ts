import type { Kysely, Transaction } from '../../database/kysely';
import type { Database } from '../../database/database.types';

export interface AntiTheftSettings {
  requirePinForNoSale: boolean;
  enforceMandatoryReceiptPrint: boolean;
  lockWeightedManualEdit: boolean;
  requireElectronicPaymentRef: boolean;
  cartClearAlertThreshold: number;
  strictTwoStepTransfers: boolean;
  inTransitAlertHours: number;
  requireManagerForWriteOff: boolean;
  writeOffAlertThreshold: number;
  enforceBlindStockCount: boolean;
  enforceBlindPurchaseReceiving: boolean;
  blockOverdueDeliveryRep: boolean;
  defaultDeliveryCustodyCap: number;
  deliveryOverdueHours: number;
}

export const ANTI_THEFT_SETTING_KEYS = [
  'antiTheftRequirePinForNoSale',
  'antiTheftEnforceMandatoryReceiptPrint',
  'antiTheftLockWeightedManualEdit',
  'antiTheftRequireElectronicPaymentRef',
  'antiTheftCartClearAlertThreshold',
  'antiTheftStrictTwoStepTransfers',
  'antiTheftInTransitAlertHours',
  'antiTheftRequireManagerForWriteOff',
  'antiTheftWriteOffAlertThreshold',
  'antiTheftEnforceBlindStockCount',
  'antiTheftEnforceBlindPurchaseReceiving',
  'antiTheftBlockOverdueDeliveryRep',
  'antiTheftDefaultDeliveryCustodyCap',
  'antiTheftDeliveryOverdueHours',
] as const;

export const DEFAULT_ANTI_THEFT_SETTINGS: AntiTheftSettings = {
  requirePinForNoSale: false,
  enforceMandatoryReceiptPrint: false,
  lockWeightedManualEdit: false,
  requireElectronicPaymentRef: false,
  cartClearAlertThreshold: 200,
  strictTwoStepTransfers: false,
  inTransitAlertHours: 4,
  requireManagerForWriteOff: false,
  writeOffAlertThreshold: 500,
  enforceBlindStockCount: false,
  enforceBlindPurchaseReceiving: false,
  blockOverdueDeliveryRep: false,
  defaultDeliveryCustodyCap: 0,
  deliveryOverdueHours: 20,
};

function parseBool(raw: unknown, fallback = false): boolean {
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true;
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false;
  return fallback;
}

function parseNonNegNumber(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const num = Number(raw);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

export function parseAntiTheftSettingsFromMap(map: Map<string, unknown>): AntiTheftSettings {
  return {
    requirePinForNoSale: parseBool(
      map.get('antiTheftRequirePinForNoSale'),
      DEFAULT_ANTI_THEFT_SETTINGS.requirePinForNoSale,
    ),
    enforceMandatoryReceiptPrint: parseBool(
      map.get('antiTheftEnforceMandatoryReceiptPrint'),
      DEFAULT_ANTI_THEFT_SETTINGS.enforceMandatoryReceiptPrint,
    ),
    lockWeightedManualEdit: parseBool(
      map.get('antiTheftLockWeightedManualEdit'),
      DEFAULT_ANTI_THEFT_SETTINGS.lockWeightedManualEdit,
    ),
    requireElectronicPaymentRef: parseBool(
      map.get('antiTheftRequireElectronicPaymentRef'),
      DEFAULT_ANTI_THEFT_SETTINGS.requireElectronicPaymentRef,
    ),
    cartClearAlertThreshold: parseNonNegNumber(
      map.get('antiTheftCartClearAlertThreshold'),
      DEFAULT_ANTI_THEFT_SETTINGS.cartClearAlertThreshold,
    ),
    strictTwoStepTransfers: parseBool(
      map.get('antiTheftStrictTwoStepTransfers'),
      DEFAULT_ANTI_THEFT_SETTINGS.strictTwoStepTransfers,
    ),
    inTransitAlertHours: Math.max(
      0.5,
      parseNonNegNumber(map.get('antiTheftInTransitAlertHours'), DEFAULT_ANTI_THEFT_SETTINGS.inTransitAlertHours),
    ),
    requireManagerForWriteOff: parseBool(
      map.get('antiTheftRequireManagerForWriteOff'),
      DEFAULT_ANTI_THEFT_SETTINGS.requireManagerForWriteOff,
    ),
    writeOffAlertThreshold: parseNonNegNumber(
      map.get('antiTheftWriteOffAlertThreshold'),
      DEFAULT_ANTI_THEFT_SETTINGS.writeOffAlertThreshold,
    ),
    enforceBlindStockCount: parseBool(
      map.get('antiTheftEnforceBlindStockCount'),
      DEFAULT_ANTI_THEFT_SETTINGS.enforceBlindStockCount,
    ),
    enforceBlindPurchaseReceiving: parseBool(
      map.get('antiTheftEnforceBlindPurchaseReceiving'),
      DEFAULT_ANTI_THEFT_SETTINGS.enforceBlindPurchaseReceiving,
    ),
    blockOverdueDeliveryRep: parseBool(
      map.get('antiTheftBlockOverdueDeliveryRep'),
      DEFAULT_ANTI_THEFT_SETTINGS.blockOverdueDeliveryRep,
    ),
    defaultDeliveryCustodyCap: parseNonNegNumber(
      map.get('antiTheftDefaultDeliveryCustodyCap'),
      DEFAULT_ANTI_THEFT_SETTINGS.defaultDeliveryCustodyCap,
    ),
    deliveryOverdueHours: Math.max(
      1,
      parseNonNegNumber(map.get('antiTheftDeliveryOverdueHours'), DEFAULT_ANTI_THEFT_SETTINGS.deliveryOverdueHours),
    ),
  };
}

export async function loadAntiTheftSettings(
  db: Kysely<Database> | Transaction<Database>,
  tenantId: string,
): Promise<AntiTheftSettings> {
  const rows = await db
    .selectFrom('settings')
    .select(['key', 'value'])
    .where('tenant_id', '=', tenantId)
    .where('key', 'in', [...ANTI_THEFT_SETTING_KEYS])
    .execute();

  const map = new Map<string, unknown>();
  for (const row of rows) {
    try {
      map.set(row.key, JSON.parse(row.value));
    } catch {
      map.set(row.key, row.value);
    }
  }
  return parseAntiTheftSettingsFromMap(map);
}
