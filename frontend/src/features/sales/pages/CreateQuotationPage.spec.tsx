/*
 * I3-D4: quotation customer picker binding.
 *
 * WHAT WAS WRONG (live trial phase 2, 2026-11-09, problem 4): picking a
 * customer from the quotation form's own list was rejected on submit
 * with "يرجى تحديد اسم العميل لإصدار عرض السعر" — until the name was
 * typed manually into the free-text box. The picker never actually
 * set the customer.
 *
 * ROOT CAUSE: Customer.id is a STRING (frontend type `Customer.id:
 * string`; DB `customers.id BIGINT`, which node-postgres returns as a
 * string), but CreateQuotationPage kept `selectedCustomerId` as a
 * NUMBER and looked the customer up with a strict comparison:
 * `customers.find((c) => c.id === Number(customerIdStr))` — string
 * === number is always false, so `setCustomerName` never ran,
 * `customerName` stayed empty, and `handleSubmit` hit the
 * `!customerName.trim()` guard. Every other customer lookup in the
 * codebase compares `String(c.id)` to `String(...)`; this page was
 * the outlier.
 *
 * WHAT THIS PINS, driving the REAL CreateQuotationPage (customers
 * arrive with string ids, exactly as the live API returns them):
 * - picking a customer from the list fills the name/phone/address
 *   fields AND submit proceeds: no "يرجى تحديد اسم العميل" error and
 *   quotationsApi.create is called once with customerId 42 and the
 *   picked name;
 * - typing a name manually (no list pick) still submits as a walk-in
 *   customer with customerId null.
 *
 * I10-A: "اعتماد وحفظ عرض السعر" saved a DRAFT (live re-test
 * 2026-11-09 §5(d): QUO-183760 stayed مسودة). Both buttons called
 * the same handleSubmit and the payload carried no status, while
 * the backend hardcoded status 'draft' — so the approve button was
 * a dead promise and no UI path could ever move a quotation out of
 * draft. The approve-vs-draft cases below pin the wire: approve
 * sends status 'sent' with the approval toast, save-as-draft sends
 * status 'draft' with the draft toast.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateQuotationPage } from '@/features/sales/pages/CreateQuotationPage';

// jsdom has no Element.scrollIntoView; CustomSelect calls it when its
// dropdown opens. Stub it so the picker interaction can run at all.
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'ar' },
  }),
}));

const mocks = vi.hoisted(() => ({
  createQuotation: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock('@/shared/api/customers.api', () => ({
  customersApi: {
    // String ids, exactly as the live API returns them: Customer.id is
    // a string and BIGINT ids arrive from node-postgres as strings.
    list: async () => [
      {
        id: '42',
        name: 'عميل اختبار 00001',
        phone: '01000000000',
        address: 'القاهرة',
        balance: 0,
        type: 'credit',
        creditLimit: 0,
        storeCreditBalance: 0,
      },
    ],
  },
}));

vi.mock('@/features/sales/api/quotations.api', () => ({
  quotationsApi: {
    create: (...args: unknown[]) => mocks.createQuotation(...args),
  },
}));

vi.mock('@/shared/hooks/use-catalog-queries', () => ({
  useProductsQuery: () => ({ data: [] }),
}));

vi.mock('@/shared/components/system-alert', () => ({
  toast: {
    error: (...args: unknown[]) => mocks.toastError(...args),
    success: (...args: unknown[]) => mocks.toastSuccess(...args),
    warning: (...args: unknown[]) => mocks.toastWarning(...args),
    info: vi.fn(),
  },
  systemConfirm: vi.fn().mockResolvedValue(true),
  systemAlert: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <CreateQuotationPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function pickCustomerFromList() {
  const picker = await screen.findByPlaceholderText('اختر عميل مسجل...');
  fireEvent.click(picker);
  const option = await screen.findByText('عميل اختبار 00001 (01000000000)');
  fireEvent.click(option);
}

function fillOneLineItem() {
  const description = screen.getByPlaceholderText('أو اكتب وصف البند / الصنف يدوياً...');
  fireEvent.change(description, { target: { value: 'اختبار صنف استيراد 001' } });
}

function submitQuotation() {
  fireEvent.click(screen.getByRole('button', { name: 'اعتماد عرض السعر' }));
}

function submitQuotationApproveAndSave() {
  fireEvent.click(screen.getByRole('button', { name: 'اعتماد وحفظ عرض السعر' }));
}

function submitQuotationSaveDraft() {
  fireEvent.click(screen.getByRole('button', { name: 'حفظ كمسودة' }));
}

describe('CreateQuotationPage customer picker', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.createQuotation.mockResolvedValue({ ok: true, quotation: { id: 1 } });
  });

  it('a list-picked customer fills the name and submit proceeds', async () => {
    renderPage();

    await pickCustomerFromList();

    // The pick must land in the customer-name state the submit guard reads.
    const nameInput = screen.getByPlaceholderText('أو اكتب اسم العميل مباشرة') as HTMLInputElement;
    expect(nameInput.value).toBe('عميل اختبار 00001');
    const phoneInput = screen.getByPlaceholderText('010XXXXXXXX') as HTMLInputElement;
    expect(phoneInput.value).toBe('01000000000');

    fillOneLineItem();
    submitQuotation();

    await waitFor(() => expect(mocks.createQuotation).toHaveBeenCalledTimes(1));
    const payload = mocks.createQuotation.mock.calls[0][0] as any;
    expect(payload.customerId).toBe(42);
    expect(payload.customerName).toBe('عميل اختبار 00001');
    expect(mocks.toastError).not.toHaveBeenCalledWith('يرجى تحديد اسم العميل لإصدار عرض السعر');
  });

  it('a manually typed name still submits as a walk-in customer', async () => {
    renderPage();

    const nameInput = await screen.findByPlaceholderText('أو اكتب اسم العميل مباشرة');
    fireEvent.change(nameInput, { target: { value: 'عميل نقدي' } });

    fillOneLineItem();
    submitQuotation();

    await waitFor(() => expect(mocks.createQuotation).toHaveBeenCalledTimes(1));
    const payload = mocks.createQuotation.mock.calls[0][0] as any;
    expect(payload.customerId).toBeNull();
    expect(payload.customerName).toBe('عميل نقدي');
    expect(mocks.toastError).not.toHaveBeenCalledWith('يرجى تحديد اسم العميل لإصدار عرض السعر');
  });
});

describe('CreateQuotationPage approve vs save-as-draft', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.createQuotation.mockResolvedValue({ ok: true, quotation: { id: 1 } });
  });

  it('"اعتماد وحفظ عرض السعر" creates the quotation as sent, not a draft', async () => {
    renderPage();

    await pickCustomerFromList();
    fillOneLineItem();
    submitQuotationApproveAndSave();

    await waitFor(() => expect(mocks.createQuotation).toHaveBeenCalledTimes(1));
    const payload = mocks.createQuotation.mock.calls[0][0] as any;
    expect(payload.status).toBe('sent');
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith('تم اعتماد وحفظ عرض السعر بنجاح'),
    );
  });

  it('"حفظ كمسودة" creates the quotation as a draft', async () => {
    renderPage();

    await pickCustomerFromList();
    fillOneLineItem();
    submitQuotationSaveDraft();

    await waitFor(() => expect(mocks.createQuotation).toHaveBeenCalledTimes(1));
    const payload = mocks.createQuotation.mock.calls[0][0] as any;
    expect(payload.status).toBe('draft');
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith('تم إنشاء وحفظ عرض السعر بنجاح'),
    );
  });
});
