import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';

interface ScheduleGeneratorSettingsProps {
  startDate: string;
  setStartDate: Dispatch<SetStateAction<string>>;
  floorsCount: number;
  setFloorsCount: Dispatch<SetStateAction<number>>;
  concreteDaysPerFloor: number;
  setConcreteDaysPerFloor: Dispatch<SetStateAction<number>>;
  masonryDaysPerFloor: number;
  setMasonryDaysPerFloor: Dispatch<SetStateAction<number>>;
  includeBasement: boolean;
  setIncludeBasement: Dispatch<SetStateAction<boolean>>;
  includeRoof: boolean;
  setIncludeRoof: Dispatch<SetStateAction<boolean>>;
}

export function ScheduleGeneratorSettings({ startDate, setStartDate, floorsCount, setFloorsCount, concreteDaysPerFloor, setConcreteDaysPerFloor, masonryDaysPerFloor, setMasonryDaysPerFloor, includeBasement, setIncludeBasement, includeRoof, setIncludeRoof }: ScheduleGeneratorSettingsProps) {
  const { t: __t } = useTranslation();
  return (<>
    {/* Wizard Settings Grid */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
      <div>
        <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
          {__t('contracting.schedule_generator_modal.s28', "تاريخ بدء أعمال المشروع *")}
        </label>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          style={{
            width: '100%',
            height: '36px',
            padding: '0 10px',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            fontSize: 'var(--font-body)',
            fontWeight: 600,
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
          {__t('contracting.schedule_generator_modal.s29', "عدد الأدوار المتكررة")}
        </label>
        <input
          type="number"
          min="1"
          max="40"
          value={floorsCount}
          onChange={(e) => setFloorsCount(parseInt(e.target.value) || 1)}
          style={{
            width: '100%',
            height: '36px',
            padding: '0 10px',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            fontSize: 'var(--font-body)',
            fontWeight: 700,
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
          {__t('contracting.schedule_generator_modal.s30', "مدة خرسانة الدور (أيام)")}
        </label>
        <input
          type="number"
          min="1"
          value={concreteDaysPerFloor}
          onChange={(e) => setConcreteDaysPerFloor(parseInt(e.target.value) || 1)}
          style={{
            width: '100%',
            height: '36px',
            padding: '0 10px',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            fontSize: 'var(--font-body)',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
          {__t('contracting.schedule_generator_modal.s31', "مدة مباني الدور (أيام)")}
        </label>
        <input
          type="number"
          min="1"
          value={masonryDaysPerFloor}
          onChange={(e) => setMasonryDaysPerFloor(parseInt(e.target.value) || 1)}
          style={{
            width: '100%',
            height: '36px',
            padding: '0 10px',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            fontSize: 'var(--font-body)',
            boxSizing: 'border-box',
          }}
        />
      </div>
    </div>

    {/* Checkboxes for Basement and Roof */}
    <div style={{ display: 'flex', gap: '20px', padding: '10px 14px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--font-body)', cursor: 'pointer', fontWeight: 600, color: '#334155' }}>
        <input
          type="checkbox"
          checked={includeBasement}
          onChange={(e) => setIncludeBasement(e.target.checked)}
        />
        <span>{__t('contracting.schedule_generator_modal.s32', "يشمل دور بدروم")}</span>
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--font-body)', cursor: 'pointer', fontWeight: 600, color: '#334155' }}>
        <input
          type="checkbox"
          checked={includeRoof}
          onChange={(e) => setIncludeRoof(e.target.checked)}
        />
        <span>{__t('contracting.schedule_generator_modal.s33', "يشمل دور سطح (روف) وغرف خدمات")}</span>
      </label>
    </div>
  </>);
}
