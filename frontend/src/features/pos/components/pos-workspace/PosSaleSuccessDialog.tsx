import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Field } from '@/shared/ui/field';
import { formatCurrency } from '@/lib/format';
import { formatSalePaymentText, paymentLabel } from '@/lib/pos-printing/shared';
import type { AppSettings, Customer, Sale } from '@/types/domain';
import { HardwareBridgeClient } from '@/features/pos/lib/hardware-bridge-client';

interface PosSaleSuccessDialogProps {
  open: boolean;
  sale: Sale | null;
  customer?: Customer | null;
  settings?: Partial<AppSettings> | null;
  onClose: () => void;
  onNewSale: () => void;
  onPrintReceipt: () => void;
  onPrintDualReceipt?: () => void;
  onPrintA4: () => void;
  onPrintKitchen?: () => void;
  onPrintBoth?: () => void;
}

function normalizeWhatsappPhone(phone: string) {
  return phone.replace(/[^\d+]/g, '').replace(/^\+/, '');
}

function buildWhatsappMessage(sale: Sale, settings?: Partial<AppSettings> | null) {
  const storeName = settings?.storeName || settings?.brandName || '';
  const invoiceNo = sale.docNo || sale.id || '';
  return [
    storeName ? `*${storeName}*` : '',
    `فاتورة رقم: ${invoiceNo}`,
    `التاريخ: ${sale.date ? new Date(sale.date).toLocaleString('ar-EG') : new Date().toLocaleString('ar-EG')}`,
    `الإجمالي: ${formatCurrency(Number(sale.total || 0))}`,
    'شكرا لتعاملكم معنا',
  ].filter(Boolean).join('\n');
}

