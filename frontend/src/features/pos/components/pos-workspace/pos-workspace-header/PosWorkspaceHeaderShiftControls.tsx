// Shift controls — split-button dropdown (close shift, X-Report, no-sale
// drawer kick, customize, close shift) or the open-shift button.
// Pure move; the header keeps all state and mounts this component.

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/shared/ui/button';
import { ChevronDownIcon, PrinterIcon, SlidersIcon, LockIcon } from '@/shared/components/icons/AppIcons';
import { cashDrawerApi } from '@/lib/api/cash-drawer';
import { printXReport } from '@/shared/utils/cash-drawer-receipt';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import type { AppSettings } from '@/types/domain';

export interface PosWorkspaceHeaderShiftControlsProps {
  pos: PosWorkspaceState;
  shiftMenuRef: React.RefObject<HTMLDivElement | null>;
  setIsShiftMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isShiftMenuOpen: boolean;
  settings: AppSettings | undefined;
  setIsNoSaleOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsCustomizationOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onRequestOpenShift?: () => void;
}

export function PosWorkspaceHeaderShiftControls({
  pos,
  shiftMenuRef,
  setIsShiftMenuOpen,
  isShiftMenuOpen,
  settings,
  setIsNoSaleOpen,
  setIsCustomizationOpen,
  onRequestOpenShift,
}: PosWorkspaceHeaderShiftControlsProps) {
  const { t, i18n } = useTranslation();
  const isEn = Boolean(i18n.language && i18n.language.startsWith('en'));
  return (
    <>
          {/* 8. Shift Controls: Split-button with dropdown (Close Shift, X-Report, Emergency Drawer Kick) */}
          {pos.ownOpenShift ? (
            <div
              ref={shiftMenuRef}
              className="pos-shift-actions-group"
            >
              <Link
                to={`/cash-drawer?action=close${pos.ownOpenShift?.id ? `&shiftId=${pos.ownOpenShift.id}` : ''}`}
                style={{ textDecoration: 'none', display: 'inline-flex' }}
              >
                <Button
                  type="button"
                  variant="secondary"
                  className="pos-close-shift-btn"
                  title={t('pos.pos_workspace.pos_workspace_header.s38', "تقفيل الوردية الحالية وترحيل النقدية")}
                >
                  <span className="pos-close-shift-text-full">{t('pos.pos_workspace.pos_workspace_header.s39', "تقفيل الوردية")}</span>
                  <span className="pos-close-shift-text-short">{t('pos.pos_workspace.pos_workspace_header.s40', "تقفيل")}</span>
                </Button>
              </Link>
              <button
                type="button"
                onClick={() => setIsShiftMenuOpen((prev) => !prev)}
                className={`btn btn-secondary pos-shift-dropdown-trigger ${isShiftMenuOpen ? 'is-active' : ''}`}
                title={t('pos.pos_workspace.pos_workspace_header.s41', "خيارات الوردية (تقرير X، فتح الدرج، إقفال Z)")}
                aria-label={t('pos.pos_workspace.pos_workspace_header.s42', "خيارات الوردية")}
                aria-expanded={isShiftMenuOpen}
              >
                <ChevronDownIcon size={14} />
              </button>

              {isShiftMenuOpen && (
                <div
                  className="pos-shift-dropdown-menu"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: isEn ? 'auto' : 0,
                    right: isEn ? 0 : 'auto',
                    zIndex: 1050,
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '12px',
                    boxShadow: '0 12px 28px -4px rgba(15, 23, 42, 0.15), 0 4px 8px -2px rgba(15, 23, 42, 0.06)',
                    minWidth: '245px',
                    maxWidth: 'calc(100vw - 20px)',
                    boxSizing: 'border-box',
                    padding: '8px 8px 12px 8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    direction: isEn ? 'ltr' : 'rtl',
                    textAlign: isEn ? 'left' : 'right',
                  }}
                >
                  {/* Option 1: X-Report */}
                  <button
                    type="button"
                    onClick={async () => {
                      setIsShiftMenuOpen(false);
                      if (!pos.ownOpenShift?.id) return;
                      try {
                        const res = await cashDrawerApi.listPage({ page: 1, pageSize: 50, filter: 'open' });
                        const fresh = res.rows.find((s) => String(s.id) === String(pos.ownOpenShift?.id));
                        printXReport((fresh || pos.ownOpenShift) as any, settings?.storeName);
                      } catch {
                        printXReport(pos.ownOpenShift as any, settings?.storeName);
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '9px 10px',
                      width: '100%',
                      border: 'none',
                      background: 'transparent',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      textAlign: isEn ? 'left' : 'right',
                      color: '#0f172a',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '8px',
                      background: '#eef2ff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <PrinterIcon size={16} color="#170e5e" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>{t('pos.pos_workspace.pos_workspace_header.s43', "تقرير الوردية اللحظي (X)")}</span>
                      <span style={{ fontSize: '10.5px', color: '#64748b' }}>{t('pos.pos_workspace.pos_workspace_header.s44', "طباعة مبيعات ونقدية الدرج الحالية دون إغلاق")}</span>
                    </div>
                  </button>

                  {/* Option 2: Emergency / Audit No-Sale Drawer Kick (Desktop only - hidden on mobile) */}
                  <button
                    type="button"
                    className="pos-shift-drawer-item"
                    onClick={() => {
                      setIsShiftMenuOpen(false);
                      setIsNoSaleOpen(true);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '9px 10px',
                      width: '100%',
                      border: 'none',
                      background: 'transparent',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      textAlign: isEn ? 'left' : 'right',
                      color: '#0f172a',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '8px',
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <SlidersIcon size={15} color="#334155" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>{t('pos.pos_workspace.pos_workspace_header.s45', "فتح الدرج يدوياً (No-Sale)")}</span>
                      <span style={{ fontSize: '10.5px', color: '#64748b' }}>{t('pos.pos_workspace.pos_workspace_header.s46', "فتح الدرج للجرد أو الصرف مع تسجيل السبب")}</span>
                    </div>
                  </button>

                  {/* Option 2.8: Customize Cashier Interface (Desktop only - mobile already has dedicated header button) */}
                  <button
                    type="button"
                    className="pos-shift-customize-item"
                    onClick={() => {
                      setIsShiftMenuOpen(false);
                      setIsCustomizationOpen(true);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '9px 10px',
                      width: '100%',
                      border: 'none',
                      background: 'transparent',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      textAlign: isEn ? 'left' : 'right',
                      color: '#0f172a',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '8px',
                      background: '#f3e8ff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <SlidersIcon size={15} color="#7c3aed" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>{t('pos.customize_ui', "تخصيص واجهة الكاشير")}</span>
                      <span style={{ fontSize: '10.5px', color: '#64748b' }}>{t('pos.customize_ui_desc', "إظهار/إخفاء الأقسام وتنسيق الموبايل المتنقل")}</span>
                    </div>
                  </button>

                  <div style={{ height: '1px', background: '#f1f5f9', margin: '2px 0' }} />

                  {/* Option 3: Close Shift (Z-Report) */}
                  <Link
                    to={`/cash-drawer?action=close${pos.ownOpenShift?.id ? `&shiftId=${pos.ownOpenShift.id}` : ''}`}
                    onClick={() => setIsShiftMenuOpen(false)}
                    style={{ textDecoration: 'none' }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '9px 10px',
                        width: '100%',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        textAlign: isEn ? 'left' : 'right',
                        color: '#b91c1c',
                        background: 'transparent',
                        transition: 'background 0.12s',
                        boxSizing: 'border-box',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#fef2f2'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        background: '#fee2e2',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        <LockIcon size={15} color="#dc2626" />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#991b1b' }}>{t('pos.pos_workspace.pos_workspace_header.s47', "إغلاق وتصفير الوردية (Z)")}</span>
                        <span style={{ fontSize: '10.5px', color: '#b91c1c' }}>{t('pos.pos_workspace.pos_workspace_header.s48', "جرد العهدة النقدية وإقفال الجلسة")}</span>
                      </div>
                    </div>
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <Button type="button" variant="primary" className="pos-close-shift-btn" onClick={onRequestOpenShift}>
              <span className="pos-close-shift-text-full">{t('pos.pos_workspace.pos_workspace_header.s49', "فتح وردية")}</span>
              <span className="pos-close-shift-text-short">{t('pos.pos_workspace.pos_workspace_header.s50', "فتح")}</span>
            </Button>
          )}
    </>
  );
}
