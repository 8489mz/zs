/*
 * INV-LOAN-INSTANT-DISBURSE: the instant-disburse checkbox must reach the
 * backend in the create-loan payload. A checked box sends autoDisburse:
 * true, so the backend approves and disburses in one step (cash moves,
 * salary deduction is armed); an unchecked box sends autoDisburse: false
 * and the loan stays a draft, as before. The helper is the single place
 * that builds this payload, and the page sends exactly what it returns.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCreateLoanPayload,
  createInitialLoanDraft,
  type LoanDraft,
  type LoanPlanPreview,
} from '@/features/hr/pages/loans/hr-loans.helpers';

const plan: LoanPlanPreview = { installmentCount: 2, firstDueDate: '2026-11-01' };

function draft(overrides: Partial<LoanDraft> = {}): LoanDraft {
  return {
    ...createInitialLoanDraft(),
    employeeId: '7',
    principalAmount: '500',
    issueDate: '2026-11-05',
    notes: 'test advance',
    ...overrides,
  };
}

describe('buildCreateLoanPayload (INV-LOAN-INSTANT-DISBURSE)', () => {
  it('sends autoDisburse: true when the instant-disburse box is checked', () => {
    const payload = buildCreateLoanPayload(draft({ autoDisburse: true }), plan);
    expect(payload.autoDisburse).toBe(true);
  });

  it('sends autoDisburse: false when the instant-disburse box is unchecked, so the loan stays a draft', () => {
    const payload = buildCreateLoanPayload(draft({ autoDisburse: false }), plan);
    expect(payload.autoDisburse).toBe(false);
  });

  it('defaults a fresh draft to instant disburse, matching the checked box in the form', () => {
    expect(createInitialLoanDraft().autoDisburse).toBe(true);
    expect(buildCreateLoanPayload(draft(), plan).autoDisburse).toBe(true);
  });

  it('keeps the rest of the payload exactly as the page sent it before', () => {
    const payload = buildCreateLoanPayload(draft({ autoDisburse: true }), plan);
    expect(payload).toEqual({
      employeeId: '7',
      loanType: 'advance',
      principalAmount: 500,
      installmentCount: 1,
      repaymentMode: 'deduct_next_salary',
      issueDate: '2026-11-05',
      firstDueDate: '2026-11-01',
      notes: 'test advance',
      autoDisburse: true,
    });
  });

  it('uses the monthly-installment mode and the plan count for installments', () => {
    const payload = buildCreateLoanPayload(
      draft({ autoDisburse: false, repaymentMethod: 'installments', installmentCount: '3' }),
      { installmentCount: 3, firstDueDate: '2026-12-01' },
    );
    expect(payload.repaymentMode).toBe('monthly_salary_installment');
    expect(payload.installmentCount).toBe(3);
    expect(payload.firstDueDate).toBe('2026-12-01');
    expect(payload.autoDisburse).toBe(false);
  });
});
