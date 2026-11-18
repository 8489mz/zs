// Header info, mode switcher and status message for the split-bill modal.
// Pure move from PosSplitBillModal; the dialog keeps all state.

import { useTranslation } from 'react-i18next';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import { ReceiptIcon, UsersIcon } from '@/shared/components/icons/AppIcons';
import { formatCurrency } from '@/lib/format';

export function PosSplitBillHeader({
  pos,
  totalAmount,
  splitMode,
  setSplitMode,
  handleSplitBySeat,
  statusMessage,
}: {
  pos: PosWorkspaceState;
  totalAmount: number;
  splitMode: 'items' | 'even';
  setSplitMode: (mode: 'items' | 'even') => void;
  handleSplitBySeat: () => void;
  statusMessage: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      {/* Header Info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ReceiptIcon size={20} color="#170e5e" />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
              {t('pos.pos_workspace.pos_split_bill_modal.s2', "تقسيم الفاتورة")} {pos.tableNumber ? `(طاولة ${pos.tableNumber})` : ''}
            </h3>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              {t('pos.pos_workspace.pos_split_bill_modal.s3', "إجمالي الطلب:")} <strong style={{ color: '#170e5e' }}>{formatCurrency(totalAmount)}</strong> • {pos.cart.length} {t('pos.pos_workspace.pos_split_bill_modal.s4', "أصناف بالسلة")}
            </span>
          </div>
        </div>

        {/* Mode Switcher */}
        <div style={{ display: 'flex', gap: '6px', background: '#f1f5f9', padding: '4px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <button
            type="button"
            onClick={() => setSplitMode('items')}
            style={{
              padding: '6px 14px',
              borderRadius: '6px',
              border: 'none',
              background: splitMode === 'items' ? '#170e5e' : 'transparent',
              color: splitMode === 'items' ? '#ffffff' : '#475569',
              fontSize: '12.5px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {t('pos.pos_workspace.pos_split_bill_modal.s5', "تجزئة حسب الأصناف")}
          </button>
          <button
            type="button"
            onClick={() => setSplitMode('even')}
            style={{
              padding: '6px 14px',
              borderRadius: '6px',
              border: 'none',
              background: splitMode === 'even' ? '#170e5e' : 'transparent',
              color: splitMode === 'even' ? '#ffffff' : '#475569',
              fontSize: '12.5px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {t('pos.pos_workspace.pos_split_bill_modal.s6', "تقسيم بالتساوي (ضيوف)")}
          </button>
          <button
            type="button"
            onClick={handleSplitBySeat}
            style={{
              padding: '6px 14px',
              borderRadius: '6px',
              border: '1px solid #bfdbfe',
              background: '#eff6ff',
              color: '#1e40af',
              fontSize: '12.5px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
            title={t('pos.pos_workspace.pos_split_bill_modal.s7', "توزيع فوري لأصناف السلة على شيكات مستقلة حسب مقعد كل ضيف")}
          >
            <UsersIcon size={14} color="#1e40af" />
            {t('pos.pos_workspace.pos_split_bill_modal.s8', "توزيع فوري حسب المقاعد (Seat Split)")}
          </button>
        </div>
      </div>

      {/* Status Message */}
      {statusMessage && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '8px',
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            color: '#1e40af',
            fontSize: '12.5px',
            fontWeight: 700,
          }}
        >
          {statusMessage}
        </div>
      )}
    </>
  );
}
