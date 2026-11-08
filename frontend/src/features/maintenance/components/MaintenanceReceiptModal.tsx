import { useTranslation } from 'react-i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { useState } from 'react';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Button } from '@/shared/ui/button';
import { ReceiptIcon, TagIcon, FileTextIcon, MessageSquareIcon, PrinterIcon } from '@/shared/components/icons/AppIcons';
import { buildCode128Svg } from '@/lib/barcode';
import type { MaintenanceTicket } from '@/types/domain-models/maintenance';
import type { AppSettings } from '@/types/domain';
import { getMaintenanceProfile } from '../constants/maintenance-profiles';
import {
  printMaintenanceReceipt,
  printMaintenanceDeviceSticker as printMaintenanceSticker,
  exportMaintenanceReceiptPdf,
} from '../utils/maintenance-receipt.utils';

export { printMaintenanceReceipt };

interface MaintenanceReceiptModalProps {
  open: boolean;
  ticket: MaintenanceTicket | null;
  settings?: AppSettings | null;
  onClose: () => void;
}

export function MaintenanceReceiptModal({ open, ticket, settings, onClose }: MaintenanceReceiptModalProps) {
  const { t } = useTranslation();
  const [printMode, setPrintMode] = useState<'receipt' | 'sticker'>('receipt');
  const [stickerPreset, setStickerPreset] = useState<'50x30' | '50x25' | '40x30' | '60x40' | '80-roll'>('50x30');
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  if (!open || !ticket) return null;

  const handlePrint = () => {
    if (printMode === 'receipt') {
      printMaintenanceReceipt(ticket, settings);
    } else {
      printMaintenanceSticker(ticket, settings, stickerPreset);
    }
  };

  const handleDownloadPdf = async () => {
    try {
      setIsExportingPdf(true);
      await exportMaintenanceReceiptPdf(ticket, settings);
    } catch (err) {
      console.error('Failed to export PDF:', err);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleSendWhatsApp = async () => {
    // 1. Download PDF automatically for attaching
    try {
      setIsExportingPdf(true);
      await exportMaintenanceReceiptPdf(ticket, settings);
    } catch (err) {
      console.warn('PDF export failed during WhatsApp share:', err);
    } finally {
      setIsExportingPdf(false);
    }

    // 2. Open WhatsApp Web with customer
    let phoneFormatted = ticket.customerPhone.trim().replace(/\D/g, '');
    if (phoneFormatted.startsWith('01')) {
      phoneFormatted = '20' + phoneFormatted.substring(1);
    }
    const storeName = settings?.storeName || 'مخازن رجب العطار';
    const totalCost = ticket.finalCost || ticket.expectedCost || 0;
    /* D-M1-1: no discount concept — the final agreed amount is the total. */
    const netTotal = totalCost;
    const advancePaid = ticket.advancePayment || 0;
    const remaining = ticket.status === 'delivered' ? 0 : Math.max(0, netTotal - advancePaid);

    const lines = [
      `*إيصال استلام جهاز صيانة*`,
      `----------------------------------------`,
      `مرحباً بك أستاذ *${ticket.customerName}*`,
      `معك *${storeName}* بخصوص جهازك:`,
      ``,
      `- *الجهاز:* ${ticket.deviceBrand ? `${ticket.deviceBrand} - ` : ''}${ticket.deviceModel}`,
      `- *كود الجهاز:* ${ticket.ticketNo}`,
      `- *العطل المسجل:* ${ticket.problemDescription}`,
      ``,
      `- *إجمالي قيمة الإصلاح:* ${totalCost.toFixed(2)} ${getGlobalCurrencySymbol()}`,
      ...(advancePaid > 0 ? [`- *المدفوع مقدماً (عربون):* ${advancePaid.toFixed(2)} ${getGlobalCurrencySymbol()}`] : []),
      `- *المتبقي عند الاستلام:* ${remaining.toFixed(2)} ${getGlobalCurrencySymbol()} ${ticket.status === 'delivered' ? '(خالص بالكامل)' : ''}`,
      `----------------------------------------`,
      `- *تم إرفاق إيصال الاستلام الرسمي بصيغة PDF.*`,
      ``,
      `*شروط الاستلام:*`,
      `- يرجى الاحتفاظ بكود الاستلام (${ticket.ticketNo}) للاستعلام عن الجهاز.`,
      `- لا يتم تسليم الجهاز إلا من خلال رقم الهاتف المسجل أو إثبات الشخصية.`,
      `- فترة الضمان على قطع الغيار ${ticket.warrantyDays || 30} يوماً من تاريخ الإصلاح.`,
      `----------------------------------------`,
      `*نسعد دائماً بخدمتكم!*`,
    ];

    const url = `https://api.whatsapp.com/send/?phone=${phoneFormatted}&text=${encodeURIComponent(lines.join('\n'))}`;
    window.open(url, '_blank');
  };

  const profile = getMaintenanceProfile(settings?.maintenanceProfile);
  const barcodeSvg = buildCode128Svg(ticket.ticketNo);
  /* D-M1-1: no discount concept — the final agreed amount is the total. */
  const totalCost = ticket.finalCost || ticket.expectedCost || 0;
  const netTotal = totalCost;
  const advancePaid = ticket.advancePayment || 0;
  const collectedAtDelivery = Math.max(0, netTotal - advancePaid);
  const remainingAmount = ticket.status === 'delivered' ? 0 : Math.max(0, netTotal - advancePaid);

  return (
    <DialogShell open={open} onClose={onClose} width="min(580px, 95vw)" ariaLabel={t('maintenance.maintenance_receipt_modal.s0', "طباعة إيصال استلام الصيانة والستيكر")}>
      <div className="page-stack" dir="rtl" style={{ gap: '14px', maxWidth: '540px', margin: '0 auto', padding: '14px 18px' }}>
        {/* Top Header & Actions Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px' }}>
          {/* Right: Tabs */}
          <div style={{ display: 'flex', gap: '4px', background: '#f1f5f9', padding: '3px', borderRadius: '8px' }}>
            <button
              type="button"
              onClick={() => setPrintMode('receipt')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                background: printMode === 'receipt' ? '#fff' : 'transparent',
                fontWeight: printMode === 'receipt' ? 800 : 500,
                color: printMode === 'receipt' ? '#0f172a' : '#64748b',
                boxShadow: printMode === 'receipt' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                cursor: 'pointer',
                fontSize: '0.85rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <ReceiptIcon size={16} /> {t('maintenance.maintenance_receipt_modal.s1', "إيصال العميل")}
            </button>
            <button
              type="button"
              onClick={() => setPrintMode('sticker')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                background: printMode === 'sticker' ? '#fff' : 'transparent',
                fontWeight: printMode === 'sticker' ? 800 : 500,
                color: printMode === 'sticker' ? '#0f172a' : '#64748b',
                boxShadow: printMode === 'sticker' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                cursor: 'pointer',
                fontSize: '0.85rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <TagIcon size={16} /> {t('maintenance.maintenance_receipt_modal.s2', "ستيكر ظهر الجهاز")}
            </button>
          </div>

          {/* Left: Actions (PDF, WhatsApp, Print) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {printMode === 'receipt' && (
              <>
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={isExportingPdf}
                  className="btn btn-sm btn-secondary"
                  style={{ fontWeight: 700, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}
                  title={t('maintenance.maintenance_receipt_modal.s3', "تنزيل الإيصال كملف PDF")}
                >
                  <FileTextIcon size={14} />
                  <span>{isExportingPdf ? t('maintenance.maintenance_receipt_modal.s4', "جاري التحميل...") : 'PDF'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleSendWhatsApp}
                  disabled={isExportingPdf}
                  className="btn btn-sm"
                  style={{ background: '#22c55e', color: '#fff', border: 'none', fontWeight: 700, padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                  title={t('maintenance.maintenance_receipt_modal.s5', "إرسال عبر واتساب مع تحميل ملف PDF")}
                >
                  <span>{t('maintenance.maintenance_receipt_modal.s6', "واتساب")}</span>
                  <MessageSquareIcon size={14} color="#ffffff" />
                </button>
              </>
            )}
            <Button variant="primary" onClick={handlePrint} style={{ fontWeight: 800, padding: '6px 14px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <PrinterIcon size={16} color="#ffffff" />
              <span>{printMode === 'receipt' ? t('maintenance.maintenance_receipt_modal.s7', "طباعة (80mm)") : t('maintenance.maintenance_receipt_modal.s8', "طباعة الستيكر")}</span>
            </Button>
          </div>
        </div>

        {printMode === 'receipt' ? (
          /* Standard Customer Receipt Preview */
          <div
            className="maintenance-printable-receipt"
            style={{
              background: '#fff',
              border: '1px dashed #94a3b8',
              borderRadius: '8px',
              padding: '16px',
              fontSize: '0.85rem',
              lineHeight: 1.5,
              color: '#0f172a',
            }}
          >
            {/* Header */}
            <div style={{ textAlign: 'center', borderBottom: '1px dashed #94a3b8', paddingBottom: '12px', marginBottom: '12px' }}>
              <h2 style={{ margin: '0 0 4px', fontSize: '1.3rem', fontWeight: 800 }}>{settings?.storeName || t('maintenance.maintenance_receipt_modal.s9', "مركز الصيانة")}</h2>
              {settings?.phone && <div style={{ fontSize: '0.85rem', color: '#475569' }}>{t('maintenance.maintenance_receipt_modal.s10', "هاتف:")} {settings.phone}</div>}
              {settings?.address && <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{settings.address}</div>}
              <div style={{ marginTop: '8px', display: 'inline-block', background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                {t('maintenance.maintenance_receipt_modal.s11', "إيصال استلام جهاز للإصلاح")}
              </div>
            </div>

            {/* Barcode & Ticket No */}
            <div style={{ textAlign: 'center', padding: '6px 0 10px', borderBottom: '1px dashed #cbd5e1', marginBottom: '12px' }}>
              <div style={{ width: '230px', height: '48px', margin: '0 auto 6px' }} dangerouslySetInnerHTML={{ __html: barcodeSvg }} />
              <strong style={{ fontSize: '1.3rem', letterSpacing: '2px', display: 'block', margin: '6px 0 2px', fontFamily: 'monospace', color: '#0284c7' }}>
                {ticket.ticketNo}
              </strong>
              <small style={{ color: '#64748b', display: 'block', marginTop: '2px' }}>
                {t('maintenance.maintenance_receipt_modal.s12', "تاريخ الاستلام:")} {new Date(ticket.receivedAt).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' })}
              </small>
            </div>

            {/* Customer & Device Details Table */}
            <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '6px', marginBottom: '12px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                <div>{t('maintenance.maintenance_receipt_modal.s13', "العميل:")} <strong>{ticket.customerName}</strong></div>
                <div>{t('maintenance.maintenance_receipt_modal.s14', "الهاتف:")} <strong dir="ltr">{ticket.customerPhone}</strong></div>
                <div style={{ gridColumn: 'span 2' }}>
                  {t('maintenance.maintenance_receipt_modal.s15', "الجهاز:")} <strong>{ticket.deviceBrand ? `${ticket.deviceBrand} - ` : ''}{ticket.deviceModel}</strong>
                </div>
                {ticket.serialNumber && <div style={{ gridColumn: 'span 2' }}>{profile.serialLabel}: <strong dir="ltr">{ticket.serialNumber}</strong></div>}
                {ticket.passcode && <div style={{ gridColumn: 'span 2' }}>{profile.passcodeLabel}: <strong dir="ltr" style={{ color: '#2563eb' }}>{ticket.passcode}</strong></div>}
              </div>
            </div>

            {/* Problem & Condition */}
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontWeight: 700, color: '#dc2626', marginBottom: '3px' }}>{t('maintenance.maintenance_receipt_modal.s16', "العطل المشتكى منه:")}</div>
              <div style={{ background: '#fef2f2', padding: '6px 10px', borderRadius: '4px', border: '1px solid #fee2e2', color: '#991b1b' }}>
                {ticket.problemDescription}
              </div>

              {ticket.deviceCondition && (
                <div style={{ marginTop: '6px', fontSize: '0.8rem' }}>
                  <span style={{ fontWeight: 600, color: '#475569' }}>{t('maintenance.maintenance_receipt_modal.s17', "حالة الجهاز الظاهرية:")} </span>
                  <span>{ticket.deviceCondition}</span>
                </div>
              )}
            </div>

            {/* Financials */}
            <div style={{ borderTop: '1px dashed #94a3b8', borderBottom: '1px dashed #94a3b8', padding: '8px 0', marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span>{t('maintenance.maintenance_receipt_modal.s18', "القيمة الإجمالية:")}</span>
                <strong>{totalCost.toFixed(2)} <CurrencySymbol /></strong>
              </div>
              {ticket.advancePayment > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', color: '#16a34a' }}>
                  <span>{t('maintenance.maintenance_receipt_modal.s19', "المدفوع مقدماً (عربون):")}</span>
                  <strong>{ticket.advancePayment.toFixed(2)} <CurrencySymbol /></strong>
                </div>
              )}
              {ticket.status === 'delivered' && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', borderTop: '1px dashed #e2e8f0', paddingTop: '4px' }}>
                  <span>{t('maintenance.maintenance_receipt_modal.s21', "المحصل عند الاستلام:")}</span>
                  <strong>{collectedAtDelivery.toFixed(2)} <CurrencySymbol /></strong>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: 800, borderTop: '1px dashed #cbd5e1', paddingTop: '4px', marginTop: '4px' }}>
                <span>{t('maintenance.maintenance_receipt_modal.s22', "المتبقي:")}</span>
                <span style={{ color: '#16a34a' }}>
                  {ticket.status === 'delivered' ? `0.00 ${getGlobalCurrencySymbol()} (خالص بالكامل)` : `${remainingAmount.toFixed(2)} ${getGlobalCurrencySymbol()}`}
                </span>
              </div>
            </div>

            {/* Disclaimer / Terms */}
            <div style={{ fontSize: '0.7rem', color: '#64748b', textAlign: 'justify', lineHeight: 1.35 }}>
              <strong>{t('maintenance.maintenance_receipt_modal.s23', "شروط الاستلام:")}</strong>
              <ul style={{ paddingRight: '16px', margin: '4px 0' }}>
                <li>{t('maintenance.maintenance_receipt_modal.s24', "المركز غير مسؤول عن الأجهزة المتروكة لأكثر من 30 يوماً من تاريخ الإصلاح.")}</li>
                <li>{t('maintenance.maintenance_receipt_modal.s25', "المركز غير مسؤول عن فقدان البيانات (Data Loss) أثناء عمليات الصيانة أو السوفت وير.")}</li>
                <li>{t('maintenance.maintenance_receipt_modal.s26', "فترة الضمان على قطع الغيار المستبدلة")} {ticket.warrantyDays || 30} {t('maintenance.maintenance_receipt_modal.s27', "يوماً بموجب هذا الإيصال.")}</li>
                <li>{t('maintenance.maintenance_receipt_modal.s28', "لا يتم تسليم الجهاز إلا بأصل هذا الإيصال أو إثبات الشخصية.")}</li>
              </ul>
            </div>

            {/* Signatures */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', paddingTop: '8px', borderTop: '1px solid #e2e8f0', fontSize: '0.75rem', textAlign: 'center' }}>
              <div>{t('maintenance.maintenance_receipt_modal.s29', "توقيع المستلم / الفني")}<br /><br />...................</div>
              <div>{t('maintenance.maintenance_receipt_modal.s30', "توقيع العميل")}<br /><br />...................</div>
            </div>
          </div>
        ) : (
          /* Mini Sticker Tag Preview */
          <div>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569' }}>{t('maintenance.maintenance_receipt_modal.s31', "مقاس الملصق / الطابعة:")}</label>
              <select
                value={stickerPreset}
                onChange={(e) => setStickerPreset(e.target.value as any)}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  background: '#fff',
                  color: '#0f172a',
                }}
              >
                <option value="50x30">{t('maintenance.maintenance_receipt_modal.s32', "50 × 30 مم (الافتراضي لملصقات الهواتف)")}</option>
                <option value="50x25">{t('maintenance.maintenance_receipt_modal.s33', "50 × 25 مم")}</option>
                <option value="40x30">{t('maintenance.maintenance_receipt_modal.s34', "40 × 30 مم")}</option>
                <option value="60x40">{t('maintenance.maintenance_receipt_modal.s35', "60 × 40 مم")}</option>
                <option value="80-roll">{t('maintenance.maintenance_receipt_modal.s36', "ورق فواتير حراري 80 مم")}</option>
              </select>
            </div>

            <div
              className="maintenance-printable-sticker"
              style={{
                background: '#fff',
                border: '2px dashed #0284c7',
                borderRadius: '8px',
                padding: '10px',
                maxWidth: stickerPreset === '80-roll' ? '380px' : '300px',
                margin: '0 auto',
                fontSize: '0.75rem',
                color: '#0f172a',
                textAlign: 'center',
                boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
              }}
            >
              <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#0f172a', borderBottom: '1px solid #e2e8f0', paddingBottom: '3px', marginBottom: '4px' }}>
                {settings?.storeName || t('maintenance.maintenance_receipt_modal.s37', "مركز الصيانة")}
              </div>

              <div style={{ width: '190px', height: '36px', margin: '0 auto 2px' }} dangerouslySetInnerHTML={{ __html: barcodeSvg }} />

              <div style={{ fontSize: '1.2rem', fontWeight: 900, fontFamily: 'monospace', letterSpacing: '1.5px', color: '#0284c7', margin: '2px 0 4px' }}>
                {ticket.ticketNo}
              </div>

              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px', padding: '6px 8px', textAlign: 'right', fontSize: '0.72rem', lineHeight: 1.4 }}>
                <div>{t('maintenance.maintenance_receipt_modal.s38', "العميل:")} <strong>{ticket.customerName}</strong> ({ticket.customerPhone})</div>
                <div>{t('maintenance.maintenance_receipt_modal.s39', "الجهاز:")} <strong>{ticket.deviceBrand ? `${ticket.deviceBrand} - ` : ''}{ticket.deviceModel}</strong></div>
                {ticket.passcode && <div>{profile.passcodeLabel}: <strong dir="ltr" style={{ color: '#2563eb' }}>{ticket.passcode}</strong></div>}
                <div style={{ color: '#dc2626', fontWeight: 700 }}>{t('maintenance.maintenance_receipt_modal.s40', "العطل:")} {ticket.problemDescription}</div>
              </div>

              <div style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '4px', fontWeight: 600 }}>
                {t('maintenance.maintenance_receipt_modal.s41', "تاريخ الاستلام:")} {new Date(ticket.receivedAt).toLocaleDateString('ar-EG')}
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #e2e8f0', paddingTop: '10px' }}>
          <Button variant="secondary" onClick={onClose} style={{ padding: '6px 20px', fontWeight: 700 }}>
            {t('maintenance.maintenance_receipt_modal.s42', "إغلاق")}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
