import { escapeHtml } from '@/lib/browser';
import { getPrintOption } from '@/lib/pos-printing/shared';
import type { AppSettings } from '@/types/domain';
import { resolveItemEnglishName } from '@/features/pos/utils/kitchen-notes.util';
import { formatReceiptNumber, formatReceiptMoney, formatReceiptQuantity } from './template-helpers';

export function renderItemsTable(items: Array<{ name?: string; unitName?: string; qty?: number; price?: number; originalPrice?: number; offerDiscount?: number; offerName?: string; lineDiscount?: number; total?: number; modifiers?: any[]; serials?: string[] }>, compact = false, settings?: Partial<AppSettings> | null) {
  const body = (items || []).map((item, index) => {
    const modifiersHtml = item.modifiers?.length
      ? `<div class="item-modifiers" style="font-size: 0.8em; color: #111; margin-top: 2px; line-height: 1.35; max-width: 100%; word-break: break-word;">
          ${item.modifiers.map((mod: any) => {
            const modPrice = Number(mod.price || 0);
            const modQty = Number(mod.qty || 1);
            const modTotal = modPrice * modQty;
            const qtyText = modQty > 1 ? ` (×${modQty})` : '';
            const priceText = modTotal > 0 ? ` (+${formatReceiptMoney(modTotal, settings)})` : '';
            return `<span style="white-space: nowrap; display: inline-block;">+ ${escapeHtml(mod.name)}${qtyText}${priceText}</span>`;
          }).join(' <span style="color: #666; font-size: 0.9em;">·</span> ')}
         </div>`
      : '';
    const serialsHtml = item.serials?.length
      ? `<div class="item-serials" style="font-size: 0.8em; color: #000; margin-top: 2px; font-family: monospace;">
          <strong>IMEI:</strong> ${item.serials.map(escapeHtml).join(', ')}
         </div>`
      : '';
    const showItemOffers = getPrintOption(settings, 'printShowItemOffers', true);
    const origPrice = Number(item.originalPrice || (Number(item.price || 0) + Number(item.offerDiscount || 0)));
    const savedAmount = Number(item.offerDiscount || (Number(item.originalPrice || 0) - Number(item.price || 0)));
    const hasOffer = origPrice > Number(item.price || 0) && savedAmount > 0;
    const isComboOffer = Boolean(item.offerName && item.offerName.startsWith('عرض مجمع'));
    const comboComponentsText = isComboOffer && item.offerName?.includes('(') ? item.offerName.replace(/^عرض مجمع\s*/, '').trim() : '';
    const inlineOfferBadge = (hasOffer && showItemOffers && !isComboOffer)
      ? `<div class="item-offer-line" style="font-size: 0.82em; line-height: 1.2; color: #000; margin-top: 1px;"><strong style="font-weight: 700;">عرض: ${formatReceiptMoney(Number(item.price || 0), settings)}</strong> <span style="font-weight: 500; color: #333; font-size: 0.95em;">بدلاً من ${formatReceiptMoney(origPrice, settings)}</span></div>`
      : '';
    const componentsHtml = (hasOffer && showItemOffers && comboComponentsText)
      ? `<div class="item-offer-line" style="font-size: 0.74em; color: #444; margin-top: 1px; font-weight: 500; line-height: 1.15; letter-spacing: -0.25px;">${escapeHtml(comboComponentsText)}</div>`
      : '';
    /* INV-POS-LINE-DISCOUNT: the line's own discount, under its name —
     * the total cell is already net of it, so the customer sees why
     * the line total is below qty x price. */
    const lineDiscountHtml = Number(item.lineDiscount || 0) > 0
      ? `<div class="item-line-discount" style="font-size: 0.82em; line-height: 1.2; color: #000; margin-top: 1px;">خصم الصنف: -${formatReceiptMoney(Number(item.lineDiscount), settings)}</div>`
      : '';
    const priceCellContent = (hasOffer && showItemOffers)
      ? `<div style="line-height: 1.15; text-align: center;">
          <del style="display: block; text-decoration: line-through; text-decoration-thickness: 1px; color: #444; font-size: 0.82em; font-weight: 400; opacity: 0.85;">${formatReceiptMoney(origPrice, settings)}</del>
          <div style="font-weight: 600; color: #000;">${formatReceiptMoney(Number(item.price || 0), settings)}</div>
         </div>`
      : formatReceiptMoney(Number(item.price || 0), settings);
    const englishName = resolveItemEnglishName(item);
    const showBilingualName = getPrintOption(settings, 'printBilingualItemNames', false) || Boolean(settings?.currency === 'KWD' && englishName);
    const englishNameHtml = (englishName && showBilingualName && englishName !== item.name)
      ? `<div class="item-name-en" style="font-size: 0.85em; font-weight: 500; color: #444; direction: ltr; text-align: left; font-family: system-ui, sans-serif;">${escapeHtml(englishName)}</div>`
      : '';
    return `
    <tr>
      ${compact ? '' : `<td class="index-cell">${formatReceiptNumber(index + 1, settings)}</td>`}
      <td class="name-cell">${escapeHtml(item.name || '—')}${englishNameHtml}${inlineOfferBadge}${componentsHtml}${lineDiscountHtml}${modifiersHtml}${serialsHtml}</td>
      ${compact ? '' : `<td class="unit-cell">${escapeHtml(item.unitName || 'قطعة')}</td>`}
      <td class="qty-cell">${formatReceiptQuantity(Number(item.qty || 0), settings)}</td>
      <td class="price-cell">${priceCellContent}</td>
      <td class="total-cell">${formatReceiptMoney(Number(item.total || 0), settings)}</td>
    </tr>
    `;
  }).join('');

  return `
    <section class="invoice-card invoice-items-card${compact ? ' compact' : ''}">
      <table class="invoice-items-table${compact ? ' compact' : ''}">
        <thead>
          <tr>
            ${compact ? '' : '<th class="index-th">#</th>'}
            <th class="name-th">الصنف / Item</th>
            ${compact ? '' : '<th class="unit-th">الوحدة / Unit</th>'}
            <th class="qty-th">الكمية / Qty</th>
            <th class="price-th">السعر / Price</th>
            <th class="total-th">الإجمالي / Total</th>
          </tr>
        </thead>
        <tbody>${body || `<tr><td colspan="${compact ? 4 : 6}">لا توجد أصناف</td></tr>`}</tbody>
      </table>
    </section>
  `;
}
