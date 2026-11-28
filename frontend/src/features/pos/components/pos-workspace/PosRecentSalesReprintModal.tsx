import { useTranslation } from 'react-i18next';
import { CheckIcon, FileTextIcon, PrinterIcon, RefreshCwIcon, XIcon } from '@/shared/components/icons/AppIcons';
import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/shared/ui/button';
import { DialogShell } from '@/shared/components/dialog-shell';
import { formatCurrency } from '@/lib/format';
import { formatDateTime, formatSalePaymentText } from '@/lib/pos-printing/shared';
import { printPostedSaleReceipt } from '@/lib/pos-printing';
import { posApi } from '@/features/pos/api/pos.api';
import { salesApi } from '@/shared/api/sales.api';
import { getArchivedRecentPosSales } from '@/features/pos/lib/pos-offline-vault';
import { isFastOfflineMode } from '@/lib/network-circuit-breaker';
import type { AppSettings, Sale } from '@/types/domain';

interface PosRecentSalesReprintModalProps {
  isOpen: boolean;
  onClose: () => void;
  lastSale: Sale | null;
  settings?: Partial<AppSettings> | null;
  cashierName?: string;
  onReprintLastSale: () => void;
}

export function PosRecentSalesReprintModal({
  isOpen,
  onClose,
  lastSale,
  settings,
  cashierName = '—',
  onReprintLastSale,
}: PosRecentSalesReprintModalProps) {
  const { t } = useTranslation();
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRecentSales = useCallback(async () => {
    try {
      setLoading(true);
      const localArchived = await getArchivedRecentPosSales(10);
      if (isFastOfflineMode()) {
        setRecentSales(localArchived.slice(0, 5));
        return;
      }
      try {
        const res = await salesApi.listPage({ pageSize: 5 });
        const serverRows = Array.isArray(res?.rows) ? res.rows : [];
        if (localArchived.length === 0) {
          setRecentSales(serverRows);
        } else {
          const seenKeys = new Set(serverRows.map((r) => String(r.docNo || r.id || '').trim()));
          const unsyncedLocal = localArchived.filter(
            (r) => !seenKeys.has(String(r.docNo || r.id || '').trim()),
          );
          setRecentSales([...unsyncedLocal, ...serverRows].slice(0, 8));
        }
      } catch {
        setRecentSales(localArchived.slice(0, 8));
      }
    } catch {
      // silent fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void fetchRecentSales();
    }
  }, [isOpen, fetchRecentSales]);

  function handlePrintSale(saleToPrint: Sale, pageSize: 'receipt' | 'a4' = 'receipt') {
    const numericId = Number(saleToPrint.id || 0);
    const saleMeta = saleToPrint as Sale & { reprintCount?: number; reprint_count?: number };
    const nextFallbackCount = Number(saleMeta.reprintCount || saleMeta.reprint_count || 0) + 1;
    const executePrint = (reprintCount: number) => {
      try {
        printPostedSaleReceipt(saleToPrint, {
          pageSize,
          settings: settings || null,
          cashierName,
          isReprint: true,
          reprintCount,
        });
        setFeedbackMessage(`تم إرسال الفاتورة #${saleToPrint.docNo || saleToPrint.id} للطباعة (نسخة مكررة #${reprintCount})`);
        setTimeout(() => setFeedbackMessage(''), 3500);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'خطأ غير متوقع';
        setFeedbackMessage(`تعذرت الطباعة: ${msg}`);
      }
    };
    if (numericId > 0 && !isFastOfflineMode()) {
      void posApi
        .recordReceiptReprint(numericId)
        .then((res) => {
          const count = Number(res?.reprintCount || nextFallbackCount);
          saleMeta.reprintCount = count;
          executePrint(count);
        })
        .catch(() => executePrint(nextFallbackCount));
    } else {
      executePrint(nextFallbackCount);
    }
  }

  function handleReprintLast() {
    if (lastSale) {
      handlePrintSale(lastSale, settings?.paperSize === 'a4' ? 'a4' : 'receipt');
    } else {
      onReprintLastSale();
    }
  }

  // Keyboard shortcut listener for F9 and Escape inside the modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F9') {
        event.preventDefault();
        event.stopPropagation();
        handleReprintLast();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, lastSale, settings]);

  if (!isOpen) return null;

  return (
    <DialogShell
      open={isOpen}
      onClose={onClose}
      width="min(860px, calc(100vw - 32px))"
      zIndex={90}
      ariaLabel={t('pos.pos_workspace.pos_recent_sales_reprint_modal.s0', "إعادة طباعة الفواتير والريسيت")}
      shellClassName="pos-recent-reprint-dialog-shell"
    >
      <div
        dir="rtl"
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'calc(100vh - 48px)',
        }}
      >
        {/* 1. Modal Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 22px',
          borderBottom: '1px solid #f1f5f9',
          background: '#ffffff',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              background: '#eff6ff',
              border: '1px solid #dbeafe',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#170e5e',
              flexShrink: 0,
            }}>
              <PrinterIcon size={20} color="#170e5e" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#0f172a' }}>
                {t('pos.pos_workspace.pos_recent_sales_reprint_modal.s1', "إعادة طباعة الفواتير والريسيت")}
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                {t('pos.pos_workspace.pos_recent_sales_reprint_modal.s2', "اضغط")} <kbd style={{ padding: '2px 6px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '11px', fontWeight: 700, color: '#0f172a' }}>F9</kbd> {t('pos.pos_workspace.pos_recent_sales_reprint_modal.s3', "لطباعة آخر فاتورة مباشرة، أو اختر من آخر 5 فواتير")}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            title={t('pos.pos_workspace.pos_recent_sales_reprint_modal.s4', "إغلاق النافذة (Esc)")}
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#64748b',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f1f5f9';
              e.currentTarget.style.color = '#0f172a';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#f8fafc';
              e.currentTarget.style.color = '#64748b';
            }}
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Feedback Alert */}
        {feedbackMessage && (
          <div style={{
            margin: '12px 22px 0',
            padding: '10px 16px',
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '8px',
            color: '#166534',
            fontSize: '13px',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <CheckIcon size={16} color="#16a34a" />
            <span>{feedbackMessage}</span>
          </div>
        )}

        {/* 2. Scrollable Body Content */}
        <div style={{
          padding: '18px 22px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}>
          {/* Action 1: Top Hero Highlight Card for Fast Last Sale Reprint (F9) */}
          <div style={{
            background: '#f8fafc',
            border: '1.5px solid #cbd5e1',
            borderRadius: '12px',
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '16px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  background: '#170e5e',
                  color: '#ffffff',
                  fontSize: '11px',
                  fontWeight: 800,
                  padding: '3px 8px',
                  borderRadius: '6px',
                  letterSpacing: '0.3px',
                }}>
                  {t('pos.pos_workspace.pos_recent_sales_reprint_modal.s5', "اختصار سريع F9")}
                </span>
                <span style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                  {t('pos.pos_workspace.pos_recent_sales_reprint_modal.s6', "طباعة آخر فاتورة تم إتمامها")}
                </span>
              </div>

              {lastSale ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', fontSize: '13px', color: '#475569' }}>
                  <span>{t('pos.pos_workspace.pos_recent_sales_reprint_modal.s7', "رقم:")} <strong style={{ fontFamily: 'monospace', color: '#0f172a', background: '#e2e8f0', padding: '1px 6px', borderRadius: '4px' }}>#{lastSale.docNo || lastSale.id}</strong></span>
                  <span style={{ color: '#cbd5e1' }}>•</span>
                  <span>{t('pos.pos_workspace.pos_recent_sales_reprint_modal.s8', "العميل:")} <strong style={{ color: '#0f172a' }}>{lastSale.customerName || t('pos.pos_workspace.pos_recent_sales_reprint_modal.s9', "عميل نقدي")}</strong></span>
                  <span style={{ color: '#cbd5e1' }}>•</span>
                  <span>{t('pos.pos_workspace.pos_recent_sales_reprint_modal.s10', "الإجمالي:")} <strong style={{ color: '#170e5e', fontSize: '14px', fontWeight: 900 }}>{formatCurrency(Number(lastSale.total || 0))}</strong></span>
                  <span style={{ color: '#cbd5e1' }}>•</span>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '9999px',
                    background: lastSale.paymentType === 'credit' ? '#fef2f2' : '#f0fdf4',
                    color: lastSale.paymentType === 'credit' ? '#dc2626' : '#16a34a',
                    border: `1px solid ${lastSale.paymentType === 'credit' ? '#fecaca' : '#bbf7d0'}`,
                  }}>
                    {formatSalePaymentText(lastSale.paymentType, lastSale.paymentChannel, lastSale.paidAmount, lastSale.total, lastSale.orderType)}
                  </span>
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
                  {t('pos.pos_workspace.pos_recent_sales_reprint_modal.s11', "لا توجد فاتورة مبيعات مسجلة في الجلسة الحالية حتى الآن")}
                </p>
              )}
            </div>

            <button
              type="button"
              disabled={!lastSale}
              onClick={handleReprintLast}
              style={{
                background: lastSale ? '#170e5e' : '#94a3b8',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 20px',
                fontSize: '13px',
                fontWeight: 800,
                cursor: lastSale ? 'pointer' : 'not-allowed',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: lastSale ? '0 2px 8px rgba(23, 14, 94, 0.25)' : 'none',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => { if (lastSale) e.currentTarget.style.background = '#110a47'; }}
              onMouseLeave={(e) => { if (lastSale) e.currentTarget.style.background = '#170e5e'; }}
            >
              <PrinterIcon size={16} color="#ffffff" />
              <span>{t('pos.pos_workspace.pos_recent_sales_reprint_modal.s12', "طباعة آخر فاتورة (F9)")}</span>
            </button>
          </div>

          {/* Action 2: Recent 5 Sales List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#334155', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileTextIcon size={16} color="#475569" />
                <span>{t('pos.pos_workspace.pos_recent_sales_reprint_modal.s13', "آخر 5 فواتير مبيعات (لإعادة طباعة ريسيت العميل عند طلبه):")}</span>
              </h4>

              <button
                type="button"
                disabled={loading}
                onClick={() => void fetchRecentSales()}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#2563eb',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <RefreshCwIcon size={13} color="#2563eb" />
                <span>{loading ? t('pos.pos_workspace.pos_recent_sales_reprint_modal.s14', "جاري التحديث...") : t('pos.pos_workspace.pos_recent_sales_reprint_modal.s15', "تحديث القائمة")}</span>
              </button>
            </div>

            <div style={{
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              background: '#ffffff',
              overflow: 'hidden',
            }}>
              {loading && recentSales.length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                  {t('pos.pos_workspace.pos_recent_sales_reprint_modal.s16', "جاري تحميل آخر الفواتير...")}
                </div>
              ) : recentSales.length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                  {t('pos.pos_workspace.pos_recent_sales_reprint_modal.s17', "لا توجد فواتير مبيعات سابقة مسجلة.")}
                </div>
              ) : (
                recentSales.map((saleItem, index) => {
                  const isTopLast = lastSale && (saleItem.id === lastSale.id || saleItem.docNo === lastSale.docNo);
                  return (
                    <div
                      key={saleItem.id || saleItem.docNo || index}
                      style={{
                        background: isTopLast ? '#f0f9ff' : '#ffffff',
                        borderBottom: index < recentSales.length - 1 ? '1px solid #f1f5f9' : 'none',
                        padding: '13px 18px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '16px',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = isTopLast ? '#e0f2fe' : '#f8fafc'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = isTopLast ? '#f0f9ff' : '#ffffff'; }}
                    >
                      {/* Sale info */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{
                            fontFamily: 'monospace',
                            fontWeight: 800,
                            fontSize: '13px',
                            color: '#0f172a',
                            background: '#f1f5f9',
                            border: '1px solid #e2e8f0',
                            padding: '2px 8px',
                            borderRadius: '6px',
                          }}>
                            #{saleItem.docNo || saleItem.id}
                          </span>

                          <span style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '9999px',
                            background: saleItem.paymentType === 'credit' ? '#fef2f2' : '#f0fdf4',
                            color: saleItem.paymentType === 'credit' ? '#dc2626' : '#16a34a',
                            border: `1px solid ${saleItem.paymentType === 'credit' ? '#fecaca' : '#bbf7d0'}`,
                          }}>
                            {formatSalePaymentText(saleItem.paymentType, saleItem.paymentChannel, saleItem.paidAmount, saleItem.total, saleItem.orderType)}
                          </span>

                          {saleItem.orderType === 'delivery' && (
                            <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '9999px', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>
                              {t('pos.pos_workspace.pos_recent_sales_reprint_modal.s18', "دليفري")}
                            </span>
                          )}

                          {isTopLast && (
                            <span style={{ fontSize: '11px', fontWeight: 800, padding: '2px 8px', borderRadius: '9999px', background: '#dbeafe', color: '#1e40af', border: '1px solid #bfdbfe' }}>
                              {t('pos.pos_workspace.pos_recent_sales_reprint_modal.s19', "آخر فاتورة")}
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: '10px', fontSize: '12px', color: '#64748b', marginTop: '2px', flexWrap: 'wrap' }}>
                          <span>{t('pos.pos_workspace.pos_recent_sales_reprint_modal.s20', "العميل:")} <strong style={{ color: '#334155' }}>{saleItem.customerName || t('pos.pos_workspace.pos_recent_sales_reprint_modal.s21', "عميل نقدي")}</strong></span>
                          <span style={{ color: '#cbd5e1' }}>•</span>
                          <span>{t('pos.pos_workspace.pos_recent_sales_reprint_modal.s22', "الوقت:")} <b>{formatDateTime(saleItem.date || saleItem.createdAt)}</b></span>
                          {saleItem.items && (
                            <>
                              <span style={{ color: '#cbd5e1' }}>•</span>
                              <span>{t('pos.pos_workspace.pos_recent_sales_reprint_modal.s23', "الأصناف:")} <b>{saleItem.items.length} {t('pos.pos_workspace.pos_recent_sales_reprint_modal.s24', "صنف")}</b></span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Total and Print actions */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
                        <div style={{ textAlign: 'left', minWidth: '90px' }}>
                          <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>{t('pos.pos_workspace.pos_recent_sales_reprint_modal.s25', "السعر النهائي")}</span>
                          <strong style={{ fontSize: '16px', color: '#0f172a', fontWeight: 900 }}>
                            {formatCurrency(Number(saleItem.total || 0))}
                          </strong>
                        </div>

                        {/* Segmented button group for Receipt and A4 */}
                        <div style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          borderRadius: '8px',
                          border: '1px solid #cbd5e1',
                          overflow: 'hidden',
                          background: '#ffffff',
                          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                        }}>
                          <button
                            type="button"
                            onClick={() => handlePrintSale(saleItem, 'receipt')}
                            title={t('pos.pos_workspace.pos_recent_sales_reprint_modal.s26', "طباعة إيصال حراري (ريسيت)")}
                            style={{
                              background: '#ffffff',
                              color: '#170e5e',
                              border: 'none',
                              padding: '7px 12px',
                              fontSize: '12px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              transition: 'all 0.15s ease',
                              borderInlineEnd: '1px solid #e2e8f0',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = '#f8fafc';
                              e.currentTarget.style.color = '#110a47';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = '#ffffff';
                              e.currentTarget.style.color = '#170e5e';
                            }}
                          >
                            <PrinterIcon size={14} color="#170e5e" />
                            <span>{t('pos.pos_workspace.pos_recent_sales_reprint_modal.s27', "طباعة ريسيت")}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handlePrintSale(saleItem, 'a4')}
                            title={t('pos.pos_workspace.pos_recent_sales_reprint_modal.s28', "طباعة فاتورة A4")}
                            style={{
                              background: '#ffffff',
                              color: '#475569',
                              border: 'none',
                              padding: '7px 10px',
                              fontSize: '12px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = '#f1f5f9';
                              e.currentTarget.style.color = '#0f172a';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = '#ffffff';
                              e.currentTarget.style.color = '#475569';
                            }}
                          >
                            A4
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* 3. Modal Footer */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 22px',
          background: '#f8fafc',
          borderTop: '1px solid #e2e8f0',
          fontSize: '12px',
          color: '#64748b',
          marginTop: 'auto',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>{t('pos.pos_workspace.pos_recent_sales_reprint_modal.s29', "اختصارات لوحة المفاتيح:")}</span>
            <kbd style={{ padding: '2px 6px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '11px', fontWeight: 700, color: '#0f172a' }}>F9</kbd>
            <span>{t('pos.pos_workspace.pos_recent_sales_reprint_modal.s30', "طباعة سريعة")}</span>
            <span style={{ color: '#cbd5e1' }}>•</span>
            <kbd style={{ padding: '2px 6px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '11px', fontWeight: 700, color: '#0f172a' }}>Esc</kbd>
            <span>{t('pos.pos_workspace.pos_recent_sales_reprint_modal.s31', "إغلاق النافذة")}</span>
          </div>

          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            style={{
              minHeight: '32px',
              fontSize: '12px',
              padding: '0 16px',
            }}
          >
            {t('pos.pos_workspace.pos_recent_sales_reprint_modal.s32', "إغلاق")}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
