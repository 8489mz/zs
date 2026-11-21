import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/shared/ui/button';
import { RefreshCwIcon, SearchIcon } from '@/shared/components/icons/AppIcons';

export interface PreSalesFilterBarProps {
  approvedCount: number;
  convertedCount: number;
  dateFrom: string;
  dateTo: string;
  isFetching: boolean;
  openConsolidateModal: () => void;
  refetch: () => void;
  reps: Array<{ id: number; name: string }>;
  searchQuery: string;
  selectedOrderIds: number[];
  selectedRepId: number | '';
  selectedStatus: string;
  setDateFrom: Dispatch<SetStateAction<string>>;
  setDateTo: Dispatch<SetStateAction<string>>;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  setSelectedRepId: Dispatch<SetStateAction<number | ''>>;
  setSelectedStatus: Dispatch<SetStateAction<string>>;
}

export function PreSalesFilterBar({
  approvedCount,
  convertedCount,
  dateFrom,
  dateTo,
  isFetching,
  openConsolidateModal,
  refetch,
  reps,
  searchQuery,
  selectedOrderIds,
  selectedRepId,
  selectedStatus,
  setDateFrom,
  setDateTo,
  setSearchQuery,
  setSelectedRepId,
  setSelectedStatus,
}: PreSalesFilterBarProps) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        padding: '12px 14px',
        border: '1px solid #e2e8f0',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '10px',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', flex: 1 }}>
        <div style={{ position: 'relative', minWidth: '180px' }}>
          <input
            type="text"
            placeholder={t('delivery_reps.van_pre_sales_admin_tab.s8', "ابحث برقم الطلب أو العميل...")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              height: '34px',
              padding: '0 28px 0 10px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '12px',
              boxSizing: 'border-box',
            }}
          />
          <SearchIcon
            size={14}
            color="#94a3b8"
            style={{ position: 'absolute', right: '9px', top: '10px' }}
          />
        </div>

        <select
          value={selectedRepId}
          onChange={(e) => setSelectedRepId(e.target.value ? Number(e.target.value) : '')}
          style={{
            height: '34px',
            padding: '0 10px',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            fontSize: '12px',
            color: '#0f172a',
          }}
        >
          <option value="">{t('delivery_reps.van_pre_sales_admin_tab.s9', "جميع المناديب")}</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>

        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          style={{
            height: '34px',
            padding: '0 10px',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            fontSize: '12px',
            color: '#0f172a',
          }}
        >
          <option value="all">{t('delivery_reps.van_pre_sales_admin_tab.s10', "كافة الحالات")}</option>
          <option value="pending_supervisor">{t('delivery_reps.van_pre_sales_admin_tab.s11', "بانتظار الاعتماد فقط")}</option>
          <option value="approved">{t('delivery_reps.van_pre_sales_admin_tab.s12', "المعتمدة والجازة للتجهيز")}</option>
          <option value="converted">{t('delivery_reps.van_pre_sales_admin_tab.s13', "تم التحويل والتنفيذ (")}{convertedCount})</option>
          <option value="rejected">{t('delivery_reps.van_pre_sales_admin_tab.s14', "المرفوضة")}</option>
        </select>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ fontSize: '11px', color: '#64748b' }}>{t('delivery_reps.van_pre_sales_admin_tab.s15', "من:")}</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{
              height: '34px',
              padding: '0 6px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '11.5px',
            }}
          />
          <span style={{ fontSize: '11px', color: '#64748b' }}>{t('delivery_reps.van_pre_sales_admin_tab.s16', "إلى:")}</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={{
              height: '34px',
              padding: '0 6px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '11.5px',
            }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {approvedCount > 0 && (
          <Button
            variant="primary"
            onClick={openConsolidateModal}
            style={{
              height: '34px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              fontWeight: 700,
              backgroundColor: '#170e5e',
              color: '#ffffff',
            }}
          >
            <span>
              {t('delivery_reps.van_pre_sales_admin_tab.s17', "تجميع وتوليد إذن تحميل للسيارة")}
              {selectedOrderIds.length > 0 ? ` (${selectedOrderIds.length})` : ` (${approvedCount})`}
            </span>
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={() => refetch()}
          disabled={isFetching}
          style={{
            height: '34px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          <RefreshCwIcon size={14} className={isFetching ? 'spin' : ''} />
          <span>{t('delivery_reps.van_pre_sales_admin_tab.s18', "تحديث")}</span>
        </Button>
      </div>
    </div>
  );
}
