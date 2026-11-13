import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { systemConfirm, toast } from '@/shared/components/system-alert';
import { vanSalesApi, type VanFieldReturnRecord } from '../api/van-sales.api';
import { RefreshCwIcon, FileTextIcon } from '@/shared/components/icons/AppIcons';

const REASON_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  damaged: { label: 'بضاعة تالفة / كسر', color: '#b91c1c', bg: '#fef2f2' },
  expired: { label: 'منتهية الصلاحية', color: '#c2410c', bg: '#fff7ed' },
  manufacturing_defect: { label: 'عيب صناعة / تعبئة', color: '#b45309', bg: '#fefce8' },
  stagnant: { label: 'بضاعة راكدة', color: '#4338ca', bg: '#eef2ff' },
  order_mismatch: { label: 'خطأ في التوريد', color: '#0369a1', bg: '#f0f9ff' },
  customer_request: { label: 'رغبة العميل / رفض', color: '#475569', bg: '#f1f5f9' },
};

export function VanFieldReturnsAdminTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedReturn, setSelectedReturn] = useState<VanFieldReturnRecord | null>(null);
  const [rejectModalReturn, setRejectModalReturn] = useState<VanFieldReturnRecord | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const {
    data: returns = [],
    isLoading,
    refetch,
  } = useQuery<VanFieldReturnRecord[]>({
    queryKey: ['van-admin-field-returns', statusFilter],
    queryFn: () => vanSalesApi.listAdminReturns({ status: statusFilter || undefined }),
    refetchInterval: 15000,
  });

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['van-admin-field-returns'] }),
        queryClient.invalidateQueries({ queryKey: ['van-admin-pending-returns-badge'] }),
        refetch(),
      ]);
      await new Promise((r) => setTimeout(r, 450));
      toast.success('تم تحديث مرتجعات الميدان بنجاح');
    } catch {
      toast.error('حدث خطأ أثناء تحديث البيانات');
    } finally {
      setIsRefreshing(false);
    }
  };

  const pendingReturns = returns.filter((r) => r.status === 'pending_approval');
  const pendingTotal = pendingReturns.reduce((sum, r) => sum + r.totalAmount, 0);
  const approvedReturns = returns.filter((r) => r.status === 'approved');
  const approvedTotal = approvedReturns.reduce((sum, r) => sum + r.totalAmount, 0);

  // Approve Mutation
  const approveMutation = useMutation({
    mutationFn: ({ id }: { id: number; tripId: number }) => vanSalesApi.approveReturn(id),
    onSuccess: (_data, variables) => {
      toast.success('تم قبول واعتماد إذن المرتجع، وقيد التسوية المخزنية والمالية بنجاح!');
      queryClient.invalidateQueries({ queryKey: ['van-admin-field-returns'] });
      queryClient.invalidateQueries({ queryKey: ['van-sales-admin-trips'] });
      // INV-VAN-ADMIN-INVALIDATIONS (P10): the open trip-details dialog
      // reads ['van-trip-admin-details', tripId] — without this it keeps
      // its pre-approval snapshot until a full reload.
      queryClient.invalidateQueries({ queryKey: ['van-trip-admin-details', variables.tripId] });
      setSelectedReturn(null);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'فشل اعتماد المرتجع');
    },
  });

  // Reject Mutation
  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string; tripId: number }) => vanSalesApi.rejectReturn(id, reason),
    onSuccess: (_data, variables) => {
      toast.info('تم رفض إذن المرتجع');
      queryClient.invalidateQueries({ queryKey: ['van-admin-field-returns'] });
      // INV-VAN-ADMIN-INVALIDATIONS (P10): a rejected return also changes
      // what the open trip-details dialog shows (returns list + KPIs).
      queryClient.invalidateQueries({ queryKey: ['van-trip-admin-details', variables.tripId] });
      setSelectedReturn(null);
      setRejectModalReturn(null);
      setRejectReasonInput('');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'فشل رفض المرتجع');
    },
  });

  const handleApprove = async (ret: VanFieldReturnRecord) => {
    const ok = await systemConfirm({
      title: 'اعتماد وقبول إذن المرتجع الميداني',
      message: `هل تود بالتأكيد اعتماد المرتجع #${ret.docNo} للعميل "${ret.customerName}" بقيمة ${ret.totalAmount.toFixed(2)} ${getGlobalCurrencySymbol()}؟ سيتم خصم القيمة من حساب العميل وإعادة البضاعة للمخزن.`,
      confirmText: 'اعتماد وقبول المرتجع',
      cancelText: 'إلغاء',
      variant: 'primary',
    });
    if (ok) {
      approveMutation.mutate({ id: ret.id, tripId: ret.tripId });
    }
  };

  const openRejectDialog = (ret: VanFieldReturnRecord) => {
    setRejectModalReturn(ret);
    setRejectReasonInput('');
  };

  const confirmReject = () => {
    if (!rejectModalReturn) return;
    rejectMutation.mutate({
      id: rejectModalReturn.id,
      reason: rejectReasonInput.trim() || 'تم الرفض بواسطة الإدارة',
      tripId: rejectModalReturn.tripId,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} dir="rtl">
      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
        <div style={{ background: '#ffffff', borderRadius: '12px', padding: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#d97706', display: 'block' }}>{t('delivery_reps.van_field_returns_admin_tab.s0', "مرتجعات قيد المراجعة والاعتماد")}</span>
          <span style={{ fontSize: '22px', fontWeight: 800, color: '#b45309', display: 'block', marginTop: '4px' }}>
            {pendingReturns.length} <span style={{ fontSize: '13px', color: '#f59e0b' }}>{t('delivery_reps.van_field_returns_admin_tab.s1', "إذن")}</span>
          </span>
        </div>

        <div style={{ background: '#ffffff', borderRadius: '12px', padding: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#dc2626', display: 'block' }}>{t('delivery_reps.van_field_returns_admin_tab.s2', "قيمة المرتجعات المعلقة")}</span>
          <span style={{ fontSize: '22px', fontWeight: 800, color: '#991b1b', display: 'block', marginTop: '4px' }}>
            {pendingTotal.toFixed(2)} <span style={{ fontSize: '13px', color: '#fca5a5' }}><CurrencySymbol /></span>
          </span>
        </div>

        <div style={{ background: '#ffffff', borderRadius: '12px', padding: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#16a34a', display: 'block' }}>{t('delivery_reps.van_field_returns_admin_tab.s3', "إجمالي المرتجعات المعتمدة")}</span>
          <span style={{ fontSize: '22px', fontWeight: 800, color: '#15803d', display: 'block', marginTop: '4px' }}>
            {approvedReturns.length} <span style={{ fontSize: '13px', color: '#86efac' }}>{t('delivery_reps.van_field_returns_admin_tab.s4', "إذن")}</span>
          </span>
        </div>

        <div style={{ background: '#ffffff', borderRadius: '12px', padding: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#170e5e', display: 'block' }}>{t('delivery_reps.van_field_returns_admin_tab.s5', "قيمة المرتجعات المعتمدة")}</span>
          <span style={{ fontSize: '22px', fontWeight: 800, color: '#170e5e', display: 'block', marginTop: '4px' }}>
            {approvedTotal.toFixed(2)} <span style={{ fontSize: '13px', color: '#a5b4fc' }}><CurrencySymbol /></span>
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <div
        style={{
          background: '#ffffff',
          padding: '12px 16px',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569' }}>{t('delivery_reps.van_field_returns_admin_tab.s6', "تصفية حسب الحالة:")}</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            {[
              { label: t('delivery_reps.van_field_returns_admin_tab.s7', "كافة المرتجعات"), value: '' },
              { label: t('delivery_reps.van_field_returns_admin_tab.s8', "قيد الاعتماد"), value: 'pending_approval' },
              { label: t('delivery_reps.van_field_returns_admin_tab.s9', "تم الاعتماد"), value: 'approved' },
              { label: t('delivery_reps.van_field_returns_admin_tab.s10', "مرفوض"), value: 'rejected' },
            ].map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setStatusFilter(f.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '7px',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: statusFilter === f.value ? '#170e5e' : '#f1f5f9',
                  color: statusFilter === f.value ? '#ffffff' : '#475569',
                  transition: 'none',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          disabled={isRefreshing}
          onClick={handleManualRefresh}
          title={t('delivery_reps.van_field_returns_admin_tab.s11', "تحديث قائمة مرتجعات الميدان من السيرفر")}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'transparent',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: isRefreshing ? 'wait' : 'pointer',
            opacity: isRefreshing ? 0.75 : 1,
            color: '#334155',
          }}
        >
          <RefreshCwIcon
            size={14}
            className={isRefreshing ? 'spin-animation' : undefined}
            style={isRefreshing ? { animation: 'spin 0.75s linear infinite' } : undefined}
          />
          {isRefreshing ? t('delivery_reps.van_field_returns_admin_tab.s12', "جارٍ التحديث...") : t('delivery_reps.van_field_returns_admin_tab.s13', "تحديث")}
        </button>
      </div>

      {/* Table */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          overflow: 'hidden',
        }}
      >
        {isLoading ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8', fontWeight: 600 }}>{t('delivery_reps.van_field_returns_admin_tab.s14', "جاري تحميل أذونات المرتجعات...")}</div>
        ) : returns.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>
            <FileTextIcon size={40} color="#cbd5e1" />
            <h4 style={{ margin: '12px 0 4px', color: '#475569', fontSize: '15px', fontWeight: 800 }}>{t('delivery_reps.van_field_returns_admin_tab.s15', "لا توجد أذونات مرتجعات مطابقة")}</h4>
            <p style={{ margin: 0, fontSize: '12px' }}>{t('delivery_reps.van_field_returns_admin_tab.s16', "أذونات المرتجع الميدانية التي يسجلها المناديب ستظهر هنا فور إرسالها.")}</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12.5px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                <th style={{ padding: '12px 14px', fontWeight: 700 }}>{t('delivery_reps.van_field_returns_admin_tab.s17', "رقم الإذن")}</th>
                <th style={{ padding: '12px 14px', fontWeight: 700 }}>{t('delivery_reps.van_field_returns_admin_tab.s18', "مندوب الفان")}</th>
                <th style={{ padding: '12px 14px', fontWeight: 700 }}>{t('delivery_reps.van_field_returns_admin_tab.s19', "العميل / المحل")}</th>
                <th style={{ padding: '12px 14px', fontWeight: 700 }}>{t('delivery_reps.van_field_returns_admin_tab.s20', "الفاتورة الأصلية")}</th>
                <th style={{ padding: '12px 14px', fontWeight: 700 }}>{t('delivery_reps.van_field_returns_admin_tab.s21', "سبب المرتجع")}</th>
                <th style={{ padding: '12px 14px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_field_returns_admin_tab.s22', "إجمالي القيمة")}</th>
                <th style={{ padding: '12px 14px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_field_returns_admin_tab.s23', "الحالة")}</th>
                <th style={{ padding: '12px 14px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_field_returns_admin_tab.s24', "الإجراءات")}</th>
              </tr>
            </thead>
            <tbody>
              {returns.map((r) => {
                const reasonInfo = REASON_LABELS[r.returnReason] || { label: r.returnReason, color: '#475569', bg: '#f1f5f9' };
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 14px', fontFamily: 'monospace', fontWeight: 800, color: '#0f172a' }}>
                      #{r.docNo}
                    </td>
                    <td style={{ padding: '12px 14px', fontWeight: 700, color: '#0f172a' }}>
                      {r.repName}
                    </td>
                    <td style={{ padding: '12px 14px', fontWeight: 600, color: '#334155' }}>
                      {r.customerName}
                    </td>
                    <td style={{ padding: '12px 14px', color: '#475569', fontFamily: 'monospace' }}>
                      {r.saleDocNo ? `#${r.saleDocNo}` : t('delivery_reps.van_field_returns_admin_tab.s25', "مرتجع عام")}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '6px',
                          color: reasonInfo.color,
                          backgroundColor: reasonInfo.bg,
                          border: `1px solid ${reasonInfo.color}33`,
                        }}
                      >
                        {reasonInfo.label}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 800, color: '#0f172a' }}>
                      {r.totalAmount.toFixed(2)} <CurrencySymbol />
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '3px 8px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 700,
                          backgroundColor:
                            r.status === 'approved'
                              ? '#dcfce7'
                              : r.status === 'rejected'
                              ? '#fee2e2'
                              : '#fef3c7',
                          color:
                            r.status === 'approved'
                              ? '#15803d'
                              : r.status === 'rejected'
                              ? '#b91c1c'
                              : '#b45309',
                          border: `1px solid ${
                            r.status === 'approved'
                              ? '#bbf7d0'
                              : r.status === 'rejected'
                              ? '#fecaca'
                              : '#fde68a'
                          }`,
                        }}
                      >
                        {r.status === 'approved'
                          ? t('delivery_reps.van_field_returns_admin_tab.s26', "معتمد ومقيد")
                          : r.status === 'rejected'
                          ? t('delivery_reps.van_field_returns_admin_tab.s27', "مرفوض")
                          : t('delivery_reps.van_field_returns_admin_tab.s28', "بانتظار الاعتماد")}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => setSelectedReturn(r)}
                          style={{
                            padding: '4px 8px',
                            borderRadius: '6px',
                            border: '1px solid #cbd5e1',
                            backgroundColor: '#ffffff',
                            color: '#334155',
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {t('delivery_reps.van_field_returns_admin_tab.s29', "معاينة")}
                        </button>
                        {r.status === 'pending_approval' && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleApprove(r)}
                              disabled={approveMutation.isPending}
                              style={{
                                padding: '4px 10px',
                                borderRadius: '6px',
                                border: 'none',
                                backgroundColor: '#15803d',
                                color: '#ffffff',
                                fontSize: '11px',
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              {t('delivery_reps.van_field_returns_admin_tab.s30', "قبول")}
                            </button>
                            <button
                              type="button"
                              onClick={() => openRejectDialog(r)}
                              disabled={rejectMutation.isPending}
                              style={{
                                padding: '4px 8px',
                                borderRadius: '6px',
                                border: '1px solid #fca5a5',
                                backgroundColor: '#fef2f2',
                                color: '#b91c1c',
                                fontSize: '11px',
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              {t('delivery_reps.van_field_returns_admin_tab.s31', "رفض")}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Return Details Modal */}
      {selectedReturn && (
        <StandardDialog
          open={Boolean(selectedReturn)}
          onClose={() => setSelectedReturn(null)}
          title={`تفاصيل إذن المرتجع الميداني #${selectedReturn.docNo}`}
          subtitle={`المندوب: ${selectedReturn.repName} • العميل: ${selectedReturn.customerName}`}
          maxWidth="640px"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }} dir="rtl">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', backgroundColor: '#f8fafc', padding: '12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>{t('delivery_reps.van_field_returns_admin_tab.s32', "الفاتورة الأصلية:")}</span>
                <strong style={{ fontSize: '12.5px', color: '#0f172a' }}>{selectedReturn.saleDocNo ? `#${selectedReturn.saleDocNo}` : t('delivery_reps.van_field_returns_admin_tab.s33', "مرتجع عام")}</strong>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>{t('delivery_reps.van_field_returns_admin_tab.s34', "سبب المرتجع:")}</span>
                <strong style={{ fontSize: '12.5px', color: '#b91c1c' }}>{REASON_LABELS[selectedReturn.returnReason]?.label || selectedReturn.returnReason}</strong>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>{t('delivery_reps.van_field_returns_admin_tab.s35', "إجمالي القيمة:")}</span>
                <strong style={{ fontSize: '14px', color: '#059669' }}>{selectedReturn.totalAmount.toFixed(2)} <CurrencySymbol /></strong>
              </div>
            </div>

            {/* Items Table */}
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '8px 10px', fontWeight: 700 }}>{t('delivery_reps.van_field_returns_admin_tab.s36', "الصنف")}</th>
                    <th style={{ padding: '8px 10px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_field_returns_admin_tab.s37', "الكمية")}</th>
                    <th style={{ padding: '8px 10px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_field_returns_admin_tab.s38', "سعر الوحدة")}</th>
                    <th style={{ padding: '8px 10px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_field_returns_admin_tab.s39', "الإجمالي")}</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedReturn.items.map((it: any, idx: number) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 700, color: '#0f172a' }}>{it.productName || `صنف #${it.productId}`}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 800 }}>{it.qty}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>{it.unitPrice.toFixed(2)} <CurrencySymbol /></td>
                      <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 800, color: '#0f172a' }}>{(it.qty * it.unitPrice).toFixed(2)} <CurrencySymbol /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedReturn.notes && (
              <div style={{ fontSize: '12px', color: '#475569', backgroundColor: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <strong>{t('delivery_reps.van_field_returns_admin_tab.s40', "ملاحظات المندوب:")}</strong> {selectedReturn.notes}
              </div>
            )}

            {selectedReturn.rejectionReason && (
              <div style={{ fontSize: '12px', color: '#991b1b', backgroundColor: '#fef2f2', padding: '10px 12px', borderRadius: '8px', border: '1px solid #fecaca' }}>
                <strong>{t('delivery_reps.van_field_returns_admin_tab.s41', "سبب الرفض:")}</strong> {selectedReturn.rejectionReason}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
              <Button variant="secondary" onClick={() => setSelectedReturn(null)}>
                {t('delivery_reps.van_field_returns_admin_tab.s42', "إغلاق")}
              </Button>
              {selectedReturn.status === 'pending_approval' && (
                <>
                  <Button
                    variant="primary"
                    onClick={() => handleApprove(selectedReturn)}
                    style={{ backgroundColor: '#15803d', color: '#ffffff' }}
                  >
                    {t('delivery_reps.van_field_returns_admin_tab.s43', "قبول واعتماد المرتجع")}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => openRejectDialog(selectedReturn)}
                    style={{ backgroundColor: '#dc2626', color: '#ffffff' }}
                  >
                    {t('delivery_reps.van_field_returns_admin_tab.s44', "رفض المرتجع")}
                  </Button>
                </>
              )}
            </div>
          </div>
        </StandardDialog>
      )}

      {/* Reject Reason Dialog */}
      {rejectModalReturn && (
        <StandardDialog
          open={Boolean(rejectModalReturn)}
          onClose={() => setRejectModalReturn(null)}
          title={`رفض إذن المرتجع #${rejectModalReturn.docNo}`}
          subtitle={`العميل: ${rejectModalReturn.customerName} • المندوب: ${rejectModalReturn.repName}`}
          maxWidth="480px"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }} dir="rtl">
            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('delivery_reps.van_field_returns_admin_tab.s45', "سبب رفض إذن المرتجع")} <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <textarea
                rows={3}
                placeholder={t('delivery_reps.van_field_returns_admin_tab.s46', "وضح سبب الرفض ليظهر للمندوب في سجل المرتجعات الميدانية...")}
                value={rejectReasonInput}
                onChange={(e) => setRejectReasonInput(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button variant="secondary" onClick={() => setRejectModalReturn(null)}>
                {t('delivery_reps.van_field_returns_admin_tab.s47', "إلغاء")}
              </Button>
              <Button
                variant="danger"
                disabled={rejectMutation.isPending}
                onClick={confirmReject}
                style={{ backgroundColor: '#dc2626', color: '#ffffff' }}
              >
                {rejectMutation.isPending ? t('delivery_reps.van_field_returns_admin_tab.s48', "جاري الرفض...") : t('delivery_reps.van_field_returns_admin_tab.s49', "تأكيد رفض المرتجع")}
              </Button>
            </div>
          </div>
        </StandardDialog>
      )}
    </div>
  );
}
