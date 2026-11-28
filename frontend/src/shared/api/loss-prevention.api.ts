import { http } from '@/lib/http';

export type RiskLevel = 'low' | 'medium' | 'high';

export type RadarEventKind =
  | 'cart_remove'
  | 'qty_decrease'
  | 'draft_cancel'
  | 'no_sale'
  | 'receipt_reprint'
  | 'held_sale_delete'
  | 'weighted_barcode_replay'
  | 'discount_override'
  | 'sale_return'
  | 'sale_cancelled';

export interface AuditSnapshotItem {
  productId?: number;
  productName: string;
  qty: number;
  previousQty?: number;
  unitName?: string;
  unitPrice: number;
  lineTotal: number;
  discount?: number;
}

export interface CashierRiskProfile {
  cashierId: number;
  cashierName: string;
  cartVoidsCount: number;
  qtyDecreasesCount?: number;
  draftCancelsCount: number;
  noSaleOpensCount?: number;
  receiptReprintsCount?: number;
  heldDeletesCount?: number;
  weightedReplaysCount?: number;
  cancelledSalesCount: number;
  discountOverridesCount: number;
  saleReturnsCount: number;
  totalSuspiciousEvents: number;
  totalSalesCount: number;
  riskScore: number;
  riskLevel: RiskLevel;
  lastSuspiciousAt?: string;
}

export interface CashierPeerBenchmarkResult {
  cashierId: number;
  cashierName: string;
  salesCount: number;
  avgTicket: number;
  peerAvgTicket: number;
  avgTicketDeltaPercent: number;
  avgItemsPerSale: number;
  peerAvgItemsPerSale: number;
  avgItemsDeltaPercent: number;
  suspiciousPer100Sales: number;
  anomalyFlags: string[];
  anomalyLevel: 'normal' | 'watch' | 'alert';
}

export interface PeerBenchmarkSummary {
  peerAvgTicket: number;
  peerAvgItemsPerSale: number;
  eligibleCashiersCount: number;
  flaggedCashiersCount: number;
  cashiers: CashierPeerBenchmarkResult[];
}

export interface FraudRadarSummaryResponse {
  timeframe: 'today' | '7days' | '30days';
  sampled?: boolean;
  totalSuspiciousEvents: number;
  highRiskCashiersCount: number;
  mediumRiskCashiersCount: number;
  estimatedProtectedLoss: number;
  cashiers: CashierRiskProfile[];
  peerBenchmarks?: PeerBenchmarkSummary;
  thresholds: {
    maxHourlyVoidsAlert: number;
    cartClearAlertThreshold?: number;
    whatsappAlertsEnabled: boolean;
  };
}

export interface FraudRadarEventItem {
  id: number;
  cashierId: number;
  cashierName: string;
  eventType: RadarEventKind;
  eventTitle: string;
  details: string;
  items?: AuditSnapshotItem[];
  amount?: number;
  cameraTime?: string;
  createdAt: string;
}

export interface AntiTheftSettingsSnapshot {
  requirePinForNoSale: boolean;
  enforceMandatoryReceiptPrint: boolean;
  requireElectronicPaymentRef: boolean;
  lockWeightedManualEdit: boolean;
  strictTwoStepTransfers: boolean;
  inTransitAlertHours: number;
  requireManagerForWriteOff: boolean;
  enforceBlindStockCount: boolean;
  enforceBlindPurchaseReceiving: boolean;
  blockOverdueDeliveryRep: boolean;
  cartClearAlertThreshold: number;
  writeOffAlertThreshold: number;
  defaultDeliveryCustodyCap: number;
  deliveryOverdueHours: number;
}

