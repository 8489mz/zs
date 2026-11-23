import { StandardDialog } from '@/shared/components/StandardDialog';
import { formatCurrency } from '@/lib/format';
import type { CustomsBroker } from '../api/shipments.api';

export interface CustomsBrokerLiquidateDialogProps {
  isLiquidateOpen: boolean;
  setIsLiquidateOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleLiquidateExpense: (e: React.FormEvent) => Promise<void>;
  selectedBrokerId: string;
  setSelectedBrokerId: React.Dispatch<React.SetStateAction<string>>;
  setSelectedAdvanceId: React.Dispatch<React.SetStateAction<string>>;
  brokers: CustomsBroker[];
  selectedAdvanceId: string;
  activeBrokerAdvances: any[];
  liquidateCategory: string;
  setLiquidateCategory: React.Dispatch<React.SetStateAction<string>>;
  setIsRefundableVat: React.Dispatch<React.SetStateAction<boolean>>;
  liquidateReceiptNo: string;
  setLiquidateReceiptNo: React.Dispatch<React.SetStateAction<string>>;
  liquidateAmountEgp: number | string;
  setLiquidateAmountEgp: React.Dispatch<React.SetStateAction<number | string>>;
  isCapitalized: boolean;
  isRefundableVat: boolean;
  setIsCapitalized: React.Dispatch<React.SetStateAction<boolean>>;
  liquidateNotes: string;
  setLiquidateNotes: React.Dispatch<React.SetStateAction<string>>;
}

export function CustomsBrokerLiquidateDialog({ isLiquidateOpen, setIsLiquidateOpen, handleLiquidateExpense, selectedBrokerId, setSelectedBrokerId, setSelectedAdvanceId, brokers, selectedAdvanceId, activeBrokerAdvances, liquidateCategory, setLiquidateCategory, setIsRefundableVat, liquidateReceiptNo, setLiquidateReceiptNo, liquidateAmountEgp, setLiquidateAmountEgp, isCapitalized, isRefundableVat, setIsCapitalized, liquidateNotes, setLiquidateNotes }: CustomsBrokerLiquidateDialogProps) {
  return (
    <>
    {/* Modal: Liquidate Expense */}
    <StandardDialog
      isOpen={isLiquidateOpen}
      onClose={() => setIsLiquidateOpen(false)}
      title="تصفية مصاريف جمركية بإيصالات رسمية"
      subtitle="إثبات الفواتير والإيصالات الحكومية والمهنية وتخفيض رصيد العهدة المعلق"
      width="620px"
      compact
    >
      <form onSubmit={handleLiquidateExpense} dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
              المخلص الجمركي صاحب العهدة: *
            </label>
            <select
              className="input"
              style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
              value={selectedBrokerId}
              onChange={(e) => {
                setSelectedBrokerId(e.target.value);
                setSelectedAdvanceId('');
              }}
              required
            >
              <option value="">-- اختر المخلص --</option>
              {brokers.map((b: any) => (
                <option key={b.id} value={b.id}>
                  {b.name} (الرصيد المعلق: {formatCurrency(b.unliquidated_balance_egp)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
              العهدة المراد التصفية منها: *
            </label>
            <select
              className="input"
              style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
              value={selectedAdvanceId || activeBrokerAdvances[0]?.id || ''}
              onChange={(e) => setSelectedAdvanceId(e.target.value)}
              required
            >
              {activeBrokerAdvances.length === 0 ? (
                <option value="">-- لا توجد عهد مفتوحة لهذا المخلص --</option>
              ) : (
                activeBrokerAdvances.map((adv: any) => (
                  <option key={adv.id} value={adv.id}>
                    #{adv.advance_no} - المتبقي: {formatCurrency(adv.remaining_amount_egp)}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
              تصنيف المصروف: *
            </label>
            <select
              className="input"
              style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
              value={liquidateCategory}
              onChange={(e) => {
                const val = e.target.value;
                setLiquidateCategory(val);
                if (val === 'vat') setIsRefundableVat(true);
              }}
            >
              <option value="customs_duty">ضرائب ورسوم جمركية (Customs Duty)</option>
              <option value="vat">ضريبة القيمة المضافة 14%</option>
              <option value="port_fees">عوايد ورسوم هيئة الميناء (Port Authority)</option>
              <option value="inspection">رسوم الفحص والرقابة على الصادرات والواردات (GOEIC)</option>
              <option value="storage">أرضيات ومخازن الميناء</option>
              <option value="brokerage_fee">أتعاب التخليص الجمركي</option>
              <option value="transport">نقل وتعتيق داخلي</option>
              <option value="demurrage">غرامات تأخير حاويات (Demurrage)</option>
              <option value="other">مصروفات إدارية ورسوم أخرى</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
              رقم الإيصال / قسيمة السداد: *
            </label>
            <input
              type="text"
              className="input"
              style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
              value={liquidateReceiptNo}
              placeholder="مثال: RCP-EGY-PORT-0492"
              onChange={(e) => setLiquidateReceiptNo(e.target.value)}
              required
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
              المبلغ المسدد (ج.م): *
            </label>
            <input
              type="number"
              className="input"
              style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
              value={liquidateAmountEgp}
              onChange={(e) => setLiquidateAmountEgp(Number(e.target.value))}
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
              المعالجة المحاسبية:
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isCapitalized && !isRefundableVat}
                  disabled={isRefundableVat}
                  onChange={(e) => setIsCapitalized(e.target.checked)}
                />
                رسملة على تكلفة البضاعة الواصلة (Landed Cost)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: '#0369a1' }}>
                <input
                  type="checkbox"
                  checked={isRefundableVat}
                  onChange={(e) => setIsRefundableVat(e.target.checked)}
                />
                ضريبة قيمة مضافة قابلة للخصم والرد (أصل ضريبي مدين)
              </label>
            </div>
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
            البيان والملاحظات:
          </label>
          <input
            type="text"
            className="input"
            style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
            value={liquidateNotes}
            placeholder="مثال: سداد قسيمة فحص الصادرات والواردات طبقاً لنموذج 4"
            onChange={(e) => setLiquidateNotes(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setIsLiquidateOpen(false)}
            style={{ padding: '7px 14px', backgroundColor: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12.5, cursor: 'pointer' }}
          >
            إلغاء
          </button>
          <button
            type="submit"
            style={{ padding: '7px 16px', backgroundColor: '#15803d', color: '#ffffff', border: 'none', borderRadius: 6, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
          >
            تأكيد تصفية المصروف
          </button>
        </div>
      </form>
    </StandardDialog>
    </>
  );
}
