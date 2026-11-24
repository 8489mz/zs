import { money } from './quick-cash-advance-shared';
import type { AuthUser } from '@/types/auth';
import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';

export interface QuickCashAdvanceShiftsProps {
  isAdminOrOwner: boolean;
  shifts: Record<string, unknown>[];
  t: ReturnType<typeof useTranslation>['t'];
  activeShift: Record<string, unknown> | null;
  parsedAmount: number;
  currentUser: AuthUser | null;
  setSelectedShiftId: Dispatch<SetStateAction<string>>;
}

export function QuickCashAdvanceShifts({ isAdminOrOwner, shifts, t, activeShift, parsedAmount, currentUser, setSelectedShiftId }: QuickCashAdvanceShiftsProps) {
  return (
    <>
    {/* 7. Active Shift Info / Drawer Selection */}
    <div>
      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', marginBottom: 4, display: 'block' }}>
        {isAdminOrOwner && shifts.length > 1
          ? `اختر درج الكاشير المراد الصرف منه (${shifts.length} أدراج مفتوحة) *`
          : t('hr.quick_cash_advance_modal.shift_header', 'الوردية المنصرف منها المسحوب (مقيدة باسمك) *')}
      </span>

      {isAdminOrOwner && shifts.length > 1 ? (
        <div
          className="thin-scrollbar"
          style={{
            display: 'grid',
            gridTemplateColumns: shifts.length === 1 ? '1fr' : shifts.length === 2 ? '1fr 1fr' : 'repeat(3, 1fr)',
            gap: 6,
            maxHeight: shifts.length > 6 ? '150px' : 'none',
            overflowY: shifts.length > 6 ? 'auto' : 'visible',
            padding: '2px',
          }}
        >
          {shifts.map((s: any) => {
            const isSelected = String(s.id) === String(activeShift?.id);
            const shiftCash = Number(s.expectedCash ?? s.expected_cash ?? 0);
            const isShort = shiftCash < parsedAmount;
            const cashierName = String(s.openedByName || s.opened_by_name || 'الكاشير');
            const isMyShift = String(s.openedById || s.opened_by) === String(currentUser?.id);

            return (
              <div
                key={s.id}
                onClick={() => setSelectedShiftId(String(s.id))}
                style={{
                  background: isSelected ? '#ffffff' : '#f8fafc',
                  border: isSelected ? '2px solid #170e5e' : '1px solid #cbd5e1',
                  borderRadius: 8,
                  padding: '7px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  minHeight: '58px',
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 4 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '0.8rem', color: isSelected ? '#170e5e' : '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                        {cashierName}
                      </strong>
                      {isMyShift && (
                        <span style={{ fontSize: '0.68rem', background: '#e0e7ff', color: '#3730a3', padding: '1px 4px', borderRadius: 3, fontWeight: 700 }}>
                          درجك
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: '0.68rem', color: '#64748b', display: 'block', marginTop: 1, direction: 'ltr', textAlign: 'right' }}>
                      {s.docNo || `#${s.id}`}
                    </span>
                  </div>

                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      border: isSelected ? '4px solid #170e5e' : '2px solid #cbd5e1',
                      backgroundColor: '#ffffff',
                      boxSizing: 'border-box',
                      flexShrink: 0,
                      marginTop: 1,
                    }}
                  />
                </div>

                <div style={{ marginTop: 5, paddingTop: 4, borderTop: '1px dashed #e2e8f0', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 4 }}>
                  <span style={{ fontSize: '0.68rem', color: '#64748b', flexShrink: 0 }}>الرصيد:</span>
                  <strong dir="ltr" style={{ fontSize: '0.74rem', fontWeight: 800, whiteSpace: 'nowrap', color: shiftCash < 0 ? '#b45309' : (isShort ? '#dc2626' : '#166534') }}>
                    {money(shiftCash)}
                  </strong>
                </div>
              </div>
            );
          })}
        </div>
      ) : activeShift ? (
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: 8,
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: '#16a34a',
              }}
            />
            <div>
              <strong style={{ fontSize: '0.82rem', color: '#0f172a', display: 'block' }}>
                {activeShift.docNo ? `${activeShift.docNo} (#${activeShift.id})` : `وردية كاشير #${activeShift.id}`}
              </strong>
              <span style={{ fontSize: '0.73rem', color: '#64748b' }}>
                مسؤول الدرج: {String(activeShift.openedByName || activeShift.opened_by_name || (currentUser as any)?.name || currentUser?.username)}
              </span>
            </div>
          </div>
          <span
            style={{
              fontSize: '0.7rem',
              background: '#e0e7ff',
              color: '#3730a3',
              padding: '2px 6px',
              borderRadius: 4,
              fontWeight: 700,
            }}
          >
            مقيدة على ورديتك
          </span>
        </div>
      ) : (
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            padding: '8px 10px',
            color: '#991b1b',
            fontSize: '0.78rem',
          }}
        >
          <strong>تنبيه رقابي:</strong> لا توجد وردية كاشير مفتوحة حالياً للصرف منها.
        </div>
      )}
    </div>
    </>
  );
}
