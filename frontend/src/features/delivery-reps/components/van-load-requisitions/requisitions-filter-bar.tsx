import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { PlusIcon, RefreshCwIcon } from '@/shared/components/icons/AppIcons';

export interface RequisitionsFilterBarProps {
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  isRefreshing: boolean;
  onManualRefresh: () => Promise<void>;
  onCreateClick: () => void;
  pendingCount: number;
  totalCount: number;
}

export function RequisitionsFilterBar({
  statusFilter,
  onStatusFilterChange,
  isRefreshing,
  onManualRefresh,
  onCreateClick,
  pendingCount,
  totalCount,
}: RequisitionsFilterBarProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* Filter Bar */}
      <div
        style={{
          background: '#ffffff',
          padding: '12px 16px',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s8', "تصفية حسب الحالة:")}</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            {[
              { label: t('delivery_reps.van_load_requisitions_admin_tab.s9', "كافة الطلبات"), value: '' },
              { label: `بانتظار الصرف (${pendingCount})`, value: 'pending' },
              { label: t('delivery_reps.van_load_requisitions_admin_tab.s10', "تم الصرف"), value: 'dispatched' },
              { label: t('delivery_reps.van_load_requisitions_admin_tab.s11', "مرفوض"), value: 'rejected' },
            ].map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => onStatusFilterChange(f.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '7px',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: statusFilter === f.value ? '#170e5e' : '#f1f5f9',
                  color: statusFilter === f.value ? '#ffffff' : '#475569',
                  transition: 'none',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>
            {t('delivery_reps.van_load_requisitions_admin_tab.s12', "إجمالي السجلات:")} {totalCount}
          </span>
          <Button
            variant="secondary"
            disabled={isRefreshing}
            style={{
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: isRefreshing ? 'wait' : 'pointer',
              opacity: isRefreshing ? 0.75 : 1,
            }}
            onClick={onManualRefresh}
            title={t('delivery_reps.van_load_requisitions_admin_tab.s13', "تحديث قائمة أذونات التحميل من السيرفر")}
          >
            <RefreshCwIcon
              size={13}
              className={isRefreshing ? 'spin-animation' : undefined}
              style={isRefreshing ? { animation: 'spin 0.75s linear infinite' } : undefined}
            />
            {isRefreshing ? t('delivery_reps.van_load_requisitions_admin_tab.s14', "جارٍ التحديث...") : t('delivery_reps.van_load_requisitions_admin_tab.s15', "تحديث")}
          </Button>
          <Button
            variant="primary"
            style={{
              fontSize: '12px',
              backgroundColor: '#170e5e',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 700,
            }}
            onClick={onCreateClick}
          >
            <PlusIcon size={14} />
            {t('delivery_reps.van_load_requisitions_admin_tab.s16', "إنشاء إذن تحميل مباشر")}
          </Button>
        </div>
      </div>
    </>
  );
}
