import { escapeHtml } from '@/lib/browser';
import { getPrintOption } from '@/lib/pos-printing/shared';
import type { AppSettings } from '@/types/domain';
import { resolveStoreIdentity, getAdaptiveBrandFontSize, formatReceiptText } from './template-helpers';

export function renderStoreHeader(settings?: Partial<AppSettings> | null, compact = false) {
  const { brandName } = resolveStoreIdentity(settings);
  const showLogo = getPrintOption(settings, 'printShowLogo', true);
  const showPhone = getPrintOption(settings, 'printShowPhone', true);
  const showAddress = getPrintOption(settings, 'printShowAddress', true);
  const showTaxNumber = settings?.currency === 'KWD' ? false : getPrintOption(settings, 'printShowTaxNumber', false);
  const phone = showPhone ? formatReceiptText(String(settings?.phone || '').trim(), settings) : '';
  const address = showAddress ? String(settings?.address || '').trim() : '';
  const taxNumber = showTaxNumber ? formatReceiptText(String(settings?.taxNumber || '').trim(), settings) : '';
  const logoData = showLogo ? String(settings?.logoData || '').trim() : '';
  const details = [
    phone ? `<div class="store-detail-line store-phone-line">${escapeHtml(phone)}</div>` : '',
    address ? `<div class="store-detail-line store-address-line">${escapeHtml(address)}</div>` : '',
    taxNumber ? `<div class="store-detail-line store-tax-line">الرقم الضريبي: ${escapeHtml(taxNumber)}</div>` : '',
  ].filter(Boolean).join('');

  return `
    <section class="invoice-card invoice-store-card${compact ? ' compact' : ''}">
      <div class="invoice-brand-row"${!logoData ? ' style="justify-content:center;"' : ''}>
        ${logoData ? `<div class="invoice-logo-wrapper"><img class="invoice-logo" src="${escapeHtml(logoData)}" alt="شعار المتجر" /></div>` : ''}
        <div class="invoice-brand-copy">
          <h2 title="${escapeHtml(brandName)}" style="font-size:${getAdaptiveBrandFontSize(brandName, compact)}">${escapeHtml(brandName)}</h2>
          ${details ? `<div class="store-inline-details">${details}</div>` : ''}
        </div>
      </div>
    </section>
  `;
}

export function renderMetaPanel(rows: Array<{ label: string; value?: string | number | null; isBadge?: boolean; isHtml?: boolean; noColon?: boolean; customClass?: string }>, compact = false, settings?: Partial<AppSettings> | null) {
  const visibleRows = rows.filter((row) => String(row.value ?? '').trim());
  if (!visibleRows.length) return '';
  return `
    <section class="invoice-card invoice-meta-panel${compact ? ' compact' : ''}">
      ${visibleRows.map((row) => `
        <div class="meta-line${row.isBadge ? ' meta-document-badge' : ''}${row.customClass ? ` ${row.customClass}` : ''}">
          <span class="meta-label">${escapeHtml(row.label)}${row.noColon ? '' : ':'}</span>
          <span class="meta-value">${row.isHtml ? row.value : escapeHtml(formatReceiptText(row.value ?? '—', settings))}</span>
        </div>
      `).join('')}
    </section>
  `;
}
