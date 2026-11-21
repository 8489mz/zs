import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import {
  PlusCircleIcon,
  RefreshCwIcon,
  SearchIcon,
  SendIcon,
  XIcon,
} from '@/shared/components/icons/AppIcons';
import type { Dispatch, SetStateAction } from 'react';

export interface LedgerFilterBarProps {
  allReps: { id: number; name: string; phone?: string; vehicle_plate?: string }[];
  dateFrom: string;
  dateTo: string;
  handleManualRefresh: () => Promise<void>;
  handleOpenAddBonus: (targetRepId?: string) => void;
  isRefreshing: boolean;
  searchTerm: string;
  selectedIds: number[];
  selectedRepId: string;
  selectedStatus: string;
  setDateFrom: Dispatch<SetStateAction<string>>;
  setDateTo: Dispatch<SetStateAction<string>>;
  setIsPushPayrollOpen: Dispatch<SetStateAction<boolean>>;
  setSearchTerm: Dispatch<SetStateAction<string>>;
  setSelectedRepId: Dispatch<SetStateAction<string>>;
  setSelectedStatus: Dispatch<SetStateAction<string>>;
}

export function LedgerFilterBar({
  allReps,
  dateFrom,
  dateTo,
  handleManualRefresh,
  handleOpenAddBonus,
  isRefreshing,
  searchTerm,
  selectedIds,
  selectedRepId,
  selectedStatus,
  setDateFrom,
  setDateTo,
  setIsPushPayrollOpen,
  setSearchTerm,
  setSelectedRepId,
  setSelectedStatus,
}: LedgerFilterBarProps) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        padding: '10px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
        }}
      >
        {/* Right Filters */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', flex: 1, minWidth: '280px' }}>
          {/* Rep Selector */}
          <div style={{ width: '200px' }}>
            <CustomSelect
              value={selectedRepId}
              onChange={(val) => setSelectedRepId(val)}
              options={[
                { value: '', label: t('delivery_reps.van_financial_ledger_admin_tab.s11', "كافة مناديب التوزيع") },
                ...allReps.map((r) => ({
                  value: String(r.id),
                  label: `${r.name} ${r.phone ? `(${r.phone})` : ''}`,
                })),
              ]}
              placeholder={t('delivery_reps.van_financial_ledger_admin_tab.s12', "اختر المندوب")}
            />
          </div>

          {/* Status Filter */}
          <div style={{ width: '160px' }}>
            <CustomSelect
              value={selectedStatus}
              onChange={(val) => setSelectedStatus(val)}
              options={[
                { value: 'all', label: t('delivery_reps.van_financial_ledger_admin_tab.s13', "كافة الحالات") },
                { value: 'pending', label: t('delivery_reps.van_financial_ledger_admin_tab.s14', "المعلقة فقط (عجز)") },
                { value: 'settled', label: t('delivery_reps.van_financial_ledger_admin_tab.s15', "المسددة بالخزينة") },
                { value: 'pushed_to_payroll', label: t('delivery_reps.van_financial_ledger_admin_tab.s16', "المرحلة للرواتب") },
                { value: 'waived', label: t('delivery_reps.van_financial_ledger_admin_tab.s17', "المعفاة إدارياً") },
              ]}
              placeholder={t('delivery_reps.van_financial_ledger_admin_tab.s18', "حالة التسوية")}
            />
          </div>

          {/* Date Range */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{
                height: '32px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                padding: '0 6px',
                fontSize: '11px',
                fontWeight: 600,
                color: '#334155',
              }}
              title={t('delivery_reps.van_financial_ledger_admin_tab.s19', "من تاريخ")}
            />
            <span style={{ fontSize: '11px', color: '#64748b' }}>{t('delivery_reps.van_financial_ledger_admin_tab.s20', "إلى")}</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={{
                height: '32px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                padding: '0 6px',
                fontSize: '11px',
                fontWeight: 600,
                color: '#334155',
              }}
              title={t('delivery_reps.van_financial_ledger_admin_tab.s21', "إلى تاريخ")}
            />
            {(dateFrom || dateTo) && (
              <button
                type="button"
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#dc2626',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: '0 4px',
                }}
              >
                {t('delivery_reps.van_financial_ledger_admin_tab.s22', "إلغاء")}
              </button>
            )}
          </div>

          {/* Search Input */}
          <div style={{ position: 'relative', width: '200px' }}>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('delivery_reps.van_financial_ledger_admin_tab.s23', "بحث برقم الرحلة، السند، السبب...")}
              style={{
                width: '100%',
                height: '32px',
                backgroundColor: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '0 26px 0 8px',
                fontSize: '11px',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ position: 'absolute', top: '50%', right: '8px', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#94a3b8' }}>
              <SearchIcon size={12} />
            </div>
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                style={{ position: 'absolute', top: '50%', left: '6px', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
              >
                <XIcon size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Left Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Button
            variant="secondary"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            style={{
              height: '32px',
              padding: '0 10px',
              fontSize: '11.5px',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <RefreshCwIcon size={13} className={isRefreshing ? 'animate-spin' : ''} />
            <span>{t('delivery_reps.van_financial_ledger_admin_tab.s24', "تحديث")}</span>
          </Button>

          <Button
            variant="secondary"
            onClick={() => handleOpenAddBonus()}
            style={{
              height: '32px',
              padding: '0 10px',
              fontSize: '11.5px',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              color: '#170e5e',
              backgroundColor: '#ffffff',
              borderColor: '#e2e8f0',
            }}
          >
            <PlusCircleIcon size={13} color="#170e5e" />
            <span>{t('delivery_reps.van_financial_ledger_admin_tab.s25', "+ إضافة بونص / عمولة")}</span>
          </Button>

          <Button
            variant="primary"
            onClick={() => setIsPushPayrollOpen(true)}
            disabled={selectedIds.length === 0}
            style={{
              height: '32px',
              padding: '0 12px',
              fontSize: '11.5px',
              fontWeight: 800,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              backgroundColor: selectedIds.length > 0 ? '#170e5e' : '#cbd5e1',
              cursor: selectedIds.length > 0 ? 'pointer' : 'not-allowed',
            }}
          >
            <SendIcon size={13} color="#ffffff" />
            <span>{t('delivery_reps.van_financial_ledger_admin_tab.s26', "ترحيل للمرتبات (")}{selectedIds.length})</span>
          </Button>
        </div>
      </div>
    </div>
    );
}
