import { Button } from '@/shared/ui/button';
import { money } from '@/features/hr/pages/payroll/hr-payroll.helpers';
import { PlusCircleIcon, SlidersIcon, Trash2Icon } from '@/shared/components/icons/AppIcons';
import type { HrPayrollAdjustment } from '@/types/domain';

export interface PayrollReviewItemModalAdjustmentsProps {
  adjustments: HrPayrollAdjustment[];
  showAddAdjustment: boolean;
  isHourly: boolean;
  isDraft: boolean;
  onAddAdjustment?: (payload: { adjustmentType: 'allowance' | 'deduction'; label: string; amount: number; notes?: string }) => Promise<void>;
  setShowAddAdjustment: React.Dispatch<React.SetStateAction<boolean>>;
  onDeleteAdjustment?: (adjustmentId: string) => Promise<void>;
  handleDeleteAdj: (id: string) => Promise<void>;
  deletingId: string | null;
  handleSaveAdjustment: (e: React.FormEvent) => Promise<void>;
  periodMonth?: string;
  adjType: 'allowance' | 'deduction';
  setAdjType: React.Dispatch<React.SetStateAction<'allowance' | 'deduction'>>;
  adjLabel: string;
  setAdjLabel: React.Dispatch<React.SetStateAction<string>>;
  adjAmount: string;
  setAdjAmount: React.Dispatch<React.SetStateAction<string>>;
  adjNotes: string;
  setAdjNotes: React.Dispatch<React.SetStateAction<string>>;
  isSubmittingAdj: boolean;
}

export function PayrollReviewItemModalAdjustments({ adjustments, showAddAdjustment, isHourly, isDraft, onAddAdjustment, setShowAddAdjustment, onDeleteAdjustment, handleDeleteAdj, deletingId, handleSaveAdjustment, periodMonth, adjType, setAdjType, adjLabel, setAdjLabel, adjAmount, setAdjAmount, adjNotes, setAdjNotes, isSubmittingAdj }: PayrollReviewItemModalAdjustmentsProps) {
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: adjustments.length || showAddAdjustment ? '12px' : '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
          <SlidersIcon size={16} color="#170e5e" />
          <span>{isHourly ? 'التسويات والتعديلات اليدوية على الأجر' : 'التسويات والتعديلات اليدوية على الراتب'}</span>
          {adjustments.length > 0 && (
            <span style={{ background: '#e0e7ff', color: '#3730a3', fontSize: '11px', padding: '1px 7px', borderRadius: '10px', fontWeight: 700 }}>
              {adjustments.length}
            </span>
          )}
        </div>

        {isDraft && onAddAdjustment && !showAddAdjustment && (
          <Button
            variant="secondary"
            onClick={() => setShowAddAdjustment(true)}
            style={{ padding: '3px 10px', fontSize: '11.5px', display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#170e5e', borderColor: '#c7d2fe', background: '#eef2ff', fontWeight: 600 }}
          >
            <PlusCircleIcon size={14} />
            <span>إضافة تسوية (مكافأة / خصم يدوي)</span>
          </Button>
        )}
      </div>

      {/* Existing Adjustments List */}
      {adjustments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: showAddAdjustment ? '12px' : '0' }}>
          {adjustments.map((adj) => {
            const isAllowance = adj.adjustmentType === 'allowance';
            return (
              <div
                key={adj.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  fontSize: '12.5px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 700,
                    background: isAllowance ? '#dcfce7' : '#fee2e2',
                    color: isAllowance ? '#166534' : '#991b1b',
                  }}>
                    {isAllowance ? '+ إضافة / مكافأة' : '- استقطاع / جزاء'}
                  </span>
                  <strong style={{ color: '#1e293b' }}>{adj.label}</strong>
                  {adj.notes && <span style={{ color: '#64748b', fontSize: '11.5px' }}>({adj.notes})</span>}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontWeight: 700, color: isAllowance ? '#166534' : '#dc2626' }}>
                    {isAllowance ? '+' : '-'}{money(adj.amount)}
                  </span>
                  {isDraft && onDeleteAdjustment && (
                    <button
                      onClick={() => handleDeleteAdj(adj.id)}
                      disabled={deletingId === adj.id}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: '#94a3b8',
                        padding: '2px 6px',
                        borderRadius: '4px',
                      }}
                      title="حذف التسوية"
                    >
                      <Trash2Icon size={14} color="#dc2626" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Adjustment Form */}
      {showAddAdjustment && (
        <form onSubmit={handleSaveAdjustment} style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '12px 14px' }}>
          <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#170e5e', marginBottom: '10px' }}>
            تسجيل تسوية جديدة للموظف لشهر {periodMonth || 'الحالي'}:
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '130px 1.5fr 110px 1.5fr auto', gap: '8px', alignItems: 'center' }}>
            <select
              value={adjType}
              onChange={(e) => setAdjType(e.target.value as 'allowance' | 'deduction')}
              style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12px', background: '#fff' }}
            >
              <option value="allowance">مكافأة / بدل (+)</option>
              <option value="deduction">خصم / جزاء (-)</option>
            </select>

            <input
              type="text"
              placeholder="بيان التسوية (مثال: مكافأة أداء، خصم إتلاف)"
              value={adjLabel}
              onChange={(e) => setAdjLabel(e.target.value)}
              required
              style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12px' }}
            />

            <input
              type="number"
              step="0.01"
              min="0.01"
              placeholder="المبلغ (ج.م)"
              value={adjAmount}
              onChange={(e) => setAdjAmount(e.target.value)}
              required
              style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12px' }}
            />

            <input
              type="text"
              placeholder="ملاحظات اختيارية..."
              value={adjNotes}
              onChange={(e) => setAdjNotes(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12px' }}
            />

            <div style={{ display: 'flex', gap: '4px' }}>
              <Button
                type="submit"
                variant="primary"
                disabled={isSubmittingAdj || !adjLabel.trim() || !adjAmount}
                style={{ padding: '5px 12px', fontSize: '12px', background: '#170e5e', color: '#fff', borderColor: '#170e5e' }}
              >
                {isSubmittingAdj ? 'جارٍ...' : 'حفظ'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowAddAdjustment(false)}
                style={{ padding: '5px 10px', fontSize: '12px' }}
              >
                إلغاء
              </Button>
            </div>
          </div>
        </form>
      )}

      {!adjustments.length && !showAddAdjustment && (
        <div style={{ color: '#64748b', fontSize: '11.5px' }}>
          لا توجد تسويات يدوية مسجلة لهذا الموظف في هذا الكشف. يمكنك إضافة مكافأة أو خصم استثنائي بالضغط على الزر أعلاه.
        </div>
      )}
    </div>
  );
}
