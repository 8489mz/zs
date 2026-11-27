import { useTranslation } from 'react-i18next';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { CustomSelect } from '@/shared/ui/custom-select';
import {MODULAR_TRADES, SCOPE_OPTIONS, type ProjectScope} from './schedule-generator-data';
import type { Dispatch, SetStateAction } from 'react';

interface ScheduleGeneratorScopeProps {
  projectId: string;
  handleSyncFromBoq: () => Promise<void>;
  isSyncingBoq: boolean;
  setShowTradeSelector: Dispatch<SetStateAction<boolean>>;
  showTradeSelector: boolean;
  selectedTrades: string[];
  projectScope: ProjectScope;
  handleScopeChange: (scope: ProjectScope) => void;
}

export function ScheduleGeneratorScope({ projectId, handleSyncFromBoq, isSyncingBoq, setShowTradeSelector, showTradeSelector, selectedTrades, projectScope, handleScopeChange }: ScheduleGeneratorScopeProps) {
  const { t: __t } = useTranslation();
  return (
    <>
    {/* Scope Selection Box */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 14px', backgroundColor: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <label style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#170e5e' }}>
          {__t('contracting.schedule_generator_modal.s13', "نطاق المشروع الإنشائي المطلوب توليده:")}
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* زر المزامنة مع المقايسة */}
          {projectId && (
            <button
              type="button"
              onClick={handleSyncFromBoq}
              disabled={isSyncingBoq}
              title={__t('contracting.schedule_generator_modal.s14', "فحص بنود مقايسة هذا المشروع وتحديد حزم الجدول الزمني تلقائياً")}
              style={{
                height: '30px',
                padding: '0 10px',
                borderRadius: '6px',
                border: '1px solid #c7d2fe',
                backgroundColor: '#eff6ff',
                color: '#1d4ed8',
                fontSize: 'var(--font-micro)',
                fontWeight: 700,
                cursor: isSyncingBoq ? 'wait' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <AppIcons.RefreshCw size={12} />
              <span>{isSyncingBoq ? __t('contracting.schedule_generator_modal.s15', "جارٍ قراءة المقايسة...") : __t('contracting.schedule_generator_modal.s16', "تحديد الحزم آلياً من مقايسة المشروع")}</span>
            </button>
          )}

          {/* زر فتح/إغلاق تفاصيل الحزم الموديولار */}
          <button
            type="button"
            onClick={() => setShowTradeSelector(!showTradeSelector)}
            style={{
              height: '30px',
              padding: '0 10px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              backgroundColor: showTradeSelector ? '#170e5e' : '#ffffff',
              color: showTradeSelector ? '#ffffff' : '#334155',
              fontSize: 'var(--font-micro)',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            <AppIcons.Sliders size={12} />
            <span>{__t('contracting.schedule_generator_modal.s17', "تخصيص الحزم (")}{selectedTrades.length} {__t('contracting.schedule_generator_modal.s18', "من")} {MODULAR_TRADES.length})</span>
          </button>
        </div>
      </div>

      <CustomSelect
        options={SCOPE_OPTIONS}
        value={projectScope}
        onChange={(val) => handleScopeChange(val as ProjectScope)}
        placeholder={__t('contracting.schedule_generator_modal.s19', "اختر نطاق تنفيذ المشروع...")}
      />
    </div>
    </>
  );
}
