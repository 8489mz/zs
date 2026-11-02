import React, { useState } from 'react';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import {
  useApprovalRequestsQuery,
  useCreateApprovalRequestMutation,
  useDecideApprovalRequestMutation,
  IMPORT_PAYMENT_METHODS,
  IMPORT_PAYMENT_METHOD_LABELS,
} from './api/shipments.api';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { formatCurrency } from '@/lib/format';
import {
  PlusCircleIcon,
  RefreshCwIcon,
} from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';

export default function ImportApprovalsManager() {
  const [filterStatus, setFilterStatus] = useState<string>('');
  const { data: requests = [], isLoading, refetch } = useApprovalRequestsQuery(filterStatus || undefined);
  const createApprovalMutation = useCreateApprovalRequestMutation();
  const decideApprovalMutation = useDecideApprovalRequestMutation();

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedRequestForDecision, setSelectedRequestForDecision] = useState<any | null>(null);
  const [decisionType, setDecisionType] = useState<'approved' | 'rejected'>('approved');
  const [decisionNotes, setDecisionNotes] = useState('');

  // New Request Form State
  const [requestType, setRequestType] = useState('large_transfer');
  const [projectId, setProjectId] = useState('');
  const [entityId, setEntityId] = useState('');
  const [amountEgp, setAmountEgp] = useState<number | string>('');
  const [justification, setJustification] = useState('');
  // Large-transfer binding fields (INV-IMPORT-PAYMENT-METHODS):
  // the backend binds an approval to the foreign amount, currency,
  // supplier, proforma and payment method at execution. Without
  // these the approval cannot authorize a transfer: the old form
  // sent only an EGP estimate, which never matched the foreign
  // amount and silently failed the binding.
  const [transferAmountForeign, setTransferAmountForeign] = useState<number | string>('');
  const [transferCurrency, setTransferCurrency] = useState('USD');
  const [transferSupplierId, setTransferSupplierId] = useState('');
  const [transferProformaId, setTransferProformaId] = useState('');
  const [transferPaymentMethod, setTransferPaymentMethod] = useState('');
  // Receipt-correction binding fields (INV-IMPORT-RECEIPT-REVERSAL):
  // the approval is bound to one shipment (the reference id) and
  // one receipt; the backend rejects a token minted without both.
  const [receiptApprovalId, setReceiptApprovalId] = useState('');

  const parsePayload = (r: any) => {
    try {
      return typeof r.request_payload === 'string'
        ? JSON.parse(r.request_payload)
        : r.request_payload || {};
    } catch {
      return {};
    }
  };

  const getRequestAmount = (r: any) => {
    const p = parsePayload(r);
    return Number(p.amount ?? p.amountEgp ?? r.amount_egp ?? 0);
  };

  const getRequestJustification = (r: any) => {
    const p = parsePayload(r);
    return p.justification || p.reason || r.justification || '—';
  };

  const pendingCount = requests.filter((r: any) => r.status === 'pending').length;
  const approvedCount = requests.filter((r: any) => r.status === 'approved').length;
  const rejectedCount = requests.filter((r: any) => r.status === 'rejected').length;
  const pendingVolume = requests
    .filter((r: any) => r.status === 'pending')
    .reduce((sum: number, r: any) => sum + getRequestAmount(r), 0);

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!entityId.trim()) throw new Error('معرف المورد أو الشريك أو المشروع إلزامي.');
      if (requestType === 'partner_distribution' && !projectId.trim()) throw new Error('معرف المشروع إلزامي لصرف الأرباح.');
      if (requestType === 'large_transfer' && (!Number(transferAmountForeign) || Number(transferAmountForeign) <= 0)) {
        throw new Error('اعتماد الحوالة يتطلب المبلغ بالعملة الأجنبية كما سينفذ بالضبط.');
      }
      const isReceiptAction = requestType === 'import_receipt_reversal' || requestType === 'import_legacy_receipt_review';
      if (isReceiptAction && !receiptApprovalId.trim()) {
        throw new Error('اعتماد عكس/مراجعة الاستلام يتطلب معرف سند الاستلام المربوط بالشحنة.');
      }
      if (requestType === 'broker_expense_verification' && (!Number(amountEgp) || Number(amountEgp) <= 0)) {
        throw new Error('اعتماد التحقق من مصروف مخلص يتطلب مبلغ المصروف بالجنيه كسقف للموافقة.');
      }
      await createApprovalMutation.mutateAsync({
        actionType: requestType,
        referenceId: entityId.trim(),
        requestPayload: {
          amount: isReceiptAction ? undefined : (requestType === 'large_transfer' ? Number(transferAmountForeign) : Number(amountEgp)),
          currency: requestType === 'large_transfer' ? transferCurrency.trim().toUpperCase() : undefined,
          supplierId: requestType === 'large_transfer' ? (transferSupplierId.trim() || entityId.trim()) : undefined,
          proformaInvoiceId: requestType === 'large_transfer' && transferProformaId.trim() ? transferProformaId.trim() : undefined,
          paymentMethod: requestType === 'large_transfer' && transferPaymentMethod ? transferPaymentMethod : undefined,
          shipmentId: isReceiptAction ? entityId.trim() : undefined,
          receiptId: isReceiptAction ? receiptApprovalId.trim() : undefined,
          brokerExpenseId: requestType === 'broker_expense_verification' ? entityId.trim() : undefined,
          partnerId: requestType === 'partner_distribution' ? entityId.trim() : undefined,
          projectId: requestType === 'partner_distribution' ? projectId.trim() : undefined,
          justification,
        },
      });
      toast.success('تم رفع طلب الاعتماد للرقابة بنجاح');
      setIsCreateModalOpen(false);
      setEntityId('');
      setJustification('');
      setTransferAmountForeign('');
      setTransferSupplierId('');
      setTransferProformaId('');
      setTransferPaymentMethod('');
      setReceiptApprovalId('');
      refetch();
    } catch (err: any) {
      toast.error('فشل رفع طلب الاعتماد: ' + (err.message || 'خطأ غير معروف'));
    }
  };

  const handleDecision = async () => {
    if (!selectedRequestForDecision) return;
    try {
      await decideApprovalMutation.mutateAsync({
        id: selectedRequestForDecision.id,
        decision: decisionType,
        comments: decisionType === 'approved' ? decisionNotes : undefined,
        rejectionReason: decisionType === 'rejected' ? decisionNotes : undefined,
      });
      toast.success(decisionType === 'approved' ? 'تم اعتماد العملية بنجاح' : 'تم رفض العملية وتوثيق السبب');
      setSelectedRequestForDecision(null);
      setDecisionNotes('');
      refetch();
    } catch (err: any) {
      toast.error('فشل تسجيل القرار: ' + (err.message || 'خطأ غير معروف'));
    }
  };

  const getRequestTypeName = (type: string) => {
    switch (type) {
      case 'large_transfer':
      case 'foreign_transfer':
        return 'حوالة بنكية للمورد الخارجي';
      case 'supplier_bank_change':
        return 'توثيق تغيير حساب مورد';
      case 'broker_settlement':
        return 'تسوية عهدة مخلص جمركي';
      case 'partner_distribution':
        return 'صرف أرباح شريك من مشروع محدد';
      case 'partner_share_adjustment':
        return 'تعديل نسب مشاركة الشركاء';
      case 'project_closure':
        return 'إقفال حسابات مشروع الاستيراد';
      case 'import_receipt_reversal':
        return 'عكس سند استلام مرحل';
      case 'import_legacy_receipt_review':
        return 'مراجعة استلام قديم مجمد';
      case 'broker_expense_verification':
        return 'التحقق من مصروف مخلص (رقابة ثنائية)';
      case 'late_expense_allocation':
        return 'تحميل مصروفات متأخرة على الحاوية';
      default:
        return type;
    }
  };

  return (
    <div className="page-stack page-shell import-sales-page" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '80px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
        <PageHeader
          title="مركز الرقابة الثنائية والموافقات المعتمدة (Maker-Checker)"
          description="فصل الصلاحيات والتحقق المزدوج للعمليات المالية الحرجة (التحويلات الكبرى، تعديل الشركاء، وإقفال المشاريع)."
          actions={
            <div className="actions compact-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button
                variant="primary"
                onClick={() => setIsCreateModalOpen(true)}
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
                <span>رفع طلب اعتماد جديد</span>
              </Button>
              <Button
                variant="secondary"
                onClick={() => refetch()}
                disabled={isLoading}
                style={{
                  height: '38px',
                  padding: '0 14px',
                  borderRadius: '8px',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <RefreshCwIcon size={14} />
                <span>تحديث</span>
              </Button>
            </div>
          }
        />

        {/* 2. KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>طلبات قيد المراجعة</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#d97706' }}>{pendingCount}</div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: 4 }}>تتطلب قراراً من مدير معتمد</div>
        </div>

        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>إجمالي القيمة المعلقة</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#170e5e' }}>{formatCurrency(pendingVolume)}</div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: 4 }}>مبالغ بانتظار تصريح الصرف</div>
        </div>

        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>طلبات تم اعتمادها</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#16a34a' }}>{approvedCount}</div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: 4 }}>عمليات مفعلة وموثقة دفترياً</div>
        </div>

        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>طلبات مرفوضة</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#dc2626' }}>{rejectedCount}</div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: 4 }}>أوقفت لمنع مخالفات تعاقدية</div>
        </div>
      </div>

      {/* 3. Filter Tabs */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid #e2e8f0', paddingBottom: 8 }}>
        {[
          { key: '', label: 'كافة الطلبات' },
          { key: 'pending', label: 'قيد المراجعة' },
          { key: 'approved', label: 'المعتمدة' },
          { key: 'rejected', label: 'المرفوضة' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilterStatus(tab.key)}
            style={{
              padding: '7px 16px',
              borderRadius: 8,
              border: '1px solid ' + (filterStatus === tab.key ? '#170e5e' : '#e2e8f0'),
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: 'pointer',
              backgroundColor: filterStatus === tab.key ? '#170e5e' : '#f8fafc',
              color: filterStatus === tab.key ? '#ffffff' : '#475569',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 4. Requests Table */}
      <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>جاري تحميل طلبات الرقابة...</div>
        ) : requests.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
            لا توجد طلبات اعتماد مطابقة للتصفية الحالية
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>رقم الطلب والمرجع</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>نوع العملية</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>القيمة المالية</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>المبرر التشغيلي</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>الحالة</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569', textAlign: 'center' }}>الإجراء الرقابي</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r: any) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 14px', fontSize: '12px' }}>
                      <div style={{ fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>
                        #{String(r.id).slice(0, 8)} {r.reference_id ? `(${String(r.reference_id).slice(0, 12)})` : ''}
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '11px' }}>{new Date(r.created_at || Date.now()).toLocaleDateString('ar-EG')}</div>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '12.5px', fontWeight: 600, color: '#0f172a' }}>
                      {getRequestTypeName(r.action_type || r.request_type)}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '12.5px', fontWeight: 700, color: '#170e5e' }}>
                      {formatCurrency(getRequestAmount(r))}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: '#475569', maxWidth: 300 }}>
                      {getRequestJustification(r)}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '12px' }}>
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: 6,
                          fontSize: '11px',
                          fontWeight: 700,
                          backgroundColor: r.status === 'approved' ? '#dcfce7' : r.status === 'rejected' ? '#fee2e2' : '#fef3c7',
                          color: r.status === 'approved' ? '#166534' : r.status === 'rejected' ? '#991b1b' : '#92400e',
                        }}
                      >
                        {r.status === 'approved' ? 'معتمد رسمياً' : r.status === 'rejected' ? 'مرفوض' : 'قيد المراجعة'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                      {r.status === 'pending' ? (
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRequestForDecision(r);
                              setDecisionType('approved');
                              setDecisionNotes('');
                            }}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 6,
                              border: 'none',
                              backgroundColor: '#166534',
                              color: '#ffffff',
                              fontSize: '11.5px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            اعتماد
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRequestForDecision(r);
                              setDecisionType('rejected');
                              setDecisionNotes('');
                            }}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 6,
                              border: '1px solid #ef4444',
                              backgroundColor: '#ffffff',
                              color: '#ef4444',
                              fontSize: '11.5px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            رفض
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                          {r.rejection_reason || r.decision_comments || 'تم اتخاذ القرار'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. Create Request Dialog */}
      <StandardDialog
        open={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="رفع طلب اعتماد مالي ورقابي جديد"
        subtitle="توثيق مبرر العملية الحساسة للحصول على موافقة خطية من الإدارة قبل التنفيذ"
        width="560px"
      >
        <form onSubmit={handleCreateRequest} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
              نوع العملية الخاضعة للموافقة
            </label>
            <select
              value={requestType}
              onChange={(e) => setRequestType(e.target.value)}
              style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            >
              <option value="large_transfer">حوالة بنكية خارجية كبيرة (Large Transfer)</option>
              <option value="supplier_bank_change">توثيق تغيير حساب مورد</option>
              <option value="broker_settlement">تسوية عهدة مخلص جمركي</option>
              <option value="partner_distribution">صرف أرباح شريك من مشروع محدد</option>
              <option value="project_closure">إقفال مشروع الاستيراد</option>
              <option value="import_receipt_reversal">عكس سند استلام مرحل</option>
              <option value="import_legacy_receipt_review">مراجعة استلام قديم مجمد</option>
              <option value="broker_expense_verification">التحقق من مصروف مخلص (رقابة ثنائية)</option>
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
                القيمة التقديرية (ج.م)
              </label>
              <input
                type="number"
                required={requestType !== 'import_receipt_reversal' && requestType !== 'import_legacy_receipt_review'}
                value={amountEgp}
                onChange={(e) => setAmountEgp(Number(e.target.value))}
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
                معرف السجل / رقم الوثيقة
              </label>
              <input
                type="text"
                placeholder="مثال: SHP-2609-001 أو PRJ-01"
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
          </div>

          {requestType === 'partner_distribution' && (
            <div>
              <label style={{ display: 'block', marginBottom: 4 }}>معرف مشروع أرباح الشريك (UUID)</label>
              <input required value={projectId} onChange={e => setProjectId(e.target.value)}
                style={{ width: '100%', height: 36, padding: 6, border: '1px solid #cbd5e1', borderRadius: 6 }} />
            </div>
          )}
          {(requestType === 'import_receipt_reversal' || requestType === 'import_legacy_receipt_review') && (
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
                معرف سند الاستلام المربوط بالشحنة (يظهر في صفحة الشحنة)
              </label>
              <input
                required
                value={receiptApprovalId}
                onChange={(e) => setReceiptApprovalId(e.target.value)}
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
          )}
          {requestType === 'large_transfer' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
                  المبلغ بالعملة الأجنبية (كما سينفذ)
                </label>
                <input
                  type="number"
                  required
                  value={transferAmountForeign}
                  onChange={(e) => setTransferAmountForeign(Number(e.target.value))}
                  style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
                  العملة
                </label>
                <input
                  type="text"
                  required
                  value={transferCurrency}
                  onChange={(e) => setTransferCurrency(e.target.value)}
                  style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
                  معرف المورد (فارغ = نفس معرف السجل أعلاه)
                </label>
                <input
                  type="text"
                  value={transferSupplierId}
                  onChange={(e) => setTransferSupplierId(e.target.value)}
                  style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
                  معرف الفاتورة المبدئية (اختياري)
                </label>
                <input
                  type="text"
                  value={transferProformaId}
                  onChange={(e) => setTransferProformaId(e.target.value)}
                  style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
                  طريقة الدفع المرخص بها (اختياري — تقيد الاعتماد بها)
                </label>
                <select
                  value={transferPaymentMethod}
                  onChange={(e) => setTransferPaymentMethod(e.target.value)}
                  style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
                >
                  <option value="">-- بدون طريقة (لا يجيز تحويلًا مقيدًا بطريقة دفع) --</option>
                  {IMPORT_PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>{IMPORT_PAYMENT_METHOD_LABELS[m]}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
              المبرر التشغيلي والتفاصيل
            </label>
            <textarea
              rows={3}
              required
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="اكتب سبب طلب الاعتماد، وأي شروط تعاقدية تم الاتفاق عليها مع المورد أو الشركاء..."
              style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(false)}
              style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={createApprovalMutation.isPending}
              style={{ padding: '8px 18px', borderRadius: 6, border: 'none', backgroundColor: '#170e5e', color: '#ffffff', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}
            >
              {createApprovalMutation.isPending ? 'جاري الإرسال...' : 'إرسال طلب الاعتماد'}
            </button>
          </div>
        </form>
      </StandardDialog>

      {/* 6. Decision Dialog */}
      <StandardDialog
        open={Boolean(selectedRequestForDecision)}
        onClose={() => setSelectedRequestForDecision(null)}
        title={decisionType === 'approved' ? 'تأكيد اعتماد العملية المالية' : 'تأكيد رفض طلب العملية المالية'}
        subtitle="توثيق القرار الرقابي في سجل المراجعة غير القابل للتعديل"
        width="500px"
      >
        {selectedRequestForDecision && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px' }}>
              <div style={{ fontSize: '12.5px', marginBottom: 4 }}>
                <strong>العملية:</strong> {getRequestTypeName(selectedRequestForDecision.action_type || selectedRequestForDecision.request_type)}
              </div>
              <div style={{ fontSize: '12.5px', marginBottom: 4 }}>
                <strong>القيمة:</strong> {formatCurrency(getRequestAmount(selectedRequestForDecision))}
              </div>
              <div style={{ fontSize: '12px', color: '#64748b' }}>
                <strong>المبرر:</strong> {getRequestJustification(selectedRequestForDecision)}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
                {decisionType === 'approved' ? 'ملاحظات وتوجيهات الاعتماد:' : 'سبب الرفض الإلزامي:'}
              </label>
              <textarea
                rows={3}
                required={decisionType === 'rejected'}
                value={decisionNotes}
                onChange={(e) => setDecisionNotes(e.target.value)}
                placeholder={decisionType === 'approved' ? 'مثال: معتمد للصرف وفق بنود الفاتورة المبدئية' : 'اذكر سبب الرفض بالتفصيل...'}
                style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setSelectedRequestForDecision(null)}
                style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}
              >
                تراجع
              </button>
              <button
                type="button"
                disabled={decideApprovalMutation.isPending}
                onClick={handleDecision}
                style={{
                  padding: '8px 18px',
                  borderRadius: 6,
                  border: 'none',
                  backgroundColor: decisionType === 'approved' ? '#166534' : '#dc2626',
                  color: '#ffffff',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {decideApprovalMutation.isPending ? 'جاري التسجيل...' : decisionType === 'approved' ? 'تأكيد الاعتماد' : 'تأكيد الرفض'}
              </button>
            </div>
          </div>
        )}
      </StandardDialog>
      </main>
    </div>
  );
}
