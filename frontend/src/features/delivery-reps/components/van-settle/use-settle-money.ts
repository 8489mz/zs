import { useMemo } from 'react';
import type { VanSettleTabProps } from './van-settle-types';

export function useSettleMoney({
  tripData,
  sales = [],
  collections = [],
  returns = [],
  expenses,
  packagingMovements,
  perDayDue,
  countedCash,
}: Pick<
  VanSettleTabProps,
  | 'tripData'
  | 'sales'
  | 'collections'
  | 'returns'
  | 'expenses'
  | 'packagingMovements'
  | 'perDayDue'
  | 'countedCash'
>): {
  safeExpenses: NonNullable<VanSettleTabProps['expenses']>;
  safePackaging: NonNullable<VanSettleTabProps['packagingMovements']>;
  salesAmount: number;
  creditSales: number;
  cashSales: number;
  collectionsTotal: number;
  returnsAmount: number;
  cashRefunds: number;
  creditReturns: number;
  totalTripExpenses: number;
  netExpectedCash: number;
  cashCollected: number;
  instapaySales: number;
  instapayCollections: number;
  totalInstapay: number;
  countedNum: number;
  perDayMode: boolean;
  totalActivities: number;
  totalDiscounts: number;
} {
  const safeExpenses = useMemo(() => {
    if (!expenses) return [];
    if (Array.isArray(expenses)) return expenses;
    return (expenses as any).expenses || [];
  }, [expenses]);

  const safePackaging = useMemo(() => {
    if (!packagingMovements) return [];
    if (Array.isArray(packagingMovements)) return packagingMovements;
    return (packagingMovements as any).movements || [];
  }, [packagingMovements]);

  const salesAmount = Number(tripData?.salesAmount || 0);
  const creditSales = Number(tripData?.creditSales || 0);
  const cashSales = Math.max(0, salesAmount - creditSales);
  const collectionsTotal = collections.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const returnsAmount = Number(tripData?.returnsAmount || 0);
  const cashRefunds = Number(tripData?.cashRefunds || 0);
  const creditReturns = Math.max(0, returnsAmount - cashRefunds);
  const totalTripExpenses = (safeExpenses && safeExpenses.length > 0)
    ? safeExpenses.reduce((s: number, e: any) => s + Number(e.amount || 0), 0)
    : Number((tripData as any)?.tripExpenses || 0);
  const netExpectedCash = Math.max(0, (cashSales + collectionsTotal - cashRefunds) - totalTripExpenses);
  const cashCollected = Number((tripData as any)?.expectedCashToRemit ?? tripData?.cashCollected ?? netExpectedCash);
  const instapaySales = Number((tripData as any)?.totalInstapaySales ?? 0);
  const instapayCollections = Number((tripData as any)?.totalInstapayCollections ?? 0);
  const totalInstapay = instapaySales + instapayCollections;
  const countedNum = Number(countedCash);
  // INV-VAN-DAILY-SPLIT-SETTLEMENT: multi-day trips settle per day.
  const perDayMode = (perDayDue?.length ?? 0) > 1;
  const totalActivities = sales.length + collections.length + returns.length + safeExpenses.length + safePackaging.length;
  const totalDiscounts = sales.reduce((sum, s) => sum + Number(s.discount || 0), 0);
  return {
    safeExpenses,
    safePackaging,
    salesAmount,
    creditSales,
    cashSales,
    collectionsTotal,
    returnsAmount,
    cashRefunds,
    creditReturns,
    totalTripExpenses,
    netExpectedCash,
    cashCollected,
    instapaySales,
    instapayCollections,
    totalInstapay,
    countedNum,
    perDayMode,
    totalActivities,
    totalDiscounts,
  };
}
