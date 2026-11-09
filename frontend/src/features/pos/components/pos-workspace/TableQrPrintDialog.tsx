import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/components/system-alert';
import { buildQrRange, isDefaultStorefrontSlug } from '@/features/pos/lib/pos-floor-state';
import {
  PrinterIcon,
  QrCodeIcon,
  XIcon,
} from '@/shared/components/icons/AppIcons';
import { buildQrSvg } from '@/lib/qrcode';
import { buildStorePublicUrl } from '@/lib/store-public-url';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { storefrontApi } from '@/features/storefront';

interface TableQrPrintDialogProps {
  open: boolean;
  onClose: () => void;
  defaultTablesCount?: number;
  slug?: string;
  businessName?: string;
}

export function TableQrPrintDialog({
  open,
  onClose,
  defaultTablesCount,
  slug,
  businessName,
}: TableQrPrintDialogProps) {
  const { t } = useTranslation();
  const { data: settings } = useSettingsQuery();
  const { data: storefrontSettings } = useQuery({
    queryKey: ['storefront-admin-settings'],
    queryFn: storefrontApi.getSettings,
    enabled: open,
  });

  // INV-REST-FLOOR-STATE-TRUTH (R5-D, R-I57): the slug was silently
  // falling back to 'default', so QR cards printed before the slug was
  // configured pointed at the wrong store. An unconfigured slug is now
  // a BLOCKING warning, never a silent print.
  const configuredSlug = slug || storefrontSettings?.slug;
  const isSlugUnconfigured = isDefaultStorefrontSlug(configuredSlug);
  const activeSlug = configuredSlug || 'default';
  const activeName = businessName || storefrontSettings?.title || settings?.storeName || 'المطعم';
  const configuredCount = Math.max(1, defaultTablesCount || Number(settings?.restaurantTablesCount || 12));
  const initialCount = configuredCount;

  const [fromTable, setFromTable] = useState(1);
  const [toTable, setToTable] = useState(initialCount);
  const [cardType, setCardType] = useState<'tent' | 'sticker'>('tent');
  const customInstructions = 'وجّه كاميرا هاتفك لمسح الرمز، تصفح المنيو، وأرسل طلبك فوراً للمطبخ';

  // R-I57: toTable was initialised once at mount, before settings
  // loaded, and never synced — the range stayed stale. Sync it whenever
  // the configured count itself changes (settings load / count edit);
  // user edits to the range do not change the count, so they are kept.
  const syncedCountRef = useRef(configuredCount);
  useEffect(() => {
    if (syncedCountRef.current !== configuredCount) {
      syncedCountRef.current = configuredCount;
      setToTable(configuredCount);
    }
  }, [configuredCount]);

  const baseUrl = useMemo(() => {
    return buildStorePublicUrl(activeSlug);
  }, [activeSlug]);

  const tablesList = useMemo(() => {
    // R-I57: the range is clamped to the configured table count —
    // never print QR cards for tables that do not exist.
    const range = buildQrRange(fromTable, toTable, configuredCount);
    const items = [];
    for (const i of range.tables) {
      const tableUrl = `${baseUrl}?table=${i}`;
      const qrSvg = buildQrSvg(tableUrl, { size: cardType === 'tent' ? 160 : 130, color: '#170e5e' });
      items.push({
        num: i,
        url: tableUrl,
        svg: qrSvg,
      });
    }
    return items;
  }, [fromTable, toTable, baseUrl, cardType, configuredCount]);

  const handlePrint = () => {
    if (isSlugUnconfigured) {
      toast.error('لم يتم ضبط رابط المتجر (slug) بعد — اضبطه أولاً قبل طباعة كروت الـ QR حتى لا تشير لمتجر خاطئ.');
      return;
    }
    const printWin = window.open('', '_blank', 'width=880,height=750');
    if (!printWin) {
      toast.error('تعذّر فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة لهذا الموقع ثم حاول مجدداً.');
      return;
    }

    const cardsHtml = tablesList.map((tbl) => {
      if (cardType === 'sticker') {
        return `
          <div class="qr-sticker">
            <div class="sticker-header">
              <span class="restaurant-name">${activeName}</span>
            </div>
            <div class="sticker-qr">
              ${tbl.svg}
            </div>
            <div class="sticker-badge">
              طاولة رقم ${tbl.num}
            </div>
            <div class="sticker-hint">امسح للطلب الذاتي</div>
          </div>
        `;
      }
      return `
        <div class="qr-card">
          <div class="card-brand">
            <div class="brand-title">${activeName}</div>
            <div class="brand-sub">قائمة الطعام والطلب الذاتي</div>
          </div>
          <div class="card-table-pill">
            طاولة رقم [ ${tbl.num} ]
          </div>
          <div class="card-qr-box">
            ${tbl.svg}
          </div>
          <div class="card-instructions">
            ${customInstructions}
          </div>
          <div class="card-footer">
            خدمة ذاتية فورية بدون انتظار • Z-Systems
          </div>
        </div>
      `;
    }).join('');

    printWin.document.write(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8" />
          <title>كروت QR طاولات الصالة - ${activeName}</title>
          <style>
            @page {
              size: A4 portrait;
              margin: 10mm;
            }
            * {
              box-sizing: border-box;
            }
            body {
              margin: 0;
              padding: 0;
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              direction: rtl;
              background: #ffffff;
              color: #0f172a;
            }
            .grid-container {
              display: grid;
              grid-template-columns: ${cardType === 'sticker' ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)'};
              gap: ${cardType === 'sticker' ? '12px' : '18px'};
              width: 100%;
            }
            /* Tent Card Style */
            .qr-card {
              border: 2px solid #170e5e;
              border-radius: 14px;
              padding: 16px 14px;
              text-align: center;
              background: #ffffff;
              page-break-inside: avoid;
              display: flex;
              flex-direction: column;
              align-items: center;
              justifyContent: space-between;
              min-height: 280px;
            }
            .card-brand {
              margin-bottom: 8px;
            }
            .brand-title {
              font-size: 16px;
              font-weight: 900;
              color: #170e5e;
              margin-bottom: 2px;
            }
            .brand-sub {
              font-size: 11px;
              color: #64748b;
              font-weight: 600;
            }
            .card-table-pill {
              background: #170e5e;
              color: #ffffff;
              font-size: 14px;
              font-weight: 900;
              padding: 4px 16px;
              border-radius: 20px;
              margin: 6px 0 10px;
            }
            .card-qr-box {
              padding: 8px;
              background: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 10px;
              display: inline-flex;
              align-items: center;
              justify-content: center;
            }
            .card-instructions {
              font-size: 11px;
              color: #334155;
              font-weight: 700;
              margin-top: 10px;
              line-height: 1.4;
              max-width: 220px;
            }
            .card-footer {
              font-size: 9.5px;
              color: #94a3b8;
              font-weight: 600;
              margin-top: 10px;
              border-top: 1px dashed #cbd5e1;
              padding-top: 6px;
              width: 100%;
            }
            /* Sticker Style */
            .qr-sticker {
              border: 1.5px dashed #475569;
              border-radius: 12px;
              padding: 12px 10px;
              text-align: center;
              background: #ffffff;
              page-break-inside: avoid;
              display: flex;
              flex-direction: column;
              align-items: center;
              justifyContent: space-between;
              min-height: 210px;
            }
            .sticker-header {
              font-size: 13px;
              font-weight: 800;
              color: #0f172a;
              margin-bottom: 4px;
            }
            .sticker-qr {
              padding: 4px;
              display: inline-flex;
            }
            .sticker-badge {
              font-size: 13px;
              font-weight: 900;
              color: #170e5e;
              margin-top: 6px;
            }
            .sticker-hint {
              font-size: 10px;
              color: #64748b;
              font-weight: 600;
            }
          </style>
        </head>
        <body>
          <div class="grid-container">
            ${cardsHtml}
          </div>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 750);
            };
          </script>
        </body>
      </html>
    `);
    printWin.document.close();
  };

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      ariaLabel={t('pos.pos_workspace.table_qr_print_dialog.s0', "طباعة كروت واستيكرات الـ QR لطاولات الصالة")}
      width="900px"
      zIndex={99}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '20px 24px', maxHeight: '88vh', overflow: 'hidden' }} dir="rtl">
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#eff6ff', border: '1px solid #bfdbfe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <QrCodeIcon size={22} color="#170e5e" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '16.5px', fontWeight: 900, color: '#0f172a' }}>
                {t('pos.pos_workspace.table_qr_print_dialog.s1', "طباعة كروت واستيكرات الـ QR لطاولات الصالة")}
              </h3>
              <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#64748b' }}>
                {t('pos.pos_workspace.table_qr_print_dialog.s2', "توليد كروت طاولات مؤسسية مع الرمز المشفر المباشر لكل طاولة لطلب الوجبات ذاتياً بدون انتظار")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: '#f1f5f9',
              border: 'none',
              borderRadius: '8px',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#64748b',
            }}
            title={t('pos.pos_workspace.table_qr_print_dialog.s3', "إغلاق")}
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* R-I57: blocking warning while the storefront slug is unconfigured. */}
        {isSlugUnconfigured && (
          <div style={{ background: '#fef2f2', border: '1.5px solid #fca5a5', borderRadius: '10px', padding: '10px 14px', fontSize: '12.5px', color: '#991b1b', fontWeight: 800 }}>
            {t('pos.pos_workspace.table_qr_print_dialog.s17', 'لم يتم ضبط رابط المتجر (slug) بعد — اضبطه من إعدادات المتجر أولاً، وإلا ستشير كروت الـ QR لمتجر خاطئ. الطباعة متوقفة حتى يتم الضبط.')}
          </div>
        )}

        {/* Controls Bar */}
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '12px 16px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          {/* Range Inputs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', fontWeight: 800, color: '#1e293b' }}>
              {t('pos.pos_workspace.table_qr_print_dialog.s4', "نطاق الطاولات:")}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: '#64748b' }}>{t('pos.pos_workspace.table_qr_print_dialog.s5', "من طاولة:")}</span>
              <input
                type="number"
                min="1"
                max={toTable}
                value={fromTable}
                onChange={(e) => setFromTable(Math.max(1, Number(e.target.value) || 1))}
                style={{ width: '56px', height: '30px', textAlign: 'center', fontWeight: 800, fontSize: '13px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: '#64748b' }}>{t('pos.pos_workspace.table_qr_print_dialog.s6', "إلى طاولة:")}</span>
              <input
                type="number"
                min={fromTable}
                max={configuredCount}
                value={toTable}
                onChange={(e) => setToTable(Math.min(configuredCount, Math.max(fromTable, Number(e.target.value) || fromTable)))}
                style={{ width: '56px', height: '30px', textAlign: 'center', fontWeight: 800, fontSize: '13px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <span style={{ fontSize: '11.5px', color: '#166534', fontWeight: 700, background: '#dcfce7', padding: '2px 8px', borderRadius: '6px' }}>
              {t('pos.pos_workspace.table_qr_print_dialog.s7', "إجمالي")} {tablesList.length} {t('pos.pos_workspace.table_qr_print_dialog.s8', "طاولة")}
            </span>
          </div>

          {/* Card Layout Switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569' }}>{t('pos.pos_workspace.table_qr_print_dialog.s9', "نمط الكارت:")}</span>
            <div style={{ display: 'inline-flex', background: '#e2e8f0', padding: '2px', borderRadius: '8px' }}>
              <button
                type="button"
                onClick={() => setCardType('tent')}
                style={{
                  border: 'none',
                  padding: '4px 12px',
                  borderRadius: '6px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: cardType === 'tent' ? '#170e5e' : 'transparent',
                  color: cardType === 'tent' ? '#ffffff' : '#475569',
                }}
              >
                {t('pos.pos_workspace.table_qr_print_dialog.s10', "أستاند طاولة (Tent)")}
              </button>
              <button
                type="button"
                onClick={() => setCardType('sticker')}
                style={{
                  border: 'none',
                  padding: '4px 12px',
                  borderRadius: '6px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: cardType === 'sticker' ? '#170e5e' : 'transparent',
                  color: cardType === 'sticker' ? '#ffffff' : '#475569',
                }}
              >
                {t('pos.pos_workspace.table_qr_print_dialog.s11', "ملصق مربع (Sticker)")}
              </button>
            </div>
          </div>
        </div>

        {/* Live Preview Grid */}
        <div style={{ flex: 1, minHeight: '260px', maxHeight: '380px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', background: '#f1f5f9' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: cardType === 'sticker' ? 'repeat(auto-fill, minmax(180px, 1fr))' : 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: '16px',
            }}
          >
            {tablesList.map((tbl) => (
              <div
                key={tbl.num}
                style={{
                  background: '#ffffff',
                  border: '1.5px solid #cbd5e1',
                  borderRadius: '12px',
                  padding: '16px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 800, color: '#170e5e', marginBottom: '4px' }}>
                  {activeName}
                </div>
                <div
                  style={{
                    background: '#170e5e',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 900,
                    padding: '2px 12px',
                    borderRadius: '999px',
                    marginBottom: '10px',
                  }}
                >
                  {t('pos.pos_workspace.table_qr_print_dialog.s12', "طاولة رقم [")} {tbl.num} ]
                </div>
                <div
                  style={{
                    background: '#f8fafc',
                    padding: '8px',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  dangerouslySetInnerHTML={{ __html: tbl.svg }}
                />
                <p style={{ margin: '8px 0 0', fontSize: '10.5px', color: '#64748b', fontWeight: 600, lineHeight: 1.3 }}>
                  {customInstructions}
                </p>
                <span style={{ fontSize: '9px', color: '#94a3b8', marginTop: '6px', fontFamily: 'monospace' }}>
                  ?table={tbl.num}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px', borderTop: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '11.5px', color: '#64748b' }}>
            {t('pos.pos_workspace.table_qr_print_dialog.s13', "الرابط الأساسي:")} <strong style={{ color: '#170e5e', fontFamily: 'monospace' }}>{baseUrl}</strong>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button type="button" variant="secondary" onClick={onClose} style={{ minHeight: '34px', height: '34px', fontSize: '12.5px' }}>
              {t('pos.pos_workspace.table_qr_print_dialog.s14', "إغلاق")}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handlePrint}
              disabled={isSlugUnconfigured}
              style={{
                minHeight: '34px',
                height: '34px',
                fontSize: '12.5px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: '#170e5e',
              }}
            >
              <PrinterIcon size={15} color="#ffffff" />
              <span>{t('pos.pos_workspace.table_qr_print_dialog.s15', "طباعة")} {tablesList.length} {t('pos.pos_workspace.table_qr_print_dialog.s16', "كارت الآن")}</span>
            </Button>
          </div>
        </div>
      </div>
    </DialogShell>
  );
}
