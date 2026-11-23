import { StandardDialog } from '@/shared/components/StandardDialog';
import { CheckCircleIcon } from '@/shared/components/icons/AppIcons';

export interface ChinaSourcingNewFactoryModalProps {
  isNewSupplierModalOpen: boolean;
  setIsNewSupplierModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleCreateNewSupplier: (e: React.FormEvent) => Promise<void>;
  newSupplierName: string;
  setNewSupplierName: React.Dispatch<React.SetStateAction<string>>;
  newChineseName: string;
  setNewChineseName: React.Dispatch<React.SetStateAction<string>>;
  newCity: string;
  setNewCity: React.Dispatch<React.SetStateAction<string>>;
  newProvince: string;
  setNewProvince: React.Dispatch<React.SetStateAction<string>>;
  newPhone: string;
  setNewPhone: React.Dispatch<React.SetStateAction<string>>;
  newAddress: string;
  setNewAddress: React.Dispatch<React.SetStateAction<string>>;
  newMoq: string;
  setNewMoq: React.Dispatch<React.SetStateAction<string>>;
  newLeadTime: number;
  setNewLeadTime: React.Dispatch<React.SetStateAction<number>>;
  newBankBeneficiary: string;
  setNewBankBeneficiary: React.Dispatch<React.SetStateAction<string>>;
  newBankName: string;
  setNewBankName: React.Dispatch<React.SetStateAction<string>>;
  newBankSwift: string;
  setNewBankSwift: React.Dispatch<React.SetStateAction<string>>;
  newBankAccount: string;
  setNewBankAccount: React.Dispatch<React.SetStateAction<string>>;
  newNotes: string;
  setNewNotes: React.Dispatch<React.SetStateAction<string>>;
  createChinaSupplierMutation: { isPending: boolean };
}

