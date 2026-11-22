import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { CustomSelect } from '@/shared/ui/custom-select';
import {
  SearchIcon,
} from '@/shared/components/icons/AppIcons';
import { EVENT_CODE_OPTIONS, PERIOD_OPTIONS } from './van-fraud-radar-helpers';

export interface FraudRadarFilterBarProps {
  periodDays: string;
  setPeriodDays: Dispatch<SetStateAction<string>>;
  selectedRepId: string;
  setSelectedRepId: Dispatch<SetStateAction<string>>;
  repOptions: { value: string; label: string }[];
  selectedEventCode: string;
  setSelectedEventCode: Dispatch<SetStateAction<string>>;
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
}

export function FraudRadarFilterBar({
  periodDays,
  setPeriodDays,
  selectedRepId,
  setSelectedRepId,
  repOptions,
  selectedEventCode,
  setSelectedEventCode,
  searchQuery,
  setSearchQuery,
}: FraudRadarFilterBarProps) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        padding: '12px 16px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '12px',
        alignItems: 'end',
      }}
    >
      <div>
        <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
          {t('delivery_reps.van_fraud_radar_admin_tab.s15', "الفترة الزمنية للفحص")}
        </label>
        <CustomSelect
          value={periodDays}
          onChange={(val: any) => setPeriodDays(val)}
          options={PERIOD_OPTIONS}
        />
      </div>

      <div>
        <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
          {t('delivery_reps.van_fraud_radar_admin_tab.s16', "تصفية حسب المندوب")}
        </label>
        <CustomSelect
          value={selectedRepId}
          onChange={(val: any) => setSelectedRepId(val)}
          options={repOptions}
        />
      </div>

      <div>
        <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
          {t('delivery_reps.van_fraud_radar_admin_tab.s17', "تصفية حسب نوع المخالفة")}
        </label>
        <CustomSelect
          value={selectedEventCode}
          onChange={(val: any) => setSelectedEventCode(val)}
          options={EVENT_CODE_OPTIONS}
        />
      </div>

      <div>
        <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
          {t('delivery_reps.van_fraud_radar_admin_tab.s18', "بحث سريع (مندوب، عميل، تفاصيل)")}
        </label>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('delivery_reps.van_fraud_radar_admin_tab.s19', "ابحث باسم المندوب أو العميل...")}
            style={{
              width: '100%',
              height: '36px',
              padding: '6px 12px 6px 32px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '12.5px',
              boxSizing: 'border-box',
            }}
          />
          <span style={{ position: 'absolute', left: '10px', top: '9px', color: '#94a3b8' }}>
            <SearchIcon size={15} />
          </span>
        </div>
      </div>
    </div>
  );
}
