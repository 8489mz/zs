import { Button } from '@/shared/ui/button';
import { CustomSelect, type SelectOption } from '@/shared/ui/custom-select';
import { FormSection } from '@/shared/components/form-section';
import { formatFreightAllocationHint } from '../utils/import-display-formatters';
import type { useTranslation } from 'react-i18next';
import type { ShipmentDetails } from '../api/shipments.api';
import type { Location } from '@/types/domain';

export interface ShipmentDetailsCostsProps {
  t: ReturnType<typeof useTranslation>['t'];
  handleUpdateCosts: (e: React.FormEvent) => Promise<void>;
  shippedDate: string;
  setShippedDate: React.Dispatch<React.SetStateAction<string>>;
  etaDate: string;
  setEtaDate: React.Dispatch<React.SetStateAction<string>>;
  clearanceDate: string;
  setClearanceDate: React.Dispatch<React.SetStateAction<string>>;
  form4Number: string;
  setForm4Number: React.Dispatch<React.SetStateAction<string>>;
  form4Date: string;
  setForm4Date: React.Dispatch<React.SetStateAction<string>>;
  fundingType: 'bank_transfer' | 'cash_carried';
  setFundingType: React.Dispatch<React.SetStateAction<'bank_transfer' | 'cash_carried'>>;
  data: ShipmentDetails;
  exchangeRate: string;
  setExchangeRate: React.Dispatch<React.SetStateAction<string>>;
  pricingExchangeRate: string;
  setPricingExchangeRate: React.Dispatch<React.SetStateAction<string>>;
  shippingCost: string;
  setShippingCost: React.Dispatch<React.SetStateAction<string>>;
  shippingAcc: string;
  setShippingAcc: React.Dispatch<React.SetStateAction<string>>;
  treasuryAccounts: any[];
  customsCost: string;
  setCustomsCost: React.Dispatch<React.SetStateAction<string>>;
  customsAcc: string;
  setCustomsAcc: React.Dispatch<React.SetStateAction<string>>;
  insuranceCost: string;
  setInsuranceCost: React.Dispatch<React.SetStateAction<string>>;
  dutyRate: string;
  setDutyRate: React.Dispatch<React.SetStateAction<string>>;
  vatRate: string;
  setVatRate: React.Dispatch<React.SetStateAction<string>>;
  transportCost: string;
  setTransportCost: React.Dispatch<React.SetStateAction<string>>;
  transportAcc: string;
  setTransportAcc: React.Dispatch<React.SetStateAction<string>>;
  freightSupplier: string;
  setFreightSupplier: React.Dispatch<React.SetStateAction<string>>;
  payeeOptions: (storedId: number | null | undefined) => SelectOption[];
  customsSupplier: string;
  setCustomsSupplier: React.Dispatch<React.SetStateAction<string>>;
  transportSupplier: string;
  setTransportSupplier: React.Dispatch<React.SetStateAction<string>>;
  demurrageSupplier: string;
  setDemurrageSupplier: React.Dispatch<React.SetStateAction<string>>;
  unallocableCostReason: string;
  setUnallocableCostReason: React.Dispatch<React.SetStateAction<string>>;
  status: string;
  setStatus: React.Dispatch<React.SetStateAction<string>>;
  allocationMethod: 'value' | 'weight' | 'cbm' | '';
  setAllocationMethod: React.Dispatch<React.SetStateAction<'value' | 'weight' | 'cbm' | ''>>;
  receiptLocationId: string;
  setReceiptLocationId: React.Dispatch<React.SetStateAction<string>>;
  warehouseLocations: Location[];
  updateCostsMutation: { isPending: boolean };
}

