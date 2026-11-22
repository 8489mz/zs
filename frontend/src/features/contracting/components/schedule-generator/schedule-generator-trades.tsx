import { useTranslation } from 'react-i18next';
import { MODULAR_TRADES, PRESET_TRADE_MAP } from './schedule-generator-data';
import type { Dispatch, SetStateAction } from 'react';
import type { ProjectScope } from './schedule-generator-data';

interface ScheduleGeneratorTradesProps {
  setSelectedTrades: Dispatch<SetStateAction<string[]>>;
  setProjectScope: Dispatch<SetStateAction<ProjectScope>>;
  selectedTrades: string[];
  handleToggleTrade: (tradeId: string) => void;
}

export function ScheduleGeneratorTrades({ setSelectedTrades, setProjectScope, selectedTrades, handleToggleTrade }: ScheduleGeneratorTradesProps) {
  const { t: __t } = useTranslation();
  return (
    <>
      {/* تفاصيل الحزم الموديولار التفاعلية (Modular Trade Selector Panel) */}
      <div style={{ padding: '14px', backgroundColor: '#ffffff', borderRadius: '10px', border: '1px solid #cbd5e1', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <div style={{ fontSize: 'var(--font-section-title)', fontWeight: 700, color: '#0f172a' }}>
              {__t('contracting.schedule_generator_modal.s20', "حزم وتخصصات الأعمال المشمولة في الجدول الزمني")}
            </div>
            <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', marginTop: '2px' }}>
              {__t('contracting.schedule_generator_modal.s21', "حدد الحزم التي يشملها عقدك؛ سيقوم المحرك بحصر الجدول الزمني عليها فقط وضبط التواريخ والاعتماديات بدقة.")}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => {
                setSelectedTrades(MODULAR_TRADES.map((t) => t.id));
                setProjectScope('custom_modular');
              }}
              style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
            >
              {__t('contracting.schedule_generator_modal.s22', "تحديد الكل")}
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedTrades(['elec_slab_earthing', 'elec_roughin_wiring', 'elec_fixtures_testing']);
                setProjectScope('electrical_only');
              }}
              style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
            >
              {__t('contracting.schedule_generator_modal.s23', "كهرباء فقط")}
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedTrades(['plumb_roughin_drainage', 'plumb_fixtures', 'waterproofing']);
                setProjectScope('plumbing_only');
              }}
              style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #a7f3d0', background: '#ecfdf5', color: '#047857', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
            >
              {__t('contracting.schedule_generator_modal.s24', "سباكة وصحي فقط")}
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedTrades(PRESET_TRADE_MAP['full_mep']);
                setProjectScope('full_mep');
              }}
              style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #fde68a', background: '#fffbeb', color: '#b45309', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
            >
              {__t('contracting.schedule_generator_modal.s25', "كهروميكانيك MEP")}
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedTrades(PRESET_TRADE_MAP['architectural_finishes']);
                setProjectScope('architectural_finishes');
              }}
              style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #e9d5ff', background: '#faf5ff', color: '#7e22ce', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
            >
              {__t('contracting.schedule_generator_modal.s26', "تشطيبات معمارية")}
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedTrades([]);
                setProjectScope('custom_modular');
              }}
              style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #fee2e2', background: '#fef2f2', color: '#b91c1c', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
            >
              {__t('contracting.schedule_generator_modal.s27', "إلغاء الكل")}
            </button>
          </div>
        </div>

        {/* شبكة بطاقات الحزم */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '8px', maxHeight: '250px', overflowY: 'auto', paddingInlineEnd: '4px' }}>
          {MODULAR_TRADES.map((trade) => {
            const isChecked = selectedTrades.includes(trade.id);
            return (
              <div
                key={trade.id}
                onClick={() => handleToggleTrade(trade.id)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  border: isChecked ? '1px solid #170e5e' : '1px solid #e2e8f0',
                  backgroundColor: isChecked ? '#f8fafc' : '#ffffff',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => handleToggleTrade(trade.id)}
                  style={{ marginTop: '3px', cursor: 'pointer', accentColor: '#170e5e' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                    <span style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: isChecked ? '#170e5e' : '#1e293b' }}>
                      {trade.name}
                    </span>
                    <span
                      style={{
                        fontSize: '10px',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        backgroundColor: isChecked ? '#e0e7ff' : '#f1f5f9',
                        color: isChecked ? '#170e5e' : '#64748b',
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {trade.code}
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', lineHeight: 1.4 }}>
                    {trade.description}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
