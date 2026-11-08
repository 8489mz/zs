import { useTranslation } from 'react-i18next';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/components/system-alert';
import { posApi } from '@/features/pos/api/pos.api';
import { salesApi } from '@/features/sales';
import { getNormalizedInvoiceSearchTerms, matchesSaleDocNo } from '@/features/pos/lib/pos-barcode-normalizer';
import { normalizeExchangeReturnSerials } from './pos-exchange-serial-validation';
import { invalidateSalesDomain } from '@/app/query-invalidation';
import { classifyExchangeRecovery, canResetExchangeRequest, type ExchangeOperationStatus } from './pos-exchange-recovery';
import type { PosWorkspaceState } from './posWorkspace.helpers';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';

type SourceSale = Awaited<ReturnType<typeof posApi.getSaleForExchange>>['sale'];

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
  const [refundMethod, setRefundMethod] = useState<'cash' | 'card' | 'store_credit'>('cash');
  const [pending, setPending] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const requestKey = useRef<string | null>(null);
  const submittedPayload = useRef<Record<string, unknown> | null>(null);

  // INV-FE1-FRONTEND-BOOK-DIGITS: exchange estimates round at the
  // tenant's book digits (settings currency, global fallback).
  const bookDigits = currencyMoneyDigits(pos.settings?.currency || pos.settingsQuery?.data?.currency || getGlobalSystemCurrency());
  const returned = (source?.items || []).filter((item) => Number(quantities[item.id] || 0) > 0);
  const returnEstimate = returned.reduce((sum, item) => sum +
    roundMoneyValue((Number(item.netLineTotal ?? item.total) + Number(item.allocatedTax || 0)) *
      Number(quantities[item.id]) / Number(item.qty), bookDigits), 0);
  const netEstimate = roundMoneyValue(Number(pos.totals.total || 0) - returnEstimate, bookDigits);

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
    if (!source || pending || !returned.length || !pos.cart.length || !managerPin.trim() ||
      !pos.ownOpenShift || Number(pos.loyaltyPointsRedeemed || 0) > 0 || pos.orderType === 'delivery') {
      toast.error('اختر فاتورة ومرتجعاً وبضاعة جديدة، وافتح وردية وأدخل رمز المشرف');
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
      managerPin: managerPin.trim(), note: `استبدال فاتورة ${source.id}`,
      items: [...items, ...negativeItems],
    };
    submittedPayload.current = payload;
    setAttempted(true);
    setPending(true);
    try {
      await posApi.createSale(payload, undefined, undefined, { 'x-idempotency-key': requestKey.current });
      toast.success('تم تسجيل الاستبدال والمرتجع في معاملة واحدة');
      pos.resetPosDraft();
      void invalidateSalesDomain(queryClient, { includeDashboard: true });
      requestKey.current = null;
      submittedPayload.current = null;
      setAttempted(false);
      setSource(null);
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

  return <DialogShell open={open} onClose={() => {
    if (pending) return;
    if (attempted) {
      toast.warning('يوجد استبدال لم يتم تأكيد نتيجته. أعد المحاولة بنفس الطلب قبل إغلاق النافذة');
      return;
    }
    onClose();
  }} width="min(700px, 96vw)" ariaLabel={t('pos.pos_workspace.pos_instant_exchange_dialog.s0', "استبدال فوري")}>
    <div dir="rtl" style={{ padding: 20, maxHeight: 'min(620px, 82vh)', overflowY: 'auto' }}>
      <h2>{t('pos.pos_workspace.pos_instant_exchange_dialog.s1', "استبدال فوري")}</h2>
      <p>{t('pos.pos_workspace.pos_instant_exchange_dialog.s2', "البضاعة الجديدة من سلة الكاشير، والمرتجع من فاتورة العميل الأصلية. يُحسب الصافي عند الاعتماد على السيرفر.")}</p>
      <label htmlFor="exchange-source">{t('pos.pos_workspace.pos_instant_exchange_dialog.s3', "رقم الفاتورة الأصلية")}</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input id="exchange-source" type="text" placeholder="مثال: Z-261023-0001 أو رقم الفاتورة" value={sourceId} onChange={(event) => setSourceId(event.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void loadSource(); } }} disabled={pending || attempted} />
        <Button type="button" onClick={() => { void loadSource(); }} disabled={pending || attempted}>{t('pos.pos_workspace.pos_instant_exchange_dialog.s4', "تحميل")}</Button>
      </div>
      {source && <>
        <p>{t('pos.pos_workspace.pos_instant_exchange_dialog.s5', "العميل:")} {source.customerId}{t('pos.pos_workspace.pos_instant_exchange_dialog.s6', "، الفاتورة:")} {source.id}</p>
        <h3>{t('pos.pos_workspace.pos_instant_exchange_dialog.s7', "السطور المرتجعة")}</h3>
        {source.items.map((item) => <div key={item.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 90px', gap: 8, marginBottom: 8 }}>
          <span>{item.name}{t('pos.pos_workspace.pos_instant_exchange_dialog.s8', "، المباع")} {item.qty}</span>
          <input type="number" min={0} max={item.qty} step="0.001" value={quantities[item.id] || 0}
          onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: Math.max(0, Math.min(Number(item.qty), Number(event.target.value) || 0)) }))} disabled={pending || attempted} />
          {Number(quantities[item.id] || 0) > 0 && item.serials?.length > 0 &&
            <input aria-label={`سيريالات ${item.name}`} placeholder={t('pos.pos_workspace.pos_instant_exchange_dialog.s9', "الأرقام التسلسلية مفصولة بفاصلة")} value={serials[item.id] || ''}
              onChange={(event) => setSerials((current) => ({ ...current, [item.id]: event.target.value }))} disabled={pending || attempted}
              style={{ gridColumn: '1 / -1' }} />}
        </div>)}
        <h3>{t('pos.pos_workspace.pos_instant_exchange_dialog.s10', "السطور الجديدة (")}{pos.cart.length})</h3>
        {pos.cart.map((item) => <div key={item.lineKey}>{item.name} × {item.qty}</div>)}
        <p>{t('pos.pos_workspace.pos_instant_exchange_dialog.s11', "تقدير المرتجع:")} {returnEstimate.toFixed(2)}{t('pos.pos_workspace.pos_instant_exchange_dialog.s12', "، تقدير الصافي:")} {netEstimate.toFixed(2)}</p>
        <label htmlFor="exchange-payment">{t('pos.pos_workspace.pos_instant_exchange_dialog.s13', "تحصيل الفرق الموجب")}</label>
        <select id="exchange-payment" value={paymentChannel} disabled={attempted} onChange={(event) => setPaymentChannel(event.target.value as 'cash' | 'card')}>
          <option value="cash">{t('pos.pos_workspace.pos_instant_exchange_dialog.s14', "نقدي")}</option><option value="card">{t('pos.pos_workspace.pos_instant_exchange_dialog.s15', "شبكة")}</option>
        </select>
        <label htmlFor="exchange-refund">{t('pos.pos_workspace.pos_instant_exchange_dialog.s16', "رد الفرق السالب")}</label>
        <select id="exchange-refund" value={refundMethod} disabled={attempted} onChange={(event) => setRefundMethod(event.target.value as 'cash' | 'card' | 'store_credit')}>
          <option value="cash">{t('pos.pos_workspace.pos_instant_exchange_dialog.s17', "حسب وسيلة الدفع الأصلية")}</option><option value="card">{t('pos.pos_workspace.pos_instant_exchange_dialog.s18', "شبكة أولاً")}</option><option value="store_credit">{t('pos.pos_workspace.pos_instant_exchange_dialog.s19', "رصيد متجر")}</option>
        </select>
        <label htmlFor="exchange-manager-pin">{t('pos.pos_workspace.pos_instant_exchange_dialog.s20', "رمز اعتماد المشرف")}</label>
        <input id="exchange-manager-pin" type="password" value={managerPin} onChange={(event) => setManagerPin(event.target.value)} disabled={pending || attempted} />
        <Button type="button" onClick={() => { void submit().catch((error: unknown) => toast.error(error instanceof Error ? error.message : t('pos.pos_workspace.pos_instant_exchange_dialog.s21', "بيانات الاستبدال غير صالحة"))); }}
          disabled={pending || !returned.length || !pos.cart.length || !managerPin.trim()}>
          {pending ? t('pos.pos_workspace.pos_instant_exchange_dialog.s22', "جارٍ التنفيذ...") : attempted ? t('pos.pos_workspace.pos_instant_exchange_dialog.s23', "التحقق من نتيجة الطلب") : t('pos.pos_workspace.pos_instant_exchange_dialog.s24', "اعتماد الاستبدال")}
        </Button>
      </>}
    </div>
  </DialogShell>;
}
