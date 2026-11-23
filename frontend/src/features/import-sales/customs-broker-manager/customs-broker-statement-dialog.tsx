import { StandardDialog } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { RefreshCwIcon } from '@/shared/components/icons/AppIcons';
import { formatCurrency } from '@/lib/format';
import type { CustomsBroker } from '../api/shipments.api';

export interface CustomsBrokerStatementDialogProps {
  selectedBrokerForStatement: CustomsBroker | null;
  setSelectedBrokerForStatement: React.Dispatch<React.SetStateAction<CustomsBroker | null>>;
  isStatementLoading: boolean;
  brokerStatement: any;
  handleVerifyExpense: (e: React.FormEvent) => Promise<void>;
  verifyExpenseId: string;
  setVerifyExpenseId: React.Dispatch<React.SetStateAction<string>>;
  verifyTokenId: string;
  setVerifyTokenId: React.Dispatch<React.SetStateAction<string>>;
  verifyExpenseMutation: { isPending: boolean };
}

export function CustomsBrokerStatementDialog({ selectedBrokerForStatement, setSelectedBrokerForStatement, isStatementLoading, brokerStatement, handleVerifyExpense, verifyExpenseId, setVerifyExpenseId, verifyTokenId, setVerifyTokenId, verifyExpenseMutation }: CustomsBrokerStatementDialogProps) {
  return (
    <>
    {/* Modal: Broker Statement */}
    {selectedBrokerForStatement && (
      <StandardDialog
        isOpen={!!selectedBrokerForStatement}
        onClose={() => setSelectedBrokerForStatement(null)}
        title={`كشف حساب العهدة: ${selectedBrokerForStatement.name}`}
        subtitle={`الميناء: ${selectedBrokerForStatement.port_name} | الرخصة: ${selectedBrokerForStatement.license_number || '—'}`}
        width="900px"
        compact
      >
        {isStatementLoading || !brokerStatement ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
            <RefreshCwIcon size={24} className="spin" />
            <p style={{ marginTop: 8, fontSize: 13 }}>جاري تحميل كشف الحساب وتفاصيل الإيصالات...</p>
          </div>
        ) : (
          <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Summary KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>إجمالي العهد المنصرفة</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#170e5e', marginTop: 4 }}>
                  {formatCurrency(brokerStatement.totalAdvances)}
                </div>
              </div>

              <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>إجمالي المصروفات المصفاة بإيصالات</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#15803d', marginTop: 4 }}>
                  {formatCurrency(brokerStatement.totalExpenses)}
                </div>
              </div>

              <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>صافي الرصيد المتبقي طرف المخلص</div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 800,
                    color: brokerStatement.netBalanceDue > 0 ? '#b91c1c' : '#15803d',
                    marginTop: 4,
                  }}
                >
                  {formatCurrency(brokerStatement.netBalanceDue)}
                </div>
              </div>
            </div>

            {/* Advances List */}
            {Array.isArray(brokerStatement.advances) && brokerStatement.advances.length > 0 && (
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', maxHeight: 150, overflowY: 'auto' }} className="thin-scrollbar">
                <div style={{ backgroundColor: '#f8fafc', padding: '7px 12px', borderBottom: '1px solid #e2e8f0', fontSize: 12, fontWeight: 700, color: '#0f172a' }}>
                  سجل العهد النقدية والبنكية المنصرفة ({brokerStatement.advances.length})
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }}>
                      <th style={{ padding: '6px 10px', color: '#475569', fontWeight: 600 }}>رقم العهدة</th>
                      <th style={{ padding: '6px 10px', color: '#475569', fontWeight: 600 }}>المنصرف</th>
                      <th style={{ padding: '6px 10px', color: '#475569', fontWeight: 600 }}>المصفى</th>
                      <th style={{ padding: '6px 10px', color: '#475569', fontWeight: 600 }}>المتبقي</th>
                      <th style={{ padding: '6px 10px', color: '#475569', fontWeight: 600 }}>التاريخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {brokerStatement.advances.map((adv: any) => (
                      <tr key={adv.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontWeight: 600 }}>{adv.advance_no}</td>
                        <td style={{ padding: '6px 10px', fontWeight: 700 }}>{formatCurrency(adv.amount_egp)}</td>
                        <td style={{ padding: '6px 10px', color: '#15803d' }}>{formatCurrency(adv.settled_amount_egp)}</td>
                        <td style={{ padding: '6px 10px', fontWeight: 700, color: Number(adv.remaining_amount_egp) > 0 ? '#b91c1c' : '#15803d' }}>
                          {formatCurrency(adv.remaining_amount_egp)}
                        </td>
                        <td style={{ padding: '6px 10px', color: '#64748b' }}>
                          {new Date(adv.disbursement_date || adv.created_at || Date.now()).toLocaleDateString('ar-EG')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Expenses List */}
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', maxHeight: 220, overflowY: 'auto' }} className="thin-scrollbar">
              <div style={{ backgroundColor: '#f8fafc', padding: '8px 12px', borderBottom: '1px solid #e2e8f0', fontSize: 12.5, fontWeight: 700, color: '#0f172a' }}>
                بيان إيصالات ومصروفات التصفية ({brokerStatement.expenses.length})
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }}>
                    <th style={{ padding: '8px 10px', color: '#475569', fontWeight: 600 }}>رقم الإيصال</th>
                    <th style={{ padding: '8px 10px', color: '#475569', fontWeight: 600 }}>التصنيف</th>
                    <th style={{ padding: '8px 10px', color: '#475569', fontWeight: 600 }}>المبلغ</th>
                    <th style={{ padding: '8px 10px', color: '#475569', fontWeight: 600 }}>المعالجة</th>
                    <th style={{ padding: '8px 10px', color: '#475569', fontWeight: 600 }}>التحقق</th>
                    <th style={{ padding: '8px 10px', color: '#475569', fontWeight: 600 }}>البيان</th>
                    <th style={{ padding: '8px 10px', color: '#475569', fontWeight: 600 }}>التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {brokerStatement.expenses.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>
                        لا توجد إيصالات مصفاة مسجلة حتى الآن
                      </td>
                    </tr>
                  ) : (
                    brokerStatement.expenses.map((exp: any) => (
                      <tr key={exp.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 600 }}>
                          {exp.receipt_no || exp.receipt_number || '—'}
                        </td>
                        <td style={{ padding: '8px 10px' }}>{exp.category}</td>
                        <td style={{ padding: '8px 10px', fontWeight: 700, color: '#15803d' }}>{formatCurrency(exp.amount_egp)}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <span
                            style={{
                              fontSize: 11,
                              padding: '2px 6px',
                              borderRadius: 4,
                              backgroundColor: exp.is_refundable_vat ? '#e0f2fe' : exp.is_capitalized ? '#eef2ff' : '#fef3c7',
                              color: exp.is_refundable_vat ? '#0369a1' : exp.is_capitalized ? '#3730a3' : '#b45309',
                            }}
                          >
                            {exp.is_refundable_vat
                              ? 'ضريبة ق.م مستردة'
                              : exp.is_capitalized
                                ? 'رسملة على البضاعة'
                                : 'مصروف فترة'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <span
                            style={{
                              fontSize: 11,
                              padding: '2px 6px',
                              borderRadius: 4,
                              backgroundColor: exp.is_verified ? '#dcfce7' : '#fef3c7',
                              color: exp.is_verified ? '#15803d' : '#b45309',
                            }}
                          >
                            {exp.is_verified ? 'تم التحقق' : 'بانتظار التحقق'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 10px', color: '#64748b' }}>{exp.notes || '—'}</td>
                        <td style={{ padding: '8px 10px', color: '#64748b' }}>
                          {new Date(exp.expense_date || exp.created_at || Date.now()).toLocaleDateString('ar-EG')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Maker-checker verification: a second person verifies a
                liquidated expense with an approved token minted in
                the approvals screen. The liquidator cannot verify
                their own expense. */}
            {brokerStatement.expenses.some((e: any) => !e.is_verified) && (
              <form onSubmit={handleVerifyExpense} style={{ marginTop: 12, border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', backgroundColor: '#fffbeb' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
                  التحقق من مصروف مخلص (رقابة ثنائية) — اطلب اعتماد التحقق من شاشة الاعتمادات أولاً
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'end' }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>الإيصال غير المتحقق منه</label>
                    <select
                      value={verifyExpenseId}
                      onChange={(e) => setVerifyExpenseId(e.target.value)}
                      style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
                    >
                      <option value="">اختر إيصالاً…</option>
                      {brokerStatement.expenses.filter((e: any) => !e.is_verified).map((e: any) => (
                        <option key={e.id} value={e.id}>
                          {e.receipt_no || e.receipt_number || e.id} — {formatCurrency(e.amount_egp)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>معرف طلب الاعتماد المعتمد</label>
                    <input
                      value={verifyTokenId}
                      onChange={(e) => setVerifyTokenId(e.target.value)}
                      placeholder="معرف الطلب من شاشة الاعتمادات"
                      style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
                    />
                  </div>
                  <Button type="submit" disabled={verifyExpenseMutation.isPending}>تحقق</Button>
                </div>
              </form>
            )}
          </div>
        )}
      </StandardDialog>
    )}
    </>
  );
}
