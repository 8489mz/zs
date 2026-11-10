/*
 * INV-REST-KIOSK-OWN-CATALOG-TRUTH (T14-B): the kiosk serves only its
 * own tenant's catalog and the server's truth — no demo-catalog toggle
 * to another tenant, no hardcoded meal claim, no food photo for an
 * item that has none, and a QR that pays the tenant's real InstaPay
 * address (hidden entirely when none is configured).
 *
 * The pure decisions are pinned directly against the production
 * helpers exported from the page (resolveKioskInstapayPayee,
 * getKioskProductImage); the render cases drive the real page with
 * the kiosk hook + settings mocked at the module boundary (the page
 * never touches the api layer itself).
 *
 * RED PROOF: at base the toggle renders 'مطعم المشويات والسندوتشات
 * (75 وجبة)' + 'متجر الأجهزة والهواتف', the count reads '88 وجبة',
 * an imageless item gets an Unsplash food photo, the QR is an
 * external qrserver.com <img> paying the tenant slug, and the QR
 * modal keeps a previous attempt's error — every render case below
 * fails there and passes with the fix.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiError } from '@/lib/http';
import { useAuthStore } from '@/stores/auth-store';
import {
  SelfOrderingKioskPage,
  getKioskProductImage,
  resolveKioskInstapayPayee,
} from './SelfOrderingKioskPage';

const createOrderMock = vi.hoisted(() => vi.fn());
const mockSettings = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('@/features/pos/hooks/useSelfOrderingKiosk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/pos/hooks/useSelfOrderingKiosk')>();
  return {
    ...actual,
    useKiosk86Items: () => [],
    useSelfOrderingKiosk: () => ({
      catalogData: {
        products: [
          { id: 1, name: 'ساندوتش دجاج', price: 75, imageUrl: 'https://example.com/chicken.jpg', categoryName: 'سندوتشات' },
          { id: 2, name: 'جهاز DVR', price: 20, imageUrl: '', categoryName: 'القسم الرئيسي' },
        ],
        categories: [{ id: 1, name: 'سندوتشات' }],
        totalCount: 88,
        hasMore: false,
      },
      isCatalogLoading: false,
      catalogPage: 1,
      setCatalogPage: vi.fn(),
      catalogTotalCount: 88,
      catalogHasMore: false,
      checkUpsell: async () => [],
      getProductModifiers: async () => [],
      createOrder: createOrderMock,
      listTerminals: async () => [],
      initiateTerminalCharge: async () => ({}),
    }),
  };
});

vi.mock('@/shared/hooks/use-catalog-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/hooks/use-catalog-queries')>();
  return {
    ...actual,
    useSettingsQuery: () => ({ data: mockSettings.current }),
  };
});

vi.mock('@/features/pos/hooks/useIsolatedDisplayLanguage', () => ({
  useIsolatedDisplayLanguage: () => ({
    currentLang: 'ar',
    isEn: false,
    setLanguage: vi.fn(),
    toggleLanguage: vi.fn(),
  }),
}));

vi.mock('@/features/pos/lib/hardware-bridge-client', () => ({
  HardwareBridgeClient: {
    isAvailable: async () => false,
    chargeTerminal: async () => ({ status: 'declined', message: 'declined' }),
  },
}));

vi.mock('@/features/pos/components/pos-workspace/PosSmartUpsellModal', () => ({
  PosSmartUpsellModal: () => null,
}));

vi.mock('@/features/pos/components/kiosk/KioskModifierPickerModal', () => ({
  KioskModifierPickerModal: () => null,
}));

function renderKiosk() {
  return render(
    <MemoryRouter initialEntries={['/pos/kiosk/test-shop']}>
      <Routes>
        <Route path="/pos/kiosk/:slug" element={<SelfOrderingKioskPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  createOrderMock.mockReset();
  createOrderMock.mockResolvedValue({ orderNumber: 'ON-261110-0001', totalAmount: 150 });
  mockSettings.current = {};
  window.localStorage.removeItem('zs_last_company_code');
  useAuthStore.setState({
    user: { id: 1 } as never,
    tenant: { slug: 'test-shop', businessName: 'متجر الاختبار' } as never,
  });
});

/** Welcome screen -> takeaway menu, with the first product in the cart. */
async function openMenuWithOneItem() {
  renderKiosk();
  fireEvent.click(screen.getByText('استلام سفري'));
  await screen.findByText('88 صنف');
  fireEvent.click(screen.getAllByText('إضافة')[0]);
  await waitFor(() => {
    expect(screen.getByText('إتمام الطلب والدفع')).not.toBeDisabled();
  });
  fireEvent.click(screen.getByText('إتمام الطلب والدفع'));
  await screen.findByText('تأكيد الطلب وطريقة الدفع');
  fireEvent.change(screen.getByPlaceholderText('مثال: 01012345678'), {
    target: { value: '01012345678' },
  });
}

