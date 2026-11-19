// Restaurant table controls — tables button, dining-course selector,
// guest-count stepper and guest-check print for the active table.
// Pure move; the header keeps all state and mounts this component.

import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { PrinterIcon } from '@/shared/components/icons/AppIcons';
import { formatCurrency } from '@/lib/format';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';

interface PosWorkspaceHeaderTableControlsProps {
  isRestaurantActive: boolean;
  onOpenTables?: () => void;
  onOpenHeldDrafts?: () => void;
  setIsTablesOpen: React.Dispatch<React.SetStateAction<boolean>>;
  pos: PosWorkspaceState;
  activeZoneMinSpend: number;
  currentCartTotal: number;
}

export function PosWorkspaceHeaderTableControls({
  isRestaurantActive,
  onOpenTables,
  onOpenHeldDrafts,
  setIsTablesOpen,
  pos,
  activeZoneMinSpend,
  currentCartTotal,
}: PosWorkspaceHeaderTableControlsProps) {
  const { t } = useTranslation();
  return (
    <>
          {/* 4. Restaurant Tables (Only when Restaurant Module is active) */}
          {isRestaurantActive && (
            <Button
              type="button"
              variant="secondary"
              onClick={onOpenTables || onOpenHeldDrafts || (() => setIsTablesOpen(true))}
              style={{
                fontWeight: 700,
                color: pos.tableNumber ? '#170e5e' : undefined,
                background: pos.tableNumber ? '#f1f5f9' : undefined,
                border: pos.tableNumber ? '1px solid #cbd5e1' : undefined,
              }}
              title={t('pos.pos_workspace.pos_workspace_header.s17', "إدارة طاولات الصالة وجلسات الطعام والطلبات المعلقة (F3)")}
            >
              {pos.tableNumber ? `طاولة: ${pos.tableNumber}` : t('pos.pos_workspace.pos_workspace_header.s18', "الطاولات F3")}
            </Button>
          )}

          {/* Dining Course Selector for Active Table */}
          {pos.tableNumber && (
            <div
              className="pos-header-table-controls"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                padding: '2px',
                gap: '2px',
              }}
              title={t('pos.pos_workspace.pos_workspace_header.s19', "تحديد مسار تقديم الوجبة للمطبخ (Courser)")}
            >
              {[
                { key: 'appetizer', label: t('pos.pos_workspace.pos_workspace_header.s20', "مقبلات") },
                { key: 'main', label: t('pos.pos_workspace.pos_workspace_header.s21', "رئيسي") },
                { key: 'dessert', label: t('pos.pos_workspace.pos_workspace_header.s22', "حلوى") },
              ].map((c) => {
                const active = (pos as any).diningCourse === c.key || (!pos.diningCourse && c.key === 'main');
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => (pos as any).setDiningCourse?.(c.key)}
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '2px 7px',
                      borderRadius: '4px',
                      border: 'none',
                      background: active ? '#170e5e' : 'transparent',
                      color: active ? '#ffffff' : '#64748b',
                      cursor: 'pointer',
                    }}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Guest Count (Covers) Stepper & Spend per guest - Strict RTL Stepper: [+] (العدد) [-] */}
          {(pos.tableNumber || pos.orderType === 'dine_in') && (
            <div
              className="pos-header-table-controls"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                padding: '2px 4px',
                gap: '3px',
                height: '30px',
              }}
              title={t('pos.pos_workspace.pos_workspace_header.s23', "عدد الضيوف على الطاولة ومؤشر متوسط إنفاق الفرد")}
            >
              <button
                type="button"
                onClick={() => (pos as any).setGuestCount?.((prev: number) => Math.min(99, (prev || 1) + 1))}
                style={{
                  width: '22px',
                  height: '22px',
                  border: 'none',
                  background: '#f1f5f9',
                  color: '#0f172a',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 900,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={t('pos.pos_workspace.pos_workspace_header.s24', "زيادة عدد الضيوف")}
              >
                +
              </button>
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#170e5e', minWidth: '46px', textAlign: 'center' }}>
                {(pos as any).guestCount || 1} {t('pos.pos_workspace.pos_workspace_header.s25', "ضيوف")}
              </span>
              <button
                type="button"
                onClick={() => (pos as any).setGuestCount?.((prev: number) => Math.max(1, (prev || 1) - 1))}
                style={{
                  width: '22px',
                  height: '22px',
                  border: 'none',
                  background: '#f1f5f9',
                  color: '#0f172a',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 900,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={t('pos.pos_workspace.pos_workspace_header.s26', "إنقاص عدد الضيوف")}
              >
                -
              </button>
              {pos.cart.length > 0 && (
                <span
                  style={{
                    marginRight: '4px',
                    paddingRight: '6px',
                    borderRight: '1px solid #e2e8f0',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    color: '#475569',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t('pos.pos_workspace.pos_workspace_header.s27', "متوسط الفرد:")} <strong style={{ color: '#047857' }}>{formatCurrency((pos.totals?.total || 0) / ((pos as any).guestCount || 1))}</strong>
                </span>
              )}
              {activeZoneMinSpend > 0 && (
                <span
                  style={{
                    marginRight: '4px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '10.5px',
                    fontWeight: 800,
                    whiteSpace: 'nowrap',
                    background: currentCartTotal >= activeZoneMinSpend ? '#ecfdf5' : '#fef2f2',
                    color: currentCartTotal >= activeZoneMinSpend ? '#047857' : '#b91c1c',
                    border: `1px solid ${currentCartTotal >= activeZoneMinSpend ? '#a7f3d0' : '#fecaca'}`,
                  }}
                  title={`الحد الأدنى لإنفاق الطاولة في هذه المنطقة: ${formatCurrency(activeZoneMinSpend)}`}
                >
                  {t('pos.pos_workspace.pos_workspace_header.s28', "الحد الأدنى:")} {formatCurrency(activeZoneMinSpend)} {currentCartTotal < activeZoneMinSpend && `(عجز: ${formatCurrency(activeZoneMinSpend - currentCartTotal)})`}
                </span>
              )}
            </div>
          )}

          {/* 1-Click Print Guest Check Button for Active Table/Cart (Restaurant Mode Only) */}
          {isRestaurantActive && (pos.tableNumber || pos.orderType === 'dine_in') && pos.cart.length > 0 && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => (pos as any).printGuestCheckNow?.()}
              style={{
                fontWeight: 700,
                fontSize: '11.5px',
                height: '30px',
                padding: '0 10px',
                color: '#170e5e',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
              title={t('pos.pos_workspace.pos_workspace_header.s29', "طباعة شيك حساب الطاولة غير المسدد للزبون للمعاينة")}
            >
              <PrinterIcon size={14} color="#170e5e" />
              <span>{(pos as any).guestCheckPrintedAt ? t('pos.pos_workspace.pos_workspace_header.s30', "تم تسليم الشيك (إعادة طباعة)") : t('pos.pos_workspace.pos_workspace_header.s31', "طباعة الشيك المبدئي")}</span>
            </Button>
          )}
    </>
  );
}
