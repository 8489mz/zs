// PosWorkspaceHeaderCoreActions — mode toggle + branch info + fast actions + customize + phone order.
// Pure move from PosWorkspaceHeader.tsx (L271-339); no behavior change.

import type { Dispatch, SetStateAction } from 'react';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import type { PosSaleMode } from '@/features/pos/lib/pos-sale-mode';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { PhoneCallIcon, SlidersIcon } from '@/shared/components/icons/AppIcons';

export interface PosWorkspaceHeaderCoreActionsProps {
  isRestaurantActive: boolean;
  posMode: PosSaleMode;
  onModeChange: (mode: PosSaleMode) => void;
  pos: PosWorkspaceState;
  onFocusSearch: () => void;
  isServicesActive: boolean;
  onOpenQuickService?: () => void;
  onOpenReprintModal?: () => void;
  setIsExchangeOpen: Dispatch<SetStateAction<boolean>>;
  setIsCustomizationOpen: Dispatch<SetStateAction<boolean>>;
  isPhoneOrdersActive: boolean;
  onOpenPhoneOrder?: () => void;
}

export function PosWorkspaceHeaderCoreActions({
  isRestaurantActive,
  posMode,
  onModeChange,
  pos,
  onFocusSearch,
  isServicesActive,
  onOpenQuickService,
  onOpenReprintModal,
  setIsExchangeOpen,
  setIsCustomizationOpen,
  isPhoneOrdersActive,
  onOpenPhoneOrder,
}: PosWorkspaceHeaderCoreActionsProps) {
  const { t } = useTranslation();
  return (
    <>
          {/* 1. Mode Toggle (Retail only - Restaurants use Touch exclusively) */}
          {!isRestaurantActive && (
            <div className="pos-mode-toggle" role="group" aria-label="POS mode">
              <Button type="button" variant={posMode === 'scanner' ? 'primary' : 'secondary'} onClick={() => onModeChange('scanner')}>{t('pos.pos_workspace.pos_workspace_header.s3', "سكانر")}</Button>
              <Button type="button" variant={posMode === 'touch' ? 'primary' : 'secondary'} onClick={() => onModeChange('touch')}>{t('pos.pos_workspace.pos_workspace_header.s4', "تاتش")}</Button>
            </div>
          )}

          {/* 2. Branch Info */}
          {pos.currentBranch?.name && (
            <div className="pos-header-branch-info" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', background: '#f1f5f9', border: '1px solid #e2e8f0', padding: '5px 12px', borderRadius: '8px', fontWeight: 700, color: '#334155' }}>
              <span>{pos.currentBranch.name}</span>
              <span style={{ opacity: 0.4 }}>|</span>
              <span>{(pos.currentBranch as any).salesStockMode === 'all_operational_locations' ? t('pos.pos_workspace.pos_workspace_header.s5', "كل المخازن") : t('pos.pos_workspace.pos_workspace_header.s6', "مخزن أساسي")}</span>
            </div>
          )}

          {/* 3. Fast Actions */}
          <Button type="button" variant="secondary" onClick={onFocusSearch} title={t('pos.pos_workspace.pos_workspace_header.s7', "البحث في الأصناف (F6)")}>
            {t('pos.pos_workspace.pos_workspace_header.s8', "البحث F6")}
          </Button>
          {isServicesActive && onOpenQuickService && (
            <Button type="button" variant="secondary" onClick={onOpenQuickService} title={t('pos.pos_workspace.pos_workspace_header.s9', "قائمة الخدمات السريعة (F8)")}>
              {t('pos.pos_workspace.pos_workspace_header.s10', "خدمة سريعة F8")}
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={onOpenReprintModal || pos.reprintLastSale} title={t('pos.pos_workspace.pos_workspace_header.s11', "إعادة طباعة الفواتير (F9)")}>
            {t('pos.pos_workspace.pos_workspace_header.s12', "F9 إعادة طباعة")}
          </Button>
          {!isRestaurantActive && (
            <Button type="button" variant="secondary" onClick={() => setIsExchangeOpen(true)} disabled={!pos.ownOpenShift || !pos.cart.length} title={t('pos.pos_workspace.pos_workspace_header.s13', "استبدال بضاعة بالفاتورة الأصلية")}>
              {t('pos.pos_workspace.pos_workspace_header.s14', "استبدال فوري")}
            </Button>
          )}

          {/* Quick UI Customization Button */}
          <Button
            type="button"
            variant="secondary"
            className="pos-customize-btn"
            onClick={() => setIsCustomizationOpen(true)}
            title={t('pos.customize_ui_title', "تخصيص واجهة الكاشير والشاشات المتنقلة")}
            aria-label={t('pos.customize_short', "تخصيص الواجهة")}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px' }}
          >
            <SlidersIcon size={16} color="#170e5e" />
          </Button>

          {/* Phone & Delivery Order Desk (F7) */}
          {isPhoneOrdersActive && onOpenPhoneOrder && (
            <Button
              type="button"
              variant="secondary"
              onClick={onOpenPhoneOrder}
              style={{
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                color: pos.orderType === 'delivery' ? '#ffffff' : '#334155',
                background: pos.orderType === 'delivery' ? '#170e5e' : undefined,
                border: pos.orderType === 'delivery' ? '1px solid #170e5e' : undefined,
              }}
              title={t('pos.pos_workspace.pos_workspace_header.s15', "مكتب طلبات الهاتف والتوصيل السريع وكاشف المتصل (F7 أو Alt + P)")}
            >
              <PhoneCallIcon size={14} color={pos.orderType === 'delivery' ? '#ffffff' : '#170e5e'} />
              <span>{t('pos.pos_workspace.pos_workspace_header.s16', "طلب هاتفي F7")}</span>
            </Button>
          )}
    </>
  );
}
