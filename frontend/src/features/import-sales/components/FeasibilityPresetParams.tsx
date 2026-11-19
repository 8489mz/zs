import { TRUCK_PARTS_PRESET_COSTS } from '../feasibility-preset';
import { PlusCircleIcon, TruckIcon } from '@/shared/components/icons/AppIcons';

export interface FeasibilityPresetParamsProps {
  hasChosenFeasibilityPreset: boolean;
  applyTruckPartsPreset: () => void;
  startManualFeasibility: () => void;
  commRate: number;
  custRate: number;
  shippingUsd: number;
  insuranceUsd: number;
  customsDutyPercent: number;
  vatPercent: number;
  clearanceEgp: number;
  transportEgp: number;
  travelEgp: number;
  targetMarkup: number;
  setCommRate: (value: number) => void;
  setCustRate: (value: number) => void;
  setShippingUsd: (value: number) => void;
  setInsuranceUsd: (value: number) => void;
  setCustomsDutyPercent: (value: number) => void;
  setVatPercent: (value: number) => void;
  setClearanceEgp: (value: number) => void;
  setTransportEgp: (value: number) => void;
  setTravelEgp: (value: number) => void;
  setTargetMarkup: (value: number) => void;
}

export function FeasibilityPresetParams(props: FeasibilityPresetParamsProps) {
  const { hasChosenFeasibilityPreset, applyTruckPartsPreset, startManualFeasibility, commRate, setCommRate, custRate, setCustRate, shippingUsd, setShippingUsd, insuranceUsd, setInsuranceUsd, customsDutyPercent, setCustomsDutyPercent, vatPercent, setVatPercent, clearanceEgp, setClearanceEgp, transportEgp, setTransportEgp, travelEgp, setTravelEgp, targetMarkup, setTargetMarkup } = props;
  return (
    <>
          {/* I2-P8: preset picker for a fresh study — the truck-parts
              bundle is offered, never forced; the manual start keeps
              the grid empty and the costs at zero. */}
          {!hasChosenFeasibilityPreset && (
            <div
              style={{
                border: '1px solid #c7d2fe',
                backgroundColor: '#eef2ff',
                borderRadius: 10,
                padding: '12px 14px',
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#170e5e', marginBottom: 4 }}>
                ابدأ دراسة الجدوى — اختر قالباً أو ابدأ فارغاً
              </div>
              <div style={{ fontSize: '12px', color: '#475569', marginBottom: 10 }}>
                لا يتم تحميل أي أصناف تلقائياً. اختر قالب قطع غيار النقل والتريلات الجاهز، أو ابدأ بجدول فارغ وأضف أصنافك بنفسك.
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={applyTruckPartsPreset}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 14px',
                    backgroundColor: '#170e5e',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: '12.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <TruckIcon size={14} />
                  <span>قالب قطع غيار النقل والتريلات (5 أصناف)</span>
                </button>
                <button
                  type="button"
                  onClick={startManualFeasibility}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 14px',
                    backgroundColor: '#ffffff',
                    color: '#170e5e',
                    border: '1px solid #cbd5e1',
                    borderRadius: 6,
                    fontSize: '12.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <PlusCircleIcon size={14} />
                  <span>بدء يدوي فارغ</span>
                </button>
              </div>
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: 8 }}>
                القالب يحمّل: شحن ${TRUCK_PARTS_PRESET_COSTS.shippingUsd.toLocaleString()} — تخليص{' '}
                {TRUCK_PARTS_PRESET_COSTS.clearanceEgp.toLocaleString()} ج.م — سفر ومعاينات{' '}
                {TRUCK_PARTS_PRESET_COSTS.travelEgp.toLocaleString()} ج.م
              </div>
            </div>
          )}

          {/* Global Parameters */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, backgroundColor: '#f8fafc', padding: 12, borderRadius: 10 }}>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>سعر صرف الدولار التجاري (ج.م)</label>
              <input
                type="number"
                value={commRate}
                onChange={(e) => setCommRate(Number(e.target.value))}
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>سعر الدولار الجمركي (ج.م)</label>
              <input
                type="number"
                value={custRate}
                onChange={(e) => setCustRate(Number(e.target.value))}
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>الشحن الدولي ($)</label>
              <input
                type="number"
                aria-label="الشحن الدولي ($)"
                value={shippingUsd}
                onChange={(e) => setShippingUsd(Number(e.target.value))}
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>التأمين البحري ($)</label>
              <input
                type="number"
                aria-label="التأمين البحري ($)"
                value={insuranceUsd}
                onChange={(e) => setInsuranceUsd(Number(e.target.value))}
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>الرسوم الجمركية (%)</label>
              <input
                type="number"
                value={customsDutyPercent}
                onChange={(e) => setCustomsDutyPercent(Number(e.target.value))}
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>ضريبة القيمة المضافة (%)</label>
              <input
                type="number"
                value={vatPercent}
                onChange={(e) => setVatPercent(Number(e.target.value))}
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }} title="يشمل التخليص، رسوم التسجيل المسبق ACI و CargoX، وسحب عينات معامل الرقابة">
                تخليص، نافذة، وفحص رقابي (ج.م)
              </label>
              <input
                type="number"
                aria-label="تخليص، نافذة، وفحص رقابي (ج.م)"
                value={clearanceEgp}
                onChange={(e) => setClearanceEgp(Number(e.target.value))}
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>نقل داخلي للمخزن (ج.م)</label>
              <input
                type="number"
                aria-label="نقل داخلي للمخزن (ج.م)"
                value={transportEgp}
                onChange={(e) => setTransportEgp(Number(e.target.value))}
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>مصاريف سفر ومعاينات (ج.م)</label>
              <input
                type="number"
                aria-label="مصاريف سفر ومعاينات (ج.م)"
                value={travelEgp}
                onChange={(e) => setTravelEgp(Number(e.target.value))}
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>هامش الربح المطلوب (%)</label>
              <input
                type="number"
                value={targetMarkup}
                onChange={(e) => setTargetMarkup(Number(e.target.value))}
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
          </div>
    </>
  );
}
