import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { DialogShell } from '@/shared/components/dialog-shell';
import { AlertTriangleIcon, CheckCircleIcon, FileTextIcon, ShieldAlertIcon } from '@/shared/components/icons/AppIcons';
import { formatCurrency } from '@/lib/format';
import { systemConfirm } from '@/shared/components/system-alert';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { getGlobalSystemCurrency } from '@/lib/currencies';

export interface ProductArchiveConfirmDialogProps {
  open: boolean;
  product: {
    id: string | number;
    name: string;
    barcode?: string | null;
    stock?: number;
    costPrice?: number;
    isActive?: boolean;
    itemKind?: string;
    styleCode?: string | null;
    variantsCount?: number;
    color?: string | null;
    size?: string | null;
  } | null;
  isBusy?: boolean;
  onConfirm: (options?: { zeroStock?: boolean; archiveEntireGroup?: boolean }) => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Universal Product Archive & Activation Confirmation Dialog
 * Single Source of Truth for product archiving across both Products Table & Edit Product Form.
 */
export function ProductArchiveConfirmDialog({
  open,
  product,
  isBusy = false,
  onConfirm,
  onCancel,
}: ProductArchiveConfirmDialogProps) {
  const { t } = useTranslation();
  const [selectedOption, setSelectedOption] = useState<'zero' | 'keep'>('zero');
  const [archiveScope, setArchiveScope] = useState<'all' | 'single'>('all');

  const isFashionModel = Boolean(product?.itemKind === 'fashion' && product?.styleCode);

  // Reset selected option when dialog opens or product changes
  useEffect(() => {
    if (open) {
      setSelectedOption('zero');
      setArchiveScope('all');
    }
  }, [open, product?.id]);

  if (!open || !product) return null;

  const isActivating = product.isActive === false;
  const currentStock = Number(product.stock || 0);
  const hasRemainingStock = currentStock > 0;
  const unitCost = Number(product.costPrice || 0);
  // INV-FE2-FRONTEND-BOOK-DIGITS: the stock valuation feeds the
  // High-Value Safety Gate (totalCost >= 5000) and the confirm message —
  // it rounds at the tenant's book digits (tenant base currency; the
  // dialog carries no settings and the product has no currency field).
  const totalCost = roundMoneyValue(currentStock * unitCost, currencyMoneyDigits(getGlobalSystemCurrency()));

  const handleExecuteArchive = async () => {
    const archiveEntireGroup = isFashionModel ? archiveScope === 'all' : undefined;
    if (hasRemainingStock && selectedOption === 'zero') {
      // High-Value Safety Gate (for large stock count or high total valuation)
      if (currentStock >= 1000 || totalCost >= 5000) {
        const confirmed = await systemConfirm({
          title: 'تأكيد تصفير وشطب رصيد المخزون',
          badge: 'تسوية محاسبية نهائية',
          message: `أنت على وشك شطب وتصفير ${currentStock} قطعة من الصنف (${product.name}) ${totalCost > 0 ? `بقيمة إجمالية ${formatCurrency(totalCost)}` : ''} وإثباتها كعجز جرد في الدفاتر المحاسبية. هل تؤكد هذه التسوية المالية نهائياً؟`,
          impactItems: [
            `سيتم إصدار إذن تسوية مخزنية رسمي للصنف #${product.id}`,
            totalCost > 0 ? `سيتم تخفيض حساب المخزون الدفتري بمبلغ ${formatCurrency(totalCost)}` : 'سيتم تصفير رصيد المخزن دفترياً إلى 0',
            archiveEntireGroup ? 'سيتم أرشفة كامل الموديل وتفريعاته وحجبها من الكاشير ونقاط البيع' : 'سيتم حظر الصنف فوراً من الكاشير ونقاط البيع ونقله للمؤرشفة',
          ],
          confirmText: `نعم، صفر الـ ${currentStock} قطعة وأرشف`,
          cancelText: 'تراجع',
          variant: 'warning',
          confirmVariant: 'danger',
        });
        if (!confirmed) return;
      }
      await onConfirm({ zeroStock: true, archiveEntireGroup });
    } else if (hasRemainingStock && selectedOption === 'keep') {
      await onConfirm({ zeroStock: false, archiveEntireGroup });
    } else {
      await onConfirm({ zeroStock: false, archiveEntireGroup });
    }
  };

  return (
    <DialogShell
      open={open}
      onClose={isBusy ? () => {} : onCancel}
      width="min(600px, 95vw)"
      zIndex={10000}
    >
      <div
        dir="rtl"
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          padding: '24px 22px 20px',
          boxSizing: 'border-box',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
        }}
      >
        {/* Executive Icon Container with Dual Ring & Soft Shadow */}
        <div
          style={{
            width: '54px',
            height: '54px',
            borderRadius: '15px',
            margin: '0 auto 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: isActivating ? '#ecfdf5' : '#fffbeb',
            border: `1px solid ${isActivating ? '#a7f3d0' : '#fde68a'}`,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
          }}
        >
          {isActivating ? (
            <CheckCircleIcon size={28} color="#059669" />
          ) : (
            <AlertTriangleIcon size={28} color="#d97706" strokeWidth={2.2} />
          )}
        </div>

