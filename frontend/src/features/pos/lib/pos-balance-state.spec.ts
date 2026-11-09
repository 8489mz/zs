/* R5-A (INV-REST-TOTALS-TRUTH-2, M24): one shared balance helper replaces
 * three drifted computations. The old sites disagreed: getBalancePreview
 * (PosCheckoutDialogSections) returned NEGATIVE remaining, PosCartSummary
 * showed positive remaining, and the credit-partial 4th tile showed
 * changeAmount while the 3rd tile showed the remaining debt. One sign
 * convention now: remaining positive, change positive, one threshold. */

import { describe, it, expect } from 'vitest';
import { getBalanceState } from './pos-balance-state';

describe('pos-balance-state (R5-A, M24)', () => {
  it('partial payment with a customer is credit-remaining, positive', () => {
    const state = getBalanceState({
      paymentType: 'cash',
      customerId: 'c-1',
      paidAmount: 60,
      amountDue: 40,
      changeAmount: 0,
      total: 100,
    });
    expect(state.kind).toBe('remaining');
    expect(state.value).toBe(40);
    expect(state.label).toBe('المتبقي (آجل)');
    expect(state.tone).toBe('danger');
  });

  it('credit sale with a partial payment shows remaining debt, not change', () => {
    const state = getBalanceState({
      paymentType: 'credit',
      customerId: 'c-1',
      paidAmount: 30,
      amountDue: 70,
      changeAmount: 0,
      total: 100,
    });
    expect(state.kind).toBe('remaining');
    expect(state.value).toBe(70);
    expect(state.label).toBe('المتبقي (آجل)');
  });

  it('unpaid credit sale owes the full total', () => {
    const state = getBalanceState({
      paymentType: 'credit',
      customerId: 'c-1',
      paidAmount: 0,
      amountDue: 100,
      changeAmount: 0,
      total: 100,
    });
    expect(state.kind).toBe('remaining');
    expect(state.value).toBe(100);
  });

  it('unpaid cash sale with no customer is plain remaining, not credit', () => {
    const state = getBalanceState({
      paymentType: 'cash',
      customerId: '',
      paidAmount: 0,
      amountDue: 100,
      changeAmount: 0,
      total: 100,
    });
    expect(state.kind).toBe('remaining');
    expect(state.value).toBe(100);
    expect(state.label).toBe('المتبقي');
  });

  it('overpay on cash shows change only, positive', () => {
    const state = getBalanceState({
      paymentType: 'cash',
      customerId: '',
      paidAmount: 120,
      amountDue: 0,
      changeAmount: 20,
      total: 100,
    });
    expect(state.kind).toBe('change');
    expect(state.value).toBe(20);
    expect(state.label).toBe('الباقي');
    expect(state.tone).toBe('primary');
  });

  it('overpay on credit never shows change', () => {
    const state = getBalanceState({
      paymentType: 'credit',
      customerId: 'c-1',
      paidAmount: 120,
      amountDue: 0,
      changeAmount: 20,
      total: 100,
    });
    expect(state.kind).toBe('remaining');
    expect(state.value).toBe(0);
  });

  it('exact payment owes nothing and returns no change', () => {
    const state = getBalanceState({
      paymentType: 'cash',
      customerId: '',
      paidAmount: 100,
      amountDue: 0,
      changeAmount: 0,
      total: 100,
    });
    expect(state.kind).toBe('remaining');
    expect(state.value).toBe(0);
  });

  it('dust below the 0.009 threshold is settled, not a remaining debt', () => {
    const state = getBalanceState({
      paymentType: 'cash',
      customerId: '',
      paidAmount: 99.995,
      amountDue: 0.005,
      changeAmount: 0,
      total: 100,
    });
    expect(state.kind).toBe('remaining');
    expect(state.value).toBe(0);
  });
});
