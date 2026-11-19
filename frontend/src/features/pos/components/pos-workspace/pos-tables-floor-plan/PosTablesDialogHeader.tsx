import { useTranslation } from 'react-i18next';
import { XIcon } from '@/shared/components/icons/AppIcons';
import { formatCurrency } from '@/lib/format';

// Header bar of the tables floor-plan dialog: title + subtitle
// (current table, cart count/total) + close button. Pure move from
// PosTablesFloorPlanDialog; the dialog keeps all state.

export interface PosTablesDialogHeaderProps {
  currentTableNumber: string;
  currentCartItemsCount?: number;
  currentCartTotal?: number;
  onClose: () => void;
}

export function PosTablesDialogHeader({
  currentTableNumber,
  currentCartItemsCount = 0,
  currentCartTotal = 0,
  onClose,
}: PosTablesDialogHeaderProps) {
  const { t: __t } = useTranslation();
  return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 900, color: '#0f172a' }}>
                {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s1', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s1', "خريطة الصالة وإدارة الطاولات والطلبات"))}
              </h3>
              {currentTableNumber && (
                <span
                  style={{
                    fontSize: '11.5px',
                    background: currentCartItemsCount > 0 ? '#eff6ff' : '#f8fafc',
                    color: currentCartItemsCount > 0 ? '#170e5e' : '#475569',
                    border: currentCartItemsCount > 0 ? '1.5px solid #bfdbfe' : '1px solid #cbd5e1',
                    padding: '3px 10px',
                    borderRadius: '6px',
                    fontWeight: 800,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span>{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s2', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s2', "الطاولة الحالية بالسلة:"))} {currentTableNumber}</span>
                  {currentCartItemsCount > 0 && (
                    <span
                      style={{
                        background: '#170e5e',
                        color: '#ffffff',
                        borderRadius: '4px',
                        padding: '1px 6px',
                        fontSize: '10.5px',
                        fontWeight: 900,
                      }}
                    >
                      {formatCurrency(currentCartTotal)} ({currentCartItemsCount} {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s3', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s3', "صنف بالسلة)"))}
                    </span>
                  )}
                </span>
              )}
            </div>
            <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#64748b' }}>
              {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s4', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s4', "إدارة شاملة لطاولات الصالة وجلسات الطعام والطلبات المعلقة والتيك أواي"))}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#64748b',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: '6px',
              borderRadius: '6px',
            }}
            title={__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s5', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s5', "إغلاق"))}
          >
            <XIcon size={16} />
          </button>
        </div>
  );
}
