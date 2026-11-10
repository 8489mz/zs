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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
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
    useSelfOrderingKiosk: (_slug: string, opts?: { search?: string }) => {
      const allProducts = [
        { id: 1, name: 'ساندوتش دجاج', price: 75, imageUrl: 'https://example.com/chicken.jpg', categoryName: 'سندوتشات' },
        { id: 2, name: 'جهاز DVR', price: 20, imageUrl: '', categoryName: 'القسم الرئيسي' },
      ];
      // The real hook sends the search to the server (debounced 300 ms);
      // the mock answers from the same two products so the page's
      // empty-category branch is reachable in tests.
      const query = String(opts?.search || '').trim();
      const products = query
        ? allProducts.filter((p) => p.name.includes(query))
        : allProducts;
      return {
      catalogData: {
        products,
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
      };
    },
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

/*
 * INV-REST-KIOSK-TRAY-NEUTRAL-TRUTH (T15-C): the kiosk tray / search /
 * loading / empty copy is neutral "صنف" wording — zero "وجبة" / "وجبات"
 * in the tray summary, the item count, the search placeholder, the
 * loading state, the empty-category state, the empty tray, the review
 * summary, and the empty-cart toast. T14-B fixed only the category
 * count label; these 9 rendered occurrences were left behind (Trial 8,
 * clean state). The keys are kiosk-namespaced, so the fix edits them
 * in place (ar.json + en.json + the __t fallbacks in the page, plus the
 * literal toast) and cannot leak to the food screens, which keep their
 * own "وجبة" wording on different keys.
 *
 * The render cases drive the real page (the test i18n resources carry
 * no ar.json values, so the rendered text is the __t fallback — the
 * same string the locale file must agree with). The locale cases read
 * the shipped ar.json / en.json files, and the source cases read the
 * shipped page + food-screen files as text. The loading state (s47)
 * cannot be rendered with the fixed hook mock (isCatalogLoading is
 * false), so it is pinned by locale + source only.
 *
 * RED PROOF: at base the placeholder reads "ابحث عن وجبة أو مشروب...",
 * the tray reads "استلام سفري • 1 وجبة" / "عدد الوجبات: 1 وجبة", the
 * empty tray reads "اختر وجباتك المفضلة...", the review summary reads
 * "1 وجبة في الصينية", and the 8 locale values still say "وجبة" /
 * "وجبات" / "Meal" / "meals" — every case below fails there and passes
 * with the fix.
 */

const FRONTEND_ROOT_T15C = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

function readSourceT15C(rel: string): string {
  return readFileSync(path.join(FRONTEND_ROOT_T15C, rel), 'utf8');
}

function readJsonT15C(rel: string): Record<string, unknown> {
  return JSON.parse(readSourceT15C(rel)) as Record<string, unknown>;
}

function kioskLocale(
  locale: Record<string, unknown>,
): Record<string, string> {
  const pos = locale.pos as Record<string, Record<string, Record<string, string>>>;
  return pos.self_ordering_kiosk_page;
}

/** Open the takeaway menu (empty tray). */
async function openTakeawayMenu() {
  renderKiosk();
  fireEvent.click(screen.getByText('استلام سفري'));
  await screen.findByText('88 صنف');
}

/** Open the menu and add the first product, so the tray holds 1 item. */
async function openMenuWithOneTrayItem() {
  await openTakeawayMenu();
  fireEvent.click(screen.getAllByText('إضافة')[0]);
  await waitFor(() => {
    expect(screen.getByText('إتمام الطلب والدفع')).not.toBeDisabled();
  });
}

describe('SelfOrderingKioskPage — tray neutral wording (T15-C)', () => {
  it('search placeholder is neutral and the category label still reads "صنف"', async () => {
    await openTakeawayMenu();
    expect(screen.getByPlaceholderText('ابحث عن صنف...')).toBeTruthy();
    expect(screen.queryByPlaceholderText(/وجبة/)).toBeNull();
    expect(screen.getByText('88 صنف')).toBeTruthy();
  });

  it('empty tray copy is neutral (0 items)', async () => {
    await openTakeawayMenu();
    expect(
      screen.getByText('اختر أصنافك المفضلة من القائمة لتظهر هنا فوراً'),
    ).toBeTruthy();
    expect(document.body.textContent).toContain('استلام سفري • 0 صنف');
    expect(document.body.textContent).not.toMatch(/وجب[ةا]/);
  });

  it('tray summary and count are neutral with one item', async () => {
    await openMenuWithOneTrayItem();
    expect(document.body.textContent).toContain('استلام سفري • 1 صنف');
    expect(screen.getByText('عدد الأصناف:')).toBeTruthy();
    expect(document.body.textContent).toContain('1 صنف');
    expect(document.body.textContent).not.toMatch(/وجب[ةا]/);
  });

  it('empty-category state is neutral when the search matches nothing', async () => {
    await openTakeawayMenu();
    fireEvent.change(screen.getByPlaceholderText('ابحث عن صنف...'), {
      target: { value: 'zzz-no-such-item' },
    });
    await screen.findByText('لا توجد أصناف في هذا القسم');
    expect(screen.queryByText('لا توجد وجبات في هذا القسم')).toBeNull();
  });

  it('review summary is neutral with one item', async () => {
    await openMenuWithOneItem();
    expect(document.body.textContent).toContain('إجمالي 1 صنف في الصينية');
    expect(document.body.textContent).not.toMatch(/وجب[ةا]/);
  });

  it('kiosk locale values are neutral in ar.json and en.json (8 keys)', () => {
    const ar = kioskLocale(readJsonT15C('src/locales/ar.json'));
    const en = kioskLocale(readJsonT15C('src/locales/en.json'));
    const expectedAr: Array<[string, string]> = [
      ['s39', 'ابحث عن صنف...'],
      ['s47', 'جارٍ تحميل قائمة الأصناف...'],
      ['s48', 'لا توجد أصناف في هذا القسم'],
      ['s55', 'صنف'],
      ['s58', 'اختر أصنافك المفضلة من القائمة لتظهر هنا فوراً'],
      ['s59', 'عدد الأصناف:'],
      ['s60', 'صنف'],
      ['s69', 'صنف في الصينية'],
    ];
    const expectedEn: Array<[string, string]> = [
      ['s39', 'Search for an item...'],
      ['s47', 'Loading item list...'],
      ['s48', 'No items in this section'],
      ['s55', 'Item'],
      ['s58', 'Choose your favorite items from the menu to appear here immediately'],
      ['s59', 'Number of items:'],
      ['s60', 'Item'],
      ['s69', 'Item in the tray'],
    ];
    for (const [key, value] of expectedAr) {
      expect(ar[key], `ar ${key}`).toBe(value);
      expect(ar[key], `ar ${key} must not say وجبة`).not.toMatch(/وجب[ةا]/);
    }
    for (const [key, value] of expectedEn) {
      expect(en[key], `en ${key}`).toBe(value);
      expect(en[key], `en ${key} must not say meal`).not.toMatch(/meal/i);
    }
  });

  it('page fallbacks and the empty-cart toast are neutral in source', () => {
    const source = readSourceT15C(
      'src/features/pos/pages/SelfOrderingKioskPage.tsx',
    );
    const oldLiterals = [
      'ابحث عن وجبة أو مشروب...',
      'جارٍ تحميل قائمة الوجبات...',
      'لا توجد وجبات في هذا القسم',
      '"وجبة"',
      'اختر وجباتك المفضلة من القائمة لتظهر هنا فوراً',
      'عدد الوجبات:',
      'وجبة في الصينية',
      'السلة فارغة، يرجى اختيار وجباتك أولاً',
    ];
    for (const literal of oldLiterals) {
      expect(source, `page must not contain ${literal}`).not.toContain(literal);
    }
    const newLiterals = [
      'ابحث عن صنف...',
      'جارٍ تحميل قائمة الأصناف...',
      'لا توجد أصناف في هذا القسم',
      'اختر أصنافك المفضلة من القائمة لتظهر هنا فوراً',
      'عدد الأصناف:',
      'صنف في الصينية',
      'السلة فارغة، يرجى اختيار أصنافك أولاً',
    ];
    for (const literal of newLiterals) {
      expect(source, `page must contain ${literal}`).toContain(literal);
    }
  });

  it('legitimate food screens keep their own "وجبة" wording', () => {
    const expectations: Array<[string, string[]]> = [
      [
        'src/features/pos/components/PosProductsPanel.tsx',
        ['جميع الوجبات', 'وجبات الغداء', 'وجبات العشاء'],
      ],
      [
        'src/features/pos/components/pos-workspace/PosComboMealModal.tsx',
        ['وجبة كومبو', 'إضافة وجبة الكومبو بالسلة', 'إجمالي سعر الوجبة'],
      ],
      [
        'src/features/pos/components/kds/KdsStandbyState.tsx',
        ['تذاكر الوجبات'],
      ],
      [
        'src/features/pos/components/pos-workspace/PosDriveThruModal.tsx',
        ['إتمام تسليم الوجبة'],
      ],
      [
        'src/features/pos/components/pos-workspace/PosFoodWasteModal.tsx',
        ['الوجبات'],
      ],
    ];
    for (const [rel, words] of expectations) {
      const source = readSourceT15C(rel);
      for (const word of words) {
        expect(source, `${rel} must still contain ${word}`).toContain(word);
      }
    }
  });
});
