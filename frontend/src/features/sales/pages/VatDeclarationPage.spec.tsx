/*
New file: frontend/src/features/sales/pages/VatDeclarationPage.spec.tsx
Pins the silent VAT declaration header (INV-VAT-DECLARATION-HEADER-ERROR).

THE GAP: the official header block is shared by both tabs (Form 10 EG 14%
and ZATCA), but the page never read the query's error state (no isError /
isLoading / error anywhere). When the server answered 409
VAT_DECLARATION_TAX_ID_MISSING — no tenant_tax_settings row, so test10k
never registered a tax number — the page silently showed "المنشأة: -" and
"الفترة الضريبية: منإلى" with empty dates, on both tabs. The entity comes
from tenants.business_name and the tax id from the selected
tenant_tax_settings row (vat-declaration.service.ts); the period is the
requested range, not server data.

THE RULE: the header shows the entity name, tax id and dates on both tabs
when the query succeeds, and the REAL server error (message + status +
code) instead of a silent "-" when it fails. The period always shows the
requested range, even on failure.

WHAT THIS PINS, driving the REAL VatDeclarationPage:
- Success (EG, then the ZATCA tab): the header shows the entity name, the
  tax id and the period dates on both tabs.
- Failure (409 VAT_DECLARATION_TAX_ID_MISSING): the header shows the server
  message, the code and the 409 status, and the period still shows the
  requested current-month dates instead of empty "منإلى".
*/

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { VatDeclarationPage } from '@/features/sales/pages/VatDeclarationPage';
import { ApiError } from '@/lib/http';

// The api module is mocked through a hoisted factory only: this spec file
// must NOT import the api layer at all (the page-composition check scans
// page files for direct api-layer imports, mocks included).
const apiMocks = vi.hoisted(() => ({ getDeclaration: vi.fn() }));

vi.mock('@/features/sales/api/vat-declaration.api', () => ({
  vatDeclarationApi: apiMocks,
}));

const getDeclarationMock = apiMocks.getDeclaration;

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
  return { from, to };
}

function declarationData(country: 'EG' | 'SA', range: { from: string; to: string }) {
  return {
    period: { from: range.from, to: range.to, country, standard_rate_percent: country === 'SA' ? 15 : 14 },
    entity: { business_name: 'شركة الاختبار', tax_id: '123456789', owner_name: 'مالك الاختبار' },
    output_tax: {
      standard_rated_base: 1000, standard_rated_tax: 140, zero_rated_base: 0, exempt_base: 0,
      returns_base: 0, returns_tax: 0, invoices_count: 4, total_sales_base: 1000, total_output_vat: 140,
    },
    input_tax: {
      standard_rated_base: 500, standard_rated_tax: 70, zero_rated_base: 0, exempt_base: 0,
      returns_base: 0, returns_tax: 0, bills_count: 2, total_purchases_base: 500, total_input_vat: 70,
    },
    summary: { gross_output_vat: 140, deductible_input_vat: 70, net_vat_due: 70, status: 'payable', currency: country === 'SA' ? 'SAR' : 'EGP' },
    egypt_form_10: {
      sales_general_rate_base: 1000, sales_general_rate_tax: 140, sales_exports_base: 0, sales_exempt_base: 0,
      sales_credit_notes_tax: 0, total_output_tax: 140, purchases_general_rate_base: 500, purchases_general_rate_tax: 70,
      purchases_debit_notes_tax: 0, total_input_tax: 70, net_tax_payable: 70, net_tax_credit: 0,
    },
    zatca_return: {
      standard_rated_supplies_amount: 1000, standard_rated_supplies_tax: 140, zero_rated_supplies_amount: 0,
      exempt_supplies_amount: 0, sales_adjustments_tax: 0, total_sales_tax: 140,
      standard_rated_purchases_amount: 500, standard_rated_purchases_tax: 70, imports_amount: 0,
      purchases_adjustments_tax: 0, total_purchases_tax: 70, net_vat_due: 70,
    },
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <VatDeclarationPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function periodLineText(): string {
  const label = screen.getByText('الفترة الضريبية:');
  const line = label.closest('div');
  if (!line) throw new Error('period line not found');
  return line.textContent ?? '';
}

describe('VatDeclarationPage header', () => {
  it('shows the entity name, tax id and dates on both tabs', async () => {
    const range = currentMonthRange();
    getDeclarationMock.mockImplementation(async (params) =>
      declarationData(params?.country === 'SA' ? 'SA' : 'EG', range),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText('شركة الاختبار')).toBeTruthy());
    expect(screen.getByText('123456789')).toBeTruthy();
    expect(periodLineText()).toContain(range.from);
    expect(periodLineText()).toContain(range.to);
    expect(screen.queryByRole('alert')).toBeNull();

    // The header block is shared: switch to the ZATCA tab and the same
    // entity and dates must still show.
    fireEvent.click(screen.getByRole('button', { name: /ZATCA/ }));
    await waitFor(() => expect(screen.getByText('المملكة العربية السعودية - هيئة الزكاة والضريبة والجمارك (ZATCA)')).toBeTruthy());
    // The SA tab is a new query: wait for its data to land before asserting.
    await waitFor(() => expect(screen.getByText('شركة الاختبار')).toBeTruthy());
    expect(screen.getByText('123456789')).toBeTruthy();
    expect(periodLineText()).toContain(range.from);
    expect(periodLineText()).toContain(range.to);
  });

  it('shows the real server error (409 VAT_DECLARATION_TAX_ID_MISSING) instead of a silent dash', async () => {
    const range = currentMonthRange();
    getDeclarationMock.mockRejectedValue(
      new ApiError('لم يتم تسجيل رقم ضريبي لهذه المنشأة، لا يمكن إصدار الإقرار', 409, {
        code: 'VAT_DECLARATION_TAX_ID_MISSING',
      }),
    );

    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('لم يتم تسجيل رقم ضريبي لهذه المنشأة، لا يمكن إصدار الإقرار');
    expect(alert.textContent).toContain('VAT_DECLARATION_TAX_ID_MISSING');
    expect(alert.textContent).toContain('409');

    // The period is the requested range, so it shows even when the query
    // fails — never the empty "منإلى" again.
    expect(periodLineText()).toContain(range.from);
    expect(periodLineText()).toContain(range.to);
  });
});
