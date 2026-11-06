import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { lazy, Suspense, useMemo, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Product, Purchase } from '@/types/domain';
import { FormSection } from '@/shared/components/form-section';
import { Button } from '@/shared/ui/button';
import { AppIcons, FileTextIcon } from '@/shared/components/icons/AppIcons';
import { formatCurrency, formatDate } from '@/lib/format';
import { SINGLE_STORE_MODE } from '@/config/product-scope';
import { PurchasePaymentScheduleCard } from '@/features/purchases/components/PurchasePaymentScheduleCard';
import { resolveRequestUrl } from '@/lib/http';
import { sharedProductsApi } from '@/shared/api/products';
import { queryKeys } from '@/app/query-keys';
import type { BarcodePrintItem } from '@/lib/barcode-labels';
import { PurchaseLandedCostsModal } from './PurchaseLandedCostsModal';
import { GoodsReceiptModal } from './GoodsReceiptModal';
import { ThreeWayMatchModal } from './ThreeWayMatchModal';

const LazyBarcodePrintDialog = lazy(() =>
  import('@/features/products/components/BarcodePrintDialog').then((module) => ({
    default: module.BarcodePrintDialog,
  }))
);

interface PurchaseDetailCardProps {
  purchase?: Purchase;
  isLoading?: boolean;
  onEdit?: () => void;
  onCancel?: () => void;
  onPrint?: () => void;
  onRefresh?: () => void;
}

