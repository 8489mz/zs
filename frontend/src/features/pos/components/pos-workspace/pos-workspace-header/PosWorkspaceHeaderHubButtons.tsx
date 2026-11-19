// Online-orders badge, screens-hub trigger and restaurant-ops trigger
// for the POS header actions row.
// Pure move; the header keeps all state and mounts this component.

import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { MonitorIcon, UtensilsIcon } from '@/shared/components/icons/AppIcons';

export interface PosWorkspaceHeaderHubButtonsProps {
  isStorefrontActive: boolean;
  pendingCount: number;
  setIsOnlineOrdersOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsDisplaysModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isDisplaysModalOpen: boolean;
  isRestaurantActive: boolean;
  setIsOpsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isOpsModalOpen: boolean;
  count86: number;
}

export function PosWorkspaceHeaderHubButtons({
  isStorefrontActive,
  pendingCount,
  setIsOnlineOrdersOpen,
  setIsDisplaysModalOpen,
  isDisplaysModalOpen,
  isRestaurantActive,
  setIsOpsModalOpen,
  isOpsModalOpen,
  count86,
}: PosWorkspaceHeaderHubButtonsProps) {
  const { t } = useTranslation();
  return (
    <>
          {/* 5. Online Orders Smart Notification Badge (Only when Storefront is active and pending orders exist) */}
          {isStorefrontActive && pendingCount > 0 && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsOnlineOrdersOpen(true)}
              style={{
                fontWeight: 700,
                background: '#ffffff',
                color: '#1e293b',
                border: '1px solid #cbd5e1',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
              title={t('pos.pos_workspace.pos_workspace_header.s32', "طلبات متجر إلكتروني جديدة معلقة بانتظار الاعتماد")}
            >
              <span>{t('pos.pos_workspace.pos_workspace_header.s33', "طلبات أونلاين")}</span>
              <span
                style={{
                  background: '#ef4444',
                  color: '#ffffff',
                  fontSize: '11px',
                  fontWeight: 900,
                  borderRadius: '999px',
                  padding: '1px 7px',
                  lineHeight: '1.2',
                }}
              >
                {pendingCount}
              </span>
            </Button>
          )}

          {/* 6. Screens Hub Trigger Button */}
          <Button
            type="button"
            variant="secondary"
            onClick={() => setIsDisplaysModalOpen(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 700,
              background: isDisplaysModalOpen ? '#f1f5f9' : '#ffffff',
              color: '#1e293b',
              border: '1px solid #cbd5e1',
            }}
            title={t('pos.pos_workspace.pos_workspace_header.s34', "مركز شاشات العرض الخارجية والمحطات التفاعلية")}
          >
            <MonitorIcon size={16} color="#170e5e" />
            <span>{t('pos.pos_workspace.pos_workspace_header.s35', "شاشات العرض")}</span>
          </Button>

          {/* 7. Restaurant Operations Modal Trigger Button */}
          {isRestaurantActive && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsOpsModalOpen(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: 700,
                background: isOpsModalOpen ? '#f1f5f9' : '#ffffff',
                color: '#1e293b',
                border: '1px solid #cbd5e1',
              }}
              title={t('pos.pos_workspace.pos_workspace_header.s36', "مركز عمليات وأدوات المطعم المتقدمة")}
            >
              <UtensilsIcon size={16} color="#170e5e" />
              <span>{t('pos.pos_workspace.pos_workspace_header.s37', "عمليات المطعم")}</span>
              {count86 > 0 && (
                <span
                  style={{
                    background: '#ef4444',
                    color: '#ffffff',
                    fontSize: '10px',
                    fontWeight: 800,
                    padding: '1px 5px',
                    borderRadius: '999px',
                    lineHeight: '1.2',
                  }}
                >
                  {count86}
                </span>
              )}
            </Button>
          )}
    </>
  );
}