export function ChinaSourcingNewFactoryModal({ isNewSupplierModalOpen, setIsNewSupplierModalOpen, handleCreateNewSupplier, newSupplierName, setNewSupplierName, newChineseName, setNewChineseName, newCity, setNewCity, newProvince, setNewProvince, newPhone, setNewPhone, newAddress, setNewAddress, newMoq, setNewMoq, newLeadTime, setNewLeadTime, newBankBeneficiary, setNewBankBeneficiary, newBankName, setNewBankName, newBankSwift, setNewBankSwift, newBankAccount, setNewBankAccount, newNotes, setNewNotes, createChinaSupplierMutation }: ChinaSourcingNewFactoryModalProps) {
  return (
    <>
    {/* New China Factory Modal */}
    <StandardDialog
      open={isNewSupplierModalOpen}
      onClose={() => setIsNewSupplierModalOpen(false)}
      title="إضافة مصنع أو مورد دولي جديد (China Factory)"
      subtitle="تسجيل بيانات المصنع، الاسم باللغة الصينية، المقاطعة، وتوثيق الحساب البنكي الرسمي لمنع الاحتيال"
      width="680px"
    >
      <form onSubmit={handleCreateNewSupplier} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Row 1: Factory Name (EN/Trade) & Chinese Name */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              اسم المصنع / المورد التجاري <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              required
              value={newSupplierName}
              onChange={(e) => setNewSupplierName(e.target.value)}
              placeholder="مثال: Shandong Liangshan Titan Trailer Parts Co., Ltd"
              style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              الاسم باللغة الصينية (Chinese Name)
            </label>
            <input
              type="text"
              value={newChineseName}
              onChange={(e) => setNewChineseName(e.target.value)}
              placeholder="مثال: 山东梁山泰坦挂车配件有限公司"
              style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>
        </div>

        {/* Row 2: City & Province & Phone/WeChat */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              المدينة (City)
            </label>
            <input
              type="text"
              value={newCity}
              onChange={(e) => setNewCity(e.target.value)}
              placeholder="مثال: Jining / Liangshan"
              style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              المقاطعة (Province)
            </label>
            <input
              type="text"
              value={newProvince}
              onChange={(e) => setNewProvince(e.target.value)}
              placeholder="مثال: Shandong / 山东"
              style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              هاتف / WeChat
            </label>
            <input
              type="text"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="مثال: +86 138 0000 0000"
              style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>
        </div>

        {/* Row 3: Full Address */}
        <div>
          <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
            العنوان التفصيلي وموقع المصنع
          </label>
          <input
            type="text"
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            placeholder="مثال: Liangshan Industrial Park, Jining City, Shandong Province, China"
            style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
          />
        </div>

        {/* Row 4: MOQ & Lead Time */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              حد الطلب الأدنى (MOQ)
            </label>
            <input
              type="text"
              value={newMoq}
              onChange={(e) => setNewMoq(e.target.value)}
              placeholder="مثال: 1x20ft أو 50 قطعة لكل صنف"
              style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              مدة دورة الإنتاج والتجهيز (بالأيام)
            </label>
            <input
              type="number"
              min={1}
              value={newLeadTime}
              onChange={(e) => setNewLeadTime(Number(e.target.value))}
              placeholder="30"
              style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>
        </div>

        {/* Verified Bank Details Box */}
        <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#170e5e', display: 'flex', alignItems: 'center', gap: 6 }}>
              <CheckCircleIcon size={14} />
              بيانات الحساب البنكي الرسمي الموثق للحوالات الدولية (Bank Wire Details)
            </div>
            <span style={{ fontSize: '11px', color: '#64748b' }}>حماية من القرصنة والاحتيال</span>
          </div>

          <div>
            <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>
              اسم المستفيد بالإنجليزية (Beneficiary Name)
            </label>
            <input
              type="text"
              value={newBankBeneficiary}
              onChange={(e) => setNewBankBeneficiary(e.target.value)}
              placeholder="الاسم الإنجليزي المطابق لحساب الشركة البنكي في الصين"
              style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>
                اسم البنك الصيني (Bank Name)
              </label>
              <input
                type="text"
                value={newBankName}
                onChange={(e) => setNewBankName(e.target.value)}
                placeholder="مثال: Bank of China, Liangshan Branch"
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>
                سويفت كود (SWIFT Code / BIC)
              </label>
              <input
                type="text"
                value={newBankSwift}
                onChange={(e) => setNewBankSwift(e.target.value)}
                placeholder="مثال: BKCHCNBJ110"
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px' }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>
              رقم الحساب البنكي / الآيبان (Account / IBAN)
            </label>
            <input
              type="text"
              value={newBankAccount}
              onChange={(e) => setNewBankAccount(e.target.value)}
              placeholder="رقم الحساب البنكي المعتمد للتحويلات الدولية USD/EUR"
              style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px' }}
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
            ملاحظات فنية وتشغيلية (المهندس المسؤول / التخصص / شروط الشحن)
          </label>
          <textarea
            rows={2}
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
            placeholder="مثال: مصنع متخصص في تصنيع محاور المقطورات وجنازير الصدر، شروط التسليم FOB Qingdao..."
            style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px' }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setIsNewSupplierModalOpen(false)}
            style={{ padding: '8px 16px', backgroundColor: '#f1f5f9', border: 'none', borderRadius: 6, fontSize: '12.5px', fontWeight: 600, color: '#475569', cursor: 'pointer' }}
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={createChinaSupplierMutation.isPending}
            style={{ padding: '8px 22px', backgroundColor: '#170e5e', border: 'none', borderRadius: 6, fontSize: '12.5px', fontWeight: 700, color: '#ffffff', cursor: 'pointer' }}
          >
            {createChinaSupplierMutation.isPending ? 'جاري الحفظ...' : 'حفظ المصنع وتوثيقه'}
          </button>
        </div>
      </form>
    </StandardDialog>
    </>
  );
}
