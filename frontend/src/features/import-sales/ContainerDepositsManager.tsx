import React, { useRef, useState } from 'react';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import {
  useContainerDepositsQuery,
  useRecordContainerDepositMutation,
  useRefundContainerDepositMutation,
  useShipmentsQuery,
} from './api/shipments.api';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { formatCurrency } from '@/lib/format';
import {
  PlusCircleIcon,
  RefreshCwIcon,
  CheckCircleIcon,
} from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';
import { useQuery } from '@tanstack/react-query';
import { http } from '@/lib/http';
import { isCashBankAccount } from '@/features/accounting';

export function ContainerDepositsManager() {
  const { data: deposits = [], refetch } = useContainerDepositsQuery();
  const recordDepositMutation = useRecordContainerDepositMutation();
  const refundDepositMutation = useRefundContainerDepositMutation();

  const [isRecordOpen, setIsRecordOpen] = useState(false);
  const [selectedDepositForRefund, setSelectedDepositForRefund] = useState<any | null>(null);
  const refundRequestKey = useRef<string | null>(null);

  // Record Deposit Form State
  const [shipmentId, setShipmentId] = useState('');
  const [containerNo, setContainerNo] = useState('');
  const [shippingLine, setShippingLine] = useState('MSC Mediterranean Shipping Company');
  const [depositAmountEgp, setDepositAmountEgp] = useState<number | string>('');
  const [expectedReturnDate, setExpectedReturnDate] = useState('');
  const [treasuryAccountId, setTreasuryAccountId] = useState('');
  const [notes, setNotes] = useState('');

  // Refund Form State
  const [actualReturnDate, setActualReturnDate] = useState(new Date().toISOString().slice(0, 10));
  const [refundedAmountEgp, setRefundedAmountEgp] = useState<number | string>('');
  const [deductionsAmountEgp, setDeductionsAmountEgp] = useState<number>(0);
  const [deductionReason, setDeductionReason] = useState('');
  const [refundTreasuryAccountId, setRefundTreasuryAccountId] = useState('');

  const { data: shipmentsData } = useShipmentsQuery();
  const shipments: any[] = Array.isArray(shipmentsData)
    ? shipmentsData
    : (shipmentsData as any)?.rows || (shipmentsData as any)?.items || [];

  // Fetch treasury accounts
  const { data: accountsData } = useQuery({
    queryKey: ['accounts-list'],
    queryFn: () => http<any>('/api/accounting/accounts').catch(() => ({ accounts: [] })),
  });
  // INV-IMPORT-CONTAINER-DEPOSIT (I3-D8): only cash/bank accounts are
  // eligible as the deposit payment account — the backend 'bank' role
  // rejects anything with isCashBank false, so offering parent
  // current-asset accounts (e.g. 1100 "الأصول المتداولة") only lets
  // the user pick an account the backend must reject.
  const treasuryAccounts = (accountsData?.accounts || (Array.isArray(accountsData) ? accountsData : [])).filter(
    (a: any) => isCashBankAccount(a),
  );

  const handleRecordDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shipmentId) {
      toast.error('يرجى اختيار الحاوية / الشحنة المرتبطة بالتأمين');
      return;
    }
    if (!containerNo.trim()) {
      toast.error('رقم الحاوية مطلوب');
      return;
    }
    if (Number(depositAmountEgp) <= 0) {
      toast.error('مبلغ التأمين يجب أن يكون أكبر من صفر');
      return;
    }

    const selectedShipment = Array.isArray(shipments) ? shipments.find((s: any) => s.id === shipmentId) : undefined;

    try {
      await recordDepositMutation.mutateAsync({
        projectId: selectedShipment?.project_id || undefined,
        shipmentId,
        containerNo: containerNo.trim(),
        shippingLine,
        depositAmountEgp: Number(depositAmountEgp),
        expectedReturnDate: expectedReturnDate || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
        treasuryAccountId: treasuryAccountId || undefined,
        notes: notes || undefined,
      });
      toast.success('تم إثبات دفع تأمين الحاوية كأصل مدين مسترد');
      setIsRecordOpen(false);
      setContainerNo('');
      refetch();
    } catch (err: any) {
      toast.error('فشل إثبات التأمين: ' + (err.message || 'خطأ'));
    }
  };

  const handleRefundDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDepositForRefund) return;
    if (!refundRequestKey.current) refundRequestKey.current = crypto.randomUUID();

    try {
      await refundDepositMutation.mutateAsync({
        depositId: selectedDepositForRefund.id,
        dto: {
          idempotencyKey: refundRequestKey.current,
          actualReturnDate,
          refundedAmountEgp: Number(refundedAmountEgp),
          deductionsAmountEgp: Number(deductionsAmountEgp),
          deductionReason: deductionReason || undefined,
          treasuryAccountId: refundTreasuryAccountId || undefined,
        },
      });
      toast.success('تمت تسوية استرداد التأمين وتحديث حالة الحاوية إلى تم تسليم الفارغ');
      setSelectedDepositForRefund(null);
      refundRequestKey.current = null;
      refetch();
    } catch (err: any) {
      toast.error('فشل تسوية التأمين: ' + (err.message || 'خطأ'));
    }
  };

  const pendingDeposits = deposits.filter(
    (d: any) => d.refund_status === 'pending' || d.refund_status === 'partially_refunded'
  );
  const totalPendingEgp = pendingDeposits.reduce(
    (sum: number, d: any) =>
      sum + Math.max(0, Number(d.deposit_amount_egp || 0) - Number(d.refunded_amount_egp || 0) - Number(d.deductions_amount_egp || 0)),
    0
  );

  return (
    <div className="page-stack page-shell import-sales-page" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '80px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
        <PageHeader
          title="تأمينات الحاويات وغرامات التأخير"
          description="متابعة مبالغ التأمين المودعة طرف الخطوط الملاحية وفترات السماح واسترداد الفارغ دون تأخير."
          actions={
            <div className="actions compact-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button
                variant="primary"
                onClick={() => setIsRecordOpen(true)}
                style={{
                  height: '38px',
                  padding: '0 16px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  background: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                }}
              >
                <PlusCircleIcon size={15} />
                <span>إثبات دفع تأمين حاوية جديد</span>
              </Button>
            </div>
          }
        />

        {/* Top KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px', marginBottom: '8px' }}>
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748b' }}>إجمالي مبالغ التأمين المعلقة طرف الخطوط</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: totalPendingEgp > 0 ? '#b45309' : '#15803d', marginTop: '4px' }}>
                {formatCurrency(totalPendingEgp)}
              </div>
            </div>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#fef3c7', border: '1px solid #fde68a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#b45309' }}>
              <RefreshCwIcon size={20} />
            </div>
          </div>

          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748b' }}>حاويات قيد الانتظار واسترجاع الفارغ</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                {pendingDeposits.length} <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748b' }}>حاوية</span>
              </div>
            </div>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#eff6ff', border: '1px solid #dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1e40af' }}>
              <CheckCircleIcon size={20} />
            </div>
          </div>
        </div>

      {/* Deposits Table */}
      <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }}>
              <th style={{ padding: '10px 14px', color: '#475569', fontWeight: 600 }}>رقم الحاوية</th>
              <th style={{ padding: '10px 14px', color: '#475569', fontWeight: 600 }}>الخط الملاحي</th>
              <th style={{ padding: '10px 14px', color: '#475569', fontWeight: 600 }}>مبلغ التأمين المدفوع</th>
              <th style={{ padding: '10px 14px', color: '#475569', fontWeight: 600 }}>المسترد الفعلي</th>
              <th style={{ padding: '10px 14px', color: '#475569', fontWeight: 600 }}>الخصومات / غرامات التأخير</th>
              <th style={{ padding: '10px 14px', color: '#475569', fontWeight: 600 }}>حالة التأمين</th>
              <th style={{ padding: '10px 14px', color: '#475569', fontWeight: 600, textAlign: 'center' }}>الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {deposits.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>
                  لا توجد تأمينات حاويات مسجلة حالياً
                </td>
              </tr>
            ) : (
              deposits.map((d: any) => (
                <tr key={d.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 14px', fontWeight: 800, color: '#170e5e', fontFamily: 'monospace' }}>
                    {d.container_no || d.container_number || '—'}
                  </td>
                  <td style={{ padding: '10px 14px' }}>{d.shipping_line}</td>
                  <td style={{ padding: '10px 14px', fontWeight: 700 }}>{formatCurrency(d.deposit_amount_egp)}</td>
                  <td style={{ padding: '10px 14px', color: '#15803d', fontWeight: 600 }}>
                    {Number(d.refunded_amount_egp) > 0 ? formatCurrency(d.refunded_amount_egp) : '—'}
                  </td>
                  <td style={{ padding: '10px 14px', color: Number(d.deductions_amount_egp) > 0 ? '#b91c1c' : '#64748b' }}>
                    {Number(d.deductions_amount_egp) > 0 ? formatCurrency(d.deductions_amount_egp) : '0.00 ج.م'}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 700,
                        backgroundColor:
                          d.refund_status === 'refunded'
                            ? '#dcfce7'
                            : d.refund_status === 'partially_refunded'
                              ? '#e0f2fe'
                              : '#fef3c7',
                        color:
                          d.refund_status === 'refunded'
                            ? '#166534'
                            : d.refund_status === 'partially_refunded'
                              ? '#0369a1'
                              : '#b45309',
                      }}
                    >
                      {d.refund_status === 'refunded'
                        ? 'تم الاسترداد والتسوية'
                        : d.refund_status === 'partially_refunded'
                          ? 'مسترد جزئياً'
                          : 'معلق طرف الخط الملاحي'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                    {d.refund_status === 'pending' || d.refund_status === 'partially_refunded' ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDepositForRefund(d);
                          const remaining = Math.max(
                            0,
                            Number(d.deposit_amount_egp || 0) - Number(d.refunded_amount_egp || 0) - Number(d.deductions_amount_egp || 0)
                          );
                          setRefundedAmountEgp(remaining);
                          setDeductionsAmountEgp(0);
                        }}
                        style={{
                          padding: '4px 10px',
                          backgroundColor: '#15803d',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: 4,
                          fontSize: 11.5,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        تسليم الفارغ واسترداد
                      </button>
                    ) : (
                      <span style={{ fontSize: 11.5, color: '#64748b' }}>تم الإغلاق</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal: Record Deposit */}
      <StandardDialog
        isOpen={isRecordOpen}
        onClose={() => setIsRecordOpen(false)}
        title="إثبات دفع تأمين حاوية (Container Security Deposit)"
        subtitle="تسجيل شيك أو تحويل تأمين الحاوية المسدد للتوكيل الملاحي واسترداده عند تسليم الفارغ"
        width="600px"
        compact
      >
        <form onSubmit={handleRecordDeposit} dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                ربط بالحاوية المسجلة: *
              </label>
              <select
                className="input"
                style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
                value={shipmentId}
                onChange={(e) => {
                  setShipmentId(e.target.value);
                  const found = Array.isArray(shipments) ? shipments.find((s: any) => s.id === e.target.value) : undefined;
                  if (found) setContainerNo(found.container_number);
                }}
                required
              >
                <option value="">-- اختر الحاوية --</option>
                {Array.isArray(shipments) && shipments.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.container_number} ({s.status})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                رقم الحاوية: *
              </label>
              <input
                type="text"
                className="input"
                style={{ width: '100%', padding: '7px 10px', fontSize: 13, fontFamily: 'monospace' }}
                value={containerNo}
                placeholder="مثال: MSCU9482019"
                onChange={(e) => setContainerNo(e.target.value)}
                required
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                الخط الملاحي / التوكيل: *
              </label>
              <select
                className="input"
                style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
                value={shippingLine}
                onChange={(e) => setShippingLine(e.target.value)}
              >
                <option value="MSC Mediterranean Shipping Company">MSC (البحر المتوسط للملاحة)</option>
                <option value="Maersk Line">Maersk (ميرسك لاين)</option>
                <option value="CMA CGM">CMA CGM</option>
                <option value="COSCO Shipping Lines">COSCO (كوسكو الصينية)</option>
                <option value="Hapag-Lloyd">Hapag-Lloyd (هاباج لويد)</option>
                <option value="ONE (Ocean Network Express)">ONE</option>
                <option value="Evergreen Marine">Evergreen (إيفرجرين)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                تاريخ الإرجاع المتوقع للفارغ:
              </label>
              <input
                type="date"
                className="input"
                style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
                value={expectedReturnDate}
                onChange={(e) => setExpectedReturnDate(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                مبلغ التأمين (ج.م): *
              </label>
              <input
                type="number"
                className="input"
                style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
                value={depositAmountEgp}
                onChange={(e) => setDepositAmountEgp(Number(e.target.value))}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                حساب السداد (الخزينة/البنك):
              </label>
              <select
                className="input"
                style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
                value={treasuryAccountId}
                onChange={(e) => setTreasuryAccountId(e.target.value)}
              >
                <option value="">-- البنك / الصندوق --</option>
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
              ملاحظات:
            </label>
            <input
              type="text"
              className="input"
              style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
              value={notes}
              placeholder="مثال: شيك تأمين مسترد عند تسليم الفارغ بمستودع الدخيلة"
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setIsRecordOpen(false)}
              style={{ padding: '7px 14px', backgroundColor: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12.5, cursor: 'pointer' }}
            >
              إلغاء
            </button>
            <button
              type="submit"
              style={{ padding: '7px 16px', backgroundColor: '#170e5e', color: '#ffffff', border: 'none', borderRadius: 6, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
            >
              حفظ التأمين
            </button>
          </div>
        </form>
      </StandardDialog>

      {/* Modal: Refund Deposit */}
      {selectedDepositForRefund && (
        <StandardDialog
          isOpen={!!selectedDepositForRefund}
          onClose={() => setSelectedDepositForRefund(null)}
          title={`تسوية استرداد تأمين الحاوية: ${selectedDepositForRefund.container_no || selectedDepositForRefund.container_number || ''}`}
          subtitle={`الخط الملاحي: ${selectedDepositForRefund.shipping_line} | التأمين الأصلي: ${formatCurrency(selectedDepositForRefund.deposit_amount_egp)}`}
          width="600px"
          compact
        >
          <form onSubmit={handleRefundDeposit} dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                  تاريخ تسليم الفارغ للخط: *
                </label>
                <input
                  type="date"
                  className="input"
                  style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
                  value={actualReturnDate}
                  onChange={(e) => setActualReturnDate(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                  حساب إيداع المبلغ المسترد:
                </label>
                <select
                  className="input"
                  style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
                  value={refundTreasuryAccountId}
                  onChange={(e) => setRefundTreasuryAccountId(e.target.value)}
                >
                  <option value="">-- البنك / الصندوق --</option>
                  {treasuryAccounts.map((acc: any) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.nameAr || acc.nameEn || acc.code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                  المبلغ المسترد نقداً أو بالحساب (ج.م): *
                </label>
                <input
                  type="number"
                  className="input"
                  style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
                  value={refundedAmountEgp}
                  onChange={(e) => setRefundedAmountEgp(Number(e.target.value))}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                  الخصومات ومصاريف التأخير (Detention):
                </label>
                <input
                  type="number"
                  className="input"
                  style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
                  value={deductionsAmountEgp}
                  onChange={(e) => setDeductionsAmountEgp(Number(e.target.value))}
                />
              </div>
            </div>

            {deductionsAmountEgp > 0 && (
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#b91c1c', marginBottom: 4 }}>
                  سبب الخصم (سيتم إثباته كمصروف غرامات/تلفيات): *
                </label>
                <input
                  type="text"
                  className="input"
                  style={{ width: '100%', padding: '7px 10px', fontSize: 13 }}
                  value={deductionReason}
                  placeholder="مثال: خصم 3 أيام تأخير detention بعد انتهاء فترة السماح"
                  onChange={(e) => setDeductionReason(e.target.value)}
                  required={deductionsAmountEgp > 0}
                />
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setSelectedDepositForRefund(null)}
                style={{ padding: '7px 14px', backgroundColor: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12.5, cursor: 'pointer' }}
              >
                إلغاء
              </button>
              <button
                type="submit"
                style={{ padding: '7px 16px', backgroundColor: '#15803d', color: '#ffffff', border: 'none', borderRadius: 6, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
              >
                تأكيد الاسترداد وإغلاق التأمين
              </button>
            </div>
          </form>
        </StandardDialog>
      )}
      </main>
    </div>
  );
}

export default ContainerDepositsManager;
