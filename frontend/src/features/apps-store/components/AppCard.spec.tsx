/*
New file: frontend/src/features/apps-store/components/AppCard.spec.tsx
Pins the tenant-admin install gate (INV-ULTIMATE-TENANT-SELF-INSTALL).

THE GAP: a tenant admin on the Ultimate plan saw every installable app as
locked — the card showed the plan-name lock badge and a
"طلب التفعيل والترقية" button even for apps his plan already allows
(table selection, delivery couriers, van sales, barcode scales), while the
page's own isAppAllowedByPlan said they were allowed.

THE RULE: the card's badge and action follow isAllowedByPlan, not the
admin's role. An allowed, inactive app shows "متاح للتثبيت" and
"تثبيت وتفعيل" for a tenant admin exactly as for the super admin; only a
not-allowed app shows the lock badge (naming the REQUIRED plan, never the
tenant's own plan as the barrier) and "طلب التفعيل والترقية". Active apps
keep "مُفعّل ضمن باقتك" for a tenant admin and "إلغاء التثبيت" for the
super admin; uninstall stays super-admin-only.

WHAT THIS PINS, driving the REAL AppCard with the REAL catalog entries:
- Table selection, couriers, van sales and barcode scales (allowed,
  inactive, tenant admin): badge "متاح للتثبيت", button "تثبيت وتفعيل",
  and clicking it calls onToggle(app, false).
- Online store (not allowed, inactive, tenant admin): lock badge
  "باقة التجارة الشاملة (Omnichannel)", button "طلب التفعيل والترقية",
  and clicking it opens the upgrade modal, never onToggle.
- Active app, tenant admin: "مُفعّل ضمن باقتك", no install/uninstall button.
- Super admin, inactive + allowed: "تثبيت وتفعيل"; active: "إلغاء التثبيت".
*/

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppCard } from '@/features/apps-store/components/AppCard';
import { APPS_CATALOG } from '@/features/apps-store/data/apps-catalog';
import type { AppItemDefinition } from '@/features/apps-store/types/apps-store.types';

function appByKey(key: string): AppItemDefinition {
  const app = APPS_CATALOG.find((a) => a.key === key);
  if (!app) throw new Error(`catalog app missing: ${key}`);
  return app;
}

interface CardProps {
  app: AppItemDefinition;
  isActive?: boolean;
  isAllowedByPlan?: boolean;
  isSuperAdmin?: boolean;
}

function renderCard(props: CardProps) {
  const onToggle = vi.fn();
  const onOpenUpgradeModal = vi.fn();
  render(
    <MemoryRouter>
      <AppCard
        app={props.app}
        isActive={props.isActive ?? false}
        isAllowedByPlan={props.isAllowedByPlan ?? true}
        isPending={false}
        isSuperAdmin={props.isSuperAdmin ?? false}
        onToggle={onToggle}
        onOpenUpgradeModal={onOpenUpgradeModal}
      />
    </MemoryRouter>,
  );
  return { onToggle, onOpenUpgradeModal };
}

function installButton() {
  return screen.getByRole('button', { name: 'تثبيت وتفعيل' });
}

describe('AppCard tenant-admin install gate', () => {
  it.each([
    ['posShowCartMeta', 'تحديد الطاولة والعميل بالسلة'],
    ['deliveryRepsModuleEnabled', 'إدارة مناديب التوصيل والدليفري'],
    ['vanSalesModuleEnabled', 'مبيعات وتوزيع الفان (الأسطول الميداني)'],
    ['weightedBarcodeEnabled', 'تشفير باركود الموازين الإلكترونية'],
  ])('tenant admin sees %s as installable, never as an upgrade request', (key, title) => {
    const app = appByKey(key);
    const { onToggle, onOpenUpgradeModal } = renderCard({ app, isActive: false, isAllowedByPlan: true, isSuperAdmin: false });

    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText('متاح للتثبيت')).toBeTruthy();
    expect(screen.queryByText('طلب التفعيل والترقية')).toBeNull();

    fireEvent.click(installButton());
    expect(onToggle).toHaveBeenCalledWith(app, false);
    expect(onOpenUpgradeModal).not.toHaveBeenCalled();
  });

  it('tenant admin sees the online store as locked by its required plan, with the upgrade path', () => {
    const app = appByKey('storefrontModuleEnabled');
    const { onToggle, onOpenUpgradeModal } = renderCard({ app, isActive: false, isAllowedByPlan: false, isSuperAdmin: false });

    expect(screen.getByText('المتجر الإلكتروني السحابي وبوابات الدفع')).toBeTruthy();
    expect(screen.getByText('باقة التجارة الشاملة (Omnichannel)')).toBeTruthy();
    expect(screen.queryByText('تثبيت وتفعيل')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /طلب التفعيل والترقية/ }));
    expect(onOpenUpgradeModal).toHaveBeenCalledWith(app);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('tenant admin sees an active app as included in the subscription, with no install or uninstall button', () => {
    renderCard({ app: appByKey('posShowCartMeta'), isActive: true, isAllowedByPlan: true, isSuperAdmin: false });

    expect(screen.getByText('مُفعّل ضمن باقتك')).toBeTruthy();
    expect(screen.queryByText('تثبيت وتفعيل')).toBeNull();
    expect(screen.queryByText('إلغاء التثبيت')).toBeNull();
  });

  it('super admin keeps the install button on an allowed app and uninstall on an active app', () => {
    const { onToggle } = renderCard({ app: appByKey('posShowCartMeta'), isActive: false, isAllowedByPlan: true, isSuperAdmin: true });
    fireEvent.click(installButton());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('super admin sees the uninstall button on an active app', () => {
    renderCard({ app: appByKey('posShowCartMeta'), isActive: true, isAllowedByPlan: true, isSuperAdmin: true });
    expect(screen.getByRole('button', { name: 'إلغاء التثبيت' })).toBeTruthy();
  });
});