        {/* Title */}
        <h3
          style={{
            margin: '0 0 14px',
            fontSize: '1.15rem',
            fontWeight: 800,
            color: '#0f172a',
            textAlign: 'center',
            letterSpacing: '-0.2px',
          }}
        >
          {isActivating
            ? t('products.product_archive_confirm_dialog.s0', "تأكيد تنشيط الصنف")
            : t('products.product_archive_confirm_dialog.s1', "تأكيد أرشفة وتعطيل الصنف")}
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.85rem' }}>
          {/* 1. Product Summary Card */}
          <div
            style={{
              background: isActivating ? '#f0fdf4' : '#f8fafc',
              border: `1px solid ${isActivating ? '#bbf7d0' : '#e2e8f0'}`,
              borderRadius: '10px',
              padding: '11px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '5px',
            }}
          >
            <div
              style={{
                fontSize: '0.75rem',
                color: isActivating ? '#166534' : '#64748b',
                fontWeight: 700,
              }}
            >
              {isActivating
                ? t('products.product_archive_confirm_dialog.s2', "الصنف المراد تنشيطه:")
                : t('products.product_archive_confirm_dialog.s3', "الصنف المراد أرشفته وتجميده:")}
            </div>
            <div style={{ fontSize: '0.96rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.4 }}>
              {product.name}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                fontSize: '0.78rem',
                color: '#475569',
                marginTop: '2px',
                flexWrap: 'wrap',
              }}
            >
              {product.barcode ? (
                <span>
                  {t('products.product_archive_confirm_dialog.s4', "الباركود:")} <strong>{product.barcode}</strong>
                </span>
              ) : null}
              {product.styleCode ? (
                <span>
                  كود الموديل: <strong>{product.styleCode}</strong>
                </span>
              ) : null}
              {product.variantsCount && product.variantsCount > 1 ? (
                <span>
                  عدد المتغيرات: <strong>{product.variantsCount} تفريعات</strong>
                </span>
              ) : null}
              <span>
                {t('products.product_archive_confirm_dialog.s5', "الرصيد الحالي بالمخزن:")}{' '}
                <strong style={{ color: hasRemainingStock ? '#b45309' : '#059669', fontSize: '0.82rem' }}>
                  {currentStock} {t('products.product_archive_confirm_dialog.s6', "قطعة")}
                </strong>
              </span>
              {hasRemainingStock && unitCost > 0 ? (
                <span>
                  تكلفة الوحدة: <strong>{formatCurrency(unitCost)}</strong>
                </span>
              ) : null}
            </div>
          </div>

