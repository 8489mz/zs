/*
 * Pins the SaaS-Only Module Control rule (INV-SAAS-ONLY-MODULE-CONTROL) on AppCard:
 * - Regular tenant admins never see a self-install ("تثبيت وتفعيل") or uninstall
 *   ("إلغاء التثبيت") button:
 *   - Included & inactive apps show badge "مُتاح عبر الإدارة" and button "طلب التفعيل من الإدارة"
 *     which opens the activation dialog (onOpenUpgradeModal) and never calls onToggle.
 *   - Higher-plan apps show the required plan lock badge and "طلب التفعيل والترقية".
 *   - Active apps show "مُفعّل ضمن باقتك" and "مُدرج بالاشتراك" without toggle buttons.
 * - Super admin (and active SaaS impersonation session) keeps "تثبيت وتفعيل" for inactive
 *   apps and "إلغاء التثبيت" for active apps.
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

describe('AppCard SaaS-only module control', () => {
  it.each([
    ['posShowCartMeta', 'تحديد الطاولة والعميل بالسلة'],
    ['deliveryRepsModuleEnabled', 'إدارة مناديب التوصيل والدليفري'],
    ['vanSalesModuleEnabled', 'مبيعات وتوزيع الفان (الأسطول الميداني)'],
    ['weightedBarcodeEnabled', 'تشفير باركود الموازين الإلكترونية'],
  ])('tenant admin sees %s as SaaS-managed activation request, never self-install', (key, title) => {
    const app = appByKey(key);
    const { onToggle, onOpenUpgradeModal } = renderCard({ app, isActive: false, isAllowedByPlan: true, isSuperAdmin: false });

    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText('مُتاح عبر الإدارة')).toBeTruthy();
    expect(screen.queryByText('تثبيت وتفعيل')).toBeNull();
    expect(screen.queryByText('طلب التفعيل والترقية')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'طلب التفعيل من الإدارة' }));
    expect(onOpenUpgradeModal).toHaveBeenCalledWith(app);
    expect(onToggle).not.toHaveBeenCalled();
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
    expect(screen.getByText('مُدرج بالاشتراك')).toBeTruthy();
    expect(screen.queryByText('تثبيت وتفعيل')).toBeNull();
    expect(screen.queryByText('إلغاء التثبيت')).toBeNull();
  });

  it('super admin / SaaS impersonator keeps the install button on an allowed app and uninstall on an active app', () => {
    const { onToggle } = renderCard({ app: appByKey('posShowCartMeta'), isActive: false, isAllowedByPlan: true, isSuperAdmin: true });
    expect(screen.getByText('متاح للتثبيت')).toBeTruthy();
    fireEvent.click(installButton());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('super admin / SaaS impersonator sees the uninstall button on an active app', () => {
    const app = appByKey('vanSalesModuleEnabled');
    const { onToggle } = renderCard({ app, isActive: true, isAllowedByPlan: true, isSuperAdmin: true });
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء التثبيت' }));
    expect(onToggle).toHaveBeenCalledWith(app, true);
  });
});
