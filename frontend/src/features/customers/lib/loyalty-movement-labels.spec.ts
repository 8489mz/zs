/* Pins INV-LOYALTY-STALE-LABELS: a manual add is labelled a manual add and a
   manual deduction a manual deduction (never purchase-earn / discount
   redemption), the totals count only real earns / redeems, and the balance
   card shows the server-confirmed balance after an operation. */

import { describe, expect, it } from 'vitest';
import {
  getLoyaltyMovementLabel,
  resolveDisplayedLoyaltyBalance,
  summarizeLoyaltyLogs,
} from './loyalty-movement-labels';

describe('loyalty movement labels', () => {
  it('labels a manual add as a manual add, not as a purchase earn', () => {
    const manualAdd = getLoyaltyMovementLabel('manual_adjust', 50);
    const purchaseEarn = getLoyaltyMovementLabel('earn', 50);
    expect(manualAdd.fallback).toBe('إضافة يدوية');
    expect(manualAdd.key).toBe('s25');
    expect(manualAdd.fallback).not.toBe(purchaseEarn.fallback);
    expect(manualAdd.key).not.toBe(purchaseEarn.key);
  });

  it('labels a manual deduction as a manual deduction, not as a discount redemption', () => {
    const manualDeduct = getLoyaltyMovementLabel('manual_adjust', -30);
    const redemption = getLoyaltyMovementLabel('redeem', -30);
    expect(manualDeduct.fallback).toBe('خصم يدوي');
    expect(manualDeduct.key).toBe('s26');
    expect(manualDeduct.fallback).not.toBe(redemption.fallback);
    expect(manualDeduct.key).not.toBe(redemption.key);
  });

  it('keeps purchase earning and discount redemption labelled correctly', () => {
    expect(getLoyaltyMovementLabel('earn', 50).fallback).toBe('اكتساب مشتريات');
    expect(getLoyaltyMovementLabel('redeem', -20).fallback).toBe('استبدال بخصم');
    expect(getLoyaltyMovementLabel('return_clawback', -10).fallback).toBe('خصم لمرتجع');
    expect(getLoyaltyMovementLabel('return_refund', 10).fallback).toBe('رد نقاط مرتجع');
  });

  it('falls back to the generic manual-adjustment label for unknown types', () => {
    expect(getLoyaltyMovementLabel('cancel_clawback', -5).fallback).toBe('تعديل يدوي');
    expect(getLoyaltyMovementLabel(undefined, 5).fallback).toBe('تعديل يدوي');
  });
});

describe('loyalty summary totals', () => {
  it('excludes manual adjustments from both the earned and redeemed totals', () => {
    const logs = [
      { action_type: 'earn', points_change: 100 },
      { action_type: 'manual_adjust', points_change: 50 },
      { action_type: 'redeem', points_change: -20 },
      { action_type: 'manual_adjust', points_change: -30 },
      { action_type: 'return_refund', points_change: 10 },
    ];
    expect(summarizeLoyaltyLogs(logs)).toEqual({ totalEarned: 100, totalRedeemed: 20 });
  });

  it('totals an empty history as zero', () => {
    expect(summarizeLoyaltyLogs([])).toEqual({ totalEarned: 0, totalRedeemed: 0 });
  });
});

describe('displayed loyalty balance', () => {
  it('shows the server-confirmed balance after an operation, not the stale snapshot', () => {
    // Dialog opened at 200; the operation returned 250.
    expect(resolveDisplayedLoyaltyBalance(250, 200)).toBe(250);
  });

  it('falls back to the customer snapshot before any operation', () => {
    expect(resolveDisplayedLoyaltyBalance(null, 200)).toBe(200);
    expect(resolveDisplayedLoyaltyBalance(undefined, undefined)).toBe(0);
  });
});
