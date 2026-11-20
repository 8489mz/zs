import type { VanActiveTripResponse, VanPackagingMovement, VanStockItem } from '../../api/van-sales.api';

// Re-exported for slices: use-stock-audit imports VanStockItem from this
// types module (merge repair — S0 as generated did not re-export it).
export type { VanStockItem } from '../../api/van-sales.api';

export interface VanSettleTabProps {
  tripData: VanActiveTripResponse['trip'];
  activeVisit?: {
    customerId: number;
    customerName: string;
    startedAt: number;
    startedTimeStr?: string;
  } | null;
  sales?: {
    id: number;
    docNo: string;
    total: number;
    subtotal?: number;
    discount?: number;
    paymentMethod: string;
    createdAt: string;
    customerName?: string;
    customerPhone?: string;
  }[];
  collections?: {
    id: number;
    amount: number;
    createdAt: string;
    customerName: string;
    note?: string;
    gpsLat?: number;
    gpsLng?: number;
  }[];
  returns?: {
    id: number;
    docNo: string;
    totalAmount: number;
    returnReason: string;
    refundMethod?: 'credit' | 'cash';
    status: string;
    createdAt: string;
    customerName?: string;
  }[];
  expenses?: {
    id: number;
    expenseType: string;
    amount: number;
    description?: string;
    createdAt: string;
  }[];
  packagingMovements?: VanPackagingMovement[];
  onOpenExpenseModal?: () => void;
  onOpenPackagingModal?: () => void;
  inventory?: VanStockItem[];
  countedCash: string;
  onCountedCashChange: (val: string) => void;
  // INV-VAN-DAILY-SPLIT-SETTLEMENT: per-day due + counted cash for a
  // trip spanning more than one tenant day. When perDayDue has more
  // than one day, the single counted input below becomes the derived
  // total (read-only) and these rows are the editors.
  perDayDue?: { businessDay: string; due: number }[];
  perDayCash?: Record<string, string>;
  onPerDayCashChange?: (day: string, val: string) => void;
  onFillPerDayWithDue?: () => void;
  unloadRemaining: boolean;
  onUnloadRemainingChange: (val: boolean) => void;
  // INV-VAN-SELF-SETTLE-PIN-REQUIRED: no charge/waive argument — the
  // rep's phone never sends that decision; a shortage stays pending
  // until a supervisor decides from the admin side. nightStockApproved
  // is the supervisor's explicit approval (authorized by the PIN) to
  // keep remaining stock in the van overnight instead of unloading it.
  onSubmitSettle: (
    supervisorPin?: string,
    countedStock?: { productId: number; countedQty: number }[],
    nightStockApproved?: boolean,
  ) => void;
  isSubmitting: boolean;
  requireSupervisorPin?: boolean;
  isBlindSettlement?: boolean;
}

export type SettleSection = 'settle' | 'activity';

export type SettleSubTab = 'sales' | 'collections' | 'returns' | 'expenses' | 'packaging' | 'inventory';
