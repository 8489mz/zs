import { useState } from 'react';
import {
  useReconciliationExceptionsQuery,
  useRunReconciliationScanMutation,
  useResolveReconciliationExceptionMutation,
  useImportFlowEventsQuery,
} from './api/shipments.api';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { formatCurrency } from '@/lib/format';
import {
  RefreshCwIcon,
  CheckShieldIcon,
} from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';

export default function ImportReconciliationManager() {
  const [filterStatus, setFilterStatus] = useState<string>('');
  const { data: exceptions = [], isLoading, refetch } = useReconciliationExceptionsQuery(filterStatus || undefined);
  // INV-IMPORT-TRACEABILITY-APPROVALS-POOL: the receipt <-> journal
  // tie-out below reads the same traceability source as the approvals
  // queue and the profit attribution — a posted receipt shows here
  // as matched with its real journal number, so "0 exceptions" is
  // never the whole story: the matched flow is visible too.
  const { data: trace } = useImportFlowEventsQuery();
  const runScanMutation = useRunReconciliationScanMutation();
  const resolveExceptionMutation = useResolveReconciliationExceptionMutation();

  const [selectedExceptionForResolve, setSelectedExceptionForResolve] = useState<any | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');

  const getExceptionTypeLabel = (type: string) => {
    switch (type) {
      case 'broker_advance_mismatch':
        return 'عهدة مخلص معلقة (>30 يوم)';
      case 'container_deposit_overdue':
        return 'تأخر استرداد تأمين حاوية';
      default:
        return type || 'مطابقة عامة';
    }
  };

  const getExceptionDescription = (e: any) => {
    if (e.description) return e.description;
    let details: any = {};
    try {
      details = typeof e.details === 'string' ? JSON.parse(e.details) : e.details || {};
    } catch {
      details = {};
    }
    if (e.exception_type === 'broker_advance_mismatch') {
      return `عهدة تخليص جمركي غير مصفاة منذ أكثر من 30 يوماً - إذن #${details.advanceNo || '—'}`;
    }
    if (e.exception_type === 'container_deposit_overdue') {
      return `تجاوز موعد استرداد تأمين الحاوية #${details.containerNo || '—'} (${details.shippingLine || '—'}) المقرر بتاريخ ${details.expectedDate || '—'}`;
    }
    return JSON.stringify(details);
  };

  const openCount = exceptions.filter((e: any) => e.status === 'open').length;
  const criticalCount = exceptions.filter((e: any) => (e.severity === 'critical' || e.severity === 'high') && e.status === 'open').length;
  const resolvedCount = exceptions.filter((e: any) => e.status === 'resolved').length;
  const openDiscrepancySum = exceptions
    .filter((e: any) => e.status === 'open')
    .reduce((sum: number, e: any) => sum + Number(e.discrepancy_amount_egp || 0), 0);

  const handleRunScan = async () => {
    try {
      const res = await runScanMutation.mutateAsync();
      const count = res?.exceptionsFoundCount ?? res?.exceptionsFound ?? 0;
      toast.success(`اكتمل الفحص الآلي الذكي: تم فحص وتدقيق كافة الحركات (${count} ملاحظة مستحدثة)`);
      refetch();
    } catch (err: any) {
      toast.error('فشل تشغيل فحص المطابقة: ' + (err.message || 'خطأ غير معروف'));
    }
  };

  const handleResolve = async () => {
    if (!selectedExceptionForResolve) return;
    try {
      await resolveExceptionMutation.mutateAsync({
        id: selectedExceptionForResolve.id,
        resolutionNotes,
      });
      toast.success('تمت تسوية الملاحظة الرقابية وإغلاق الاستثناء بنجاح');
      setSelectedExceptionForResolve(null);
      setResolutionNotes('');
      refetch();
    } catch (err: any) {
      toast.error('فشل تسوية الاستثناء: ' + (err.message || 'خطأ غير معروف'));
    }
  };

  return (
    <div className="page-stack page-shell import-sales-page" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '80px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
        <PageHeader
          title="مركز مطابقة الاستيراد وتسوية الفروقات (Audit & Reconciliation)"
          description="الفحص الآلي الذكي لاكتشاف تسريب التكاليف، العهد الجمركية العالقة، وتأمينات الخطوط الملاحية غير المستردة."
          actions={
            <div className="actions compact-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button
                variant="secondary"
                onClick={() => refetch()}
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
              <Button
                variant="primary"
                onClick={handleRunScan}
                disabled={runScanMutation.isPending}
                style={{
                  height: '38px',
                  padding: '0 18px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  background: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: runScanMutation.isPending ? 'not-allowed' : 'pointer',
                }}
              >
                <CheckShieldIcon size={15} />
                <span>{runScanMutation.isPending ? 'جاري الفحص الآلي...' : 'تشغيل فحص المطابقة الشامل'}</span>
              </Button>
            </div>
          }
        />

      {/* 2. KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>فروقات معلقة غير مسواة</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#d97706' }}>{openCount}</div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: 4 }}>استثناءات تتطلب تدقيقاً فورياً</div>
        </div>

        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>ملاحظات رقابية حرجة</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#dc2626' }}>{criticalCount}</div>
          <div style={{ fontSize: '11px', color: '#dc2626', marginTop: 4 }}>تمنع الإقفال النهائي للمشاريع</div>
        </div>

        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>إجمالي الفروق المالية المحتملة</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#170e5e' }}>{formatCurrency(openDiscrepancySum)}</div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: 4 }}>مبالغ مستحقة للشركة أو عليها</div>
        </div>

        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>استثناءات تمت تسويتها</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#16a34a' }}>{resolvedCount}</div>
          <div style={{ fontSize: '11px', color: '#16a34a', marginTop: 4 }}>معالجة دفترياً ومغلقة</div>
        </div>
      </div>

      {/* 3. Filter Tabs */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid #e2e8f0', paddingBottom: 8 }}>
        {[
          { key: '', label: 'كافة الاستثناءات' },
          { key: 'open', label: 'المفتوحة والمعلقة' },
          { key: 'resolved', label: 'تمت تسويتها' },
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

      {/* 4. Exceptions Table */}
      <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>جاري تحميل نتائج المطابقة...</div>
        ) : exceptions.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#166534', fontSize: '13px', backgroundColor: '#f0fdf4' }}>
            الدفاتر مطابقة 100%! لا توجد أي استثناءات أو عهد معلقة أو فروق تكلفة مكتشفة حالياً.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>تاريخ الاكتشاف</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>النطاق والنوع</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>درجة الخطورة</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>بيان الفارق الرقابي</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>قيمة الفارق (ج.م)</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>الحالة</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569', textAlign: 'center' }}>الإجراء</th>
                </tr>
              </thead>
              <tbody>
                {exceptions.map((e: any) => (
                  <tr key={e.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: '#64748b' }}>
                      {new Date(e.created_at || Date.now()).toLocaleDateString('ar-EG')}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '12.5px', fontWeight: 600, color: '#0f172a' }}>
                      {getExceptionTypeLabel(e.exception_type)}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '12px' }}>
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: 6,
                          fontSize: '11px',
                          fontWeight: 700,
                          backgroundColor: e.severity === 'critical' || e.severity === 'high' ? '#fee2e2' : e.severity === 'warning' ? '#fef3c7' : '#e0f2fe',
                          color: e.severity === 'critical' || e.severity === 'high' ? '#991b1b' : e.severity === 'warning' ? '#92400e' : '#0369a1',
                        }}
                      >
                        {e.severity === 'critical' ? 'حرج' : e.severity === 'high' ? 'مرتفع' : e.severity === 'warning' ? 'تنبيه' : 'معلومة'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: '#334155', maxWidth: 320 }}>
                      {getExceptionDescription(e)}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '12.5px', fontWeight: 700, color: '#170e5e' }}>
                      {formatCurrency(e.discrepancy_amount_egp)}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '12px' }}>
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: 6,
                          fontSize: '11px',
                          fontWeight: 700,
                          backgroundColor: e.status === 'resolved' ? '#dcfce7' : '#fef3c7',
                          color: e.status === 'resolved' ? '#166534' : '#92400e',
                        }}
                      >
                        {e.status === 'resolved' ? 'تمت التسوية' : 'معلق'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                      {e.status === 'open' ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedExceptionForResolve(e);
                            setResolutionNotes('');
                          }}
                          style={{
                            padding: '4px 12px',
                            borderRadius: 6,
                            border: '1px solid #170e5e',
                            backgroundColor: '#ffffff',
                            color: '#170e5e',
                            fontSize: '11.5px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          تسوية الاستثناء
                        </button>
                      ) : (
                        <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                          {e.resolution_notes || 'مسوّى'}
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

      {/* 5. Receipt <-> journal tie-out (INV-IMPORT-TRACEABILITY-APPROVALS-POOL):
          every import receipt with its real state and its journal.
          A receipt is "matched" only when receipt and journal are
          both posted — an unposted receipt is an open tie-out, never
          a silent 100% match. */}
      <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
          <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: '#0f172a' }}>مطابقة سندات الاستلام مع قيود اليومية</h4>
          <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
            {trace
              ? `${trace.counts.receiptsMatched}/${trace.counts.receipts} سند مطابق • ${trace.counts.receiptsPosted} مرحّل • ${trace.counts.supplierPayments} دفعة مورد مرتبطة بفاتورة مبدئية`
              : 'جاري تحميل سجل المطابقة...'}
          </span>
        </div>
        {!trace ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>جاري تحميل سجل المطابقة...</div>
        ) : trace.events.filter((e: any) => e.kind === 'receipt').length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>لا توجد سندات استلام مسجلة بعد</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>سند الاستلام</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>الحاوية</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>حالة السند</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>قيد اليومية</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>المطابقة</th>
                </tr>
              </thead>
              <tbody>
                {trace.events.filter((e: any) => e.kind === 'receipt').map((e: any, idx: number) => (
                  <tr key={`${e.ref}-${idx}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 14px', fontSize: '12.5px', fontWeight: 700, color: '#0f172a' }}>سند الاستلام {e.ref}</td>
                    <td style={{ padding: '10px 14px', fontSize: '12.5px', color: '#0f172a' }}>{e.label || '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: '12px' }}>{e.state || '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: '12.5px', fontWeight: 700, color: '#170e5e' }}>{e.journalEntryNo || '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: '12px' }}>
                      <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: '11px', fontWeight: 700, backgroundColor: e.journalMatched ? '#dcfce7' : '#fef3c7', color: e.journalMatched ? '#166534' : '#92400e' }}>
                        {e.journalMatched ? 'مطابق' : 'مطابقة مفتوحة'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 6. Resolve Exception Dialog */}
      <StandardDialog
        open={Boolean(selectedExceptionForResolve)}
        onClose={() => setSelectedExceptionForResolve(null)}
        title="تسوية ملاحظة مطابقة رقابية"
        subtitle="توثيق معالجة الفارق الحسابي وإقفال الملاحظة في سجل التدقيق"
        width="520px"
      >
        {selectedExceptionForResolve && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px' }}>
              <div style={{ fontSize: '12.5px', marginBottom: 4 }}>
                <strong>النوع:</strong> {getExceptionTypeLabel(selectedExceptionForResolve.exception_type)}
              </div>
              <div style={{ fontSize: '12.5px', marginBottom: 4 }}>
                <strong>قيمة الفارق:</strong> {formatCurrency(selectedExceptionForResolve.discrepancy_amount_egp)}
              </div>
              <div style={{ fontSize: '12px', color: '#64748b' }}>
                <strong>الوصف:</strong> {getExceptionDescription(selectedExceptionForResolve)}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
                بيان التسوية والمبرر المحاسبي الإلزامي:
              </label>
              <textarea
                rows={3}
                required
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                placeholder="اذكر كيف تمت معالجة الفارق (مثال: تم إرفاق إيصال الرسوم الجمركية المفقود برقم...)"
                style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setSelectedExceptionForResolve(null)}
                style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={resolveExceptionMutation.isPending || !resolutionNotes.trim()}
                onClick={handleResolve}
                style={{
                  padding: '8px 18px',
                  borderRadius: 6,
                  border: 'none',
                  backgroundColor: '#170e5e',
                  color: '#ffffff',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: resolveExceptionMutation.isPending || !resolutionNotes.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {resolveExceptionMutation.isPending ? 'جاري التسوية...' : 'تأكيد تسوية الاستثناء'}
              </button>
            </div>
          </div>
        )}
      </StandardDialog>
      </main>
    </div>
  );
}
