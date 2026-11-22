import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import {
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
} from '@/shared/components/icons/AppIcons';

export interface PromotionsFilterBarProps {
  searchTerm: string;
  setSearchTerm: Dispatch<SetStateAction<string>>;
  typeFilter: string;
  setTypeFilter: Dispatch<SetStateAction<string>>;
  statusFilter: 'all' | 'active' | 'inactive';
  setStatusFilter: Dispatch<SetStateAction<'all' | 'active' | 'inactive'>>;
  handleManualRefresh: () => Promise<void>;
  isRefreshing: boolean;
  openCreateDialog: () => void;
}

export function PromotionsFilterBar({
  searchTerm,
  setSearchTerm,
  typeFilter,
  setTypeFilter,
  statusFilter,
  setStatusFilter,
  handleManualRefresh,
  isRefreshing,
  openCreateDialog,
}: PromotionsFilterBarProps) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        padding: '16px 20px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '1 1 320px', maxWidth: '420px' }}>
        <div style={{ position: 'relative', width: '100%' }}>
          <SearchIcon
            size={16}
            style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}
          />
          <input
            type="text"
            placeholder={t('delivery_reps.van_promotions_admin_tab.s8', "البحث باسم العرض أو الكود...")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              height: '38px',
              padding: '0 38px 0 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              outline: 'none',
            }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <CustomSelect
          value={typeFilter}
          onChange={(val) => setTypeFilter(val)}
          options={[
            { value: 'all', label: t('delivery_reps.van_promotions_admin_tab.s9', "كافة أنواع العروض") },
            { value: 'mix_and_match', label: t('delivery_reps.van_promotions_admin_tab.s10', "خلطات وباقات (Mix & Match)") },
            { value: 'tiered_qty', label: t('delivery_reps.van_promotions_admin_tab.s11', "شرائح كميات وبونص") },
            { value: 'invoice_threshold', label: t('delivery_reps.van_promotions_admin_tab.s12', "سقف قيمة الفاتورة") },
          ]}
          style={{ minWidth: '170px' }}
        />

        <CustomSelect
          value={statusFilter}
          onChange={(val: any) => setStatusFilter(val)}
          options={[
            { value: 'all', label: t('delivery_reps.van_promotions_admin_tab.s13', "كافة الحالات") },
            { value: 'active', label: t('delivery_reps.van_promotions_admin_tab.s14', "المفعلة فقط") },
            { value: 'inactive', label: t('delivery_reps.van_promotions_admin_tab.s15', "المعطلة") },
          ]}
          style={{ minWidth: '130px' }}
        />

        <Button
          variant="secondary"
          onClick={handleManualRefresh}
          disabled={isRefreshing}
          style={{ height: '38px', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <RefreshCwIcon size={14} className={isRefreshing ? 'animate-spin' : ''} />
          {t('delivery_reps.van_promotions_admin_tab.s16', "تحديث")}
        </Button>

        <Button
          onClick={openCreateDialog}
          style={{
            backgroundColor: '#170e5e',
            color: '#ffffff',
            height: '38px',
            fontWeight: 700,
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <PlusIcon size={16} />
          {t('delivery_reps.van_promotions_admin_tab.s17', "إضافة عرض ترويجي")}
        </Button>
      </div>
    </div>
  );
}
