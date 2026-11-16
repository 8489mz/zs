import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createTestQueryClient } from '@/test/test-query-client';
import { SupplierEditorCard } from './SupplierEditorCard';
import type { Supplier } from '@/types/domain';

const {
  listAllLedgerMock,
  accountsListMock,
  supplierBillsListMock,
  supplierBillsCreateMock,
  printHtmlDocumentMock,
  printSmallReceiptDocumentMock,
  html2canvasMock,
  pdfSaveMock,
} = vi.hoisted(() => ({
  listAllLedgerMock: vi.fn(),
  accountsListMock: vi.fn(),
  supplierBillsListMock: vi.fn(),
  supplierBillsCreateMock: vi.fn(),
  printHtmlDocumentMock: vi.fn(),
  printSmallReceiptDocumentMock: vi.fn(),
  html2canvasMock: vi.fn(),
  pdfSaveMock: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (_k: string, fallback?: string) => fallback || _k,
      i18n: { language: 'ar' },
    }),
  };
});

vi.mock('@/features/suppliers/api/suppliers.api', () => ({
  suppliersApi: {
    listAllLedger: listAllLedgerMock,
  },
}));

vi.mock('@/features/accounting', () => ({
  accountingApi: {
    accounts: accountsListMock,
  },
}));

vi.mock('@/features/suppliers/api/supplier-bills.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/suppliers/api/supplier-bills.api')>();
  return {
    ...actual,
    supplierBillsApi: {
      ...actual.supplierBillsApi,
      list: supplierBillsListMock,
      create: supplierBillsCreateMock,
    },
  };
});

vi.mock('@/shared/hooks/use-catalog-queries', () => ({
  useSettingsQuery: () => ({
    data: {
      storeName: 'شركة النخبة للتجارة',
      phone: '01000000000',
      address: 'القاهرة',
      receiptWidthMm: 80,
      invoiceFooter: 'شكراً لتعاملكم معنا',
      importModuleEnabled: false,
    },
  }),
}));

vi.mock('@/lib/browser', () => ({
  escapeHtml: (v: string) => String(v || ''),
  printHtmlDocument: printHtmlDocumentMock,
}));

vi.mock('@/lib/small-receipt-printer', () => ({
  printSmallReceiptDocument: printSmallReceiptDocumentMock,
}));

vi.mock('html2canvas', () => ({ default: html2canvasMock }));
vi.mock('jspdf', () => ({
  jsPDF: class MockJsPdf {
    addImage = vi.fn();
    addPage = vi.fn();
    save = pdfSaveMock;
  },
}));

const SUPPLIER: Supplier = {
  id: '7',
  name: 'بيج كولا',
  phone: '01012345678',
  address: 'المنطقة الصناعية',
  balance: -100000,
  notes: 'مورد مشروبات',
  supplierType: 'supplier',
  overdraftLimit: null,
  metadata: { instapayAddress: 'bigcola@instapay' },
};

