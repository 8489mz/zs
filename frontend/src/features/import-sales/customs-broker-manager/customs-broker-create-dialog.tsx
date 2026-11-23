import { StandardDialog } from '@/shared/components/StandardDialog';

export interface CustomsBrokerCreateDialogProps {
  isCreateBrokerOpen: boolean;
  setIsCreateBrokerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleCreateBroker: (e: React.FormEvent) => Promise<void>;
  brokerName: string;
  setBrokerName: React.Dispatch<React.SetStateAction<string>>;
  licenseNumber: string;
  setLicenseNumber: React.Dispatch<React.SetStateAction<string>>;
  portName: string;
  setPortName: React.Dispatch<React.SetStateAction<string>>;
  phone: string;
  setPhone: React.Dispatch<React.SetStateAction<string>>;
  brokerNotes: string;
  setBrokerNotes: React.Dispatch<React.SetStateAction<string>>;
}

export function CustomsBrokerCreateDialog({ isCreateBrokerOpen, setIsCreateBrokerOpen, handleCreateBroker, brokerName, setBrokerName, licenseNumber, setLicenseNumber, portName, setPortName, phone, setPhone, brokerNotes, setBrokerNotes }: CustomsBrokerCreateDialogProps) {
  return (
    <>
    {/* Modal: Create Customs Broker */}
    <StandardDialog
      isOpen={isCreateBrokerOpen}
      onClose={() => setIsCreateBrokerOpen(false)}
      title="إضافة مخلص جمركي معتمد"
      subtitle="تسجيل بيانات مكتب أو مخلص التخليص الجمركي وإدراج حسابه بدفتر الأستاذ"
      width="600px"
      compact
    >
      <form onSubmit={handleCreateBroker} dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
            اسم المخلص أو المكتب: *
          </label>
          <input
            type="text"
            className="input"
            style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
            value={brokerName}
            placeholder="مثال: مكتب النصر للتخليص الجمركي والشحن"
            onChange={(e) => setBrokerName(e.target.value)}
            required
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
              رقم الرخصة الجمركية:
            </label>
            <input
              type="text"
              className="input"
              style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
              value={licenseNumber}
              placeholder="مثال: LIC-EG-ALEX-9921"
              onChange={(e) => setLicenseNumber(e.target.value)}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
              الميناء الرئيسي:
            </label>
            <select
              className="input"
              style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
              value={portName}
              onChange={(e) => setPortName(e.target.value)}
            >
              <option value="Alexandria">ميناء الإسكندرية البحري</option>
              <option value="Dekheila">ميناء الدخيلة</option>
              <option value="Port Said East">ميناء شرق بورسعيد</option>
              <option value="Port Said West">ميناء غرب بورسعيد</option>
              <option value="Damietta">ميناء دمياط</option>
              <option value="Sokhna">ميناء العين السخنة</option>
              <option value="Cairo Airport">قرية البضائع - مطار القاهرة</option>
            </select>
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
            رقم الهاتف المحمول:
          </label>
          <input
            type="text"
            className="input"
            style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
            value={phone}
            placeholder="مثال: 01012345678"
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
            ملاحظات:
          </label>
          <input
            type="text"
            className="input"
            style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
            value={brokerNotes}
            placeholder="مثال: خبير في الإفراج عن الأدوات الكهربائية والأجهزة المنزلية"
            onChange={(e) => setBrokerNotes(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setIsCreateBrokerOpen(false)}
            style={{ padding: '7px 14px', backgroundColor: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12.5, cursor: 'pointer' }}
          >
            إلغاء
          </button>
          <button
            type="submit"
            style={{ padding: '7px 16px', backgroundColor: '#170e5e', color: '#ffffff', border: 'none', borderRadius: 6, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
          >
            حفظ المخلص
          </button>
        </div>
      </form>
    </StandardDialog>
    </>
  );
}
