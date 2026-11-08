import { useTranslation } from 'react-i18next';
import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/shared/ui/button';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { formatCurrency } from '@/lib/format';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { CheckIcon, TagIcon, MessageSquareIcon } from '@/shared/components/icons/AppIcons';
import {
  marginProtectionApi,
  type MarginProtectionAnalysisResponse,
} from '../api/margin-protection.api';

interface MarginProtectionModalProps {
  open: boolean;
  purchaseId: number;
  initialTargetMargin?: number;
  onClose: () => void;
  onRepricingApplied?: (count: number) => void;
}

export function MarginProtectionModal({
  open,
  purchaseId,
  initialTargetMargin = 25,
  onClose,
  onRepricingApplied,
}: MarginProtectionModalProps) {
  const { t } = useTranslation();
  const { currencySymbol, currencyCode } = useSystemCurrency();
  const [targetMargin, setTargetMargin] = useState(initialTargetMargin);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [notifyOwner, setNotifyOwner] = useState(true);
  const [analysis, setAnalysis] = useState<MarginProtectionAnalysisResponse | null>(null);
  const [editedPrices, setEditedPrices] = useState<Record<number, number>>({});
  const [selectedProductIds, setSelectedProductIds] = useState<Set<number>>(new Set());
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !purchaseId) {
      setAnalysis(null);
      setEditedPrices({});
      setSelectedProductIds(new Set());
      setSuccessMessage(null);
      setErrorMessage(null);
      return;
    }

    let active = true;
    setLoading(true);
    setErrorMessage(null);

    marginProtectionApi
      .analyze(purchaseId, targetMargin)
      .then((res) => {
        if (!active) return;
        setAnalysis(res);
        // Pre-select items where margin is compressed or loss-making
        const autoSelected = new Set<number>();
        const initialPrices: Record<number, number> = {};
        for (const it of res.items) {
          initialPrices[it.productId] = it.recommendedRetailPrice;
          if (it.isLossMaking || it.isMarginCompressed || it.costChangePercent > 0) {
            autoSelected.add(it.productId);
          }
        }
        setEditedPrices(initialPrices);
        setSelectedProductIds(autoSelected);
      })
      .catch((err: any) => {
        if (!active) return;
        setErrorMessage(err?.message || 'تعذر تحميل تقرير حماية هامش الربح');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, purchaseId, targetMargin]);

  // Recalculate recommended price dynamically if user changes target margin
  // INV-FE2-FRONTEND-BOOK-DIGITS: the recommended price is POSTed as the
  // new retail price (handleApply), so it must round at the tenant's book
  // digits — a 2dp cut would store a truncated price on a 3-decimal
  // tenant. profitAfter is the matching preview. NOTE: currencyCode (not
  // the hook's `decimals`, which comes from the incomplete
  // getCurrencyDecimals — KWD/BHD/OMR only) feeds the canonical helper.
  const bookDigits = currencyMoneyDigits(currencyCode);
  const displayItems = useMemo(() => {
    if (!analysis) return [];
    return analysis.items.map((item) => {
      const recPrice = roundMoneyValue(item.newCost / (1 - (targetMargin / 100)), bookDigits);
      const currentEdit = editedPrices[item.productId] ?? recPrice;
      const profitAfter = roundMoneyValue(currentEdit - item.newCost, bookDigits);
      const marginAfter = currentEdit > 0 ? Number(((profitAfter / currentEdit) * 100).toFixed(1)) : 0;
      return {
        ...item,
        dynamicRecommended: recPrice,
        effectivePrice: currentEdit,
        profitAfter,
        marginAfter,
      };
    });
  }, [analysis, bookDigits, targetMargin, editedPrices]);

  const handlePriceChange = (productId: number, val: number) => {
    setEditedPrices((prev) => ({ ...prev, [productId]: Math.max(0, val) }));
  };

  const toggleSelect = (productId: number) => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedProductIds.size === displayItems.length) {
      setSelectedProductIds(new Set());
    } else {
      setSelectedProductIds(new Set(displayItems.map((it) => it.productId)));
    }
  };

  const handleApply = async () => {
    if (!selectedProductIds.size) {
      setErrorMessage('يرجى تحديد صنف واحد على الأقل لتحديث سعره');
      return;
    }

    setApplying(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const itemsToUpdate = displayItems
        .filter((it) => selectedProductIds.has(it.productId))
        .map((it) => ({
          productId: it.productId,
          newRetailPrice: it.effectivePrice,
        }));

      const res = await marginProtectionApi.applyRepricing(purchaseId, {
        items: itemsToUpdate,
        notifyOwner,
      });

      setSuccessMessage(res.message);
      if (onRepricingApplied) {
        onRepricingApplied(res.updatedCount);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'تعذر تطبيق الأسعار الجديدة');
    } finally {
      setApplying(false);
    }
  };

  const handlePrintShelfLabels = () => {
    window.print();
  };

  if (!open) return null;

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={t('purchases.margin_protection_modal.s0', "محرك حماية هامش الربح وتحديث الأسعار التلقائي")}
      subtitle={`فاتورة رقم #${analysis?.docNo || purchaseId} | المورد: ${analysis?.supplierName || '—'}`}
      maxWidth="1100px"
      footerActions={
        <StandardDialogFooter
          onCancel={onClose}
          cancelLabel={t('purchases.margin_protection_modal.s1', "إغلاق")}
          onSubmit={handleApply}
          submitLabel={applying ? t('purchases.margin_protection_modal.s2', "جاري التحديث...") : `تحديث أسعار ${selectedProductIds.size} صنفاً في الكاشير`}
          isSubmitting={applying}
          submitDisabled={applying || !selectedProductIds.size}
          extraActions={
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 700, color: '#334155' }}>
                <input
                  type="checkbox"
                  checked={notifyOwner}
                  onChange={(e) => setNotifyOwner(e.target.checked)}
                  style={{ accentColor: '#170e5e' }}
                />
                <MessageSquareIcon size={14} color="#16a34a" />
                <span>{t('purchases.margin_protection_modal.s3', "إرسال تقرير بالأسعار المحدثة على واتساب المالك")}</span>
              </label>
              <Button
                type="button"
                variant="secondary"
                onClick={handlePrintShelfLabels}
                disabled={!selectedProductIds.size}
                style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <TagIcon size={14} />
                <span>{t('purchases.margin_protection_modal.s4', "طباعة ملصقات الأسعار للأرفف")}</span>
              </Button>
            </div>
          }
        />
      }
    >
      <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Target Margin Controls & Overview Banner */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', alignItems: 'center', fontSize: '12px' }}>
          <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            <span style={{ color: '#64748b', display: 'block', marginBottom: '4px' }}>{t('purchases.margin_protection_modal.s5', "أصناف الفاتورة:")}</span>
            <span style={{ fontSize: '16px', fontWeight: 800, color: '#1e293b' }}>
              {analysis?.totalAffectedItems || 0} {t('purchases.margin_protection_modal.s6', "أصناف")}
            </span>
          </div>

          <div style={{ background: '#fef2f2', padding: '12px', borderRadius: '10px', border: '1px solid #fecaca' }}>
            <span style={{ color: '#dc2626', display: 'block', fontWeight: 700, marginBottom: '4px' }}>{t('purchases.margin_protection_modal.s7', "أصناف تحقق خسارة:")}</span>
            <span style={{ fontSize: '16px', fontWeight: 800, color: '#b91c1c' }}>
              {analysis?.lossMakingCount || 0} {t('purchases.margin_protection_modal.s8', "صنف (سعر البيع دون التكلفة!)")}
            </span>
          </div>

          <div style={{ background: '#fffbeb', padding: '12px', borderRadius: '10px', border: '1px solid #fde68a' }}>
            <span style={{ color: '#b45309', display: 'block', fontWeight: 700, marginBottom: '4px' }}>{t('purchases.margin_protection_modal.s9', "أصناف انخفض هامشها:")}</span>
            <span style={{ fontSize: '16px', fontWeight: 800, color: '#92400e' }}>
              {analysis?.marginCompressedCount || 0} {t('purchases.margin_protection_modal.s10', "صنف (دون 15%)")}
            </span>
          </div>

          <div style={{ background: '#eff6ff', padding: '12px', borderRadius: '10px', border: '1px solid #bfdbfe', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <label style={{ color: '#1e3a8a', display: 'block', fontWeight: 800, marginBottom: '4px' }}>
              {t('purchases.margin_protection_modal.s11', "هامش الربح المستهدف:")} <span style={{ color: '#1d4ed8', fontWeight: 900, fontSize: '14px' }}>{targetMargin}%</span>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="range"
                min="10"
                max="60"
                step="1"
                value={targetMargin}
                onChange={(e) => setTargetMargin(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#170e5e', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#1e3a8a', background: '#ffffff', padding: '2px 6px', borderRadius: '4px', border: '1px solid #93c5fd' }}>
                {targetMargin}%
              </span>
            </div>
          </div>
        </div>

        {/* Content Table */}
        <div style={{ overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#64748b', fontSize: '13px', fontWeight: 700 }}>
              {t('purchases.margin_protection_modal.s12', "جاري فحص تغيرات التكلفة واحتساب هوامش الربح المقترحة...")}
            </div>
          ) : errorMessage ? (
            <div style={{ padding: '12px 16px', borderRadius: '8px', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '13px', fontWeight: 700, marginBottom: '12px' }}>
              {errorMessage}
            </div>
          ) : displayItems.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
              {t('purchases.margin_protection_modal.s13', "لم يتم العثور على أصناف تتطلب إعادة تسعير في هذه الفاتورة.")}
            </div>
          ) : (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12.5px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '10px 14px', width: '40px', textAlign: 'center', fontWeight: 700 }}>
                      <input
                        type="checkbox"
                        checked={selectedProductIds.size === displayItems.length}
                        onChange={toggleSelectAll}
                        style={{ accentColor: '#170e5e' }}
                      />
                    </th>
                    <th style={{ padding: '10px 16px', fontWeight: 700 }}>{t('purchases.margin_protection_modal.s14', "اسم الصنف والباركود")}</th>
                    <th style={{ padding: '10px 16px', fontWeight: 700, textAlign: 'center' }}>{t('purchases.margin_protection_modal.s15', "التكلفة (السابقة ← الجديدة)")}</th>
                    <th style={{ padding: '10px 16px', fontWeight: 700, textAlign: 'center' }}>{t('purchases.margin_protection_modal.s16', "سعر البيع الحالي")}</th>
                    <th style={{ padding: '10px 16px', fontWeight: 700, textAlign: 'center' }}>{t('purchases.margin_protection_modal.s17', "الهامش الحالي")}</th>
                    <th style={{ padding: '10px 16px', fontWeight: 700, textAlign: 'center', backgroundColor: '#f0f9ff' }}>{t('purchases.margin_protection_modal.s18', "السعر المقترح للكاشير")}</th>
                    <th style={{ padding: '10px 16px', fontWeight: 700, textAlign: 'center' }}>{t('purchases.margin_protection_modal.s19', "الهامش بعد التعديل")}</th>
                  </tr>
                </thead>
                <tbody>
                  {displayItems.map((item) => {
                    const isSelected = selectedProductIds.has(item.productId);
                    const isCostIncreased = item.costChangePercent > 0;

                    return (
                      <tr
                        key={item.productId}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          backgroundColor: isSelected ? 'rgba(239, 246, 255, 0.5)' : '#ffffff',
                        }}
                      >
                        <td style={{ padding: '10px', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(item.productId)}
                            style={{ accentColor: '#170e5e' }}
                          />
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <div style={{ fontWeight: 700, color: '#0f172a' }}>{item.productName}</div>
                          <div style={{ fontSize: '10.5px', color: '#94a3b8', fontFamily: 'monospace' }}>{item.barcode}</div>
                        </td>
                        <td style={{ padding: '10px 16px', textAlign: 'center', fontFamily: 'monospace' }}>
                          <span style={{ color: '#94a3b8', textDecoration: 'line-through', fontSize: '11px' }}>
                            {formatCurrency(item.previousCost)}
                          </span>
                          <span style={{ margin: '0 6px', color: '#94a3b8' }}>←</span>
                          <span style={{ fontWeight: 800, color: '#0f172a' }}>
                            {formatCurrency(item.newCost)}
                          </span>
                          {isCostIncreased && (
                            <span style={{ display: 'block', fontSize: '10px', fontWeight: 800, color: '#dc2626' }}>
                              +{item.costChangePercent}%
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '10px 16px', textAlign: 'center', fontFamily: 'monospace', fontWeight: 700, color: '#334155' }}>
                          {formatCurrency(item.currentRetailPrice)}
                        </td>
                        <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 700,
                              backgroundColor: item.isLossMaking ? '#fee2e2' : item.isMarginCompressed ? '#fef3c7' : '#f1f5f9',
                              color: item.isLossMaking ? '#991b1b' : item.isMarginCompressed ? '#92400e' : '#334155',
                              border: item.isLossMaking ? '1px solid #fca5a5' : item.isMarginCompressed ? '1px solid #fcd34d' : '1px solid #e2e8f0',
                            }}
                          >
                            {item.isLossMaking ? t('purchases.margin_protection_modal.s20', "خسارة! ") : ''}
                            {item.currentMarginPercent}%
                          </span>
                        </td>
                        <td style={{ padding: '10px 16px', textAlign: 'center', backgroundColor: '#f0f9ff' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              step="0.5"
                              value={item.effectivePrice}
                              onChange={(e) => handlePriceChange(item.productId, Number(e.target.value))}
                              style={{
                                width: '90px',
                                height: '32px',
                                padding: '0 6px',
                                textAlign: 'center',
                                fontWeight: 800,
                                color: '#0f172a',
                                backgroundColor: '#ffffff',
                                border: '1px solid #93c5fd',
                                borderRadius: '6px',
                                outline: 'none',
                              }}
                            />
                            <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 700 }}>{currencySymbol}</span>
                          </div>
                        </td>
                        <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', fontWeight: 700, fontSize: '11px' }}>
                            {item.marginAfter}% (+{formatCurrency(item.profitAfter)})
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {successMessage && (
            <div style={{ marginTop: '16px', padding: '12px 16px', borderRadius: '8px', background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', fontSize: '12.5px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{successMessage}</span>
              <CheckIcon size={16} color="#16a34a" />
            </div>
          )}
        </div>

        {/* Printable Shelf Labels Container for @media print */}
        <div className="hidden print:block" style={{ padding: '16px', background: '#ffffff' }}>
          <div style={{ textAlign: 'center', fontWeight: 800, fontSize: '16px', marginBottom: '12px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
            {t('purchases.margin_protection_modal.s21', "بطاقات الأسعار وملصقات الأرفف المحدثة")}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            {displayItems
              .filter((it) => selectedProductIds.has(it.productId))
              .map((it) => (
                <div key={it.productId} style={{ border: '1px solid #94a3b8', padding: '12px', borderRadius: '6px', textAlign: 'center' }}>
                  <div style={{ fontWeight: 800, fontSize: '14px' }}>{it.productName}</div>
                  <div style={{ fontSize: '12px', fontFamily: 'monospace', margin: '4px 0' }}>{it.barcode}</div>
                  <div style={{ fontSize: '18px', fontWeight: 900, color: '#000000' }}>
                    {formatCurrency(it.effectivePrice)}
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </StandardDialog>
  );
}