export function PosSaleSuccessDialog({
  open,
  sale,
  customer,
  settings,
  onClose,
  onNewSale,
  onPrintReceipt,
  onPrintDualReceipt,
  onPrintA4,
  onPrintKitchen,
  onPrintBoth,
}: PosSaleSuccessDialogProps) {
  const { t: __t } = useTranslation();
  const { t } = useTranslation();
  const [printError, setPrintError] = useState('');
  const [whatsappError, setWhatsappError] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const lastKickedSaleId = useRef<string>('');
  const customerPhone = String(customer?.phone || '').trim();
  const showManualPhone = !customerPhone;
  const isDeliveryOrder = sale?.orderType === 'delivery';
  const hasDeliveryRep = Boolean(sale?.deliveryRepId || (sale as any)?.delivery_rep_id);
  const repName = (sale as any)?.deliveryRepName || (sale as any)?.delivery_rep_name;
  const collectionStatus = (sale as any)?.collectionStatus || (sale as any)?.collection_status;

  const changeAmount = Number(sale?.changeAmount || 0);
  const tenderedAmount = Number(sale?.tenderedAmount || 0);
  const paidAmount = Number(sale?.paidAmount || 0);
  const total = Number(sale?.total || 0);
  const deliveryFee = Number((sale as any)?.deliveryFee || (sale as any)?.delivery_fee || 0);
  const deliveryFeeMode = (sale as any)?.deliveryFeeMode || (sale as any)?.delivery_fee_mode;
  const remainingDebt = Math.max(0, total - paidAmount);
  const isFullyPaid = paidAmount + 0.009 >= total;
  const isCreditSale = sale?.paymentType === 'credit';
  const isCreditOrPartial = isCreditSale || (remainingDebt > 0.009 && !isDeliveryOrder);

  const isDeliveryCreditSale = isDeliveryOrder && isCreditSale;
  const isDeliveryCod = isDeliveryOrder && hasDeliveryRep && !isDeliveryCreditSale && (collectionStatus === 'cod' || !isFullyPaid);

  const paymentMethodLabel = isDeliveryCod
    ? `دليفري — تحصيل مع المندوب${repName ? ` (${repName})` : ''}`
    : isDeliveryOrder
      ? `دليفري — ${formatSalePaymentText(sale?.paymentType, sale?.paymentChannel, sale?.paidAmount, sale?.total)}`
      : formatSalePaymentText(sale?.paymentType, sale?.paymentChannel, sale?.paidAmount, sale?.total);

  function safePrint(printAction: () => void) {
    setPrintError('');
    try {
      printAction();
    } catch (error) {
      setPrintError(error instanceof Error ? error.message : 'تعذرت الطباعة. حاول مرة أخرى.');
    }
  }

  const openWhatsapp = useCallback((phone: string) => {
    if (!sale) return;
    setWhatsappError('');
    const normalizedPhone = normalizeWhatsappPhone(phone);
    if (!normalizedPhone) {
      setWhatsappError('أدخل رقم الهاتف لإرسال الفاتورة');
      return;
    }
    const url = `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(buildWhatsappMessage(sale, settings))}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [sale, settings]);

  const triggerWhatsapp = useCallback(() => {
    if (customerPhone) {
      openWhatsapp(customerPhone);
      return;
    }
    openWhatsapp(manualPhone);
  }, [customerPhone, manualPhone, openWhatsapp]);

  useEffect(() => {
    if (!open || !sale) return undefined;

    // Auto-kick cash drawer on cash sale in Electron desktop mode or local Hardware Bridge
    const isCashPayment = sale.payments?.length
      ? sale.payments.some((payment) => payment.paymentChannel === 'cash' && Number(payment.amount) > 0)
      : sale.paymentChannel === 'cash' && Number(sale.paidAmount) > 0;
    const saleKey = String(sale.id || sale.docNo || '');
    if (sale.status === 'posted' && isCashPayment && saleKey && lastKickedSaleId.current !== saleKey) {
      lastKickedSaleId.current = saleKey;
      if (typeof window !== 'undefined' && (window as any).electronPrinter?.kickCashDrawer) {
        void (window as any).electronPrinter.kickCashDrawer(settings?.posElectronCashierPrinter).catch(() => {});
      } else if (settings?.posCashDrawerPrinterEnabled === true) {
        // INV-DRAWER-KICK-500: the bridge being up does not mean a printer
        // is attached — kicking with no printer configured returns 500
        // from the bridge. Only kick when the merchant has set a cash
        // drawer printer as connected in Settings (printing tab).
        HardwareBridgeClient.isAvailable().then((avail) => {
          if (avail) {
            void HardwareBridgeClient.kickDrawer({ ip: (settings as any)?.posNetworkPrinterIp || '127.0.0.1' }).catch(() => {});
          }
        }).catch(() => {});
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleShortcut = (event: KeyboardEvent) => {
      if (!['F2', 'F3', 'F4', 'F8', 'F10', 'Escape'].includes(event.key)) return;

      // Do not intercept Alt+F4 (system window close)
      if (event.key === 'F4' && event.altKey) return;

      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'F2') {
        safePrint(onPrintReceipt);
        return;
      }
      if (event.key === 'F4') {
        safePrint(onPrintDualReceipt || onPrintReceipt);
        return;
      }
      if (event.key === 'F3') {
        onNewSale();
        return;
      }
      if (event.key === 'F8') {
        triggerWhatsapp();
        return;
      }
      if (event.key === 'F10') {
        safePrint(onPrintA4);
        return;
      }
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleShortcut, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleShortcut, true);
    };
  }, [onClose, onNewSale, onPrintA4, onPrintDualReceipt, onPrintReceipt, open, sale, triggerWhatsapp]);

  if (!open || !sale) return null;

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      width="min(760px, 95vw)"
      ariaLabel={__t('pos.pos_workspace.pos_sale_success_dialog.s0', __t('pos.pos_workspace.pos_sale_success_dialog.s0', "تم البيع بنجاح"))}
      autoFocus={false}
    >
      <div
        className="pos-sale-success-modal-shell pos-sale-success-dialog"
        dir="rtl"
        style={{
          maxHeight: 'calc(90vh - 32px)',
          overflowY: 'auto',
          background: '#ffffff',
          padding: '12px 14px',
        }}
      >
        <div className="pos-sale-success-head">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                background: '#ecfdf5',
                color: '#059669',
                border: '1px solid #a7f3d0',
                fontSize: '11px',
                fontWeight: 800,
                padding: '2px 8px',
                borderRadius: '9999px',
                display: 'inline-block'
              }}>
                {t('pos.operation_completed', 'عملية مكتملة')}
              </span>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>{t('pos.sale_completed', 'تم البيع بنجاح')}</h3>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>{t('pos.use_shortcuts_hint', 'استخدم الاختصارات لتنفيذ الإجراء بسرعة')}</p>
          </div>
          <div
            className="pos-sale-success-docno-badge"
            style={{
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              padding: '6px 12px',
              fontSize: '13px',
              fontWeight: 800,
              color: '#0f172a',
              fontFamily: 'monospace'
            }}
          >
            #{sale.docNo || sale.id}
          </div>
        </div>

        <div className="pos-sale-success-metrics">
          <span><b>{t('pos.invoice_no', 'رقم الفاتورة')}</b>{sale.docNo || sale.id}</span>
          <span><b>{t('pos.total', 'الإجمالي')}</b><strong style={{ color: '#0f172a' }}>{formatCurrency(Number(sale.total || 0))}</strong></span>
          <span><b>{t('pos.payment_method', 'طريقة الدفع')}</b>{paymentMethodLabel}</span>
          {isDeliveryOrder ? (
            isDeliveryCod ? (
              <>
                {paidAmount > 0 && <span><b>{__t('pos.pos_workspace.pos_sale_success_dialog.s1', __t('pos.pos_workspace.pos_sale_success_dialog.s1', "المدفوع مقدماً"))}</b>{formatCurrency(paidAmount)}</span>}
                <span><b>{__t('pos.pos_workspace.pos_sale_success_dialog.s2', __t('pos.pos_workspace.pos_sale_success_dialog.s2', "المطلوب تحصيله"))}</b><strong style={{ color: '#d97706' }}>{formatCurrency(remainingDebt)}</strong> {__t('pos.pos_workspace.pos_sale_success_dialog.s3', __t('pos.pos_workspace.pos_sale_success_dialog.s3', "(مع المندوب)"))}</span>
                <span><b>{__t('pos.pos_workspace.pos_sale_success_dialog.s4', __t('pos.pos_workspace.pos_sale_success_dialog.s4', "حالة التحصيل"))}</b><strong style={{ color: '#d97706' }}>{__t('pos.pos_workspace.pos_sale_success_dialog.s5', __t('pos.pos_workspace.pos_sale_success_dialog.s5', "عهدة مع المندوب"))}</strong></span>
                {repName && <span><b>{__t('pos.pos_workspace.pos_sale_success_dialog.s6', __t('pos.pos_workspace.pos_sale_success_dialog.s6', "المندوب"))}</b>{repName} {__t('pos.pos_workspace.pos_sale_success_dialog.s7', __t('pos.pos_workspace.pos_sale_success_dialog.s7', "(تحصيل وتسليم)"))}</span>}
              </>
            ) : isDeliveryCreditSale ? (
              <>
                {paidAmount > 0 && <span><b>{__t('pos.pos_workspace.pos_sale_success_dialog.s8', __t('pos.pos_workspace.pos_sale_success_dialog.s8', "المدفوع مقدماً"))}</b>{formatCurrency(paidAmount)}</span>}
                <span><b>{__t('pos.pos_workspace.pos_sale_success_dialog.s9', __t('pos.pos_workspace.pos_sale_success_dialog.s9', "المتبقي على العميل"))}</b><strong style={{ color: '#dc2626' }}>{formatCurrency(remainingDebt)}</strong></span>
                <span><b>{__t('pos.pos_workspace.pos_sale_success_dialog.s10', __t('pos.pos_workspace.pos_sale_success_dialog.s10', "حالة الفاتورة"))}</b><strong style={{ color: '#d97706' }}>{paidAmount === 0 ? __t('pos.pos_workspace.pos_sale_success_dialog.s11', __t('pos.pos_workspace.pos_sale_success_dialog.s11', "آجل بالكامل على حساب العميل")) : __t('pos.pos_workspace.pos_sale_success_dialog.s12', __t('pos.pos_workspace.pos_sale_success_dialog.s12', "سداد جزئي (متبقي آجل)"))}</strong></span>
                {repName && <span><b>{__t('pos.pos_workspace.pos_sale_success_dialog.s13', __t('pos.pos_workspace.pos_sale_success_dialog.s13', "المندوب"))}</b>{repName} {__t('pos.pos_workspace.pos_sale_success_dialog.s14', __t('pos.pos_workspace.pos_sale_success_dialog.s14', "(تسليم فقط — الحساب مسجل على العميل)"))}</span>}
                {deliveryFee > 0 && <span><b>{__t('pos.pos_workspace.pos_sale_success_dialog.s15', __t('pos.pos_workspace.pos_sale_success_dialog.s15', "أجرة التوصيل"))}</b>{formatCurrency(deliveryFee)} {__t('pos.pos_workspace.pos_sale_success_dialog.s16', __t('pos.pos_workspace.pos_sale_success_dialog.s16', "(على حساب العميل)"))}</span>}
              </>
            ) : (
              <>
                {paidAmount > 0 && <span><b>{__t('pos.pos_workspace.pos_sale_success_dialog.s17', __t('pos.pos_workspace.pos_sale_success_dialog.s17', "المدفوع"))}</b>{formatCurrency(paidAmount)}</span>}
                <span><b>{__t('pos.pos_workspace.pos_sale_success_dialog.s18', __t('pos.pos_workspace.pos_sale_success_dialog.s18', "حالة التحصيل"))}</b><strong style={{ color: '#16a34a' }}>{__t('pos.pos_workspace.pos_sale_success_dialog.s19', __t('pos.pos_workspace.pos_sale_success_dialog.s19', "مدفوع مسبقاً بالكامل"))}</strong></span>
                {repName && <span><b>{__t('pos.pos_workspace.pos_sale_success_dialog.s20', __t('pos.pos_workspace.pos_sale_success_dialog.s20', "المندوب"))}</b>{repName} {__t('pos.pos_workspace.pos_sale_success_dialog.s21', __t('pos.pos_workspace.pos_sale_success_dialog.s21', "(تسليم فقط)"))}</span>}
                {deliveryFee > 0 && deliveryFeeMode !== 'store_fleet' && collectionStatus !== 'cod' && collectionStatus !== 'prepaid_by_rep' && (collectionStatus === 'prepaid_online' || sale?.paymentChannel === 'wallet' || sale?.paymentChannel === 'instapay') && (
                  <span style={{ gridColumn: '1 / -1', background: '#fffbeb', padding: '8px 12px', borderRadius: '8px', border: '1px solid #fef3c7', color: '#92400e' }}>
                    <b>{__t('pos.pos_workspace.pos_sale_success_dialog.s22', __t('pos.pos_workspace.pos_sale_success_dialog.s22', "تسوية المندوب:"))}</b> {__t('pos.pos_workspace.pos_sale_success_dialog.s23', __t('pos.pos_workspace.pos_sale_success_dialog.s23', "تم صرف"))} {formatCurrency(deliveryFee)} {__t('pos.pos_workspace.pos_sale_success_dialog.s24', __t('pos.pos_workspace.pos_sale_success_dialog.s24', "نقداً من الدرج لأجرة التوصيل (الطلب مسدد أونلاين بالكامل)"))}
                  </span>
                )}
              </>
            )
          ) : isCreditOrPartial ? (
            <>
              <span><b>{t('pos.paid', 'المدفوع')}</b>{formatCurrency(paidAmount)}</span>
              <span><b>{t('pos.remaining_debt', 'المتبقي على العميل')}</b><strong style={{ color: '#dc2626' }}>{formatCurrency(remainingDebt)}</strong></span>
              <span><b>{t('pos.invoice_status', 'حالة الفاتورة')}</b><strong style={{ color: '#d97706' }}>{paidAmount === 0 ? __t('pos.pos_workspace.pos_sale_success_dialog.s25', __t('pos.pos_workspace.pos_sale_success_dialog.s25', "آجل بالكامل على حساب العميل")) : __t('pos.pos_workspace.pos_sale_success_dialog.s26', __t('pos.pos_workspace.pos_sale_success_dialog.s26', "سداد جزئي (متبقي آجل)"))}</strong></span>
            </>
          ) : (
            <>
              {tenderedAmount > 0 && <span><b>{t('pos.tendered', 'المستلم نقديًا')}</b>{formatCurrency(tenderedAmount)}</span>}
              {changeAmount > 0.009 && <span><b>{t('pos.change', 'الباقي للعميل')}</b><strong style={{ color: '#16a34a' }}>{formatCurrency(changeAmount)}</strong></span>}
              <span><b>{t('pos.invoice_status', 'حالة الفاتورة')}</b><strong style={{ color: '#16a34a' }}>{t('pos.paid_full', 'مدفوعة بالكامل')}</strong></span>
              {((sale as any).terminalAuthCode || (sale as any).terminal_auth_code) && (
                <span style={{ gridColumn: '1 / -1', background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '6px 12px', borderRadius: '8px', color: '#166534', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>
                    <b>{__t('pos.pos_workspace.pos_sale_success_dialog.s27', __t('pos.pos_workspace.pos_sale_success_dialog.s27', "دفع شبكة إلكتروني معتمد:"))}</b> {((sale as any).cardScheme === 'knet' ? __t('pos.pos_workspace.pos_sale_success_dialog.s28', __t('pos.pos_workspace.pos_sale_success_dialog.s28', "كي نت (KNET)")) : (sale as any).cardScheme === 'mada' ? __t('pos.pos_workspace.pos_sale_success_dialog.s29', __t('pos.pos_workspace.pos_sale_success_dialog.s29', "مدى (Mada)")) : ((sale as any).cardScheme || __t('pos.pos_workspace.pos_sale_success_dialog.s30', __t('pos.pos_workspace.pos_sale_success_dialog.s30', "بطاقة مصرفية"))))}
                    {((sale as any).cardLastFour || (sale as any).card_last_four) ? ` (**** ${((sale as any).cardLastFour || (sale as any).card_last_four)})` : ''}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 800 }}>
                    {__t('pos.pos_workspace.pos_sale_success_dialog.s31', __t('pos.pos_workspace.pos_sale_success_dialog.s31', "تفويض:"))} {((sale as any).terminalAuthCode || (sale as any).terminal_auth_code)}
                    {((sale as any).terminalRrn || (sale as any).terminal_rrn) ? ` | مرجع: ${((sale as any).terminalRrn || (sale as any).terminal_rrn)}` : ''}
                  </span>
                </span>
              )}
            </>
          )}
          <span><b>{t('pos.customer', 'العميل')}</b>{sale.customerName || customer?.name || (isDeliveryOrder ? __t('pos.pos_workspace.pos_sale_success_dialog.s32', __t('pos.pos_workspace.pos_sale_success_dialog.s32', "عميل دليفري")) : __t('pos.pos_workspace.pos_sale_success_dialog.s33', __t('pos.pos_workspace.pos_sale_success_dialog.s33', "عميل نقدي")))}</span>
          {Array.isArray(sale.payments) && sale.payments.length > 1 && (
            <span style={{ gridColumn: '1 / -1', background: '#f8fafc', padding: '6px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px' }}>
              <b>{__t('pos.pos_workspace.pos_sale_success_dialog.s34', __t('pos.pos_workspace.pos_sale_success_dialog.s34', "تفاصيل المدفوعات:"))}</b>{' '}
              {sale.payments.map((p) => `${paymentLabel(p.paymentChannel)}: ${formatCurrency(Number(p.amount || 0))}`).join(' + ')}
            </span>
          )}
        </div>

        {printError ? <div className="pos-sale-success-error">{printError}</div> : null}
        {whatsappError ? <div className="pos-sale-success-error">{whatsappError}</div> : null}

        <div className="pos-sale-success-actions-container" style={{ marginTop: '8px' }}>
          <div className="pos-sale-success-buttons-grid">
            <Button
              type="button"
              variant="success"
              onClick={onNewSale}
              className="pos-sale-success-btn-primary"
              style={{
                minHeight: '38px',
                fontSize: '13px',
                fontWeight: 800,
                borderRadius: '8px',
                padding: '4px 6px',
              }}
            >
              {t('pos.new_sale_f3', 'بيع جديد F3')}
            </Button>
            <Button
              type="button"
              onClick={() => safePrint(onPrintReceipt)}
              style={{
                minHeight: '36px',
                fontSize: '12px',
                fontWeight: 800,
                background: '#0f172a',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '4px 6px',
              }}
            >
              {t('pos.print_receipt_f2', 'طباعة ريسيت العميل F2')}
            </Button>
            {(isDeliveryOrder || onPrintDualReceipt) && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => safePrint(onPrintDualReceipt || onPrintReceipt)}
                style={{
                  minHeight: '36px',
                  fontWeight: 800,
                  fontSize: '12px',
                  background: '#f8fafc',
                  color: '#0f172a',
                  border: '1px solid #cbd5e1',
                  borderRadius: '8px',
                  padding: '3px 6px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1.2,
                }}
              >
                <span>{__t('pos.pos_workspace.pos_sale_success_dialog.s35', __t('pos.pos_workspace.pos_sale_success_dialog.s35', "طباعة نسختين"))}</span>
                {' '}
                <span style={{ fontSize: '10.5px', color: '#475569', fontWeight: 700 }}>{__t('pos.pos_workspace.pos_sale_success_dialog.s36', __t('pos.pos_workspace.pos_sale_success_dialog.s36', "(عميل + محل) F4"))}</span>
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={triggerWhatsapp}
              style={{
                minHeight: '34px',
                fontSize: '12px',
                fontWeight: 700,
                color: '#15803d',
                background: '#f0fdf4',
                borderColor: '#bbf7d0',
                borderRadius: '8px',
                padding: '4px 6px',
              }}
            >
              {__t('pos.pos_workspace.pos_sale_success_dialog.s37', __t('pos.pos_workspace.pos_sale_success_dialog.s37', "إرسال واتساب F8"))}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => safePrint(onPrintA4)}
              style={{
                minHeight: '34px',
                fontSize: '12px',
                fontWeight: 700,
                color: '#475569',
                background: '#f8fafc',
                borderColor: '#e2e8f0',
                borderRadius: '8px',
                padding: '4px 6px',
              }}
            >
              {__t('pos.pos_workspace.pos_sale_success_dialog.s38', __t('pos.pos_workspace.pos_sale_success_dialog.s38', "طباعة A4 F10"))}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              className="pos-sale-success-btn-close"
              style={{
                minHeight: '34px',
                fontSize: '12px',
                fontWeight: 700,
                color: '#64748b',
                background: '#f1f5f9',
                borderColor: '#cbd5e1',
                borderRadius: '8px',
                padding: '4px 6px',
              }}
            >
              {__t('pos.pos_workspace.pos_sale_success_dialog.s39', __t('pos.pos_workspace.pos_sale_success_dialog.s39', "إغلاق Esc"))}
            </Button>
          </div>

          {/* Kitchen Print Row if Enabled */}
          {settings?.posKitchenPrinterEnabled && onPrintKitchen && (
            <div className="pos-sale-success-kitchen-grid" style={{ display: 'grid', gridTemplateColumns: onPrintBoth ? '1fr 1fr' : '1fr', gap: '6px', width: '100%', marginTop: '4px' }}>
              <Button type="button" onClick={() => safePrint(onPrintKitchen)} style={{ minHeight: '36px', borderRadius: '8px', padding: '4px 6px', fontSize: '12px' }}>
                {__t('pos.pos_workspace.pos_sale_success_dialog.s40', __t('pos.pos_workspace.pos_sale_success_dialog.s40', "طباعة للمطبخ"))}
              </Button>
              {onPrintBoth && (
                <Button type="button" onClick={() => safePrint(onPrintBoth)} style={{ minHeight: '36px', borderRadius: '8px', padding: '4px 6px', fontSize: '12px' }}>
                  {__t('pos.pos_workspace.pos_sale_success_dialog.s41', __t('pos.pos_workspace.pos_sale_success_dialog.s41', "طباعة الريسيت والمطبخ"))}
                </Button>
              )}
            </div>
          )}
        </div>

        {showManualPhone ? (
          <div className="pos-sale-success-whatsapp" style={{ marginTop: '8px' }}>
            <Field label={__t('pos.pos_workspace.pos_sale_success_dialog.s42', __t('pos.pos_workspace.pos_sale_success_dialog.s42', "رقم الهاتف"))}>
              <input
                value={manualPhone}
                onChange={(event) => setManualPhone(event.target.value)}
                placeholder={__t('pos.pos_workspace.pos_sale_success_dialog.s43', __t('pos.pos_workspace.pos_sale_success_dialog.s43', "أدخل رقم الهاتف لإرسال الفاتورة"))}
              />
            </Field>
            <Button type="button" variant="secondary" onClick={() => openWhatsapp(manualPhone)}>{__t('pos.pos_workspace.pos_sale_success_dialog.s44', __t('pos.pos_workspace.pos_sale_success_dialog.s44', "إرسال مرة واحدة F8"))}</Button>
          </div>
        ) : null}
      </div>
    </DialogShell>
  );
}