export function ShipmentDetailsCosts(props: ShipmentDetailsCostsProps) {
  const { t, handleUpdateCosts, shippedDate, setShippedDate, etaDate, setEtaDate, clearanceDate, setClearanceDate, form4Number, setForm4Number, form4Date, setForm4Date, fundingType, setFundingType, data, exchangeRate, setExchangeRate, pricingExchangeRate, setPricingExchangeRate, shippingCost, setShippingCost, shippingAcc, setShippingAcc, treasuryAccounts, customsCost, setCustomsCost, customsAcc, setCustomsAcc, insuranceCost, setInsuranceCost, dutyRate, setDutyRate, vatRate, setVatRate, transportCost, setTransportCost, transportAcc, setTransportAcc, freightSupplier, setFreightSupplier, payeeOptions, customsSupplier, setCustomsSupplier, transportSupplier, setTransportSupplier, demurrageSupplier, setDemurrageSupplier, unallocableCostReason, setUnallocableCostReason, status, setStatus, allocationMethod, setAllocationMethod, receiptLocationId, setReceiptLocationId, warehouseLocations, updateCostsMutation } = props;
  return (
    <>
    <FormSection title={t('import_sales.shipment_details_page.s11', "تفاصيل وتكاليف الحاوية (مؤثرة على سعر المنتج)")}>
      <form onSubmit={handleUpdateCosts} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', padding: '1rem' }}>

        {/* Timeline */}
        <div className="form-group">
          <label>{t('import_sales.shipment_details_page.s12', "تاريخ الشحن (من المصنع)")}</label>
          <input type="date" className="input" value={shippedDate} onChange={e => setShippedDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label>{t('import_sales.shipment_details_page.s13', "تاريخ الوصول المتوقع للميناء (ETA)")}</label>
          <input type="date" className="input" value={etaDate} onChange={e => setEtaDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label>{t('import_sales.shipment_details_page.s14', "تاريخ التخليص الجمركي")}</label>
          <input type="date" className="input" value={clearanceDate} onChange={e => setClearanceDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label>رقم نموذج 4 (مطلوب قبل التخليص للشحنات الممولة بنكيًا فوق 2000 دولار)</label>
          <input type="text" className="input" value={form4Number} onChange={e => setForm4Number(e.target.value)} />
        </div>
        <div className="form-group">
          <label>تاريخ نموذج 4</label>
          <input type="date" className="input" value={form4Date} onChange={e => setForm4Date(e.target.value)} />
        </div>
        <div className="form-group">
          <label>طريقة تمويل الشحنة</label>
          <select className="input" value={fundingType} onChange={e => setFundingType(e.target.value as 'bank_transfer' | 'cash_carried')}>
            <option value="bank_transfer">تحويل بنكي</option>
            <option value="cash_carried">نقد محمول مع مسافر (معفى من نموذج 4)</option>
          </select>
          <small style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '3px' }}>
            التمويل البنكي فوق 2000 دولار يتطلب رقم نموذج 4 قبل التخليص أو الوصول.
          </small>
        </div>
        <div className="form-group">
          <label>سعر صرف الدولار الجمركي / الفعلي (التكلفة الدفترية)</label>
          <input type="number" step="0.01" className="input" placeholder={`الحالي: ${data.exchange_rate_at_arrival || ''}`} value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} />
          <small style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '3px' }}>
            السعر الحقيقي الفعلي للدولار عند وصول الشحنة والمثبت محاسبياً.
          </small>
        </div>

        <div className="form-group">
          <label>سعر دولار التسعير بالسوق (سعر الإحلال والتحوط)</label>
          <input type="number" step="0.01" className="input" placeholder={`الحالي: ${data.pricing_exchange_rate || data.exchange_rate_at_arrival || ''}`} value={pricingExchangeRate} onChange={e => setPricingExchangeRate(e.target.value)} />
          <small style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '3px' }}>
            سعر السوق الحالي لاقتراح أسعار البيع لحماية رأس المال (اجعله نفس الفعلي إذا كنت تبيع بسعر الشراء).
          </small>
        </div>

        <hr style={{ gridColumn: 'span 2' }} />

        {/* Costs */}
        <div className="form-group">
          <label>{t('import_sales.shipment_details_page.s17', "تكلفة الشحن البحري (بالدولار)")}</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input type="number" step="0.01" className="input" placeholder={`الحالي: $${data.shipping_cost_usd}`} value={shippingCost} onChange={e => setShippingCost(e.target.value)} />
            <select className="input" value={shippingAcc} onChange={e => setShippingAcc(e.target.value)}>
              <option value="">-- بدون خصم نقدي (تسجيل تكلفة فقط) --</option>
              {treasuryAccounts.map((a: any) => <option key={a.id} value={a.id}>سداد من: {a.nameAr || a.name_ar || a.name}</option>)}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label>{t('import_sales.shipment_details_page.s19', "الجمارك ومصاريف التخليص (بالجنيه)")}</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input type="number" step="0.01" className="input" placeholder={`الحالي: ${data.customs_cost_egp} ج`} value={customsCost} onChange={e => setCustomsCost(e.target.value)} />
            <select className="input" value={customsAcc} onChange={e => setCustomsAcc(e.target.value)}>
              <option value="">-- بدون خصم نقدي (تسجيل تكلفة فقط) --</option>
              {treasuryAccounts.map((a: any) => <option key={a.id} value={a.id}>سداد من: {a.nameAr || a.name_ar || a.name}</option>)}
            </select>
          </div>
          <small style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '3px' }}>
            رسم تخليص ثابت — ليس الضريبة؛ نسبة الرسوم الجمركية وضريبة القيمة المضافة في الحقلين التاليين.
          </small>
        </div>

        {/* INV-IMPORT-LANDED-COST-DUTY-VAT: itemized customs
            tax, carried from the feasibility study. Duty is
            charged on CIF (goods + freight + insurance) and
            VAT on (CIF + duty), capitalized into landed cost
            exactly as the study computes them. */}
        <div className="form-group">
          <label>تكلفة التأمين (بالدولار)</label>
          <input type="number" step="0.01" className="input" placeholder={`الحالي: $${(data as any).insurance_cost_usd || 0}`} value={insuranceCost} onChange={e => setInsuranceCost(e.target.value)} />
          <small style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '3px' }}>
            يدخل في أساس CIF لحساب الرسوم الجمركية والضريبة.
          </small>
        </div>

        <div className="form-group">
          <label>نسبة الرسوم الجمركية (%)</label>
          <input type="number" step="0.01" className="input" placeholder={`الحالي: ${(data as any).customs_duty_rate_percent || 0}%`} value={dutyRate} onChange={e => setDutyRate(e.target.value)} />
          <small style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '3px' }}>
            تُحسب على قيمة CIF (بضاعة + شحن + تأمين) وتُرحَّل ضمن التكلفة المحملة.
          </small>
        </div>

        <div className="form-group">
          <label>نسبة ضريبة القيمة المضافة (%)</label>
          <input type="number" step="0.01" className="input" placeholder={`الحالي: ${(data as any).vat_rate_percent || 0}%`} value={vatRate} onChange={e => setVatRate(e.target.value)} />
          <small style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '3px' }}>
            تُحسب على (CIF + الرسوم الجمركية) وتُرسمل ضمن التكلفة المحملة مثل دراسة الجدوى.
          </small>
        </div>

        <div className="form-group">
          <label>{t('import_sales.shipment_details_page.s21', "نقل داخلي ونثريات (بالجنيه)")}</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input type="number" step="0.01" className="input" placeholder={`الحالي: ${data.internal_transport_cost_egp} ج`} value={transportCost} onChange={e => setTransportCost(e.target.value)} />
            <select className="input" value={transportAcc} onChange={e => setTransportAcc(e.target.value)}>
              <option value="">-- بدون خصم نقدي (تسجيل تكلفة فقط) --</option>
              {treasuryAccounts.map((a: any) => <option key={a.id} value={a.id}>سداد من: {a.nameAr || a.name_ar || a.name}</option>)}
            </select>
          </div>
        </div>

        {/* Explicit payee per cost component (INV-IMPORT-SUPPLIER-ATTRIBUTION).
            Each nonzero component must name the supplier it is owed to
            before the receipt posts; a component with no payee needs a
            recorded unallocable reason instead (clearing path). */}
        <div className="form-group">
          <label>مورد الشحن البحري (مستحق الشحن)</label>
          <CustomSelect value={freightSupplier} onChange={setFreightSupplier} options={payeeOptions(data.freight_supplier_id)} searchable placeholder="ابحث عن مورد..." />
        </div>

        <div className="form-group">
          <label>مورد الجمارك والتخليص (مستحق الجمارك)</label>
          <CustomSelect value={customsSupplier} onChange={setCustomsSupplier} options={payeeOptions(data.customs_supplier_id)} searchable placeholder="ابحث عن مورد..." />
        </div>

        <div className="form-group">
          <label>مورد النقل الداخلي (مستحق النقل)</label>
          <CustomSelect value={transportSupplier} onChange={setTransportSupplier} options={payeeOptions(data.transport_supplier_id)} searchable placeholder="ابحث عن مورد..." />
        </div>

        <div className="form-group">
          <label>مورد غرامات التأخير والأرضيات (الحالي: {data.actual_demurrage_fees || 0} ج)</label>
          <CustomSelect value={demurrageSupplier} onChange={setDemurrageSupplier} options={payeeOptions(data.demurrage_supplier_id)} searchable placeholder="ابحث عن مورد..." />
        </div>

        <div className="form-group" style={{ gridColumn: 'span 2' }}>
          <label>سبب عدم قابلية التخصيص (لبند بلا مورد — يقيد على حساب التسوية)</label>
          <input className="input" value={unallocableCostReason} onChange={e => setUnallocableCostReason(e.target.value)} placeholder={data.unallocable_cost_reason ? `الحالي: ${data.unallocable_cost_reason}` : 'يترك فارغاً إلا إذا كان بند بلا مورد محدد فعلاً'} />
        </div>

        <div className="form-group">
          <label>{t('import_sales.shipment_details_page.s23', "تغيير حالة الحاوية")}</label>
          <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">{t('import_sales.shipment_details_page.s24', "لا تغيير (الحالية:")} {data.status})</option>
            <option value="Pending">{t('import_sales.shipment_details_page.s25', "في البحر (Pending)")}</option>
            <option value="In Customs">{t('import_sales.shipment_details_page.s26', "في الجمارك (In Customs)")}</option>
            <option value="Arrived">{t('import_sales.shipment_details_page.s27', "تم الوصول (Arrived) - سيتم إضافة الكميات للمخزون")}</option>
          </select>
        </div>

        {data.status !== 'Arrived' && (
          <div className="form-group">
            <label>طريقة توزيع نولون الشحن والجمارك على الأصناف</label>
            <select className="input" value={allocationMethod} onChange={e => setAllocationMethod(e.target.value as typeof allocationMethod)}>
              <option value="">
                الحالية: {data.cost_allocation_method === 'weight' ? 'الوزن (كجم)' : data.cost_allocation_method === 'cbm' ? 'الحجم (CBM)' : 'قيمة الصنف بالدولار (موصى به)'}
              </option>
              <option value="value">قيمة الصنف بالدولار (Value %) - الخيار الشائع والموصى به</option>
              <option value="weight">الوزن الإجمالي بالكيلوجرام (Gross Weight)</option>
              <option value="cbm">الحجم والمساحة بالمتر المكعب (CBM Volume)</option>
            </select>
            <small style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '3px' }}>
              {formatFreightAllocationHint(shippingCost !== '' ? Number(shippingCost) : Number(data.shipping_cost_usd || 0))}
            </small>
          </div>
        )}
        {status === 'Arrived' && data.status !== 'Arrived' && (
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label>مخزن استلام الحاوية (إلزامي عند الوصول)</label>
            <select className="input" required value={receiptLocationId} onChange={e => setReceiptLocationId(e.target.value)}>
              <option value="">اختر مخزنًا فعليًا مسجلًا للشركة</option>
              {warehouseLocations.map((loc: any) => (
                <option key={loc.id} value={loc.id}>{loc.name || loc.nameAr || `مخزن ${loc.id}`}</option>
              ))}
            </select>
          </div>
        )}
        <div className="actions" style={{ gridColumn: 'span 2' }}>
          <Button type="submit" variant="primary" disabled={updateCostsMutation.isPending}>{t('import_sales.shipment_details_page.s28', "تحديث البيانات والتكاليف وإعادة الحساب")}</Button>
        </div>
      </form>
    </FormSection>
    </>
  );
}
