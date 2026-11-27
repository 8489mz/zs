import { useTranslation } from 'react-i18next';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { toast } from '@/shared/components/system-alert';
import { AlertTriangleIcon, ReceiptIcon } from '@/shared/components/icons/AppIcons';
import { posApi } from '@/features/pos/api/pos.api';
import { salesApi } from '@/shared/api/sales.api';
import { getNormalizedInvoiceSearchTerms, matchesSaleDocNo } from '@/features/pos/lib/pos-barcode-normalizer';
import { normalizeExchangeReturnSerials } from './pos-exchange-serial-validation';
import { invalidateSalesDomain } from '@/app/query-invalidation';
import { classifyExchangeRecovery, canResetExchangeRequest, type ExchangeOperationStatus } from './pos-exchange-recovery';
import type { PosWorkspaceState } from './posWorkspace.helpers';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { formatCurrency } from '@/lib/format';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { useAuthStore } from '@/stores/auth-store';
import '@/styles/partials/pos-exchange-dialog.css';

type SourceSale = Awaited<ReturnType<typeof posApi.getSaleForExchange>>['sale'];

function clampReturnQty(value: number, maxQty: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maxQty, Math.round(value * 1000) / 1000));
}

export function PosInstantExchangeDialog({ open, onClose, pos }: {
  open: boolean; onClose: () => void; pos: PosWorkspaceState;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [sourceId, setSourceId] = useState('');
  const [source, setSource] = useState<SourceSale | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [managerPin, setManagerPin] = useState('');
  const [paymentChannel, setPaymentChannel] = useState<'cash' | 'card'>('cash');
  // INV-SALE-RETURN-CASH-ONLY: an exchange remainder refunds in full
  // in cash from the drawer — no card option exists (there is no
  // Visa-refund mechanism). Store credit stays: it is the exchange
  // settlement mode, not a refund method.
  const [refundMethod, setRefundMethod] = useState<'cash' | 'store_credit'>('cash');
  const [pending, setPending] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const requestKey = useRef<string | null>(null);
  const submittedPayload = useRef<Record<string, unknown> | null>(null);

  const currencyCode = pos.settings?.currency || pos.settingsQuery?.data?.currency || getGlobalSystemCurrency();
  // INV-FE1-FRONTEND-BOOK-DIGITS: exchange estimates round at the
  // tenant's book digits (settings currency, global fallback).
  const bookDigits = currencyMoneyDigits(currencyCode);
  const returned = (source?.items || []).filter((item) => Number(quantities[item.id] || 0) > 0);
  const returnEstimate = returned.reduce((sum, item) => sum +
    roundMoneyValue((Number(item.netLineTotal ?? item.total) + Number(item.allocatedTax || 0)) *
      Number(quantities[item.id]) / Number(item.qty), bookDigits), 0);
  const cartTotal = roundMoneyValue(Number(pos.totals.total || 0), bookDigits);
  const netEstimate = roundMoneyValue(cartTotal - returnEstimate, bookDigits);
  const currentUser = useAuthStore((state) => state.user);
  const isAdminUser = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';
  const largeCashRefundThreshold = Number(
    (pos.settings as any)?.posLargeCashRefundThreshold ??
    (pos.settingsQuery?.data as any)?.posLargeCashRefundThreshold ??
    500
  );
  const estimatedCashRefund = netEstimate < -0.001 && refundMethod === 'cash' ? Math.abs(netEstimate) : 0;
  const requiresManagerPin = !isAdminUser && estimatedCashRefund >= largeCashRefundThreshold;

  const blockingPrereqMessage = !pos.ownOpenShift
    ? 'يجب فتح وردية كاشير قبل تنفيذ الاستبدال الفوري.'
    : pos.orderType === 'delivery'
      ? 'الاستبدال الفوري غير متاح أثناء تحديد نوع الطلب «توصيل / دليفري».'
      : Number(pos.loyaltyPointsRedeemed || 0) > 0
        ? 'ألغِ استبدال نقاط الولاء في السلة قبل تنفيذ الاستبدال الفوري.'
        : !pos.cart.length
          ? 'سلة الكاشير فارغة حالياً — أضف الأصناف البديلة في السلة لإتمام الاستبدال.'
          : '';

  const allSourceItemsSelected = Boolean(
    source && source.items.length > 0 && source.items.every((item) => Number(quantities[item.id] || 0) >= Number(item.qty))
  );

  function handleDialogClose() {
    if (pending) return;
    if (attempted) {
      toast.warning('يوجد استبدال لم يتم تأكيد نتيجته. أعد المحاولة بنفس الطلب قبل إغلاق النافذة');
      return;
    }
    onClose();
  }

  function setItemQuantity(itemId: string, maxQty: number, nextValue: number) {
    const clamped = clampReturnQty(nextValue, maxQty);
    setQuantities((current) => ({ ...current, [itemId]: clamped }));
  }

  function handleToggleSelectAll() {
    if (!source || pending || attempted) return;
    if (allSourceItemsSelected) {
      setQuantities({});
      return;
    }
    const next: Record<string, number> = {};
    for (const item of source.items) {
      next[item.id] = clampReturnQty(Number(item.qty), Number(item.qty));
    }
    setQuantities(next);
  }

  async function loadSource() {
    if (attempted) { toast.error('أعد محاولة نفس الطلب أولاً لمعرفة نتيجته قبل تحميل فاتورة أخرى'); return; }
    const rawQuery = String(sourceId || '').trim();
    const numericId = Number(rawQuery);
    if (!rawQuery) { toast.error('أدخل رقم الفاتورة الأصلية أو باركود الإيصال'); return; }
    setPending(true);
    try {
      let targetSaleId = Number.isInteger(numericId) && numericId > 0 ? numericId : 0;
      if (!targetSaleId) {
        const terms = getNormalizedInvoiceSearchTerms(rawQuery);
        const searchTerm = terms[0] || rawQuery;
        const page = await salesApi.listPage({ search: searchTerm, pageSize: 10 });
        const matched = (page.rows || []).find((s) => matchesSaleDocNo(s.docNo, rawQuery) || matchesSaleDocNo(s.docNo, searchTerm) || String(s.docNo || '').toLowerCase() === rawQuery.toLowerCase());
        if (matched) targetSaleId = Number(matched.id);
      }
      if (!targetSaleId) throw new Error('لم يتم العثور على الفاتورة المطلوبة');
      const result = await posApi.getSaleForExchange(targetSaleId);
      const sale = result.sale;
      if (sale.status !== 'posted' || !sale.customerId || String(sale.branchId) !== String(pos.branchId) ||
        Number(sale.total) - Number(sale.paidAmount) - Number(sale.storeCreditUsed || 0) > 0.001) {
        throw new Error('يلزم اختيار فاتورة مدفوعة لنفس الفرع وعميل مسجل');
      }
      setSource(sale);
      setQuantities({});
      setSerials({});
      requestKey.current = null;
      submittedPayload.current = null;
      setAttempted(false);
    } catch (error) {
      setSource(null);
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل الفاتورة الأصلية');
    } finally { setPending(false); }
  }

  async function submit() {
    if (!source || pending || !returned.length || !pos.cart.length || (requiresManagerPin && !managerPin.trim()) ||
      !pos.ownOpenShift || Number(pos.loyaltyPointsRedeemed || 0) > 0 || pos.orderType === 'delivery') {
      toast.error(requiresManagerPin
        ? 'اختر فاتورة ومرتجعاً وبضاعة جديدة، وافتح وردية وأدخل رمز المشرف'
        : 'اختر فاتورة ومرتجعاً وبضاعة جديدة، وتأكد من فتح وردية');
      return;
    }
    let negativeItems: Array<{ productId: number; originalSaleItemId: number;
      qty: number; price: number; serials: string[] }>;
    try {
      negativeItems = returned.map((item) => {
        const qty = Number(quantities[item.id]);
        const selected = normalizeExchangeReturnSerials(
          Array.isArray(item.serials) ? item.serials : [],
          String(serials[item.id] || ''), qty, item.name,
        );
        return { productId: Number(item.productId), originalSaleItemId: Number(item.id),
          qty: -qty, price: 0, serials: selected };
      });
    } catch (validationError) {
      toast.error(validationError instanceof Error ? validationError.message : 'راجع بيانات سيريالات المرتجع');
      return;
    }
    const items = pos.cart.map((item) => ({
      productId: Number(item.productId), qty: Number(item.qty), price: Number(item.price),
      unitName: item.unitName, unitMultiplier: Number(item.unitMultiplier || 1),
      priceType: item.priceType, notes: item.notes, modifiers: item.modifiers,
      serials: item.serials || [],
    }));
    requestKey.current ||= crypto.randomUUID();
    const payload = submittedPayload.current || {
      exchangeSaleId: Number(source.id), exchangeRefundMethod: refundMethod,
      customerId: Number(source.customerId), branchId: Number(pos.branchId), source: 'pos',
      paymentType: 'cash', paymentChannel, payments: [], tenderedAmount: 0,
      discount: Number(pos.discount || 0), deliveryFee: 0, taxRate: Number(pos.totals.taxRate || 0),
      pricesIncludeTax: Boolean(pos.totals.pricesIncludeTax),
      managerPin: requiresManagerPin ? managerPin.trim() : (managerPin.trim() || undefined), note: `استبدال فاتورة ${source.docNo || source.id}`,
      items: [...items, ...negativeItems],
    };
    submittedPayload.current = payload;
    setAttempted(true);
    setPending(true);
    try {
      await posApi.createSale(payload, undefined, { 'x-idempotency-key': requestKey.current });
      toast.success('تم تسجيل الاستبدال والمرتجع في معاملة واحدة');
      pos.resetPosDraft();
      void invalidateSalesDomain(queryClient, { includeDashboard: true });
      requestKey.current = null;
      submittedPayload.current = null;
      setAttempted(false);
      setSource(null);
      setManagerPin('');
      onClose();
    } catch (error) {
      const httpStatus = typeof error === 'object' && error !== null && 'status' in error
        ? Number((error as { status?: number }).status) : 0;
      let operationStatus: ExchangeOperationStatus = 'unknown';
      // A failed HTTP response is not proof of a failed sale. The server might
      // already have committed the atomic exchange and lost the response.
      try {
        const operation = await posApi.getSaleOperationStatus(requestKey.current!);
        operationStatus = classifyExchangeRecovery(operation);
      } catch {
        // Keep the same payload and idempotency key while outcome is unknown.
      }
      if (operationStatus === 'committed') {
        toast.success('تم تأكيد تسجيل الاستبدال من سجل العمليات');
        pos.resetPosDraft();
        void invalidateSalesDomain(queryClient, { includeDashboard: true });
        requestKey.current = null;
        submittedPayload.current = null;
        setAttempted(false);
        setSource(null);
        setManagerPin('');
        onClose();
      } else if (canResetExchangeRequest(httpStatus, operationStatus)) {
        // Rejection was recorded or the operation never reached the server:
        // user may correct inputs and submit a genuinely new attempt.
        requestKey.current = null;
        submittedPayload.current = null;
        setAttempted(false);
        toast.error(error instanceof Error ? error.message : 'تعذر تنفيذ الاستبدال');
      } else {
        toast.warning('حالة الاستبدال غير مؤكدة. لا تنشئ طلباً جديداً؛ أعد المحاولة بنفس الطلب للتحقق من النتيجة');
      }
    } finally { setPending(false); }
  }

  const netBoxClass = netEstimate > 0.001
    ? 'is-collect'
    : netEstimate < -0.001
      ? 'is-refund'
      : 'is-even';
  const netBoxLabel = netEstimate > 0.001
    ? 'تحصيل من العميل'
    : netEstimate < -0.001
      ? 'رد للعميل'
      : 'متعادل';

  const paymentOptions = [
    { value: 'cash', label: t('pos.pos_workspace.pos_instant_exchange_dialog.s14', 'نقدي') },
    { value: 'card', label: t('pos.pos_workspace.pos_instant_exchange_dialog.s15', 'شبكة') },
  ];
  const refundOptions = [
    { value: 'cash', label: t('pos.pos_workspace.pos_instant_exchange_dialog.s17', 'نقدي') },
    { value: 'store_credit', label: t('pos.pos_workspace.pos_instant_exchange_dialog.s19', 'رصيد متجر') },
  ];

  return (
    <StandardDialog
      open={open}
      onClose={handleDialogClose}
      title={t('pos.pos_workspace.pos_instant_exchange_dialog.s1', 'استبدال فوري')}
      subtitle={t('pos.pos_workspace.pos_instant_exchange_dialog.s2', 'البضاعة الجديدة من سلة الكاشير، والمرتجع من فاتورة العميل الأصلية. يُحسب الصافي عند الاعتماد على السيرفر.')}
      width="min(1020px, 95vw)"
      height="min(600px, calc(100vh - 24px))"
      compact
      shellClassName="pos-exchange-dialog-shell"
      closeOnBackdrop={!pending && !attempted}
      bodyStyle={{ overflow: 'visible', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1, minHeight: 0 }}
      footerActions={(
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={handleDialogClose}
            disabled={pending}
          >
            إلغاء
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              void submit().catch((error: unknown) => toast.error(
                error instanceof Error
                  ? error.message
                  : t('pos.pos_workspace.pos_instant_exchange_dialog.s21', 'بيانات الاستبدال غير صالحة')
              ));
            }}
            disabled={!source || pending || !returned.length || !pos.cart.length || (requiresManagerPin && !managerPin.trim())}
          >
            {pending
              ? t('pos.pos_workspace.pos_instant_exchange_dialog.s22', 'جارٍ التنفيذ...')
              : attempted
                ? t('pos.pos_workspace.pos_instant_exchange_dialog.s23', 'التحقق من نتيجة الطلب')
                : t('pos.pos_workspace.pos_instant_exchange_dialog.s24', 'اعتماد الاستبدال')}
          </Button>
        </>
      )}
    >
      <div className="pos-exchange-dialog-body" dir="rtl">
        <div className="pos-exchange-search-bar">
          <div className="pos-exchange-search-group">
            <label htmlFor="exchange-source" className="pos-exchange-search-label">
              {t('pos.pos_workspace.pos_instant_exchange_dialog.s3', 'رقم الفاتورة الأصلية')}
            </label>
            <input
              id="exchange-source"
              type="text"
              className="pos-exchange-search-input"
              placeholder="مثال: Z-261116-0001 أو رقم الفاتورة"
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void loadSource();
                }
              }}
              disabled={pending || attempted}
            />
            <Button
              type="button"
              variant="primary"
              onClick={() => { void loadSource(); }}
              disabled={pending || attempted}
            >
              {t('pos.pos_workspace.pos_instant_exchange_dialog.s4', 'تحميل')}
            </Button>
          </div>

          {source && (
            <div className="pos-exchange-source-meta">
              <span className="pos-exchange-meta-pill">
                <span>{t('pos.pos_workspace.pos_instant_exchange_dialog.s6', 'الفاتورة:').replace(/^[،,\s]+/, '')}</span>
                <strong>{source.docNo || source.id}</strong>
              </span>
              <span className="pos-exchange-meta-pill">
                <span>{t('pos.pos_workspace.pos_instant_exchange_dialog.s5', 'العميل:')}</span>
                <strong>{source.customerName || source.customerId}</strong>
              </span>
              <span className="pos-exchange-meta-pill">
                <span>الإجمالي:</span>
                <strong>{formatCurrency(source.total, currencyCode)}</strong>
              </span>
            </div>
          )}
        </div>

        {blockingPrereqMessage && (
          <div className="pos-exchange-prereq-banner" role="alert">
            <AlertTriangleIcon size={16} />
            <span>{blockingPrereqMessage}</span>
          </div>
        )}

        {!source ? (
          <div className="pos-exchange-empty-stage">
            <div className="pos-exchange-empty-icon">
              <ReceiptIcon size={24} />
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#0f172a' }}>
              أدخل رقم الفاتورة الأصلية المدفوعة ثم اضغط «تحميل»
            </div>
            <div style={{ fontSize: '0.79rem', fontWeight: 600, color: '#64748b', maxWidth: '460px', lineHeight: 1.5 }}>
              السطور المختارة كمرتجع ستُخصم من قيمة السلة الجديدة ({pos.cart.length} صنف بقيمة {formatCurrency(cartTotal, currencyCode)}) في قيد استبدال ومرتجع واحد على السيرفر.
            </div>
          </div>
        ) : (
          <div className="pos-exchange-workspace">
            {/* Right column in RTL: Returned items from source invoice */}
            <div className="pos-exchange-column">
              <div className="pos-exchange-panel is-fill">
                <div className="pos-exchange-panel-header">
                  <h3 className="pos-exchange-panel-title">
                    <span className="pos-exchange-accent-bar" />
                    <span>{t('pos.pos_workspace.pos_instant_exchange_dialog.s7', 'السطور المرتجعة')}</span>
                    <span style={{ fontSize: '0.73rem', fontWeight: 700, color: '#64748b' }}>
                      ({returned.length} / {source.items.length})
                    </span>
                  </h3>
                  <button
                    type="button"
                    className="pos-exchange-quick-btn"
                    onClick={handleToggleSelectAll}
                    disabled={pending || attempted || source.items.length === 0}
                  >
                    {allSourceItemsSelected ? 'تصفير الكل' : 'استرجاع الكل'}
                  </button>
                </div>

                <div className="pos-exchange-items-scroll thin-scrollbar">
                  {source.items.map((item) => {
                    const currentQty = Number(quantities[item.id] || 0);
                    const maxQty = Number(item.qty || 0);
                    const lineGross = roundMoneyValue(
                      Number(item.netLineTotal ?? item.total) + Number(item.allocatedTax || 0),
                      bookDigits
                    );
                    const selectedReturnValue = maxQty > 0 && currentQty > 0
                      ? roundMoneyValue((lineGross * currentQty) / maxQty, bookDigits)
                      : 0;
                    const hasSerials = Array.isArray(item.serials) && item.serials.length > 0;

                    return (
                      <div
                        key={item.id}
                        className={`pos-exchange-return-row ${currentQty > 0 ? 'is-selected' : ''}`}
                      >
                        <div className="pos-exchange-return-top">
                          <div className="pos-exchange-item-info">
                            <div className="pos-exchange-item-name">{item.name}</div>
                            <div className="pos-exchange-item-sub">
                              {t('pos.pos_workspace.pos_instant_exchange_dialog.s8', 'المباع').replace(/^[،,\s]+/, '')}: {item.qty} • القيمة: {formatCurrency(lineGross, currencyCode)}
                              {currentQty > 0 ? ` • مرتجع: ${formatCurrency(selectedReturnValue, currencyCode)}` : ''}
                            </div>
                          </div>

                          {/* Strict RTL Stepper Standard: [+] (qty) [-] */}
                          <div className="pos-exchange-stepper">
                            <button
                              type="button"
                              className="pos-exchange-stepper-btn"
                              aria-label={`زيادة كمية المرتجع ${item.name}`}
                              onClick={() => setItemQuantity(item.id, maxQty, currentQty + 1)}
                              disabled={pending || attempted || currentQty >= maxQty}
                            >
                              +
                            </button>
                            <input
                              type="number"
                              className="no-spin-arrows pos-exchange-qty-input"
                              aria-label={`كمية المرتجع ${item.name}`}
                              min={0}
                              max={item.qty}
                              step="0.001"
                              value={quantities[item.id] ?? 0}
                              onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
                              onFocus={(e) => e.currentTarget.select()}
                              onChange={(event) => setItemQuantity(item.id, maxQty, Number(event.target.value) || 0)}
                              disabled={pending || attempted}
                            />
                            <button
                              type="button"
                              className="pos-exchange-stepper-btn"
                              aria-label={`إنقاص كمية المرتجع ${item.name}`}
                              onClick={() => setItemQuantity(item.id, maxQty, currentQty - 1)}
                              disabled={pending || attempted || currentQty <= 0}
                            >
                              -
                            </button>
                          </div>
                        </div>

                        {currentQty > 0 && hasSerials && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>
                              السيريالات الأصلية: {item.serials.join('، ')}
                            </span>
                            <input
                              aria-label={`سيريالات ${item.name}`}
                              className="pos-exchange-serial-input"
                              placeholder={t('pos.pos_workspace.pos_instant_exchange_dialog.s9', 'الأرقام التسلسلية مفصولة بفاصلة')}
                              value={serials[item.id] || ''}
                              onChange={(event) => setSerials((current) => ({ ...current, [item.id]: event.target.value }))}
                              disabled={pending || attempted}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Left column in RTL: New cart items + settlement options + supervisor PIN */}
            <div className="pos-exchange-column">
              <div className="pos-exchange-panel is-fill">
                <div className="pos-exchange-panel-header">
                  <h3 className="pos-exchange-panel-title">
                    <span className="pos-exchange-accent-bar" />
                    <span>{t('pos.pos_workspace.pos_instant_exchange_dialog.s10', 'السطور الجديدة (')}{pos.cart.length})</span>
                  </h3>
                  <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#170e5e' }}>
                    {formatCurrency(cartTotal, currencyCode)}
                  </span>
                </div>

                <div className="pos-exchange-items-scroll thin-scrollbar">
                  {pos.cart.length === 0 ? (
                    <div style={{ fontSize: '0.78rem', color: '#991b1b', fontWeight: 600, padding: '8px' }}>
                      سلة الكاشير فارغة. أضف أصنافاً جديدة في السلة أولاً.
                    </div>
                  ) : (
                    pos.cart.map((item) => {
                      const lineTotal = roundMoneyValue(Number(item.qty) * Number(item.price), bookDigits);
                      return (
                        <div key={item.lineKey} className="pos-exchange-new-row">
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {item.name}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>
                              {item.qty} {item.unitName || ''} × {formatCurrency(item.price, currencyCode)}
                            </div>
                          </div>
                          <strong style={{ fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>
                            {formatCurrency(lineTotal, currencyCode)}
                          </strong>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="pos-exchange-panel is-settlement">
                <div className="pos-exchange-kpi-grid">
                  <div className="pos-exchange-kpi-box">
                    <div className="pos-exchange-kpi-label">
                      {t('pos.pos_workspace.pos_instant_exchange_dialog.s11', 'تقدير المرتجع:').replace(/[:：\s]+$/, '')}
                    </div>
                    <div className="pos-exchange-kpi-value">{formatCurrency(returnEstimate, currencyCode)}</div>
                  </div>
                  <div className="pos-exchange-kpi-box">
                    <div className="pos-exchange-kpi-label">البضاعة الجديدة</div>
                    <div className="pos-exchange-kpi-value">{formatCurrency(cartTotal, currencyCode)}</div>
                  </div>
                  <div className={`pos-exchange-kpi-box ${netBoxClass}`}>
                    <div className="pos-exchange-kpi-label">
                      {t('pos.pos_workspace.pos_instant_exchange_dialog.s12', 'تقدير الصافي:').replace(/^[،,\s]+|[:：\s]+$/g, '')} ({netBoxLabel})
                    </div>
                    <div className="pos-exchange-kpi-value">{formatCurrency(Math.abs(netEstimate), currencyCode)}</div>
                  </div>
                </div>

                <div className="pos-exchange-settlement-grid">
                  <div className="pos-exchange-field">
                    <label>{t('pos.pos_workspace.pos_instant_exchange_dialog.s13', 'تحصيل الفرق الموجب')}</label>
                    <CustomSelect
                      value={paymentChannel}
                      onChange={(val) => setPaymentChannel(val as 'cash' | 'card')}
                      options={paymentOptions}
                      searchable={false}
                      disabled={attempted || pending}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div className="pos-exchange-field">
                    <label>{t('pos.pos_workspace.pos_instant_exchange_dialog.s16', 'رد الفرق السالب')}</label>
                    <CustomSelect
                      value={refundMethod}
                      onChange={(val) => setRefundMethod(val as 'cash' | 'store_credit')}
                      options={refundOptions}
                      searchable={false}
                      disabled={attempted || pending}
                      dropdownAlign="left"
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>

                {requiresManagerPin && (
                  <div className="pos-exchange-field">
                    <label htmlFor="exchange-manager-pin">
                      {t('pos.pos_workspace.pos_instant_exchange_dialog.s20', 'رمز اعتماد المشرف')}
                    </label>
                    <input
                      id="exchange-manager-pin"
                      type="text"
                      name="exchange_supervisor_pin"
                      className="pos-exchange-pin-input secure-password-field"
                      autoComplete="off"
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-form-type="other"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      placeholder="أدخل رمز المشرف لاعتماد المعاملة"
                      value={managerPin}
                      onChange={(event) => setManagerPin(event.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && source && !pending && returned.length > 0 && pos.cart.length > 0 && managerPin.trim()) {
                          e.preventDefault();
                          void submit().catch((error: unknown) => toast.error(
                            error instanceof Error
                              ? error.message
                              : t('pos.pos_workspace.pos_instant_exchange_dialog.s21', 'بيانات الاستبدال غير صالحة')
                          ));
                        }
                      }}
                      disabled={pending || attempted}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </StandardDialog>
  );
}
