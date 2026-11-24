import type { Dispatch, SetStateAction } from 'react';

export interface QuickCashAdvanceNotesProps {
  activeTab: 'advance' | 'payout';
  notes: string;
  setNotes: Dispatch<SetStateAction<string>>;
}

export function QuickCashAdvanceNotes({ activeTab, notes, setNotes }: QuickCashAdvanceNotesProps) {
  return (
    <>
    {/* 5. Notes & Reason */}
    <div>
      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: 4, display: 'block' }}>
        {activeTab === 'payout' ? 'ملاحظات وتفاصيل صرف الراتب *' : 'ملاحظات وسبب الصرف *'}
      </span>
      <input
        required
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder={activeTab === 'payout' ? 'تفاصيل تسوية وصرف الراتب (مطلوب)' : 'سبب صرف المسحوب أو السلفة (مطلوب)'}
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
    </div>
    </>
  );
}
