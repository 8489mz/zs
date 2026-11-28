import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { DialogShell } from '@/shared/components/dialog-shell';
import { formatCurrency } from '@/lib/format';
import {
  downloadOfflineQueueEmergencyJson,
  OfflinePosSale,
  removeOfflineSale,
} from '@/features/pos/lib/pos-offline-sync';
import { posApi } from '@/features/pos/api/pos.api';
import { systemConfirm, toast } from '@/shared/components/system-alert';

interface PosOfflineQueueModalProps {
  open: boolean;
  onClose: () => void;
  offlineQueue: OfflinePosSale[];
  isSyncing: boolean;
  onRetrySync: () => Promise<void> | void;
}

export function PosOfflineQueueModal({
  open,
  onClose,
  offlineQueue,
  isSyncing,
  onRetrySync,
}: PosOfflineQueueModalProps) {
  const { t } = useTranslation();
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  if (!open) return null;

  const totalAmount = offlineQueue.reduce((sum, item) => {
    return sum + Number(item.payload.expectedTotal || 0);
  }, 0);

  const handleCopyJson = () => {
    try {
      const dataStr = JSON.stringify(offlineQueue, null, 2);
      navigator.clipboard.writeText(dataStr);
      setCopyStatus('تم نسخ بيانات الفواتير بنجاح');
      setTimeout(() => setCopyStatus(null), 3000);
    } catch {
      setCopyStatus('تعذر النسخ إلى الحافظة');
      setTimeout(() => setCopyStatus(null), 3000);
    }
  };

  const handleDownloadJson = () => {
    const ok = downloadOfflineQueueEmergencyJson(offlineQueue);
    if (ok) {
      setCopyStatus('تم تنزيل ملف النسخة الاحتياطية للفواتير الأوفلاين بنجاح');
    } else {
      setCopyStatus('تعذر تنزيل ملف النسخة الاحتياطية');
    }
    setTimeout(() => setCopyStatus(null), 3000);
  };

  const handleRemoveSingle = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const sale = offlineQueue.find(item => item.id === id);
    if (!sale || sale.status !== 'failed') {
      toast.error('لا يمكن حذف فاتورة معلقة أو قيد الترحيل؛ يجب التحقق من نتيجتها أولاً');
      return;
    }
    try {
      const server = await posApi.getSaleOperationStatus(id);
      if (server.documentId || !['not_found', 'failed'].includes(String(server.status))) {
        throw new Error('حالة الفاتورة غير محسومة على الخادم؛ لا يمكن حذفها');
      }
      const confirmed = await systemConfirm({
        title: 'حذف فاتورة لم تُرحّل',
        message: 'أثبت الخادم عدم ترحيل الفاتورة. انسخ بياناتها كنسخة احتياطية قبل الحذف. هل تريد إلغاء المحاولة المحلية؟',
        confirmText: 'حذف الفاتورة الفاشلة', cancelText: 'إبقاء الفاتورة',
      });
      if (!confirmed) return;
      // Freshly re-read status after confirmation to avoid deleting a voucher
      // that a parallel device or in-flight request just committed.
      const verified = await posApi.getSaleOperationStatus(id);
      if (verified.documentId || !['not_found', 'failed'].includes(String(verified.status))) {
        throw new Error('تغيرت حالة الفاتورة؛ لم يتم حذفها');
      }
      removeOfflineSale(id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تأكيد أمان حذف الفاتورة');
    }
  };

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      ariaLabel={t('pos.pos_workspace.pos_offline_queue_modal.s0', "سجل الفواتير المحفوظة بدون إنترنت (Offline Queue)")}
      width="min(720px, 100%)"
    >
      <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '4px 0' }}>
        {/* Summary header banner */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '14px 18px',
          flexWrap: 'wrap',
          gap: '12px'
        }}>
          <div>
            <div style={{ fontSize: '13px', color: '#64748b' }}>{t('pos.pos_workspace.pos_offline_queue_modal.s1', "إجمالي الفواتير المعلقة محلياً")}</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>
              {offlineQueue.length} {t('pos.pos_workspace.pos_offline_queue_modal.s2', "فواتير (")}{formatCurrency(totalAmount)})
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              disabled={isSyncing || offlineQueue.length === 0}
              onClick={async () => {
                const failed = offlineQueue.filter((sale) => sale.status === 'failed').length;
                if (failed > 0) {
                  const proceed = await systemConfirm({
                    title: 'مراجعة الفواتير المتعثرة',
                    message: `يوجد ${failed} فاتورة فشل ترحيلها. سيتم التحقق من حالة الخادم أولاً دون تكرار الفاتورة.`,
                    confirmText: 'التحقق والمحاولة', cancelText: 'إلغاء',
                  });
                  if (!proceed) return;
                }
                await onRetrySync();
              }}
              style={{
                background: '#170e5e',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: isSyncing || offlineQueue.length === 0 ? 'not-allowed' : 'pointer',
                opacity: isSyncing || offlineQueue.length === 0 ? 0.6 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>{isSyncing ? t('pos.pos_workspace.pos_offline_queue_modal.s3', "جاري المزامنة...") : t('pos.pos_workspace.pos_offline_queue_modal.s4', "إعادة محاولة المزامنة الآن")}</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadJson}
              disabled={offlineQueue.length === 0}
              style={{
                background: '#ffffff',
                color: '#170e5e',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '8px 14px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: offlineQueue.length === 0 ? 'not-allowed' : 'pointer',
                opacity: offlineQueue.length === 0 ? 0.6 : 1,
              }}
            >
              تنزيل ملف طوارئ (JSON)
            </button>
            <button
              type="button"
              onClick={handleCopyJson}
              disabled={offlineQueue.length === 0}
              style={{
                background: '#ffffff',
                color: '#334155',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '8px 14px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: offlineQueue.length === 0 ? 'not-allowed' : 'pointer',
                opacity: offlineQueue.length === 0 ? 0.6 : 1,
              }}
            >
              {t('pos.pos_workspace.pos_offline_queue_modal.s5', "نسخ البيانات (JSON)")}
            </button>
          </div>
        </div>

        {copyStatus && (
          <div style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', fontWeight: 600 }}>
            {copyStatus}
          </div>
        )}

        {/* List of offline sales */}
        {offlineQueue.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 16px', color: '#94a3b8' }}>
            <div style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              background: '#ecfdf5',
              border: '1px solid #a7f3d0',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 12px',
              color: '#059669',
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#334155' }}>{t('pos.pos_workspace.pos_offline_queue_modal.s6', "لا توجد فواتير معلقة حالياً")}</div>
            <div style={{ fontSize: '13px' }}>{t('pos.pos_workspace.pos_offline_queue_modal.s7', "جميع فواتير الكاشير رُحّلت واعتمدت على الخادم بنجاح.")}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '50vh', overflowY: 'auto' }}>
            {offlineQueue.map((item, idx) => {
              const isExpanded = expandedSaleId === item.id;
              const dateFormatted = new Date(item.savedAt).toLocaleString('ar-EG', {
                dateStyle: 'short',
                timeStyle: 'medium',
              });
              const itemsCount = item.payload.cart?.length || 0;
              const total = Number(item.payload.expectedTotal || 0);

              let statusBg = '#fef3c7';
              let statusColor = '#92400e';
              let statusLabel = t('pos.pos_workspace.pos_offline_queue_modal.s8', "في انتظار المزامنة");

              if (item.status === 'committed') {
                statusBg = '#dcfce7';
                statusColor = '#166534';
                statusLabel = 'مرحّلة على الخادم — جارٍ تنظيف الطابور';
              } else if (item.status === 'syncing') {
                statusBg = '#dbeafe';
                statusColor = '#1e40af';
                statusLabel = t('pos.pos_workspace.pos_offline_queue_modal.s9', "جاري الترحيل...");
              } else if (item.status === 'auth_required') {
                statusBg = '#fef3c7';
                statusColor = '#b45309';
                statusLabel = 'بانتظار تسجيل الدخول لاستكمال الترحيل';
              } else if (item.status === 'failed') {
                statusBg = '#fee2e2';
                statusColor = '#991b1b';
                statusLabel = t('pos.pos_workspace.pos_offline_queue_modal.s10', "تحتاج مراجعة قبل إعادة المحاولة");
              }

              return (
                <div
                  key={item.id}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    background: '#ffffff',
                    padding: '12px 16px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onClick={() => setExpandedSaleId(isExpanded ? null : item.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 800, color: '#170e5e', fontFamily: 'monospace', background: '#e0e7ff', padding: '2px 8px', borderRadius: '6px' }}>
                        {(item.payload as any).docNo || (item.payload as any).offlineDocNo || `#${idx + 1}`}
                      </span>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
                          {t('pos.pos_workspace.pos_offline_queue_modal.s11', "فاتورة")} {formatCurrency(total)} ({itemsCount} {t('pos.pos_workspace.pos_offline_queue_modal.s12', "أصناف)")}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>{dateFormatted}</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{
                        background: statusBg,
                        color: statusColor,
                        padding: '3px 10px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: 700,
                      }}>
                        {statusLabel}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => void handleRemoveSingle(item.id, e)}
                        title={t('pos.pos_workspace.pos_offline_queue_modal.s13', "حذف من الطابور المحلي")}
                        style={{
                          background: '#fef2f2',
                          border: '1px solid #fee2e2',
                          color: '#dc2626',
                          cursor: 'pointer',
                          padding: '2px 8px',
                          fontSize: '11px',
                          fontWeight: 700,
                          borderRadius: '6px',
                        }}
                      >
                        {t('pos.pos_workspace.pos_offline_queue_modal.s14', "حذف")}
                      </button>
                    </div>
                  </div>

                  {item.error && (
                    <div style={{
                      marginTop: '8px',
                      padding: '6px 10px',
                      background: '#fef2f2',
                      color: '#b91c1c',
                      borderRadius: '6px',
                      fontSize: '11px',
                      borderRight: '3px solid #ef4444',
                    }}>
                      {t('pos.pos_workspace.pos_offline_queue_modal.s15', "سبب تعثر الترحيل:")} {item.error}
                    </div>
                  )}

                  {/* Expanded Items */}
                  {isExpanded && (
                    <div style={{ marginTop: '12px', borderTop: '1px solid #f1f5f9', paddingTop: '10px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>{t('pos.pos_workspace.pos_offline_queue_modal.s16', "الأصناف في الفاتورة:")}</div>
                      <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: '#f8fafc', textAlign: 'right', color: '#64748b' }}>
                            <th style={{ padding: '6px 8px' }}>{t('pos.pos_workspace.pos_offline_queue_modal.s17', "الصنف")}</th>
                            <th style={{ padding: '6px 8px' }}>{t('pos.pos_workspace.pos_offline_queue_modal.s18', "الكمية")}</th>
                            <th style={{ padding: '6px 8px' }}>{t('pos.pos_workspace.pos_offline_queue_modal.s19', "السعر")}</th>
                            <th style={{ padding: '6px 8px' }}>{t('pos.pos_workspace.pos_offline_queue_modal.s20', "الإجمالي")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {item.payload.cart?.map((cartItem, cIdx) => (
                            <tr key={cIdx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '6px 8px', fontWeight: 600 }}>{cartItem.name || `صنف #${cartItem.productId}`}</td>
                              <td style={{ padding: '6px 8px' }}>{cartItem.qty} {cartItem.unitName || ''}</td>
                              <td style={{ padding: '6px 8px' }}>{formatCurrency(cartItem.price)}</td>
                              <td style={{ padding: '6px 8px', fontWeight: 700 }}>{formatCurrency(cartItem.qty * cartItem.price)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Modal Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', borderTop: '1px solid #e2e8f0', paddingTop: '14px' }}>
          {offlineQueue.length > 0 ? (
            <span className="muted small">الحذف الجماعي محظور لحماية الفواتير المالية المعلقة. يمكن نسخ السجل للمراجعة.</span>
          ) : <div />}

          <button
            type="button"
            onClick={onClose}
            style={{
              background: '#f1f5f9',
              color: '#334155',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              padding: '8px 20px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {t('pos.pos_workspace.pos_offline_queue_modal.s22', "إغلاق")}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}