export function PurchaseDetailCard({ purchase, isLoading = false, onEdit, onCancel, onPrint, onRefresh }: PurchaseDetailCardProps) {
  const { t } = useTranslation();
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [showThreeWayMatchModal, setShowThreeWayMatchModal] = useState(false);
  const [showLandedCostsModal, setShowLandedCostsModal] = useState(false);
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);

  const productsQuery = useQuery({
    queryKey: queryKeys.products,
    queryFn: sharedProductsApi.list,
    enabled: showBarcodeModal,
    staleTime: 60_000,
  });

  const barcodeItems: BarcodePrintItem[] = useMemo(() => {
    if (!purchase?.items) return [];
    const catalogProducts = productsQuery.data || [];
    return purchase.items.map((item) => {
      const p = catalogProducts.find((prod) => String(prod.id) === String(item.productId));
      const product: Product = p || ({
        id: item.productId,
        name: item.name,
        barcode: '',
        retailPrice: item.cost,
        stock: item.qty,
        units: item.unitName ? [{ id: 'u1', name: item.unitName, multiplier: item.unitMultiplier || 1, isBaseUnit: true }] : [],
      } as unknown as Product);

      const unit = p?.units?.find((u) => u.name === item.unitName) || product.units?.[0] || null;
      const copies = Math.max(1, Number(item.receivedQty || item.qty || 1));
      return { product, unit, copies };
    });
  }, [purchase?.items, productsQuery.data]);

  if (isLoading) return <FormSection title={t('purchases.purchase_detail_card.s0', "تفاصيل الفاتورة")} className="purchase-detail-card"><div className="muted">{t('purchases.purchase_detail_card.s1', "جاري تحميل تفاصيل الفاتورة...")}</div></FormSection>;
  if (!purchase) return <FormSection title={t('purchases.purchase_detail_card.s2', "تفاصيل الفاتورة")} className="purchase-detail-card"><div className="muted">{t('purchases.purchase_detail_card.s3', "اختر فاتورة من الجدول لعرض التفاصيل.")}</div></FormSection>;

  const isMatched = purchase.matchedStatus === 'matched' || (!purchase.matchedStatus && purchase.status === 'posted');
  const isCancelled = purchase.status === 'cancelled';
  const isGrn = purchase.lifecycleStatus === 'grn_received';

  // The global button rule forces `white-space: nowrap`; in this fixed
  // 3-column bar that lets long labels overflow their cell and overlap
  // neighbours at narrow widths. Each control opts back into wrapping
  // inside its own cell (local override; the global rule is untouched).
  const actionControlWrap: CSSProperties = {
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    textAlign: 'center',
    lineHeight: 1.35,
  };


  return (
    <div className="purchase-detail-card-shell" dir="rtl">
      {/* 1. Header with Title and Status */}
      <div className="invoice-detail-header" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '10px',
        marginBottom: '12px',
        paddingBottom: '10px',
        borderBottom: '1px solid #e2e8f0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '4px', height: '18px', background: '#0284c7', borderRadius: '2px' }} />
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
              {`تفاصيل ${purchase.docNo || purchase.id}`}
            </h3>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <span className={`status-badge ${isCancelled ? 'status-cancelled' : 'status-posted'}`} style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '3px 8px',
            borderRadius: '6px',
            fontSize: '11.5px',
            fontWeight: 700,
            background: isCancelled ? '#fee2e2' : '#dcfce7',
            color: isCancelled ? '#991b1b' : '#166534',
          }}>
            {purchase.status === 'posted' ? t('purchases.purchase_detail_card.s4', "مرحلة") : isCancelled ? t('purchases.purchase_detail_card.s5', "ملغاة") : t('purchases.purchase_detail_card.s6', "مسودة")}
          </span>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '3px 8px',
            borderRadius: '6px',
            fontSize: '11.5px',
            fontWeight: 700,
            background: isMatched ? '#dcfce7' : isGrn ? '#e0f2fe' : '#fef3c7',
            color: isMatched ? '#166534' : isGrn ? '#0369a1' : '#92400e',
          }}>
            {isMatched ? t('purchases.purchase_detail_card.s7', "مطابقة ثلاثية كاملة") : isGrn ? t('purchases.purchase_detail_card.s8', "استلام جزئي (GRN)") : t('purchases.purchase_detail_card.s9', "أمر شراء (PO) معلق")}
          </span>
        </div>
      </div>

      {/* 3-Way Matching Workflow Stepper */}
      <div style={{
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: '10px',
        padding: '12px 16px',
        marginBottom: '14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            background: '#0284c7',
            color: '#fff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px',
            fontWeight: 700,
          }}>1</span>
          <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#0f172a' }}>{t('purchases.purchase_detail_card.s10', "أمر الشراء (PO)")}</span>
        </div>
        <div style={{ width: '30px', height: '2px', background: '#cbd5e1' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            background: isGrn || isMatched ? '#0284c7' : '#cbd5e1',
            color: '#fff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px',
            fontWeight: 700,
          }}>2</span>
          <span style={{ fontSize: '12.5px', fontWeight: 700, color: isGrn || isMatched ? '#0f172a' : '#64748b' }}>{t('purchases.purchase_detail_card.s11', "الاستلام المخزني (GRN)")}</span>
        </div>
        <div style={{ width: '30px', height: '2px', background: '#cbd5e1' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            background: isMatched ? '#16a34a' : '#cbd5e1',
            color: '#fff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px',
            fontWeight: 700,
          }}>3</span>
          <span style={{ fontSize: '12.5px', fontWeight: 700, color: isMatched ? '#166534' : '#64748b' }}>{t('purchases.purchase_detail_card.s12', "المطابقة المحاسبية والترحيل")}</span>
        </div>
      </div>

      {/* 2. Action Buttons Toolbar */}
      {!isCancelled && (
        <div className="invoice-detail-actions-bar" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: '8px',
          marginBottom: '14px',
        }}>
          <Button
            variant="primary"
            style={{ ...actionControlWrap, fontSize: '12.5px', padding: '7px 8px', justifyContent: 'center', background: '#0284c7', borderColor: '#0284c7' }}
            onClick={() => setShowThreeWayMatchModal(true)}
          >
            {t('purchases.purchase_detail_card.s13', "فحص واعتماد المطابقة (3-Way Match)")}
          </Button>
          {!isMatched && (
            <Button
              variant="primary"
              style={{ ...actionControlWrap, fontSize: '12.5px', padding: '7px 8px', justifyContent: 'center', background: '#059669', borderColor: '#059669' }}
              onClick={() => setShowReceiveModal(true)}
            >
              {t('purchases.purchase_detail_card.s14', "استلام بضاعة (GRN)")}
            </Button>
          )}
          <Button
            variant="secondary"
            style={{ ...actionControlWrap, fontSize: '12.5px', padding: '7px 8px', justifyContent: 'center', borderColor: '#170e5e', color: '#170e5e', fontWeight: 800 }}
            onClick={() => setShowLandedCostsModal(true)}
          >
            {t('purchases.purchase_detail_card.s15', "تكلفة الوصول (Landed Costs)")}
          </Button>
          <Link
            className="button button-secondary"
            to={`/accounts?supplierId=${encodeURIComponent(purchase.supplierId)}`}
            style={{ ...actionControlWrap, fontSize: '12.5px', padding: '7px 8px', justifyContent: 'center', borderColor: '#170e5e', color: '#170e5e', fontWeight: 800, display: 'inline-flex', alignItems: 'center' }}
          >
            {t('purchases.purchase_detail_card.pay_supplier_link', "دفع لمورد")}
          </Link>
          <Button
            variant="secondary"
            style={{ ...actionControlWrap, fontSize: '12.5px', padding: '7px 8px', justifyContent: 'center', borderColor: '#170e5e', color: '#170e5e', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            onClick={() => setShowBarcodeModal(true)}
            title={t('purchases.purchase_detail_card.s16', "طباعة ملصقات الباركود واستيكرات الرفوف لبنود هذه الفاتورة بالكميات المستلمة أو المطلوبة")}
          >
            <AppIcons.Printer size={15} />
            <span>{t('purchases.purchase_detail_card.s17', "طباعة باركود البنود (")}{(purchase.items || []).length})</span>
          </Button>
          {onPrint ? <Button variant="secondary" style={{ ...actionControlWrap, fontSize: '12.5px', padding: '7px 8px', justifyContent: 'center' }} onClick={onPrint}>{t('purchases.purchase_detail_card.s18', "طباعة الفاتورة")}</Button> : null}
          {onEdit ? <Button variant="secondary" style={{ ...actionControlWrap, fontSize: '12.5px', padding: '7px 8px', justifyContent: 'center' }} onClick={onEdit}>{t('purchases.purchase_detail_card.s19', "تعديل الفاتورة")}</Button> : null}
          {onCancel ? <Button variant="danger" style={{ ...actionControlWrap, fontSize: '12.5px', padding: '7px 8px', justifyContent: 'center' }} onClick={onCancel}>{t('purchases.purchase_detail_card.s20', "إلغاء الفاتورة")}</Button> : null}
        </div>
      )}

      {/* 3. Stats Grid */}
      <div className="stats-grid compact-grid invoice-detail-summary-grid">
        <div className="stat-card"><span>{t('purchases.purchase_detail_card.s21', "المورد")}</span><strong>{purchase.supplierName || '—'}</strong></div>
        <div className="stat-card"><span>{t('purchases.purchase_detail_card.s22', "المطابقة")}</span><strong className="status-chip">{isMatched ? t('purchases.purchase_detail_card.s23', "مطابق تماماً") : isGrn ? t('purchases.purchase_detail_card.s24', "استلام جزئي") : t('purchases.purchase_detail_card.s25', "بانتظار الاستلام")}</strong></div>
        <div className="stat-card"><span>{t('purchases.purchase_detail_card.s26', "الإجمالي")}</span><strong style={{ color: 'var(--primary, #0f172a)' }}>{formatCurrency(purchase.total)}</strong></div>
        <div className="stat-card"><span>{t('purchases.purchase_detail_card.s27', "نوع الدفع")}</span><strong>{purchase.paymentType === 'credit' ? t('purchases.purchase_detail_card.s28', "آجل") : t('purchases.purchase_detail_card.s29', "نقدي")}</strong></div>
        <div className="stat-card"><span>{t('purchases.purchase_detail_card.s30', "التاريخ")}</span><strong style={{ fontSize: '11.5px' }}><bdi dir="ltr">{formatDate(purchase.date)}</bdi></strong></div>
        <div className="stat-card"><span>{SINGLE_STORE_MODE ? t('purchases.purchase_detail_card.s31', "المخزن") : t('purchases.purchase_detail_card.s32', "الفرع/الموقع")}</span><strong>{SINGLE_STORE_MODE ? (purchase.locationName || t('purchases.purchase_detail_card.s33', "المخزن الأساسي")) : `${purchase.branchName || '—'} / ${purchase.locationName || '—'}`}</strong></div>
      </div>

      <div className="table-wrap invoice-desktop-table" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>{t('purchases.purchase_detail_card.s34', "الصنف")}</th>
              <th>{t('purchases.purchase_detail_card.s35', "الوحدة")}</th>
              <th>{t('purchases.purchase_detail_card.s36', "المطلوب (PO)")}</th>
              <th>{t('purchases.purchase_detail_card.s37', "المستلم (GRN)")}</th>
              <th>{t('purchases.purchase_detail_card.s38', "المتبقي")}</th>
              <th>{t('purchases.purchase_detail_card.s39', "التكلفة")}</th>
              <th>{t('purchases.purchase_detail_card.s40', "الإجمالي")}</th>
            </tr>
          </thead>
          <tbody>
            {(purchase.items || []).map((item) => {
              const ordered = Number(item.qty || 0);
              const received = Number(item.receivedQty || 0);
              const remaining = Math.max(0, ordered - received);
              return (
                <tr key={item.id || `${item.productId}-${item.unitName}`}>
                  <td>{item.name}</td>
                  <td>{item.unitName === 'Piece' || item.unitName === 'piece' ? t('purchases.purchase_detail_card.s41', "قطعة") : item.unitName || '—'}</td>
                  <td><strong>{ordered}</strong></td>
                  <td style={{ color: received >= ordered ? '#166534' : '#b45309', fontWeight: 700 }}>
                    {received}
                  </td>
                  <td style={{ color: remaining > 0 ? '#dc2626' : '#64748b' }}>
                    {remaining}
                  </td>
                  <td>{formatCurrency(item.cost)}</td>
                  <td>{formatCurrency(item.total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Responsive Smart Item Cards for Purchases */}
      <div className="invoice-mobile-items-list" style={{ marginTop: 12 }}>
        <h5 className="invoice-mobile-items-title">{t('purchases.purchase_detail_card.s42', "بنود الفاتورة (")}{(purchase.items || []).length})</h5>
        <div className="invoice-mobile-items-grid">
          {(purchase.items || []).map((item, idx) => {
            const ordered = Number(item.qty || 0);
            const received = Number(item.receivedQty || 0);
            return (
              <div key={item.id || `${item.productId}-${idx}`} className="invoice-mobile-item-card">
                <div className="mobile-item-card-top">
                  <strong className="mobile-item-name">{item.name}</strong>
                  <span className="mobile-item-total">{formatCurrency(item.total)}</span>
                </div>
                <div className="mobile-item-card-bottom">
                  <span className="mobile-item-unit">{item.unitName || t('purchases.purchase_detail_card.s43', "قطعة")}</span>
                  <span className="mobile-item-calc">
                    {t('purchases.purchase_detail_card.s44', "مطلوب:")} {ordered} {t('purchases.purchase_detail_card.s45', "| مستلم:")} {received}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {purchase.attachments && purchase.attachments.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <FormSection title={t('purchases.purchase_detail_card.s46', "المرفقات")} className="purchase-detail-card">
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {purchase.attachments.map((att: any, idx: number) => {
              const url = resolveRequestUrl(att.fileUrl);
              return (
                <a key={att.id || idx} href={url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: '6px', textDecoration: 'none', color: 'inherit', background: 'var(--surface-color)' }}>
                  <FileTextIcon size={18} color="#64748b" />
                  <span style={{ fontSize: '0.9em' }}>{att.fileName || `مرفق ${idx + 1}`}</span>
                </a>
              );
            })}
          </div>
          </FormSection>
        </div>
      )}

      <PurchasePaymentScheduleCard purchase={purchase} />

      {showReceiveModal && (
        <GoodsReceiptModal
          open={showReceiveModal}
          onClose={() => setShowReceiveModal(false)}
          purchaseOrderId={purchase.purchaseOrderId ? Number(purchase.purchaseOrderId) : null}
          poDocNo={purchase.poDocNo || purchase.docNo}
          supplierId={Number(purchase.supplierId || 0)}
          supplierName={purchase.supplierName || t('purchases.purchase_detail_card.s47', "مورد عام")}
          locationId={purchase.locationId ? Number(purchase.locationId) : undefined}
          initialItems={(purchase.items || []).map((item) => ({
            purchaseOrderItemId: item.purchaseOrderItemId ? Number(item.purchaseOrderItemId) : undefined,
            productId: Number(item.productId),
            productName: item.name,
            orderedQty: Number(item.qty || 0),
            unitCost: Number(item.cost || 0),
            unitName: item.unitName,
          }))}
          onSuccess={() => {
            if (onRefresh) onRefresh();
          }}
        />
      )}

      {showThreeWayMatchModal && (
        <ThreeWayMatchModal
          open={showThreeWayMatchModal}
          onClose={() => setShowThreeWayMatchModal(false)}
          purchaseId={Number(purchase.id)}
          docNo={purchase.docNo}
          onSuccess={() => {
            if (onRefresh) onRefresh();
          }}
        />
      )}

      {showLandedCostsModal && (
        <PurchaseLandedCostsModal
          open={showLandedCostsModal}
          purchaseId={purchase.id}
          onClose={() => setShowLandedCostsModal(false)}
          onApplied={() => {
            if (onRefresh) onRefresh();
          }}
        />
      )}

      {showBarcodeModal && (
        <Suspense fallback={null}>
          <LazyBarcodePrintDialog
            open={showBarcodeModal}
            items={barcodeItems}
            onClose={() => setShowBarcodeModal(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
