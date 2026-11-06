import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { PaginationControls } from '@/shared/components/pagination-controls';
import { QueryFeedback } from '@/shared/components/query-feedback';
import {
  EditIcon,
  BarcodeIcon,
  TagIcon,
  ArchiveIcon,
  TrashIcon,
  PrinterIcon,
  DownloadIcon,
  SmartphoneIcon,
  CheckShieldIcon,
  RefreshCwIcon,
} from '@/shared/components/icons/AppIcons';
import { formatCurrency, formatDate, formatDateOnly } from '@/lib/format';
import {
  evaluateProductExpiryStatus,
  getProductExpiryDate,
  productExpiryAlertLabel,
} from '../utils/product-expiry.utils';
import { downloadExcelFile, escapeHtml, printHtmlDocument } from '@/lib/browser';
import { inventoryApi } from '@/shared/api/inventory.api';
import type { Product, StockMovementRecord } from '@/types/domain';

const movementLabels: Record<string, string> = {
  opening: 'رصيد افتتاحي',
  opening_balance: 'رصيد افتتاحي',
  sale: 'فاتورة بيع',
  sale_return: 'مرتجع بيع',
  sale_edit: 'تعديل بيع',
  sale_edit_reversal: 'عكس تعديل بيع',
  sale_cancel: 'إلغاء بيع',
  purchase: 'فاتورة شراء',
  purchase_return: 'مرتجع شراء',
  van_load_out: 'تحميل سيارة توزيع',
  van_load_in: 'استلام سيارة توزيع',
  van_unload_out: 'تفريغ سيارة توزيع',
  van_unload_in: 'استلام من سيارة توزيع',
  van_sale: 'بيع سيارة توزيع',
  van_return: 'مرتجع سيارة توزيع',
  transfer_send: 'إذن صرف تحويل',
  transfer_receive: 'استلام تحويل',
  transfer_cancel: 'إلغاء تحويل',
  stock_count_gain: 'زيادة جرد',
  stock_count_loss: 'عجز جرد',
  damaged: 'تالف وهالك',
  food_waste: 'هالك أطعمة',
  manufacturing_consumption: 'استهلاك تصنيع',
  manufacturing_production: 'إنتاج تام',
  tradein_in: 'استبدال - استلام',
  tradein_out: 'استبدال - صرف',
  add: 'إضافة مخزنية',
  deduct: 'خصم مخزني',
};

const movementToneMap: Record<string, string> = {
  damaged: 'negative',
  food_waste: 'negative',
  deduct: 'negative',
  stock_count_loss: 'negative',
  transfer_send: 'negative',
  van_load_out: 'negative',
  van_unload_out: 'negative',
  van_sale: 'negative',
  sale: 'negative',
  sale_edit: 'negative',
  purchase_return: 'negative',
  tradein_out: 'negative',
  manufacturing_consumption: 'negative',

  transfer_cancel: 'positive',
  stock_count_gain: 'positive',
  opening: 'positive',
  opening_balance: 'positive',
  add: 'positive',
  transfer_receive: 'positive',
  van_load_in: 'positive',
  van_unload_in: 'positive',
  purchase: 'positive',
  sale_return: 'positive',
  sale_cancel: 'positive',
  sale_edit_reversal: 'positive',
  van_return: 'positive',
  tradein_in: 'positive',
  manufacturing_production: 'positive',
};

function getMovementLabel(type: string) {
  return movementLabels[type] || type || 'حركة';
}

function getMovementReasonText(reason?: string, note?: string) {
  const cleanNote = note?.trim();
  const cleanReason = reason?.trim();

  if (cleanNote && cleanNote !== cleanReason) {
    return cleanNote;
  }

  if (cleanReason && movementLabels[cleanReason]) {
    return movementLabels[cleanReason];
  }

  return cleanNote || cleanReason || '—';
}

function MovementPill({ type }: { type: string }) {
  const tone = movementToneMap[type] || 'neutral';
  return (
    <span className={`status-badge movement-pill movement-${tone}`} style={{ fontSize: '0.74rem' }}>
      {getMovementLabel(type)}
    </span>
  );
}

const MOVEMENT_FILTER_OPTIONS = [
  { value: 'all', label: 'كل الحركات' },
  ...Object.entries(movementLabels).map(([type, label]) => ({ value: type, label })),
];