export interface CommandCenterResponse {
  timeframe: 'today' | '7days' | '30days';
  antiTheftSettings: AntiTheftSettingsSnapshot;
  posRadar: {
    summary: FraudRadarSummaryResponse;
    events: FraudRadarEventItem[];
  };
  inTransitCustody: {
    alertThresholdHours: number;
    openCount: number;
    overdueCount: number;
    totalEstimatedCost: number;
    transfers: Array<{
      transferId: string;
      docNo: string;
      fromLocationName: string;
      toLocationName: string;
      carrierName: string;
      createdByName: string;
      createdAt: string;
      ageHours: number;
      isOverdue: boolean;
      overdueByHours: number;
      itemsCount: number;
      totalQty: number;
      estimatedCost: number;
    }>;
  };
  shrinkage: {
    hotSkusCount: number;
    totalLossQty: number;
    totalLossCost: number;
    totalIncidents: number;
    byCause: {
      damaged: { qty: number; cost: number; count: number };
      negative_adjustment: { qty: number; cost: number; count: number };
      count_shortage: { qty: number; cost: number; count: number };
      transfer_shortage: { qty: number; cost: number; count: number };
    };
    topProducts: Array<{
      productId: string;
      productName: string;
      totalQtyLost: number;
      totalCostLost: number;
      incidentsCount: number;
      topLocationName: string;
      causesBreakdown: {
        damaged: number;
        negative_adjustment: number;
        count_shortage: number;
        transfer_shortage: number;
      };
    }>;
  };
  shiftsAndDelivery: {
    totalShiftShortageAmount: number;
    shortageShiftsCount: number;
    shiftVariances: Array<{
      shiftId: string;
      docNo: string;
      cashierName: string;
      terminalCode: string;
      expectedCash: number;
      countedCash: number;
      variance: number;
      varianceResolution: string;
      closedAt: string;
    }>;
    totalUnsettledDeliveryCash: number;
    overdueDeliveryOrdersCount: number;
    overCapRepsCount: number;
    deliveryCustodies: Array<{
      repId: string;
      repName: string;
      phone: string;
      unsettledOrdersCount: number;
      overdueOrdersCount: number;
      unsettledCash: number;
      custodyCap: number;
      isOverCap: boolean;
      oldestUnsettledAt: string | null;
    }>;
  };
  headlineMetrics: {
    totalFinancialExposure: number;
    criticalAlertsCount: number;
    highRiskCashiersCount: number;
    overdueTransfersCount: number;
    overdueDeliveriesCount: number;
    hotSkusCount: number;
  };
}

export interface HotSkuItem {
  id: string;
  name: string;
  barcode: string;
  categoryName?: string;
  costPrice: number;
  salePrice: number;
  globalStockQty: number;
  locationStockQty?: number | null;
  isHighRiskShrinkage?: boolean;
}

export interface HotSkusResponse {
  hotSkus: HotSkuItem[];
  suggestedCandidates: HotSkuItem[];
}

export const cashierFraudRadarApi = {
  getSummary: async (timeframe: 'today' | '7days' | '30days' = 'today'): Promise<FraudRadarSummaryResponse> => {
    return http<FraudRadarSummaryResponse>(`/api/sales/fraud-radar/summary?timeframe=${timeframe}`);
  },

  getEvents: async (limit = 40, timeframe: 'today' | '7days' | '30days' = 'today'): Promise<FraudRadarEventItem[]> => {
    return http<FraudRadarEventItem[]>(`/api/sales/fraud-radar/events?limit=${limit}&timeframe=${timeframe}`);
  },

  getCommandCenter: async (timeframe: 'today' | '7days' | '30days' = 'today'): Promise<CommandCenterResponse> => {
    return http<CommandCenterResponse>(`/api/sales/fraud-radar/command-center?timeframe=${timeframe}`);
  },

  listHotSkus: async (locationId?: number): Promise<HotSkusResponse> => {
    const qs = locationId ? `?locationId=${locationId}` : '';
    return http<HotSkusResponse>(`/api/inventory/hot-skus${qs}`);
  },

  toggleHotSku: async (productId: number, isHighRiskShrinkage: boolean): Promise<{ ok: boolean }> => {
    return http<{ ok: boolean }>('/api/inventory/hot-skus/toggle', {
      method: 'POST',
      body: JSON.stringify({ productId, isHighRiskShrinkage }),
    });
  },
};