          {/* 1.5. Fashion Group Scope Selector */}
          {isFashionModel && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#334155' }}>
                حدد نطاق تطبيق {isActivating ? 'التنشيط' : 'الأرشفة'}:
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {/* Option: Entire Model */}
                <div
                  onClick={() => setArchiveScope('all')}
                  style={{
                    border: `2px solid ${archiveScope === 'all' ? '#170e5e' : '#e2e8f0'}`,
                    background: archiveScope === 'all' ? '#eef2ff' : '#ffffff',
                    borderRadius: '10px',
                    padding: '10px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '8px',
                  }}
                >
                  <input
                    type="radio"
                    name="archiveScope"
                    checked={archiveScope === 'all'}
                    onChange={() => setArchiveScope('all')}
                    style={{ cursor: 'pointer', marginTop: '2px' }}
                  />
                  <div>
                    <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.84rem' }}>
                      {isActivating ? 'الموديل بالكامل' : 'الموديل بالكامل بجميع تفريعاته'}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px', lineHeight: 1.35 }}>
                      {product.variantsCount && product.variantsCount > 1
                        ? `تطبيق الإجراء على كافة الـ (${product.variantsCount}) تفريعات التابعة للموديل دفعة واحدة.`
                        : 'تطبيق الإجراء على كافة الألوان والمقاسات التابعة لنفس كود الموديل دفعة واحدة.'}
                    </div>
                  </div>
                </div>

                {/* Option: Single Variant */}
                <div
                  onClick={() => setArchiveScope('single')}
                  style={{
                    border: `2px solid ${archiveScope === 'single' ? '#170e5e' : '#e2e8f0'}`,
                    background: archiveScope === 'single' ? '#f8fafc' : '#ffffff',
                    borderRadius: '10px',
                    padding: '10px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '8px',
                  }}
                >
                  <input
                    type="radio"
                    name="archiveScope"
                    checked={archiveScope === 'single'}
                    onChange={() => setArchiveScope('single')}
                    style={{ cursor: 'pointer', marginTop: '2px' }}
                  />
                  <div>
                    <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.84rem' }}>
                      {isActivating ? 'هذا المتغير فقط' : 'هذا المتغير/الفرعي فقط'}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px', lineHeight: 1.35 }}>
                      {product.color || product.size
                        ? `تطبيق الإجراء فقط على (${[product.color, product.size].filter(Boolean).join(' / ')}) وإبقاء باقي الموديل.`
                        : 'تطبيق الإجراء على هذا الصنف الفردي فقط دون المساس ببقية الموديل.'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 2. Stock Options Selector (if archiving and stock > 0) */}
          {!isActivating && hasRemainingStock ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#334155' }}>
                حدد كيفية التعامل مع الرصيد الحالي ({currentStock} قطعة):
              </div>

              {/* Option A: Zero Stock (Recommended) */}
              <div
                onClick={() => setSelectedOption('zero')}
                style={{
                  border: `2px solid ${selectedOption === 'zero' ? '#b45309' : '#e2e8f0'}`,
                  background: selectedOption === 'zero' ? '#fffbeb' : '#ffffff',
                  borderRadius: '10px',
                  padding: '11px 13px',
                  cursor: 'pointer',
                  transition: 'none',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                }}
              >
                <div style={{ marginTop: '2px' }}>
                  <input
                    type="radio"
                    name="archiveStockOption"
                    checked={selectedOption === 'zero'}
                    onChange={() => setSelectedOption('zero')}
                    style={{ cursor: 'pointer', width: '15px', height: '15px' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '2px' }}>
                    <span style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.86rem' }}>
                      أرشفة مع تصفير الرصيد آلياً
                    </span>
                    <span
                      style={{
                        background: '#fef3c7',
                        color: '#92400e',
                        border: '1px solid #fde68a',
                        borderRadius: '6px',
                        padding: '1px 6px',
                        fontSize: '0.68rem',
                        fontWeight: 700,
                      }}
                    >
                      موصى به في أغلب الحالات
                    </span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b', lineHeight: 1.45 }}>
                    شطب الكمية بقيد تسوية مخزنية نظامية وإثبات عجز/خسائر الجرد لتطابق الدفاتر مع المخزن الفعلي.
                  </div>
                </div>
              </div>

              {/* Option B: Keep Stock */}
              <div
                onClick={() => setSelectedOption('keep')}
                style={{
                  border: `2px solid ${selectedOption === 'keep' ? '#170e5e' : '#e2e8f0'}`,
                  background: selectedOption === 'keep' ? '#f8fafc' : '#ffffff',
                  borderRadius: '10px',
                  padding: '11px 13px',
                  cursor: 'pointer',
                  transition: 'none',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                }}
              >
                <div style={{ marginTop: '2px' }}>
                  <input
                    type="radio"
                    name="archiveStockOption"
                    checked={selectedOption === 'keep'}
                    onChange={() => setSelectedOption('keep')}
                    style={{ cursor: 'pointer', width: '15px', height: '15px' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '2px' }}>
                    <span style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.86rem' }}>
                      أرشفة مع إبقاء الرصيد الدفتري
                    </span>
                    <span
                      style={{
                        background: '#e0f2fe',
                        color: '#0369a1',
                        border: '1px solid #bae6fd',
                        borderRadius: '6px',
                        padding: '1px 6px',
                        fontSize: '0.68rem',
                        fontWeight: 700,
                      }}
                    >
                      للبضاعة المحجوزة أو الموسمية
                    </span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b', lineHeight: 1.45 }}>
                    حظر بيع الصنف فقط في الكاشير مع بقاء الكمية وقيمتها مسجلة دفترياً كأصل من أصول المنشأة.
                  </div>
                </div>
              </div>

              {/* Dynamic Financial Impact Breakdown Box */}
              {selectedOption === 'zero' ? (
                <div
                  style={{
                    background: '#fef3c7',
                    border: '1px solid #fde68a',
                    borderRadius: '10px',
                    padding: '12px 14px',
                    color: '#92400e',
                    fontSize: '0.78rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800, marginBottom: '8px', fontSize: '0.82rem' }}>
                    <FileTextIcon size={16} color="#b45309" />
                    <span>بيان الأثر المالي والمحاسبي للتصفير:</span>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: totalCost > 0 ? '1fr 1fr 1fr' : '1fr 1fr',
                      gap: '8px',
                      background: '#ffffff',
                      border: '1px solid #fed7aa',
                      borderRadius: '8px',
                      padding: '8px 10px',
                      marginBottom: '8px',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.7rem', color: '#64748b' }}>الكمية المشطوبة:</div>
                      <div style={{ fontWeight: 800, color: '#b45309', fontSize: '0.88rem' }}>{currentStock} قطعة</div>
                    </div>
                    {totalCost > 0 ? (
                      <div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>التكلفة الدفترية الإجمالية:</div>
                        <div style={{ fontWeight: 800, color: '#dc2626', fontSize: '0.88rem' }}>{formatCurrency(totalCost)}</div>
                      </div>
                    ) : null}
                    <div>
                      <div style={{ fontSize: '0.7rem', color: '#64748b' }}>نوع الحركة:</div>
                      <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.82rem' }}>تسوية عجز جرد</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', color: '#78350f', lineHeight: 1.45 }}>
                    <div>• يتم إصدار إذن تسوية مخزنية نظامي، وتسجيل قيد عجز جرد وتخفيض حساب المخزون دفترياً.</div>
                    <div>• يصبح رصيد الصنف صفراً فوراً ويُحجب من الكاشير ونقاط البيع.</div>
                    <div style={{ fontWeight: 700, color: '#b45309', marginTop: '2px' }}>
                      • تنبيه رقابي: تصفير الرصيد يولد قيداً محاسبياً رسمياً ولا يمكن التراجع عنه يدوياً.
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: '10px',
                    padding: '12px 14px',
                    color: '#166534',
                    fontSize: '0.78rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800, marginBottom: '6px', fontSize: '0.82rem' }}>
                    <ShieldAlertIcon size={16} color="#059669" />
                    <span>حفظ الرصيد كأصل دفتري مالي:</span>
                  </div>
                  <div style={{ lineHeight: 1.5, color: '#14532d' }}>
                    سيتم تجميد الصنف فوراً وحجبه من الكاشير والبيع والشراء لمنع التداول، مع بقاء الـ <strong>{currentStock} قطعة</strong> {totalCost > 0 ? `بقيمة ${formatCurrency(totalCost)}` : ''} مسجلة في الميزانية العمومية كأصل مخزني. يمكنك إعادة التنشيط في أي وقت.
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {/* 3. General Operational Bullet Points (if stock is 0 or activating) */}
          {isActivating || !hasRemainingStock ? (
            <div style={{ color: '#475569', fontSize: '0.8125rem', lineHeight: 1.65 }}>
              {isActivating ? (
                <div>
                  {t('products.product_archive_confirm_dialog.s10', "سيتم إعادة الصنف فوراً إلى دليل الأصناف النشطة وإتاحته في شاشات البيع والشراء ونقاط البيع لاستئناف العمل عليه.")}
                </div>
              ) : (
                <ul style={{ margin: 0, paddingInlineStart: '18px' }}>
                  <li>{t('products.product_archive_confirm_dialog.s11', "يتم إخفاء الصنف فوراً من نقاط البيع (POS) وقوائم البيع والشراء لمنع التعامل عليه بالخطأ.")}</li>
                  <li>{t('products.product_archive_confirm_dialog.s12', "تظل كافة الفواتير والتقارير وحركات كارت الصنف التاريخية محفوظة بنسبة 100%.")}</li>
                  <li>{t('products.product_archive_confirm_dialog.s13', "يمكنك في أي وقت استعراض الصنف وإلغاء أرشفته من تبويب")} <strong>{t('products.product_archive_confirm_dialog.s14', "«المؤرشفة»")}</strong>.</li>
                </ul>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '10px',
            marginTop: '20px',
            paddingTop: '16px',
            borderTop: '1px solid #f1f5f9',
            flexWrap: 'wrap',
          }}
        >
          <Button
            variant="secondary"
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            style={{ minWidth: '85px' }}
          >
            {t('products.product_archive_confirm_dialog.s15', "تراجع")}
          </Button>

          {!isActivating && hasRemainingStock ? (
            <Button
              variant="primary"
              type="button"
              onClick={handleExecuteArchive}
              disabled={isBusy}
              style={{
                fontWeight: 800,
                background: selectedOption === 'zero' ? '#d97706' : '#170e5e',
                borderColor: selectedOption === 'zero' ? '#b45309' : '#170e5e',
                color: '#ffffff',
                padding: '8px 16px',
                fontSize: '0.84rem',
              }}
            >
              {isBusy
                ? t('products.product_archive_confirm_dialog.s16', "جارٍ التنفيذ...")
                : selectedOption === 'zero'
                ? totalCost > 0
                  ? isFashionModel && archiveScope === 'all'
                    ? `تأكيد تصفير وشطب رصيد كامل الموديل (${formatCurrency(totalCost)}) والأرشفة`
                    : `تأكيد تصفير ${currentStock} قطعة (${formatCurrency(totalCost)}) والأرشفة`
                  : isFashionModel && archiveScope === 'all'
                  ? `تأكيد تصفير ${currentStock} قطعة وأرشفة الموديل بالكامل`
                  : `تأكيد تصفير ${currentStock} قطعة والأرشفة`
                : isFashionModel && archiveScope === 'all'
                ? `تأكيد أرشفة الموديل بالكامل (مع إبقاء ${currentStock} قطعة)`
                : `تأكيد الأرشفة (مع إبقاء ${currentStock} قطعة)`}
            </Button>
          ) : (
            <Button
              variant="primary"
              type="button"
              onClick={handleExecuteArchive}
              disabled={isBusy}
              style={{
                minWidth: '130px',
                fontWeight: 700,
                background: isActivating ? '#059669' : '#170e5e',
                borderColor: isActivating ? '#059669' : '#170e5e',
              }}
            >
              {isBusy
                ? t('products.product_archive_confirm_dialog.s16', "جارٍ التنفيذ...")
                : isActivating
                ? isFashionModel && archiveScope === 'all'
                  ? 'تأكيد تنشيط الموديل بالكامل'
                  : t('products.product_archive_confirm_dialog.s17', "تأكيد التنشيط")
                : isFashionModel && archiveScope === 'all'
                ? 'تأكيد أرشفة الموديل بالكامل'
                : t('products.product_archive_confirm_dialog.s18', "تأكيد الأرشفة والتعطيل")}
            </Button>
          )}
        </div>
      </div>
    </DialogShell>
  );
}
