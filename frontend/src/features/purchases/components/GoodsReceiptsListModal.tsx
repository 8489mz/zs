import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { goodsReceiptsApi, type GoodsReceiptRecord } from '../api/goods-receipts.api';
import { toast } from '@/shared/components/system-alert';
import { formatDate } from '@/lib/format';

interface GoodsReceiptsListModalProps {
  open: boolean;
  onClose: () => void;
  supplierId?: number;
}

export const GoodsReceiptsListModal: React.FC<GoodsReceiptsListModalProps> = ({
  open,
  onClose,
  supplierId,
}) => {
  const { t } = useTranslation();
  const [receipts, setReceipts] = useState<GoodsReceiptRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedReceipt, setSelectedReceipt] = useState<GoodsReceiptRecord | null>(null);
  const [isPosting, setIsPosting] = useState<number | null>(null);

  const fetchReceipts = async () => {
    try {
      setIsLoading(true);
      const data = await goodsReceiptsApi.list({
        supplierId,
        search: search.trim() || undefined,
      });
      setReceipts(Array.isArray(data) ? data : []);
    } catch (err: any) {
      toast.error(err?.message || 'فشل جلب قائمة أذون الاستلام');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchReceipts();
      setSelectedReceipt(null);
    }
  }, [open, supplierId]);

  const handlePost = async (id: number) => {
    try {
      setIsPosting(id);
      await goodsReceiptsApi.post(id);
      toast.success('تم ترحيل إذن الاستلام وتغذية المخزون وقيد GRNI بنجاح.');
      await fetchReceipts();
      if (selectedReceipt?.id === id) {
        const updated = await goodsReceiptsApi.getById(id);
        setSelectedReceipt(updated);
      }
    } catch (err: any) {
      toast.error(err?.message || 'فشل ترحيل إذن الاستلام');
    } finally {
      setIsPosting(null);
    }
  };

  const handleViewDetails = async (id: number) => {
    try {
      const detailed = await goodsReceiptsApi.getById(id);
      setSelectedReceipt(detailed);
    } catch (err: any) {
      toast.error(err?.message || 'فشل جلب تفاصيل إذن الاستلام');
    }
  };

  if (!open) return null;

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={t('purchases.goods_receipts_list_modal.s0', "سجل أذون الاستلام المخزني (Goods Receipt Notes - GRN)")}
      subtitle={t('purchases.goods_receipts_list_modal.s1', "متابعة استلام البضائع وفحص الجودة وقيود وسيط التوريد غير المفوتر (GRNI)")}
      maxWidth="min(1140px, 96vw)"
    >
      <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
        {/* Search & Actions Bar */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            placeholder={t('purchases.goods_receipts_list_modal.s2', "ابحث برقم الإذن أو المورد أو إذن تسليم المورد...")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchReceipts()}
            style={{
              flex: 1,
              padding: '6px 10px',
              fontSize: '12.5px',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              boxSizing: 'border-box',
            }}
          />
          <Button variant="secondary" onClick={fetchReceipts}>
            {t('purchases.goods_receipts_list_modal.s3', "بحث")}
          </Button>
        </div>

        {/* Master List & Details Pane */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: selectedReceipt ? '1fr 1fr' : '1fr',
            gap: '12px',
            minHeight: '340px',
            maxHeight: '420px',
          }}
        >
          {/* List Table */}
          <div
            style={{
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              overflow: 'hidden',
              overflowY: 'auto',
            }}
            className="thin-scrollbar"
          >
            {isLoading ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>{t('purchases.goods_receipts_list_modal.s4', "جاري التحميل...")}</div>
            ) : receipts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>{t('purchases.goods_receipts_list_modal.s5', "لا توجد أذون استلام مسجلة")}</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'right' }}>
                <thead
                  style={{
                    backgroundColor: '#f8fafc',
                    borderBottom: '1px solid #cbd5e1',
                    color: '#475569',
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                  }}
                >
                  <tr>
                    <th style={{ padding: '8px 10px' }}>{t('purchases.goods_receipts_list_modal.s6', "رقم الإذن")}</th>
                    <th style={{ padding: '8px 10px' }}>{t('purchases.goods_receipts_list_modal.s7', "المورد")}</th>
                    <th style={{ padding: '8px 10px' }}>{t('purchases.goods_receipts_list_modal.s8', "أمر الشراء")}</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center' }}>{t('purchases.goods_receipts_list_modal.s9', "الحالة")}</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center' }}>{t('purchases.goods_receipts_list_modal.s10', "إجراءات")}</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((r) => (
                    <tr
                      key={r.id}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        backgroundColor: selectedReceipt?.id === r.id ? '#f0fdf4' : '#ffffff',
                        cursor: 'pointer',
                      }}
                      onClick={() => handleViewDetails(r.id)}
                    >
                      <td style={{ padding: '8px 10px', fontWeight: 700, color: '#0f172a' }}>
                        <div>{r.docNo}</div>
                        <span style={{ fontSize: '10.5px', color: '#64748b' }}>{formatDate(r.receivedAt)}</span>
                      </td>
                      <td style={{ padding: '8px 10px' }}>{r.supplierName}</td>
                      <td style={{ padding: '8px 10px', color: '#0284c7' }}>{r.poDocNo ? `#${r.poDocNo}` : '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                        <span
                          style={{
                            fontSize: '10.5px',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '10px',
                            backgroundColor: r.pendingReview ? '#fef3c7' : r.status === 'posted' ? '#dcfce7' : '#fef3c7',
                            color: r.pendingReview ? '#92400e' : r.status === 'posted' ? '#166534' : '#92400e',
                          }}
                        >
                          {r.pendingReview
                            ? t('purchases.goods_receipts_list_modal.s23', "مرحل — قيد المراجعة")
                            : r.status === 'posted' ? t('purchases.goods_receipts_list_modal.s11', "مرحل") : t('purchases.goods_receipts_list_modal.s12', "مسودة")}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                          <Button
                            variant="secondary"
                            style={{ fontSize: '11px', padding: '2px 6px' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleViewDetails(r.id);
                            }}
                          >
                            {t('purchases.goods_receipts_list_modal.s13', "عرض")}
                          </Button>
                          {r.status === 'draft' && (
                            <Button
                              variant="primary"
                              style={{ fontSize: '11px', padding: '2px 6px', background: '#059669', borderColor: '#059669' }}
                              disabled={isPosting === r.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePost(r.id);
                              }}
                            >
                              {isPosting === r.id ? '...' : t('purchases.goods_receipts_list_modal.s14', "ترحيل")}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Details Pane */}
          {selectedReceipt && (
            <div
              style={{
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '12px',
                backgroundColor: '#f8fafc',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                overflowY: 'auto',
              }}
              className="thin-scrollbar"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#170e5e' }}>
                  {t('purchases.goods_receipts_list_modal.s15', "تفاصيل الإذن")} {selectedReceipt.docNo}
                </h4>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '10px',
                    backgroundColor: selectedReceipt.pendingReview ? '#fef3c7' : selectedReceipt.status === 'posted' ? '#dcfce7' : '#fef3c7',
                    color: selectedReceipt.pendingReview ? '#92400e' : selectedReceipt.status === 'posted' ? '#166534' : '#92400e',
                  }}
                >
                  {selectedReceipt.pendingReview
                    ? t('purchases.goods_receipts_list_modal.s24', "مرحل — قيد المراجعة")
                    : selectedReceipt.status === 'posted' ? t('purchases.goods_receipts_list_modal.s16', "مرحل ومقيد محاسبياً") : t('purchases.goods_receipts_list_modal.s17', "مسودة غير مرحلة")}
                </span>
              </div>

              {selectedReceipt.pendingReview && selectedReceipt.pendingReviewReason && (
                <div style={{ fontSize: '11.5px', color: '#92400e', backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', padding: '8px 10px' }}>
                  <strong>{t('purchases.goods_receipts_list_modal.s25', "سبب المراجعة:")}</strong> {selectedReceipt.pendingReviewReason}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11.5px' }}>
                <div><strong>{t('purchases.goods_receipts_list_modal.s18', "المورد:")}</strong> {selectedReceipt.supplierName}</div>
                <div><strong>{t('purchases.goods_receipts_list_modal.s19', "تاريخ الاستلام:")}</strong> {formatDate(selectedReceipt.receivedAt)}</div>
                <div><strong>{t('purchases.goods_receipts_list_modal.s20', "إذن تسليم المورد:")}</strong> {selectedReceipt.supplierDeliveryNoteRef || '—'}</div>
                <div><strong>{t('purchases.goods_receipts_list_modal.s21', "رقم قيد GRNI:")}</strong> {selectedReceipt.grniJournalEntryId ? `#${selectedReceipt.grniJournalEntryId}` : t('purchases.goods_receipts_list_modal.s22', "لم يرحل بعد")}</div>
              </div>

              {/* Lines in Details */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px', textAlign: 'right' }}>
                  <thead style={{ backgroundColor: '#f1f5f9', color: '#475569' }}>
                    <tr>
                      <th style={{ padding: '6px 8px' }}>{t('purchases.goods_receipts_list_modal.s23', "الصنف")}</th>
                      <th style={{ padding: '6px 8px', textAlign: 'center' }}>{t('purchases.goods_receipts_list_modal.s24', "المستلم")}</th>
                      <th style={{ padding: '6px 8px', textAlign: 'center', color: '#166534' }}>{t('purchases.goods_receipts_list_modal.s25', "المقبول")}</th>
                      <th style={{ padding: '6px 8px', textAlign: 'center', color: '#b91c1c' }}>{t('purchases.goods_receipts_list_modal.s26', "المرفوض")}</th>
                      <th style={{ padding: '6px 8px' }}>{t('purchases.goods_receipts_list_modal.s27', "التشغيلة")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedReceipt.lines || []).map((line, idx) => (
                      <tr key={line.id || idx} style={{ borderBottom: '1px solid #f1f5f9', backgroundColor: '#ffffff' }}>
                        <td style={{ padding: '6px 8px', fontWeight: 600 }}>{line.productName || `الصنف #${line.productId}`}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'center' }}>{line.receivedQty}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 700, color: '#166534' }}>{line.acceptedQty}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'center', color: line.rejectedQty ? '#b91c1c' : '#64748b' }}>
                          {line.rejectedQty || 0}
                          {line.rejectionReason && <div style={{ fontSize: '10px', color: '#dc2626' }}>{line.rejectionReason}</div>}
                        </td>
                        <td style={{ padding: '6px 8px', fontSize: '10.5px' }}>{line.batchNumber || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </StandardDialog>
  );
};
