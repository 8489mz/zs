import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { CustomSelect } from '@/shared/ui/custom-select';
import type { BrickPreset } from '../TenderEstimatorModal';

export interface TenderCadTakeoffPopupProps {
  isCadTakeoffFormOpen: boolean;
  t: TFunction;
  cadItemCode: string;
  setCadItemCode: Dispatch<SetStateAction<string>>;
  engineeringConstants: any[];
  cadLength: number;
  setCadLength: Dispatch<SetStateAction<number>>;
  cadWidth: number;
  setCadWidth: Dispatch<SetStateAction<number>>;
  cadHeight: number;
  setCadHeight: Dispatch<SetStateAction<number>>;
  cadCount: number;
  setCadCount: Dispatch<SetStateAction<number>>;
  cadDeductions: number;
  setCadDeductions: Dispatch<SetStateAction<number>>;
  calculatedBrickRate: {
    ratePerM2: number;
    sandPerM2: number;
    cementPerM2: number;
    unit: string;
    name: string;
    dimensions: string;
    isCustom: boolean;
  };
  cadBrickPreset: string;
  setCadBrickPreset: Dispatch<SetStateAction<string>>;
  customBrickLength: number;
  setCustomBrickLength: Dispatch<SetStateAction<number>>;
  customBrickWidth: number;
  setCustomBrickWidth: Dispatch<SetStateAction<number>>;
  customBrickHeight: number;
  setCustomBrickHeight: Dispatch<SetStateAction<number>>;
  mortarJoint: number;
  setMortarJoint: Dispatch<SetStateAction<number>>;
  setIsCadTakeoffFormOpen: Dispatch<SetStateAction<boolean>>;
  handleAddFromCadTakeoff: () => void;
  brickPresets: BrickPreset[];
}