export interface ProductCardModalProps {
  product: Product | null;
  onClose: () => void;
  categoryName?: string;
  supplierName?: string;
  locationName?: string;
  onEditProduct: (product: Product) => void;
  onOpenBarcodeDialog: (product: Product, mode?: 'scan' | 'generate') => void;
  onOpenOfferDialog: (product: Product) => void;
  onOpenSerialsDialog?: (product: Product) => void;
  onToggleArchiveProduct?: (product: Product) => void;
  onDeleteProduct?: (product: Product) => void;
  mobileStoreEnabled?: boolean;
}

export function ProductCardModal({
  product,
  onClose,
  categoryName,
  supplierName,
  locationName,
  onEditProduct,
  onOpenBarcodeDialog,
  onOpenOfferDialog,
  onOpenSerialsDialog,
  onToggleArchiveProduct,
  onDeleteProduct,
  mobileStoreEnabled,
}: ProductCardModalProps) {
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  const movementsQuery = useQuery({
    queryKey: ['product-stock-movements', product?.id, page, pageSize, typeFilter],
    queryFn: () => {
      if (!product?.id) {
        return Promise.resolve({
          rows: [] as StockMovementRecord[],
          pagination: {
            page: 1,
            pageSize,
            totalItems: 0,
            totalPages: 1,
            rangeStart: 0,
            rangeEnd: 0,
          },
          summary: { positive: 0, negative: 0, totalItems: 0 },
        });
      }
      return inventoryApi.stockMovementsPage({
        productId: product.id,
        page,
        pageSize,
        type: typeFilter,
      });
    },
    enabled: Boolean(product?.id),
    staleTime: 10_000,
    refetchOnMount: 'always',
    placeholderData: (previous) => previous,
  });

  const rows = useMemo(() => movementsQuery.data?.rows || [], [movementsQuery.data?.rows]);
  const pagination = movementsQuery.data?.pagination;

  if (!product) return null;

  const cost = Number(product.costPrice || 0);
  const retail = Number(product.retailPrice || 0);
  const wholesale = Number(product.wholesalePrice || 0);
  const marginVal = retail - cost;
  const marginPct = cost > 0 ? ((marginVal / cost) * 100).toFixed(1) : '100';

  const isOutOfStock = product.stock <= 0;
  const isLowStock = !isOutOfStock && product.stock <= (product.minStock || 5);

  // INV-EXPIRY-ALERT: the recorded expiry date (top-level or metadata) and
  // its alert status under the canonical 60-day rule. A dateless product
  // yields no_expiry here and the card simply shows '—'.
  const expiryDate = getProductExpiryDate(product);
  const expiryInfo = evaluateProductExpiryStatus(expiryDate);
  const expiryAlert = productExpiryAlertLabel(expiryInfo);
  const expiryTone =
    expiryInfo.status === 'expired'
      ? { border: '#fecaca', color: '#dc2626' }
      : expiryInfo.status === 'near_expiry'
        ? { border: '#fed7aa', color: '#d97706' }
        : expiryInfo.status === 'valid'
          ? { border: '#bbf7d0', color: '#16a34a' }
          : { border: '#e2e8f0', color: '#334155' };

  async function fetchAllMovementsForExport() {
    if (!product?.id) return [];
    const first = await inventoryApi.stockMovementsPage({
      productId: product.id,
      page: 1,
      pageSize: 100,
      type: typeFilter,
    });
    const totalPages = first.pagination?.totalPages || 1;
    const allRows = [...(first.rows || [])];
    for (let currentPage = 2; currentPage <= totalPages; currentPage += 1) {
      const nextPage = await inventoryApi.stockMovementsPage({
        productId: product.id,
        page: currentPage,
        pageSize: 100,
        type: typeFilter,
      });
      allRows.push(...(nextPage.rows || []));
    }
    return allRows;
  }

  const exportExcel = async () => {
    const allRows = await fetchAllMovementsForExport();
    if (!allRows.length) return;
    downloadExcelFile(
      `كارت-حركة-${product.name}.xlsx`,
      ['الصنف', 'نوع الحركة', 'الكمية', 'قبل', 'بعد', 'السبب', 'الملاحظات', 'المخزن', 'المسؤول', 'التاريخ'],
      allRows.map((m) => [
        product.name,
        getMovementLabel(m.type),
        m.qty,
        m.beforeQty,
        m.afterQty,
        m.reason || '',
        m.note || '',
        m.locationName || m.branchName || '',
        m.createdBy || '',
        m.date || '',
      ]),
    );
  };

  const printCard = async () => {
    const allRows = await fetchAllMovementsForExport();
    if (!allRows.length) return;
    // INV-EXPIRY-ALERT: the printed card carries the same expiry date/alert as the screen card.
    const printExpiry = getProductExpiryDate(product);
    const printExpiryInfo = evaluateProductExpiryStatus(printExpiry);
    const printExpiryAlert = productExpiryAlertLabel(printExpiryInfo);
    printHtmlDocument(
      `كارت حركة صنف - ${product.name}`,
      `
      <div style="direction: rtl; font-family: 'Segoe UI', Tahoma, sans-serif; padding: 24px; color: #0f172a;">
        <div style="border-bottom: 2px solid #170e5e; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <h2 style="margin: 0 0 6px; color: #170e5e; font-size: 1.3rem;">كارت حركة ومخزون الصنف</h2>
            <div style="font-size: 1.1rem; font-weight: 800; color: #0f172a;">${escapeHtml(product.name)}</div>
            <div style="font-size: 0.85rem; color: #64748b; margin-top: 4px;">
              كود: ${product.id} · باركود: ${escapeHtml(product.barcode || '—')} · القسم: ${escapeHtml(categoryName || '—')}${printExpiryInfo.earliestExpiryDate ? ` · تاريخ الصلاحية: ${escapeHtml(formatDateOnly(printExpiryInfo.earliestExpiryDate))}${printExpiryAlert ? ` (${escapeHtml(printExpiryAlert)})` : ''}` : ''}
            </div>
          </div>
          <div style="text-align: left; background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px 16px; border-radius: 8px;">
            <div style="font-size: 0.8rem; color: #64748b;">الرصيد الحالي بالمخازن</div>
            <div style="font-size: 1.3rem; font-weight: 800; color: #170e5e;">${product.stock}</div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; text-align: center; background: #f8fafc; padding: 10px; border-radius: 8px; border: 1px solid #e2e8f0;">
          <div><span style="font-size: 0.75rem; color: #64748b;">سعر التكلفة:</span> <strong>${formatCurrency(cost)}</strong></div>
          <div><span style="font-size: 0.75rem; color: #64748b;">سعر القطاعي:</span> <strong>${formatCurrency(retail)}</strong></div>
          <div><span style="font-size: 0.75rem; color: #64748b;">سعر الجملة:</span> <strong>${formatCurrency(wholesale)}</strong></div>
          <div><span style="font-size: 0.75rem; color: #64748b;">هامش الربح:</span> <strong>${marginPct}%</strong></div>
        </div>

        <h3 style="font-size: 1rem; color: #1e293b; margin: 0 0 10px;">سجل الحركات التاريخية (${allRows.length} حركة)</h3>
        <table style="width: 100%; border-collapse: collapse; text-align: right; font-size: 0.82rem;">
          <thead>
            <tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
              <th style="padding: 8px 10px;">التاريخ</th>
              <th style="padding: 8px 10px;">نوع الحركة</th>
              <th style="padding: 8px 10px;">قبل</th>
              <th style="padding: 8px 10px;">مقدار التغير</th>
              <th style="padding: 8px 10px;">بعد</th>
              <th style="padding: 8px 10px;">المخزن / الفرع</th>
              <th style="padding: 8px 10px;">المسؤول</th>
              <th style="padding: 8px 10px;">السبب / الملاحظات</th>
            </tr>
          </thead>
          <tbody>
            ${allRows
              .map(
                (m) => `
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 8px 10px;">${escapeHtml(formatDate(m.date || ''))}</td>
                <td style="padding: 8px 10px;">${escapeHtml(getMovementLabel(m.type))}</td>
                <td style="padding: 8px 10px;">${m.beforeQty}</td>
                <td style="padding: 8px 10px; font-weight: 700; color: ${m.qty >= 0 ? '#16a34a' : '#dc2626'};">${m.qty >= 0 ? '+' : ''}${m.qty}</td>
                <td style="padding: 8px 10px;">${m.afterQty}</td>
                <td style="padding: 8px 10px;">${escapeHtml(m.locationName || m.branchName || '—')}</td>
                <td style="padding: 8px 10px;">${escapeHtml(m.createdBy || '—')}</td>
                <td style="padding: 8px 10px;">${escapeHtml(m.reason || m.note || '—')}</td>
              </tr>
            `,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `,
    );
  };

  return (
    <StandardDialog
      open={Boolean(product)}
      onClose={onClose}
      title={product.name}
      subtitle={`كود: ${product.id} · باركود: ${product.barcode || '—'} · القسم: ${categoryName || 'غير محدد'}${supplierName ? ` · المورد: ${supplierName}` : ''}${locationName ? ` · المخزن: ${locationName}` : ''}`}
      size="xl"
      width="min(980px, 96vw)"
      minHeight="min(600px, 85vh)"
      bodyStyle={{ overflowX: 'hidden' }}
      footerActions={
        <StandardDialogFooter
          cancelLabel="إغلاق"
          onCancel={onClose}
          extraActions={
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button
                variant="secondary"
                type="button"
                onClick={() => void exportExcel()}
                disabled={!pagination?.totalItems}
                style={{ fontSize: '0.82rem', padding: '6px 12px' }}
              >
                <DownloadIcon size={14} style={{ marginInlineEnd: '4px' }} />
                <span>تصدير Excel</span>
              </Button>
              <Button
                variant="secondary"
                type="button"
                onClick={() => void printCard()}
                disabled={!pagination?.totalItems}
                style={{ fontSize: '0.82rem', padding: '6px 12px' }}
              >
                <PrinterIcon size={14} style={{ marginInlineEnd: '4px' }} />
                <span>طباعة كارت الصنف</span>
              </Button>
            </div>
          }
        />
      }
    >
      <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%', minWidth: 0, boxSizing: 'border-box' }}>
        {/* 1. Header KPIs & Pricing Summary */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '10px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '12px 14px',
          }}
        >
          {/* Stock KPI */}
          <div
            style={{
              background: '#ffffff',
              border: `1px solid ${isOutOfStock ? '#fecaca' : isLowStock ? '#fed7aa' : '#bbf7d0'}`,
              borderRadius: '8px',
              padding: '8px 12px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>الرصيد الكلي الحالي</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '2px' }}>
              <strong
                style={{
                  fontSize: '1.25rem',
                  color: isOutOfStock ? '#dc2626' : isLowStock ? '#d97706' : '#16a34a',
                }}
              >
                {product.stock}
              </strong>
              <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                {isOutOfStock ? '(نافد)' : isLowStock ? '(منخفض)' : '(متوفر)'}
              </span>
            </div>
          </div>

          {/* Cost Price */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px' }}>
            <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>سعر التكلفة (الشراء)</span>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#334155', marginTop: '2px' }}>
              {formatCurrency(cost)}
            </div>
          </div>

          {/* Retail Price */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px' }}>
            <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>سعر البيع (قطاعي)</span>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#170e5e', marginTop: '2px' }}>
              {formatCurrency(retail)}
            </div>
          </div>

          {/* Wholesale Price */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px' }}>
            <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>سعر الجملة</span>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>
              {formatCurrency(wholesale)}
            </div>
          </div>

          {/* Profit Margin */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px' }}>
            <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>هامش الربح المتوقع</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginTop: '2px' }}>
              <strong style={{ fontSize: '1.05rem', color: '#16a34a' }}>{marginPct}%</strong>
              <span style={{ fontSize: '0.72rem', color: '#64748b' }}>({formatCurrency(marginVal)})</span>
            </div>
          </div>

          {/* Expiry Date (INV-EXPIRY-ALERT) */}
          <div
            style={{
              background: '#ffffff',
              border: `1px solid ${expiryTone.border}`,
              borderRadius: '8px',
              padding: '8px 12px',
            }}
          >
            <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>تاريخ انتهاء الصلاحية</span>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: expiryTone.color, marginTop: '2px' }}>
              {expiryInfo.earliestExpiryDate ? formatDateOnly(expiryInfo.earliestExpiryDate) : '—'}
            </div>
            <span style={{ fontSize: '0.72rem', color: expiryTone.color }}>
              {expiryAlert ||
                (expiryInfo.status === 'valid' && expiryInfo.daysRemaining !== null
                  ? `صالحة (باقي ${expiryInfo.daysRemaining} يوم)`
                  : 'لا يوجد تاريخ صلاحية مسجل')}
            </span>
          </div>
        </div>

        {/* Expiry alert banner (INV-EXPIRY-ALERT): shown only when the item is expired or inside the 60-day window */}
        {expiryAlert ? (
          <div
            role="alert"
            style={{
              background: expiryInfo.status === 'expired' ? '#fef2f2' : '#fffbeb',
              border: `1px solid ${expiryTone.border}`,
              borderRadius: '10px',
              padding: '10px 14px',
              fontSize: '0.85rem',
              fontWeight: 700,
              color: expiryTone.color,
            }}
          >
            {`تنبيه: ${expiryAlert} — تاريخ الصلاحية ${expiryInfo.earliestExpiryDate ? formatDateOnly(expiryInfo.earliestExpiryDate) : '—'}`}
          </div>
        ) : null}

        {/* 2. Operations & Actions Strip (مركز الإجراءات الموحد) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '8px',
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '10px 14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginInlineEnd: '4px' }}>
              إجراءات الصنف:
            </span>

            {/* Edit Button */}
            <Button
              variant="primary"
              type="button"
              onClick={() => {
                onClose();
                onEditProduct(product);
              }}
              style={{
                fontSize: '0.8rem',
                padding: '6px 14px',
                background: '#170e5e',
                color: '#ffffff',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <EditIcon size={14} />
              <span>تعديل الصنف</span>
            </Button>

            {/* Barcode Print */}
            <Button
              variant="secondary"
              type="button"
              onClick={() => onOpenBarcodeDialog(product, 'scan')}
              style={{ fontSize: '0.8rem', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              <BarcodeIcon size={14} />
              <span>طباعة الباركود</span>
            </Button>

            {/* Price Offers */}
            <Button
              variant="secondary"
              type="button"
              onClick={() => onOpenOfferDialog(product)}
              style={{ fontSize: '0.8rem', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              <TagIcon size={14} />
              <span>عروض الأسعار</span>
            </Button>

            {/* Mobile / Serials if enabled */}
            {mobileStoreEnabled && product.trackSerials && onOpenSerialsDialog ? (
              <Button
                variant="secondary"
                type="button"
                onClick={() => onOpenSerialsDialog(product)}
                style={{ fontSize: '0.8rem', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
              >
                <SmartphoneIcon size={14} />
                <span>أرقام السيريال IMEI</span>
              </Button>
            ) : null}
          </div>

          {/* Archive / Delete Status Button */}
          <div>
            {product.isActive === false ? (
              <Button
                variant="secondary"
                type="button"
                onClick={() => {
                  onToggleArchiveProduct?.(product);
                  onClose();
                }}
                style={{
                  fontSize: '0.8rem',
                  padding: '6px 12px',
                  color: '#16a34a',
                  borderColor: '#bbf7d0',
                  background: '#f0fdf4',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <CheckShieldIcon size={14} />
                <span>تنشيط الصنف</span>
              </Button>
            ) : (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                {onToggleArchiveProduct ? (
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => {
                      onToggleArchiveProduct(product);
                      onClose();
                    }}
                    style={{
                      fontSize: '0.8rem',
                      padding: '6px 12px',
                      color: '#d97706',
                      borderColor: '#fde68a',
                      background: '#fffbeb',
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    <ArchiveIcon size={14} />
                    <span>أرشفة وتعطيل</span>
                  </Button>
                ) : null}

                {product.canDelete && onDeleteProduct ? (
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => {
                      onDeleteProduct(product);
                      onClose();
                    }}
                    style={{
                      fontSize: '0.8rem',
                      padding: '6px 12px',
                      color: '#dc2626',
                      borderColor: '#fecaca',
                      background: '#fef2f2',
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    <TrashIcon size={14} />
                    <span>حذف نهائي</span>
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {/* 3. Movements Ledger Header & Filter */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
            borderBottom: '1px solid #e2e8f0',
            paddingBottom: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span
              style={{
                width: '3px',
                height: '16px',
                backgroundColor: '#170e5e',
                borderRadius: '2px',
                display: 'inline-block',
              }}
            />
            <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800, color: '#0f172a' }}>
              سجل حركات وعمليات الصنف بالمخازن
            </h4>
            <span
              style={{
                background: '#e0e7ff',
                color: '#3730a3',
                fontSize: '0.72rem',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '12px',
              }}
            >
              {pagination?.totalItems || 0} حركة
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => movementsQuery.refetch()}
              disabled={movementsQuery.isFetching}
              title="تحديث حركات الصنف"
              style={{
                padding: '3px 8px',
                height: '26px',
                borderRadius: '6px',
                fontSize: '0.74rem',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                color: '#334155',
                borderColor: '#cbd5e1',
                background: '#f8fafc',
              }}
            >
              <RefreshCwIcon size={12} style={{ animation: movementsQuery.isFetching ? 'spin 0.75s linear infinite' : 'none' }} />
              <span>تحديث</span>
            </Button>
          </div>

          {/* Filter by Type */}
          <div style={{ minWidth: '180px' }}>
            <CustomSelect
              value={typeFilter}
              onChange={(val) => {
                setTypeFilter(val);
                setPage(1);
              }}
              options={MOVEMENT_FILTER_OPTIONS}
              placeholder="فلترة بنوع الحركة"
            />
          </div>
        </div>

        {/* 4. Movements Table */}
        <div style={{ minHeight: '260px', width: '100%', minWidth: 0 }}>
          <QueryFeedback
            isLoading={movementsQuery.isLoading}
            isError={movementsQuery.isError}
            error={movementsQuery.error}
            isEmpty={!pagination?.totalItems}
            loadingText="جاري تحميل كارت حركات الصنف..."
            emptyTitle="لا توجد حركات مخزون مسجلة لهذا الصنف"
            emptyHint="تظهر هنا تلقائياً كافة فواتير البيع والشراء والتحويلات والتوالف وتسويات الجرد التي تمت على هذا الصنف."
          >
            <div className="table-wrap table-wrap-sticky table-wrap-compact" style={{ overflowX: 'hidden', width: '100%' }}>
              <table style={{ tableLayout: 'fixed', width: '100%', minWidth: '100%' }}>
                <colgroup>
                  <col style={{ width: '23%' }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '19%' }} />
                  <col style={{ width: '24%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'start' }}>التاريخ والوقت</th>
                    <th style={{ textAlign: 'center' }}>نوع الحركة</th>
                    <th style={{ textAlign: 'center' }}>قبل / التغير / بعد</th>
                    <th style={{ textAlign: 'start' }}>المخزن / الفرع</th>
                    <th style={{ textAlign: 'start' }}>السبب / الملاحظات</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m: StockMovementRecord) => (
                    <tr key={m.id}>
                      <td style={{ textAlign: 'start', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                        <div>
                          <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '0.8rem', lineHeight: 1.3 }}>
                            {formatDate(m.date || '')}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '2px' }}>
                            بواسطة: {m.createdBy || 'مستخدم غير محدد'}
                          </div>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <MovementPill type={m.type} />
                      </td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                            قبل: {m.beforeQty} · بعد: {m.afterQty}
                          </div>
                          <div
                            style={{
                              fontWeight: 800,
                              fontSize: '0.85rem',
                              color: m.qty >= 0 ? '#16a34a' : '#dc2626',
                              direction: 'ltr',
                              textAlign: 'center',
                            }}
                          >
                            {m.qty >= 0 ? '+' : ''}
                            {m.qty}
                          </div>
                        </div>
                      </td>
                      <td style={{ textAlign: 'start', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                        <span style={{ fontSize: '0.8rem', color: '#334155', fontWeight: 600, lineHeight: 1.35, display: 'block' }}>
                          {m.locationName || m.branchName || locationName || 'المخزن الرئيسي'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'start', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                        <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.35, wordBreak: 'break-word' }}>
                          {getMovementReasonText(m.reason, m.note)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pagination && pagination.totalItems > 0 ? (
              <PaginationControls
                page={page}
                totalPages={pagination.totalPages || Math.max(1, Math.ceil(pagination.totalItems / pageSize))}
                pageSize={pageSize}
                pageSizeOptions={[10, 15, 30]}
                totalItems={pagination.totalItems}
                rangeStart={((page - 1) * pageSize) + 1}
                rangeEnd={Math.min(page * pageSize, pagination.totalItems)}
                onPageChange={setPage}
                onPageSizeChange={(val) => {
                  setPageSize(val);
                  setPage(1);
                }}
                itemLabel="حركة"
              />
            ) : null}
          </QueryFeedback>
        </div>
      </div>
    </StandardDialog>
  );
}