function renderEditor(supplier: Supplier = SUPPLIER, onRequestDelete = vi.fn()) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SupplierEditorCard supplier={supplier} canDelete onRequestDelete={onRequestDelete} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SupplierEditorCard & SupplierStatementTab', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    listAllLedgerMock.mockReset();
    accountsListMock.mockReset();
    supplierBillsListMock.mockReset();
    supplierBillsCreateMock.mockReset();
    supplierBillsCreateMock.mockResolvedValue({ ok: true, bill: { id: '12' }, appliedAdvances: [] });
    printHtmlDocumentMock.mockReset();
    printSmallReceiptDocumentMock.mockReset();
    html2canvasMock.mockReset();
    pdfSaveMock.mockReset();

    accountsListMock.mockResolvedValue({
      accounts: [
        {
          id: '6700',
          code: '6700',
          nameAr: 'مصروفات إدارية واشتراكات',
          accountType: 'expense',
          isActive: true,
          flags: { isControlAccount: false },
        },
      ],
    });
    supplierBillsListMock.mockResolvedValue({
      ok: true,
      bills: [
        {
          id: '11',
          supplierId: '7',
          docNo: 'SPB-261116-0001',
          billDate: '2026-11-16',
          total: 1200,
          note: 'اشتراك سنوي',
          status: 'posted',
          createdAt: '2026-11-16T10:00:00.000Z',
          lines: [{ description: 'تجديد اشتراك', accountId: 6700, amount: 1200 }],
        },
      ],
    });

    listAllLedgerMock.mockResolvedValue({
      supplier: SUPPLIER,
      summary: {
        openingBalance: 0,
        totalCredits: 25000,
        totalDebits: 125000,
        closingBalance: -100000,
        totalEntries: 3,
      },
      entries: [
        {
          id: '1',
          type: 'opening_balance',
          amount: -100000,
          debit: 100000,
          credit: 0,
          balanceAfter: -100000,
          note: 'رصيد افتتاحي',
          createdAt: '2026-09-01T10:00:00.000Z',
        },
        {
          id: '2',
          type: 'purchase_credit',
          amount: 25000,
          debit: 0,
          credit: 25000,
          balanceAfter: -75000,
          note: 'فاتورة شراء PUR-260910-0001',
          createdAt: '2026-09-10T11:00:00.000Z',
        },
        {
          id: '3',
          type: 'supplier_advance',
          amount: 0,
          debit: 0,
          credit: 0,
          advanceAmount: 5000,
          balanceAfter: -75000,
          note: 'دفعة مقدمة',
          createdAt: '2026-10-15T12:00:00.000Z',
        },
      ],
    });

    const mockCanvas = {
      width: 1588,
      height: 800,
      toDataURL: () => 'data:image/jpeg;base64,test',
      getContext: () => ({ fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }),
    };
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName.toLowerCase() === 'canvas') {
        return {
          width: 0,
          height: 0,
          toDataURL: () => 'data:image/jpeg;base64,page',
          getContext: () => ({ fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }),
        } as unknown as HTMLCanvasElement;
      }
      return origCreateElement(tagName);
    });
    html2canvasMock.mockResolvedValue(mockCanvas);
  });

  it('keeps uniform tab button weight without flickering, surfaces action triggers, and loads full statement with PDF/A4/Receipt print', async () => {
    const onRequestDelete = vi.fn();
    renderEditor(SUPPLIER, onRequestDelete);

    const detailsTab = screen.getByRole('tab', { name: 'البيانات الأساسية' });
    const billsTab = screen.getByRole('tab', { name: 'فواتير بدون مخزون' });
    const statementTab = screen.getByRole('tab', { name: 'كشف الحساب' });

    expect(detailsTab.style.fontWeight).toBe('600');
    expect(billsTab.style.fontWeight).toBe('600');
    expect(statementTab.style.fontWeight).toBe('600');
    expect(screen.getByRole('button', { name: 'حفظ التعديل' })).toBeTruthy();
    expect(screen.getByLabelText('اسم المورد *')).toBeTruthy();
    expect(screen.getByLabelText('رقم الهاتف')).toBeTruthy();
    expect(screen.getByLabelText('العنوان / المقر')).toBeTruthy();
    expect(screen.getByLabelText('حساب إنستاباي (IPA)')).toBeTruthy();
    expect(screen.getByLabelText('ملاحظات إضافية')).toBeTruthy();
    expect(screen.queryAllByPlaceholderText(/010xxxxxxxx/i)).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'حذف المورد' }));
    expect(onRequestDelete).toHaveBeenCalledTimes(1);

    expect(screen.queryAllByPlaceholderText(/مثال:/i)).toHaveLength(0);

    fireEvent.click(billsTab);
    expect(await screen.findByText('SPB-261116-0001')).toBeTruthy();
    expect(await screen.findByText(/6700 — مصروفات إدارية واشتراكات/)).toBeTruthy();
    expect(screen.queryByText(/النوع \/ التصنيف/)).toBeNull();
    expect(screen.queryAllByPlaceholderText(/مثال:/i)).toHaveLength(0);

    const descInput = screen.getByLabelText('الوصف *');
    const amtInput = screen.getByLabelText('المبلغ *');
    fireEvent.change(descInput, { target: { value: 'صيانة وتجهيز' } });
    fireEvent.change(amtInput, { target: { value: '350' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ الفاتورة بدون مخزون' }));
    await waitFor(() => expect(supplierBillsCreateMock).toHaveBeenCalledTimes(1));
    expect(supplierBillsCreateMock.mock.calls[0][0]).toEqual({
      supplierId: '7',
      lines: [{ description: 'صيانة وتجهيز', accountId: 6700, amount: 350 }],
    });

    fireEvent.click(statementTab);
    await waitFor(() => expect(listAllLedgerMock).toHaveBeenCalledWith('7', {
      from: '2000-01-01T00:00:00.000Z',
      to: undefined,
    }));

    expect(await screen.findByText('فاتورة شراء PUR-260910-0001')).toBeTruthy();
    expect(screen.getAllByText(/سحبة \/ دفعة مقدمة/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/5,000\.00/).length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByRole('button', { name: 'طباعة A4' }));
    expect(printHtmlDocumentMock).toHaveBeenCalledTimes(1);
    const [a4Title, a4Html] = printHtmlDocumentMock.mock.calls[0];
    expect(a4Title).toContain('بيج كولا');
    expect(a4Html).toContain('كشف حساب مورد');
    expect(a4Html).toContain('فاتورة شراء PUR-260910-0001');
    expect(a4Html).toContain('25,000.00');

    fireEvent.click(screen.getByRole('button', { name: 'طباعة ريسيت' }));
    expect(printSmallReceiptDocumentMock).toHaveBeenCalledTimes(1);
    const [receiptHtml, receiptOpts] = printSmallReceiptDocumentMock.mock.calls[0];
    expect(receiptOpts.widthMm).toBe(80);
    expect(receiptHtml).toContain('بيج كولا');
    expect(receiptHtml).toContain('شركة النخبة للتجارة');
    expect(receiptHtml).toContain('125,000.00');

    fireEvent.click(screen.getByRole('button', { name: 'تحميل PDF' }));
    await waitFor(() => expect(html2canvasMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(pdfSaveMock).toHaveBeenCalledWith('supplier-statement-بيج-كولا.pdf'));
    expect(a4Html).toContain('<colgroup>');
  });

  it('surfaces openAdvanceBalance (لك عند المورد: 500.00) on screen badge, A4/PDF, and thermal receipt without double minus sign', async () => {
    listAllLedgerMock.mockResolvedValue({
      supplier: { ...SUPPLIER, balance: 0 },
      summary: {
        openingBalance: 0,
        totalCredits: 0,
        totalDebits: 0,
        closingBalance: 0,
        openAdvanceBalance: 500,
        totalEntries: 1,
      },
      entries: [
        {
          id: '10',
          type: 'supplier_advance',
          amount: 0,
          debit: 0,
          credit: 0,
          advanceAmount: 500,
          balanceAfter: 0,
          note: 'دفعة مقدمة إلى بيج كولا',
          createdAt: '2026-11-16T13:05:00.000Z',
        },
      ],
    });

    renderEditor({ ...SUPPLIER, balance: 0 });
    fireEvent.click(screen.getByRole('tab', { name: 'كشف الحساب' }));
    expect(await screen.findByText('دفعة مقدمة إلى بيج كولا')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('لك عند المورد (دفعة مقدمة): 500.00')).toBeTruthy();
    });
    expect(screen.getByText('لك عند المورد (دفعة مقدمة)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'طباعة ريسيت' }));
    expect(printSmallReceiptDocumentMock).toHaveBeenCalledTimes(1);
    const [receiptHtml] = printSmallReceiptDocumentMock.mock.calls[0];
    expect(receiptHtml).toContain('دفعات مقدمة مفتوحة (لك):');
    expect(receiptHtml).toContain('لك عند المورد (دفعة مقدمة):');
    expect(receiptHtml).toContain('500.00 مدين');
    expect(receiptHtml).not.toContain('-500.00');

    fireEvent.click(screen.getByRole('button', { name: 'طباعة A4' }));
    expect(printHtmlDocumentMock).toHaveBeenCalledTimes(1);
    const [, a4Html] = printHtmlDocumentMock.mock.calls[0];
    expect(a4Html).toContain('دفعات مقدمة مفتوحة (لك)');
    expect(a4Html).toContain('لك عند المورد (دفعة مقدمة)');
    expect(a4Html).toContain('500.00');
  });
});
