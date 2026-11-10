/* INV-REST-DISPLAY-ZERO-SHOWROOM (T14-D, K6) — the customer-display family
 * must carry no showroom/retail-identity copy: no hardcoded showroom promo,
 * no invented payment-methods block, no "المعرض" / "صالة البيع" / "تسوق"
 * wording in the display pages, the displays portal, the displays modal,
 * or the K6 locale values that win at runtime over the t() fallbacks.
 * The dictionary's dead showroom entries are deleted (the warehouse
 * "صالة العرض" location entries are legitimate domain vocabulary and stay).
 * At base (219e337a) these assertions fail on the hardcoded copy; with the
 * fix they pass. The spec reads the shipped source/locale files as text
 * and drives the real promo builder from the display page.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildDefaultPromotions } from '../pages/CustomerFacingDisplayPage';

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const FORBIDDEN = ['المعرض', 'صالة البيع', 'تسوق'] as const;

const DISPLAY_SOURCES = [
  'src/features/pos/pages/CustomerFacingDisplayPage.tsx',
  'src/features/pos/components/customer-display/CfdIdleView.tsx',
  'src/features/pos/components/customer-display/CfdScanningView.tsx',
  'src/features/pos/components/customer-display/CfdCompletedView.tsx',
  'src/features/pos/pages/DisplaysPortalPage.tsx',
  'src/features/pos/components/pos-workspace/PosDisplaysModal.tsx',
] as const;

function readSource(rel: string): string {
  return readFileSync(path.join(FRONTEND_ROOT, rel), 'utf8');
}

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readSource(rel)) as Record<string, unknown>;
}

describe('display-copy zero-showroom (INV-REST-DISPLAY-ZERO-SHOWROOM)', () => {
  it('no forbidden showroom wording in any display-family source file', () => {
    for (const rel of DISPLAY_SOURCES) {
      const source = readSource(rel);
      for (const word of FORBIDDEN) {
        expect(source, `${rel} must not contain ${word}`).not.toContain(word);
      }
    }
  });

  it('promo rotation is neutral welcome + loyalty, driven by the real store name', () => {
    const promotions = buildDefaultPromotions('متجر الاختبار');
    expect(promotions.length).toBeGreaterThan(0);
    for (const promo of promotions) {
      for (const word of FORBIDDEN) {
        expect(promo.title, `promo title must not contain ${word}`).not.toContain(word);
        expect(promo.subtitle, `promo subtitle must not contain ${word}`).not.toContain(word);
        expect(promo.badge, `promo badge must not contain ${word}`).not.toContain(word);
      }
    }
    expect(promotions[0].title).toContain('متجر الاختبار');
    expect(promotions.map((promo) => promo.id)).toContain('promo-loyalty');
  });

  it('payment-methods block is dropped from the idle view', () => {
    const source = readSource('src/features/pos/components/customer-display/CfdIdleView.tsx');
    expect(source).not.toContain('cfd-kiosk-payments-box');
    expect(source).not.toContain('cfd-payment-chip');
  });

  it('dining-hall "الصالة" references in the displays modal are kept', () => {
    const source = readSource('src/features/pos/components/pos-workspace/PosDisplaysModal.tsx');
    expect(source).toContain('تلفزيون الصالة');
    expect(source).toContain('كابتن الصالة');
  });

  it('K6 locale values carry no forbidden showroom wording', () => {
    const ar = readJson('src/locales/ar.json');
    const pos = ar.pos as Record<string, Record<string, Record<string, string>>>;
    const customerDisplay = pos.customer_display;
    const displaysPortal = pos.displays_portal_page as unknown as Record<string, string>;
    const k6Values: Array<[string, string]> = [
      ['cfd_idle_view.s1', customerDisplay.cfd_idle_view.s1],
      ['cfd_idle_view.s4', customerDisplay.cfd_idle_view.s4],
      ['cfd_idle_view.s5', customerDisplay.cfd_idle_view.s5],
      ['cfd_idle_view.s7', customerDisplay.cfd_idle_view.s7],
      ['cfd_idle_view.s14', customerDisplay.cfd_idle_view.s14],
      ['cfd_idle_view.s15', customerDisplay.cfd_idle_view.s15],
      ['cfd_idle_view.s16', customerDisplay.cfd_idle_view.s16],
      ['cfd_idle_view.s17', customerDisplay.cfd_idle_view.s17],
      ['cfd_idle_view.s18', customerDisplay.cfd_idle_view.s18],
      ['cfd_idle_view.s19', customerDisplay.cfd_idle_view.s19],
      ['cfd_scanning_view.s0', customerDisplay.cfd_scanning_view.s0],
      ['cfd_completed_view.s1', customerDisplay.cfd_completed_view.s1],
      ['displays_portal_page.s2', displaysPortal.s2],
      ['pos_displays_modal.s2', pos.pos_workspace.pos_displays_modal.s2],
      ['pos_displays_modal.s3', pos.pos_workspace.pos_displays_modal.s3],
    ];
    for (const [key, value] of k6Values) {
      expect(typeof value, `${key} must exist`).toBe('string');
      for (const word of FORBIDDEN) {
        expect(value, `${key} must not contain ${word}`).not.toContain(word);
      }
    }
  });

  it('dead showroom dictionary entries are gone; warehouse entries stay', () => {
    const dict = readJson('src/lib/ui-dictionary.json');
    const deadKeys = [
      'بث مباشر بصالة العرض',
      'تسليم فوري من صالة العرض',
      'مزايا التسوق في صالة العرض',
      'متوفر بصالة العرض',
      'جاري تحميل عروض ومنتجات صالة العرض...',
      "( 'أهلاً بكم في صالة العرض • عروض وتخفيضات كبرى على مدار الأسبوع • امسح كود الـ QR للتسوق من هاتفك فورياً • نضمن لكم أعلى جودة بأفضل سعر' ); const [viewFilter, setViewFilter] = useState",
    ];
    for (const key of deadKeys) {
      expect(dict, `dictionary must not contain ${key}`).not.toHaveProperty(key);
    }
    const warehouseKeys = [
      'المستودع المصدر هو نفسه موقع صالة العرض:',
      'لا توجد أصناف ناقصة أو مباعة تتطلب تعويضاً من المستودع حالياً في صالة العرض المحددة.',
      'يجب اختيار مستودع مصدر مختلف عن صالة العرض',
    ];
    for (const key of warehouseKeys) {
      expect(dict, `warehouse entry must stay: ${key}`).toHaveProperty(key);
    }
  });
});