export function TenderCadTakeoffPopup({
  isCadTakeoffFormOpen,
  t,
  cadItemCode,
  setCadItemCode,
  engineeringConstants,
  cadLength,
  setCadLength,
  cadWidth,
  setCadWidth,
  cadHeight,
  setCadHeight,
  cadCount,
  setCadCount,
  cadDeductions,
  setCadDeductions,
  calculatedBrickRate,
  cadBrickPreset,
  setCadBrickPreset,
  customBrickLength,
  setCustomBrickLength,
  customBrickWidth,
  setCustomBrickWidth,
  customBrickHeight,
  setCustomBrickHeight,
  mortarJoint,
  setMortarJoint,
  setIsCadTakeoffFormOpen,
  handleAddFromCadTakeoff,
  brickPresets,
}: TenderCadTakeoffPopupProps) {
  return (
    <>
      {isCadTakeoffFormOpen && (
        <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '10px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#0369a1', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <AppIcons.CheckShield size={16} />
            <span>{t('contracting.tender_estimator_modal.s19', "حاسبة الحصر الهندسي السريع من واقع اللوحات والمخططات المعمارية والإنشائية")}</span>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(320px, 1fr) 85px 85px 85px 75px 105px',
            gap: '8px',
            alignItems: 'end',
          }}>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#0369a1', marginBottom: '2px' }}>{t('contracting.tender_estimator_modal.s20', "نوع البند الهندسي")}</label>
              <CustomSelect
                value={cadItemCode}
                onChange={(val) => setCadItemCode(String(val))}
                options={engineeringConstants.map((c) => ({
                  value: c.itemCode,
                  label: `${c.itemName} (${c.unit})`,
                  hint: c.itemCode,
                }))}
                placeholder={t('contracting.tender_estimator_modal.s21', "اختر كود البند...")}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#0369a1', marginBottom: '2px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s22', "الطول (م)")}</label>
              <input
                type="number"
                value={cadLength}
                onChange={(e) => setCadLength(Number(e.target.value))}
                style={{ width: '100%', height: '32px', padding: '0 4px', textAlign: 'center', borderRadius: '6px', border: '1px solid #7dd3fc', fontSize: 'var(--font-body)', fontWeight: 600 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#0369a1', marginBottom: '2px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s23', "العرض (م)")}</label>
              <input
                type="number"
                value={cadWidth}
                onChange={(e) => setCadWidth(Number(e.target.value))}
                style={{ width: '100%', height: '32px', padding: '0 4px', textAlign: 'center', borderRadius: '6px', border: '1px solid #7dd3fc', fontSize: 'var(--font-body)', fontWeight: 600 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#0369a1', marginBottom: '2px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s24', "الارتفاع (م)")}</label>
              <input
                type="number"
                value={cadHeight}
                onChange={(e) => setCadHeight(Number(e.target.value))}
                style={{ width: '100%', height: '32px', padding: '0 4px', textAlign: 'center', borderRadius: '6px', border: '1px solid #7dd3fc', fontSize: 'var(--font-body)', fontWeight: 600 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#0369a1', marginBottom: '2px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s25', "التكرار")}</label>
              <input
                type="number"
                value={cadCount}
                onChange={(e) => setCadCount(Number(e.target.value))}
                style={{ width: '100%', height: '32px', padding: '0 4px', textAlign: 'center', borderRadius: '6px', border: '1px solid #7dd3fc', fontSize: 'var(--font-body)', fontWeight: 600 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#0369a1', marginBottom: '2px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s26', "خصومات الفتحات")}</label>
              <input
                type="number"
                value={cadDeductions}
                onChange={(e) => setCadDeductions(Number(e.target.value))}
                style={{ width: '100%', height: '32px', padding: '0 4px', textAlign: 'center', borderRadius: '6px', border: '1px solid #7dd3fc', fontSize: 'var(--font-body)', fontWeight: 600 }}
              />
            </div>
          </div>

          {/* محدد ومحرك مقاسات الطوب والبلوك الديناميكي */}
          {(cadItemCode.startsWith('BRK') || cadItemCode.startsWith('BLK') || cadItemCode.startsWith('AAC')) && (
            <div style={{ background: '#ffffff', border: '1px solid #bae6fd', borderRadius: '8px', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '2px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                <span style={{ fontSize: 'var(--font-micro)', fontWeight: 700, color: '#0369a1', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <AppIcons.Sliders size={13} />
                  <span>{t('contracting.tender_estimator_modal.s27', "مواصفات وأبعاد الطوبة / البلوك المستخدم (Brick & Block Dimensions):")}</span>
                </span>
                <span style={{ fontSize: '11px', color: '#166534', background: '#dcfce7', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                  {t('contracting.tender_estimator_modal.s28', "المعدل الهندسي المحسوب:")} {calculatedBrickRate.ratePerM2} {t('contracting.tender_estimator_modal.s29', "طوبة/م² | رمل:")} {calculatedBrickRate.sandPerM2} {t('contracting.tender_estimator_modal.s30', "م³ | أسمنت:")} {calculatedBrickRate.cementPerM2} {t('contracting.tender_estimator_modal.s31', "طن")}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: cadBrickPreset === 'CUSTOM' ? 'minmax(260px, 1.4fr) 85px 85px 85px 95px' : '1fr', gap: '8px', alignItems: 'end' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: '#64748b', marginBottom: '2px' }}>{t('contracting.tender_estimator_modal.s32', "اختر مقاس الطوب أو البلوك الشائع:")}</label>
                  <CustomSelect
                    value={cadBrickPreset}
                    onChange={(val) => setCadBrickPreset(String(val))}
                    options={brickPresets.map((p) => ({
                      value: p.id,
                      label: p.name,
                      hint: `${p.ratePerM2OrM3} ${p.unit === 'm3' ? t('contracting.tender_estimator_modal.s33', "طوبة/م³") : t('contracting.tender_estimator_modal.s34', "طوبة/م²")}`,
                    }))}
                    placeholder={t('contracting.tender_estimator_modal.s35', "اختر مقاس الطوب...")}
                  />
                </div>

                {cadBrickPreset === 'CUSTOM' && (
                  <>
                    <div>
                      <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: '#0369a1', textAlign: 'center', marginBottom: '2px' }}>{t('contracting.tender_estimator_modal.s36', "طول الطوبة (سم)")}</label>
                      <input
                        type="number"
                        value={customBrickLength}
                        onChange={(e) => setCustomBrickLength(Number(e.target.value))}
                        style={{ width: '100%', height: '30px', padding: '0 4px', textAlign: 'center', borderRadius: '5px', border: '1px solid #7dd3fc', fontSize: 'var(--font-micro)', fontWeight: 700 }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: '#0369a1', textAlign: 'center', marginBottom: '2px' }}>{t('contracting.tender_estimator_modal.s37', "عرض/سمك (سم)")}</label>
                      <input
                        type="number"
                        value={customBrickWidth}
                        onChange={(e) => setCustomBrickWidth(Number(e.target.value))}
                        style={{ width: '100%', height: '30px', padding: '0 4px', textAlign: 'center', borderRadius: '5px', border: '1px solid #7dd3fc', fontSize: 'var(--font-micro)', fontWeight: 700 }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: '#0369a1', textAlign: 'center', marginBottom: '2px' }}>{t('contracting.tender_estimator_modal.s38', "ارتفاع (سم)")}</label>
                      <input
                        type="number"
                        value={customBrickHeight}
                        onChange={(e) => setCustomBrickHeight(Number(e.target.value))}
                        style={{ width: '100%', height: '30px', padding: '0 4px', textAlign: 'center', borderRadius: '5px', border: '1px solid #7dd3fc', fontSize: 'var(--font-micro)', fontWeight: 700 }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: '#0369a1', textAlign: 'center', marginBottom: '2px' }}>{t('contracting.tender_estimator_modal.s39', "عرموس مونة (سم)")}</label>
                      <input
                        type="number"
                        step="0.1"
                        value={mortarJoint}
                        onChange={(e) => setMortarJoint(Number(e.target.value))}
                        style={{ width: '100%', height: '30px', padding: '0 4px', textAlign: 'center', borderRadius: '5px', border: '1px solid #7dd3fc', fontSize: 'var(--font-micro)', fontWeight: 700 }}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            <button
              type="button"
              onClick={() => setIsCadTakeoffFormOpen(false)}
              style={{ height: '30px', padding: '0 12px', borderRadius: '6px', border: '1px solid #bae6fd', background: '#ffffff', color: '#0369a1', fontSize: 'var(--font-micro)', fontWeight: 600, cursor: 'pointer' }}
            >
              {t('contracting.tender_estimator_modal.s40', "إغلاق")}
            </button>
            <button
              type="button"
              onClick={handleAddFromCadTakeoff}
              style={{ height: '30px', padding: '0 16px', borderRadius: '6px', border: 'none', background: '#0284c7', color: '#ffffff', fontSize: 'var(--font-micro)', fontWeight: 700, cursor: 'pointer' }}
            >
              {t('contracting.tender_estimator_modal.s41', "إضافة البند المحصور للعطاء")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
