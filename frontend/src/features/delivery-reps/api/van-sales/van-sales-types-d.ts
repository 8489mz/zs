export interface VanRepFinancialSettlementItem {
  id: number;
  tenantId: string;
  repId: number;
  repName: string;
  repPhone?: string;
  employeeId?: number | null;
  employeeName?: string | null;
  employeeNo?: string | null;
  tripId?: number | null;
  shiftName?: string | null;
  vehiclePlate?: string | null;
  entryType: 'cash_shortage' | 'stock_shortage' | 'cash_overage' | 'commission' | 'bonus' | 'cash_reimbursement' | 'waiver' | 'payroll_deduction' | string;
  amount: number;
  status: 'pending' | 'settled' | 'waived' | 'pushed_to_payroll' | string;
  settledAt?: string | null;
  settledById?: number | null;
  settledByName?: string | null;
  settlementMethod?: 'cash' | 'payroll' | 'waiver' | string | null;
  notes?: string | null;
  receiptVoucherNo?: string | null;
  payrollRunId?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface VanRepLedgerBreakdown {
  repId: number;
  repName: string;
  repPhone?: string;
  employeeId?: number | null;
  employeeName?: string | null;
  pendingShortages: number;
  settledShortages: number;
  waivedShortages: number;
  pushedToPayroll: number;
  commissions: number;
  netBalance: number;
  itemsCount: number;
}

export interface VanRepFinancialLedgerResponse {
  items: VanRepFinancialSettlementItem[];
  summary: {
    totalPendingShortages: number;
    totalSettledShortages: number;
    totalWaivedShortages: number;
    totalPushedToPayroll: number;
    totalCommissions: number;
    netRepBalance: number;
    repsBreakdown: VanRepLedgerBreakdown[];
  };
}

export interface FmcgPromotion {
  id: number;
  name: string;
  code: string;
  promoType: 'mix_and_match' | 'tiered_qty' | 'invoice_threshold' | string;
  applyType: 'free_bonus' | 'discount_percent' | 'discount_amount' | string;
  buyConditions: any;
  reward: {
    bonusProductId?: number;
    bonusProductName?: string;
    bonusQty?: number;
    bonusUom?: string;
    bonusReason?: string;
    discountPercent?: number;
    discountAmount?: number;
    targetProductId?: number;
  };
  customerTypes?: string[];
  startDate?: string | null;
  endDate?: string | null;
  isActive: boolean;
  maxApplicationsPerOrder: number;
  priority: number;
  notes?: string | null;
}

export interface RouteOptimizationResult {
  stats: {
    totalStops: number;
    mappedStopsCount: number;
    unmappedStopsCount: number;
    originalDistanceMeters: number;
    optimizedDistanceMeters: number;
    savedDistanceMeters: number;
    originalDistanceKm: number;
    optimizedDistanceKm: number;
    savedDistanceKm: number;
    savingsPercent: number;
  };
  orderedStops: Array<{
    id: number;
    name: string;
    lat?: number | null;
    lng?: number | null;
    address?: string;
    district?: string;
    customerCode?: string;
    sequenceIndex: number;
    legDistanceMeters: number;
    cumulativeDistanceMeters: number;
    isUnmappedGps?: boolean;
  }>;
  persistedCount?: number;
}

export interface VanFraudRadarEvent {
  id: number;
  eventCode: string;
  severity: 'medium' | 'high' | 'critical';
  repId: number;
  repName: string;
  tripId: number | null;
  customerId: number | null;
  customerName: string | null;
  titleAr: string;
  detailsAr: string;
  amountInvolved: number;
  metadata: Record<string, any>;
  createdAt: string;
}

export interface VanRepRiskProfile {
  repId: number;
  repName: string;
  phone: string;
  totalSuspicionEvents: number;
  criticalEventsCount: number;
  highEventsCount: number;
  mediumEventsCount: number;
  priceManipulationCount: number;
  unauthorizedBonusCount: number;
  creditBypassCount: number;
  crossRepCollectionCount: number;
  fakeCardCount: number;
  fraudulentReturnCount: number;
  expenseAbuseCount: number;
  odometerRollbackCount: number;
  geofenceViolationCount: number;
  selfApprovalCount: number;
  invalidPinCount: number;
  unauthorizedLoadOrSettleCount: number;
  settlementShortageCount: number;
  totalAmountAtRisk: number;
  riskScore: number;
  riskLevel: 'safe' | 'watch' | 'high_risk';
  flags: string[];
  lastEventAt: string | null;
}

export interface VanFraudRadarSummaryResponse {
  ok?: boolean;
  periodDays: number;
  kpis: {
    totalRepsMonitored: number;
    highRiskRepsCount: number;
    watchRepsCount: number;
    totalSuspicionEvents: number;
    criticalEventsCount: number;
    totalAmountAtRisk: number;
    blockedTamperAttemptsCount: number;
    settlementShortageEventsCount: number;
  };
  repProfiles: VanRepRiskProfile[];
  recentEvents: VanFraudRadarEvent[];
}
