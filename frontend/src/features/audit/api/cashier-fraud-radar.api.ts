import { http } from '@/lib/http';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface CashierRiskProfile {
  cashierId: number;
  cashierName: string;
  cartVoidsCount: number;
  draftCancelsCount: number;
  cancelledSalesCount: number;
  discountOverridesCount: number;
  saleReturnsCount: number;
  totalSuspiciousEvents: number;
  totalSalesCount: number;
  riskScore: number; // 0 to 100
  riskLevel: RiskLevel;
  lastSuspiciousAt?: string;
}

export interface FraudRadarSummaryResponse {
  timeframe: 'today' | '7days' | '30days';
  totalSuspiciousEvents: number;
  highRiskCashiersCount: number;
  mediumRiskCashiersCount: number;
  estimatedProtectedLoss: number;
  cashiers: CashierRiskProfile[];
  thresholds: {
    maxHourlyVoidsAlert: number;
    whatsappAlertsEnabled: boolean;
  };
}

export interface FraudRadarEventItem {
  id: number;
  cashierId: number;
  cashierName: string;
  eventType: 'cart_remove' | 'draft_cancel' | 'sale_cancelled' | 'discount_override' | 'sale_return';
  eventTitle: string;
  details: string;
  amount?: number;
  createdAt: string;
}

export const cashierFraudRadarApi = {
  getSummary: async (timeframe: 'today' | '7days' | '30days' = 'today'): Promise<FraudRadarSummaryResponse> => {
    return http<FraudRadarSummaryResponse>(`/api/sales/fraud-radar/summary?timeframe=${timeframe}`);
  },

  getEvents: async (limit = 40, timeframe: 'today' | '7days' | '30days' = 'today'): Promise<FraudRadarEventItem[]> => {
    return http<FraudRadarEventItem[]>(`/api/sales/fraud-radar/events?limit=${limit}&timeframe=${timeframe}`);
  },
};
