import { StandardDialog } from '@/shared/components/StandardDialog';
import type { ChinaSupplier } from '../api/shipments.api';

export interface ChinaSourcingMetadataDialogProps {
  selectedSupplier: ChinaSupplier | null;
  setSelectedSupplier: React.Dispatch<React.SetStateAction<ChinaSupplier | null>>;
  handleSaveMeta: (e: React.FormEvent) => Promise<void>;
  chineseName: string;
  setChineseName: React.Dispatch<React.SetStateAction<string>>;
  city: string;
  setCity: React.Dispatch<React.SetStateAction<string>>;
  moq: string;
  setMoq: React.Dispatch<React.SetStateAction<string>>;
  leadTime: number;
  setLeadTime: React.Dispatch<React.SetStateAction<number>>;
  bankBeneficiary: string;
  setBankBeneficiary: React.Dispatch<React.SetStateAction<string>>;
  bankName: string;
  setBankName: React.Dispatch<React.SetStateAction<string>>;
  bankSwift: string;
  setBankSwift: React.Dispatch<React.SetStateAction<string>>;
  bankIban: string;
  setBankIban: React.Dispatch<React.SetStateAction<string>>;
  notes: string;
  setNotes: React.Dispatch<React.SetStateAction<string>>;
  upsertSupplierMetaMutation: { isPending: boolean };
}

export function ChinaSourcingMetadataDialog({ selectedSupplier, setSelectedSupplier, handleSaveMeta, chineseName, setChineseName, city, setCity, moq, setMoq, leadTime, setLeadTime, bankBeneficiary, setBankBeneficiary, bankName, setBankName, bankSwift, setBankSwift, bankIban, setBankIban, notes, setNotes, upsertSupplierMetaMutation }: ChinaSourcingMetadataDialogProps) {
  return (
    <>
    {/* 5. Sourcing Metadata Dialog */}
    <StandardDialog
      open={Boolean(selectedSupplier)}
      onClose={() => setSelectedSupplier(null)}
      title={`توثيق بيانات المصنع الصيني والحساب البنكي: ${selectedSupplier?.name || ''}`}
      subtitle="توثيق الحسابات البنكية الرسمية المعتمدة لحماية الحوالات الخارجية من الاحتيال"
      width="650px"
    >
      <form onSubmit={handleSaveMeta} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              الاسم الصيني للمصنع (Chinese Company Name)
            </label>
            <input
              type="text"
              value={chineseName}
              onChange={(e) => setChineseName(e.target.value)}
              placeholder="مثال: 广州智能科技有限公司"
              style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              المدينة والمقاطعة
            </label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="مثال: Shenzhen, Guangdong"
              style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              الحد الأدنى للطلب MOQ
            </label>
            <input
              type="text"
              value={moq}
              onChange={(e) => setMoq(e.target.value)}
              placeholder="مثال: 500 قطعة لكل لون"
              style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              مدة التصنيع والتجهيز (بالأيام)
            </label>
            <input
              type="number"
              value={leadTime}
              onChange={(e) => setLeadTime(Number(e.target.value))}
              style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>
        </div>

        {/* Bank Verified Details Box */}
        <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: '12px', fontWeight: 800, color: '#170e5e' }}>
            الحساب البنكي الموثق للحوالات الدولية (Verified Bank Account)
          </div>

          <div>
            <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>اسم المستفيد (Beneficiary Name)</label>
            <input
              type="text"
              value={bankBeneficiary}
              onChange={(e) => setBankBeneficiary(e.target.value)}
              placeholder="اسم الشركة المطابق للسجل التجاري الصيني"
              style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>اسم البنك (Bank Name)</label>
              <input
                type="text"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="مثال: Bank of China"
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>سويفت كود (SWIFT Code)</label>
              <input
                type="text"
                value={bankSwift}
                onChange={(e) => setBankSwift(e.target.value)}
                placeholder="مثال: BKCHCNBJ110"
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px' }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>رقم الحساب / الآيبان (Account / IBAN)</label>
            <input
              type="text"
              value={bankIban}
              onChange={(e) => setBankIban(e.target.value)}
              placeholder="رقم الحساب البنكي المعتمد"
              style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px' }}
            />
          </div>
        </div>

        <div>
          <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
            ملاحظات المورد والتعامل
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="شروط التسليم، شهادات الجودة، وكيل الشحن المحلي..."
            style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px' }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
          <button
            type="button"
            onClick={() => setSelectedSupplier(null)}
            style={{ padding: '8px 16px', backgroundColor: '#f1f5f9', border: 'none', borderRadius: 6, fontSize: '12.5px', fontWeight: 600, color: '#475569', cursor: 'pointer' }}
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={upsertSupplierMetaMutation.isPending}
            style={{ padding: '8px 20px', backgroundColor: '#170e5e', border: 'none', borderRadius: 6, fontSize: '12.5px', fontWeight: 700, color: '#ffffff', cursor: 'pointer' }}
          >
            {upsertSupplierMetaMutation.isPending ? 'جاري الحفظ...' : 'حفظ وتوثيق المصنع'}
          </button>
        </div>
      </form>
    </StandardDialog>
    </>
  );
}
