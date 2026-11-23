import { StandardDialog } from '@/shared/components/StandardDialog';
import { formatCurrency } from '@/lib/format';
import type { CustomsBroker } from '../api/shipments.api';

export interface CustomsBrokerDisburseDialogProps {
  isDisburseOpen: boolean;
  setIsDisburseOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleDisburseAdvance: (e: React.FormEvent) => Promise<void>;
  selectedBrokerId: string;
  setSelectedBrokerId: React.Dispatch<React.SetStateAction<string>>;
  brokers: CustomsBroker[];
  selectedProjectId: string;
  setSelectedProjectId: React.Dispatch<React.SetStateAction<string>>;
  projects: any[];
  selectedShipmentId: string;
  setSelectedShipmentId: React.Dispatch<React.SetStateAction<string>>;
  shipments: any[];
  advanceAmountEgp: number | string;
  setAdvanceAmountEgp: React.Dispatch<React.SetStateAction<number | string>>;
  treasuryAccountId: string;
  setTreasuryAccountId: React.Dispatch<React.SetStateAction<string>>;
  treasuryAccounts: any[];
  advanceNo: string;
  setAdvanceNo: React.Dispatch<React.SetStateAction<string>>;
  advanceNotes: string;
  setAdvanceNotes: React.Dispatch<React.SetStateAction<string>>;
}

export function CustomsBrokerDisburseDialog({ isDisburseOpen, setIsDisburseOpen, handleDisburseAdvance, selectedBrokerId, setSelectedBrokerId, brokers, selectedProjectId, setSelectedProjectId, projects, selectedShipmentId, setSelectedShipmentId, shipments, advanceAmountEgp, setAdvanceAmountEgp, treasuryAccountId, setTreasuryAccountId, treasuryAccounts, advanceNo, setAdvanceNo, advanceNotes, setAdvanceNotes }: CustomsBrokerDisburseDialogProps) {
  return (
    <>
    {/* Modal: Disburse Advance */}
    <StandardDialog
      isOpen={isDisburseOpen}
      onClose={() => setIsDisburseOpen(false)}
      title="صرف عهدة نقدية لمخلص جمركي"
      subtitle="تحويل أو صرف مبالغ لتسديد الرسوم الجمركية ومصاريف الموانئ مقدماً"
      width="620px"
      compact
    >
      <form onSubmit={handleDisburseAdvance} dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
            المخلص الجمركي المستلم للعهدة: *
          </label>
          <select
            className="input"
            style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
            value={selectedBrokerId}
            onChange={(e) => setSelectedBrokerId(e.target.value)}
            required
          >
            <option value="">-- اختر المخلص --</option>
            {brokers.map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.port_name}) - رصيد معلق: {formatCurrency(b.unliquidated_balance_egp)}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
              ربط بمشروع استيراد:
            </label>
            <select
              className="input"
              style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
            >
              <option value="">-- اختياري --</option>
              {Array.isArray(projects) && projects.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.project_no} - {p.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
              ربط بحاوية / شحنة:
            </label>
            <select
              className="input"
              style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
              value={selectedShipmentId}
              onChange={(e) => setSelectedShipmentId(e.target.value)}
            >
              <option value="">-- اختياري --</option>
              {Array.isArray(shipments) && shipments.map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.container_number} ({s.status})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
              مبلغ العهدة (ج.م): *
            </label>
            <input
              type="number"
              className="input"
              style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
              value={advanceAmountEgp}
              onChange={(e) => setAdvanceAmountEgp(Number(e.target.value))}
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
              خزينة / بنك الصرف:
            </label>
            <select
              className="input"
              style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
              value={treasuryAccountId}
              onChange={(e) => setTreasuryAccountId(e.target.value)}
            >
              <option value="">-- الصندوق الرئيسي --</option>
              {treasuryAccounts.map((acc: any) => (
                <option key={acc.id} value={acc.id}>
                  {acc.nameAr || acc.nameEn || acc.code}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
            رقم إذن الصرف أو الشيك:
          </label>
          <input
            type="text"
            className="input"
            style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
            value={advanceNo}
            placeholder="مثال: ADV-ALEX-2026-001"
            onChange={(e) => setAdvanceNo(e.target.value)}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
            البيان والغرض:
          </label>
          <input
            type="text"
            className="input"
            style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
            value={advanceNotes}
            placeholder="مثال: عهدة تسديد ضرائب جمركية ورسوم إفراج تحت الحساب"
            onChange={(e) => setAdvanceNotes(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setIsDisburseOpen(false)}
            style={{ padding: '7px 14px', backgroundColor: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12.5, cursor: 'pointer' }}
          >
            إلغاء
          </button>
          <button
            type="submit"
            style={{ padding: '7px 16px', backgroundColor: '#0284c7', color: '#ffffff', border: 'none', borderRadius: 6, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
          >
            تأكيد صرف العهدة
          </button>
        </div>
      </form>
    </StandardDialog>
    </>
  );
}