describe('resolveKioskInstapayPayee (T14-B)', () => {
  it('returns the configured address as-is', () => {
    expect(resolveKioskInstapayPayee('merchant@instapay')).toBe('merchant@instapay');
    expect(resolveKioskInstapayPayee('  01012345678  ')).toBe('01012345678');
  });

  it('treats empty and the placeholder default as unset', () => {
    expect(resolveKioskInstapayPayee('')).toBeNull();
    expect(resolveKioskInstapayPayee(undefined)).toBeNull();
    expect(resolveKioskInstapayPayee('01018017523')).toBeNull();
  });
});

describe('getKioskProductImage (T14-B)', () => {
  it('returns the product own photo when it has one', () => {
    expect(getKioskProductImage({ imageUrl: 'https://example.com/x.jpg' })).toBe(
      'https://example.com/x.jpg',
    );
  });

  it('returns no photo — never a food photo — when the item has none', () => {
    expect(getKioskProductImage({ name: 'جهاز DVR', imageUrl: '' })).toBe('');
    expect(getKioskProductImage({ name: 'جهاز DVR' })).toBe('');
  });
});

describe('SelfOrderingKioskPage — kiosk truth (T14-B)', () => {
  it('has no demo-catalog toggle and no hardcoded 75-meal claim anywhere', () => {
    renderKiosk();
    expect(screen.queryByText(/75 وجبة/)).toBeNull();
    expect(screen.queryByText('متجر الأجهزة والهواتف')).toBeNull();
    expect(document.body.textContent).not.toContain('almhnds');
    expect(screen.getByText('تناول بالصالة')).toBeTruthy();
    expect(screen.getByText('استلام سفري')).toBeTruthy();
  });

  it('shows the resolved tenant catalog only, with a neutral count and no food photo for an imageless item', async () => {
    renderKiosk();
    fireEvent.click(screen.getByText('استلام سفري'));
    await screen.findByText('88 صنف');
    expect(screen.queryByText('88 وجبة')).toBeNull();
    expect(screen.queryByText('الأجهزة')).toBeNull();
    expect(document.body.textContent).not.toContain('almhnds');
    const images = Array.from(document.querySelectorAll('img'));
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute('src')).toBe('https://example.com/chicken.jpg');
    expect(images.some((img) => (img.getAttribute('src') || '').includes('unsplash'))).toBe(false);
    expect(screen.getByText('جهاز DVR')).toBeTruthy();
  });

  it('hides the QR option when no real InstaPay payee is configured', async () => {
    mockSettings.current = { instapayAddress: '01018017523' };
    renderKiosk();
    fireEvent.click(screen.getByText('استلام سفري'));
    await screen.findByText('88 صنف');
    fireEvent.click(screen.getAllByText('إضافة')[0]);
    await waitFor(() => {
      expect(screen.getByText('إتمام الطلب والدفع')).not.toBeDisabled();
    });
    fireEvent.click(screen.getByText('إتمام الطلب والدفع'));
    await screen.findByText('تأكيد الطلب وطريقة الدفع');
    expect(screen.queryByText('رمز QR بالهاتف')).toBeNull();
    expect(document.body.textContent).not.toContain('qrserver');
  });

  it('shows a local QR paying the real payee when one is configured', async () => {
    mockSettings.current = { instapayAddress: 'merchant@instapay' };
    await openMenuWithOneItem();
    fireEvent.click(screen.getByText('رمز QR بالهاتف'));
    fireEvent.click(screen.getByText(/عرض رمز QR وسداد الفاتورة/));
    const qrImage = await screen.findByRole('img', { name: 'رمز QR للدفع' });
    expect(qrImage.innerHTML).toContain('<svg');
    expect(document.querySelector('img[src*="qrserver"]')).toBeNull();
    expect(screen.getByText('merchant@instapay')).toBeTruthy();
  });

  it('clears a stale finalize error when the QR modal opens', async () => {
    mockSettings.current = { instapayAddress: 'merchant@instapay' };
    createOrderMock.mockRejectedValueOnce(
      new ApiError('خطأ تجريبي فريد 98765', 400),
    );
    await openMenuWithOneItem();
    fireEvent.click(screen.getByText('دفع بالكاونتر'));
    fireEvent.click(screen.getByText(/طباعة تذكرة وسدادها عند الكاونتر/));
    await screen.findByText('خطأ تجريبي فريد 98765');
    fireEvent.click(screen.getByText('رمز QR بالهاتف'));
    fireEvent.click(screen.getByText(/عرض رمز QR وسداد الفاتورة/));
    await screen.findByRole('img', { name: 'رمز QR للدفع' });
    expect(screen.queryByText('خطأ تجريبي فريد 98765')).toBeNull();
  });
});
