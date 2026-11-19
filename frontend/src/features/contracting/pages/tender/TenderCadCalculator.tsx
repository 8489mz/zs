import { useTranslation } from 'react-i18next';
import { BRICK_SIZE_PRESETS } from '../../components/TenderEstimatorModal';

export interface TenderCadCalculatorProps {
  isCadTakeoffFormOpen: boolean;
  setIsCadTakeoffFormOpen: (open: boolean) => void;
  engineeringConstants: any[];
  cadItemCode: string;
  setCadItemCode: (value: string) => void;
  cadLength: number;
  setCadLength: (value: number) => void;
  cadHeight: number;
  setCadHeight: (value: number) => void;
  cadCount: number;
  setCadCount: (value: number) => void;
  cadDeductions: number;
  setCadDeductions: (value: number) => void;
  cadBrickPreset: string;
  setCadBrickPreset: (value: string) => void;
  handleAddFromCadTakeoff: () => void;
}

export function TenderCadCalculator({
  isCadTakeoffFormOpen,
  setIsCadTakeoffFormOpen,
  engineeringConstants,
  cadItemCode,
  setCadItemCode,
  cadLength,
  setCadLength,
  cadHeight,
  setCadHeight,
  cadCount,
  setCadCount,
  cadDeductions,
  setCadDeductions,
  cadBrickPreset,
  setCadBrickPreset,
  handleAddFromCadTakeoff,
}: TenderCadCalculatorProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* 3. Expandable CAD Takeoff Calculator */}
      {isCadTakeoffFormOpen && (
        <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '12px', padding: '16px 20px' }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 'var(--font-section-title)', fontWeight: 700, color: '#170e5e' }}>
            {t('contracting.contracting_tender_page.s36', "حاسبة الحصر السريع للأبعاد وتفكيك الكود الهندسي")}
          </h4>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>{t('contracting.contracting_tender_page.s37', "نوع البند")}</label>
              <select
                value={cadItemCode}
                onChange={(e) => setCadItemCode(e.target.value)}
                style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
              >
                {engineeringConstants.map((c) => (
                  <option key={c.itemCode} value={c.itemCode}>
                    [{c.itemCode}] {c.itemName} ({c.unit})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>{t('contracting.contracting_tender_page.s38', "الطول (م)")}</label>
              <input
                type="number"
                step="0.01"
                value={cadLength}
                onChange={(e) => setCadLength(Number(e.target.value))}
                style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>{t('contracting.contracting_tender_page.s39', "الارتفاع / السمك (م)")}</label>
              <input
                type="number"
                step="0.01"
                value={cadHeight}
                onChange={(e) => setCadHeight(Number(e.target.value))}
                style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>{t('contracting.contracting_tender_page.s40', "عدد الحوائط / التكرار")}</label>
              <input
                type="number"
                step="1"
                min="1"
                value={cadCount}
                onChange={(e) => setCadCount(Number(e.target.value))}
                style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>{t('contracting.contracting_tender_page.s41', "خصومات الأبواب والشبابيك (م²)")}</label>
              <input
                type="number"
                step="0.01"
                value={cadDeductions}
                onChange={(e) => setCadDeductions(Number(e.target.value))}
                style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
              />
            </div>
          </div>

          {/* Brick Dimension Selector if Masonry */}
          {cadItemCode.startsWith('BRK') && (
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', marginBottom: '12px' }}>
              <div style={{ fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
                {t('contracting.contracting_tender_page.s42', "مقاس الطوب والبلوك ومعادلة حساب الاستهلاك:")}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                {BRICK_SIZE_PRESETS.slice(0, 4).map((p) => (
                  <label
                    key={p.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: cadBrickPreset === p.id ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
                      background: cadBrickPreset === p.id ? '#f0f4ff' : '#ffffff',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    <input
                      type="radio"
                      name="brickPreset"
                      checked={cadBrickPreset === p.id}
                      onChange={() => setCadBrickPreset(p.id)}
                    />
                    <div>
                      <div style={{ fontWeight: 700, color: '#0f172a' }}>{p.name.split('-')[0]}</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>{t('contracting.contracting_tender_page.s43', "معدل:")} {p.ratePerM2OrM3} {t('contracting.contracting_tender_page.s44', "طوبة/")}{p.unit}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              type="button"
              onClick={() => setIsCadTakeoffFormOpen(false)}
              style={{ padding: '7px 14px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', fontSize: '12.5px', cursor: 'pointer' }}
            >
              {t('contracting.contracting_tender_page.s45', "إلغاء")}
            </button>
            <button
              type="button"
              onClick={handleAddFromCadTakeoff}
              style={{ padding: '7px 18px', borderRadius: '6px', border: 'none', background: '#170e5e', color: '#fff', fontWeight: 700, fontSize: '12.5px', cursor: 'pointer' }}
            >
              {t('contracting.contracting_tender_page.s46', "حصر وإضافة البند فورياً")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
