/*
New file: frontend/src/features/approvals/pages/ApprovalsWorkspacePage.spec.tsx
Pins the approvals summary count going stale (INV-APPROVALS-SUMMARY-COUNT).

THE GAP: the workspace page computed rulesCount once, in loadData, which
ran only on mount and on filter change. ApprovalRulesManager kept its own
rules state and reloaded only itself after create / toggle / delete, never
telling the parent. So the "قواعد الرقابة الهرمية المفعلة" card stayed 0
after a rule was created (and stayed 1 after one was deactivated or
deleted) until a full page reload. The card and the manager badge read the
same field (r.is_active) from the same endpoint (GET /api/approvals/rules),
and create sets is_active true -- so no reading of the live data explains
a 0 while the badge shows "مفعلة"; the snapshot mechanism is the cause.

THE RULE: the manager notifies the parent after every rules mutation
(create / toggle / delete) via onRulesChanged, and the parent reloads its
data, so the summary card reflects the new count without a page reload.

WHAT THIS PINS, driving the REAL ApprovalsWorkspacePage (api module
mocked with a mutable rules list, so refetches see the mutation):
- creating a rule moves the card 0 -> 1 with no reload.
- deactivating a rule moves the card 1 -> 0 with no reload.
- deleting a rule moves the card 1 -> 0 with no reload.
*/

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalsWorkspacePage } from '@/features/approvals/pages/ApprovalsWorkspacePage';
import type { ApprovalRule } from '@/features/approvals/api/approvals.api';

const {
  getApprovalRulesMock,
  createApprovalRuleMock,
  updateApprovalRuleMock,
  deleteApprovalRuleMock,
  getApprovalRequestsMock,
  getPendingApprovalsCountMock,
} = vi.hoisted(() => ({
  getApprovalRulesMock: vi.fn(),
  createApprovalRuleMock: vi.fn(),
  updateApprovalRuleMock: vi.fn(),
  deleteApprovalRuleMock: vi.fn(),
  getApprovalRequestsMock: vi.fn(),
  getPendingApprovalsCountMock: vi.fn(),
}));

vi.mock('@/features/approvals/api/approvals.api', () => ({
  getApprovalRules: getApprovalRulesMock,
  createApprovalRule: createApprovalRuleMock,
  updateApprovalRule: updateApprovalRuleMock,
  deleteApprovalRule: deleteApprovalRuleMock,
  getApprovalRequests: getApprovalRequestsMock,
  getPendingApprovalsCount: getPendingApprovalsCountMock,
  getApprovalRequestDetails: vi.fn(),
  approveApprovalRequest: vi.fn(),
  rejectApprovalRequest: vi.fn(),
}));

let rules: ApprovalRule[] = [];

function activeRule(overrides?: Partial<ApprovalRule>): ApprovalRule {
  return {
    id: 'r1',
    module: 'purchase_orders',
    min_amount: 5000,
    max_amount: null,
    tier_level: 1,
    required_role: 'admin',
    approver_user_id: null,
    is_active: true,
    notes: null,
    created_at: '2026-11-05T00:00:00.000Z',
    updated_at: '2026-11-05T00:00:00.000Z',
    ...overrides,
  };
}

function rulesCardValue(): string {
  const card = screen.getByText('قواعد الرقابة الهرمية المفعلة').closest('.stat-card');
  if (!card) throw new Error('rules stat card not found');
  const value = card.querySelector('strong');
  if (!value) throw new Error('rules stat value not found');
  return value.textContent ?? '';
}

describe('ApprovalsWorkspacePage rules count', () => {
  beforeEach(() => {
    rules = [];
    getApprovalRulesMock.mockReset();
    createApprovalRuleMock.mockReset();
    updateApprovalRuleMock.mockReset();
    deleteApprovalRuleMock.mockReset();
    getApprovalRequestsMock.mockReset();
    getPendingApprovalsCountMock.mockReset();

    getApprovalRulesMock.mockImplementation(async () => [...rules]);
    getApprovalRequestsMock.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    getPendingApprovalsCountMock.mockResolvedValue({ count: 0 });
    createApprovalRuleMock.mockImplementation(async (payload: { module: string; minAmount: number }) => {
      const rule = activeRule({
        id: `r${rules.length + 1}`,
        min_amount: payload.minAmount,
      });
      rules.push(rule);
      return { ok: true, rule };
    });
    updateApprovalRuleMock.mockImplementation(async (id: string, payload: { isActive?: boolean }) => {
      const rule = rules.find((r) => r.id === id);
      if (rule && typeof payload.isActive === 'boolean') rule.is_active = payload.isActive;
      return { ok: true, rule };
    });
    deleteApprovalRuleMock.mockImplementation(async (id: string) => {
      rules = rules.filter((r) => r.id !== id);
      return { ok: true };
    });
  });

  async function openRulesTab(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /مصفوفة القواعد/ }));
  }

  function renderPage() {
    function Wrapper({ children }: PropsWithChildren) {
      // PageHeader reads useLocation(); the page itself needs no routing.
      return <MemoryRouter initialEntries={['/approvals']}>{children}</MemoryRouter>;
    }
    return render(<ApprovalsWorkspacePage />, { wrapper: Wrapper });
  }

  it('moves the card 0 -> 1 after a rule is created, with no reload', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(rulesCardValue()).toBe('0'));
    await openRulesTab(user);

    await user.click(screen.getByRole('button', { name: 'إضافة قاعدة اعتماد جديدة' }));
    await user.click(screen.getByRole('button', { name: 'حفظ وتفعيل القاعدة' }));

    await waitFor(() => expect(rulesCardValue()).toBe('1'), { timeout: 3000 });
  });

  it('moves the card 1 -> 0 after a rule is deactivated, with no reload', async () => {
    const user = userEvent.setup();
    rules = [activeRule()];
    renderPage();

    await waitFor(() => expect(rulesCardValue()).toBe('1'));
    await openRulesTab(user);

    await user.click(screen.getByRole('button', { name: 'مفعلة' }));

    await waitFor(() => expect(rulesCardValue()).toBe('0'), { timeout: 3000 });
  });

  it('moves the card 1 -> 0 after a rule is deleted, with no reload', async () => {
    const user = userEvent.setup();
    rules = [activeRule()];
    renderPage();

    await waitFor(() => expect(rulesCardValue()).toBe('1'));
    await openRulesTab(user);

    await user.click(screen.getByTitle('حذف القاعدة'));

    await waitFor(() => expect(rulesCardValue()).toBe('0'), { timeout: 3000 });
  });
});
