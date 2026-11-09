import { escapeHtml, printHtmlDocument } from '@/lib/browser';
import { formatCurrency, formatDate } from '@/lib/format';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import type { CashierShift } from '@/types/domain';

function getDurationStr(from?: string, to?: string): string {
  if (!from) return '—';
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  if (isNaN(start) || isNaN(end) || end < start) return '—';
  const totalMinutes = Math.floor((end - start) / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} دقيقة`;
  return `${hours} ساعة و ${minutes} دقيقة`;
}

function formatVarianceText(amount: number): string {
  if (Math.abs(amount) < 0.01) return `${formatCurrency(0)} (مطابق)`;
  if (amount < 0) return `${formatCurrency(amount)} (عجز)`;
  return `+${formatCurrency(amount)} (زيادة)`;
}

export interface ShiftReceiptOptions {
  reportType?: 'X' | 'Z' | 'settlement';
}

export function generateCashDrawerSettlementReceiptHtml(
  shift: CashierShift,
  storeName?: string,
  options?: ShiftReceiptOptions
): string {
  const isClosed = Boolean(shift.closedAt || shift.status === 'closed');
  const reportType = options?.reportType || (isClosed ? 'Z' : 'X');
  const isKwd = getGlobalSystemCurrency() === 'KWD';
  const movementItems = shift.movementItems || [];
  const manualCashInItems = movementItems.filter((i) => i.kind === 'cash_in');
  const cashOutItems = movementItems.filter((i) => i.kind === 'cash_out');
  const expenseItems = movementItems.filter((i) => i.kind === 'expense');
  const supplierItems = movementItems.filter((i) => i.kind === 'supplier_payment');
  const returnItems = movementItems.filter((i) => (i.kind as string) === 'return' || (i.kind as string) === 'sale_return');

  const shiftSalesTotal = Number(shift.shiftSalesTotal || 0);
  const tipSalesTotal = Number(shift.tipSalesTotal || 0);
  const freelanceFee = Number(shift.freelanceDeliveryFeeTotal || 0);
  const netStoreSales = Number(shift.netStoreSalesTotal || Math.max(0, shiftSalesTotal - freelanceFee));

  const rawCashSales = Number(shift.cashSalesTotal || 0) + Number(shift.serviceCashTotal || 0);
  const expectedCard = Number(shift.cardSalesTotal || 0) + Number(shift.serviceCardTotal || 0) - Number(shift.saleReturnCardRefundTotal || 0);
  const expectedWallet = Number(shift.walletSalesTotal || 0);
  const expectedInstapay = Number(shift.instapaySalesTotal || 0);
  const expectedCredit = Number(shift.creditSalesTotal || 0);
  const expectedDelivery = Number(shift.deliverySalesTotal || 0);

  const declaredCash = Number(shift.declaredCash ?? shift.countedCash ?? 0);
  const declaredCard = Number(shift.declaredCardTotal || 0);
  const declaredWallet = Number(shift.declaredWalletTotal || 0);
  const declaredInstapay = Number(shift.declaredInstapayTotal || 0);

  const totalOutflows =
    Number(shift.cashDrawerCashOutTotal || 0) +
    Number(shift.expensesTotal || 0) +
    Number(shift.supplierPaymentsTotal || 0) +
    Number(shift.saleReturnCashRefundTotal || 0);

  const deliveryCashIn = Number(shift.cashDrawerDeliveryCashInTotal || 0);
  const manualCashIn = Number(shift.cashDrawerManualCashInTotal || 0);
  const totalInflows = Number(shift.cashDrawerCashInTotal || (manualCashIn + deliveryCashIn));
  const openingCash = Number(shift.openingCash || 0);
  // INV-REST-SHIFT-CLOSE-CONTROL (I25): the two expected-cash
  // components the Z-report used to omit. Without them the
  // report's expected cash understated the drawer on every shift
  // with a customer collection or a cancelled cash sale.
  const customerCollections = Number(shift.customerCollectionsTotal || 0);
  const cancelledSaleCash = Number(shift.cancelledSaleCashTotal || 0);

  const dynamicExpectedCash = openingCash + rawCashSales + totalInflows - totalOutflows + customerCollections + cancelledSaleCash;
  const drawerVariance = (shift.declaredCash ?? shift.countedCash) != null
    ? declaredCash - dynamicExpectedCash
    : Number(shift.variance || 0);

  const cardDiff = declaredCard - expectedCard;
  const walletDiff = declaredWallet - expectedWallet;
  const instapayDiff = declaredInstapay - expectedInstapay;
  const electronicDiff = cardDiff + walletDiff + instapayDiff;
  const totalShiftDiscrepancy = drawerVariance + electronicDiff;
  const hasDrawerMovements = openingCash > 0 || totalInflows > 0 || totalOutflows > 0;

  const cleanNote = (n: string) => escapeHtml(n.replace(/^وردية\s*#?[A-Z0-9_-]+:\s*/i, '').trim() || n);

  const cleanCloseNote = shift.closeNote && !shift.closeNote.startsWith('BLIND_CLOSE:')
    ? shift.closeNote
    : (!shift.closeNoteRaw?.startsWith('BLIND_CLOSE:') && shift.closeNoteRaw ? shift.closeNoteRaw : '');

  return `
    <div style="font-family: system-ui, -apple-system, sans-serif; font-size: 10px; line-height: 1.3; color: #000; direction: rtl; text-align: right; width: 100%;">
      <!-- Header -->
      <div style="text-align: center; border-bottom: 1.5px solid #000; padding-bottom: 4px; margin-bottom: 4px;">
        <h2 style="margin: 0 0 1px; font-size: 14px; font-weight: 800;">${escapeHtml(storeName || 'إغلاق وردية الكاشير')}</h2>
        <div style="font-size: 10.5px; font-weight: 700;">تقرير تسوية وجرد الوردية الشامل</div>
        <div style="margin-top: 2px;">
          ${reportType === 'X'
            ? '<span style="display: inline-block; padding: 2px 8px; border: 1.5px dashed #000; font-weight: 800; font-size: 11px; background: #fff;">تقرير X الاسترشادي (X-Report) - قراءة منتصف الوردية</span>'
            : '<span style="display: inline-block; padding: 2px 8px; border: 1.5px solid #000; font-weight: 800; font-size: 11px; background: #f1f5f9;">تقرير Z النهائي (Z-Report) - إغلاق الوردية والمطابقة</span>'
          }
        </div>
      </div>

      <!-- Shift Meta -->
      <div style="border-bottom: 1px dashed #000; padding-bottom: 4px; margin-bottom: 4px; font-size: 9.5px;">
        <div style="display: flex; justify-content: space-between; font-weight: 800; font-size: 10.5px;">
          <span>الوردية: <strong>#${escapeHtml(String(shift.id || shift.docNo || ''))}</strong> (${escapeHtml(shift.openedByName || 'كاشير')})</span>
          <span>${escapeHtml([shift.branchName, shift.locationName].filter(Boolean).join(' - ') || 'الفرع الرئيسي')}</span>
        </div>
        <div style="display: flex; justify-content: space-between; color: #222; margin-top: 1px;">
          <span>وقت الفتح: ${escapeHtml(shift.createdAt ? formatDate(shift.createdAt) : '—')}</span>
        </div>
        <div style="display: flex; justify-content: space-between; color: #222; margin-top: 1px;">
          <span>وقت الإغلاق: ${escapeHtml(shift.closedAt ? formatDate(shift.closedAt) : 'مفتوحة حالياً')}</span>
          <span>(المدة: <strong>${getDurationStr(shift.createdAt, shift.closedAt)}</strong>)</span>
        </div>
        ${shift.closedByName && shift.closedByName !== shift.openedByName ? `
        <div style="display: flex; justify-content: space-between; font-weight: 700; color: #000; margin-top: 1px;">
          <span>أُغلقت إدارياً بواسطة:</span>
          <strong>${escapeHtml(shift.closedByName)}</strong>
        </div>` : ''}
      </div>

      <!-- Section 1: Sales & Payment Channels Comparison Table -->
      <div style="border-bottom: 1px dashed #000; padding-bottom: 4px; margin-bottom: 4px;">
        <div style="font-weight: 800; font-size: 10px; margin-bottom: 3px; background: #eee; padding: 1px 4px; display: flex; justify-content: space-between;">
          <span>[1] مطابقة المبيعات وقنوات التحصيل</span>
        </div>

        <table style="width: 100%; border-collapse: collapse; font-size: 9px; margin-top: 1px;">
          <thead>
            <tr style="border-bottom: 1px solid #000; font-weight: 800; background: #f8fafc;">
              <th style="text-align: right; padding: 2px 1px;">القناة</th>
              <th style="text-align: center; padding: 2px 1px;">النظام</th>
              <th style="text-align: center; padding: 2px 1px;">الإقرار</th>
              <th style="text-align: center; padding: 2px 1px;">الفرق</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom: 1px dashed #ccc;">
              <td style="padding: 2px 1px;"><strong>${hasDrawerMovements ? 'مبيعات نقدية (كاش)' : 'كاش (نقدية الدرج)'}</strong></td>
              <td style="text-align: center; padding: 2px 1px;">${formatCurrency(rawCashSales)}</td>
              <td style="text-align: center; padding: 2px 1px;">${hasDrawerMovements ? '<span style="color: #475569; font-size: 8px;">يُجرد بالقسم [3]</span>' : formatCurrency(declaredCash)}</td>
              <td style="text-align: center; padding: 2px 1px; font-weight: 700;">${hasDrawerMovements ? '<span style="color: #888;">—</span>' : (drawerVariance === 0 ? 'مطابق' : formatCurrency(drawerVariance))}</td>
            </tr>
            <tr style="border-bottom: 1px dashed #ccc;">
              <td style="padding: 2px 1px;"><strong>${isKwd ? 'بطاقات (K-NET / فيزا)' : 'بطاقات (فيزا / ماستركارد)'}</strong></td>
              <td style="text-align: center; padding: 2px 1px;">${formatCurrency(expectedCard)}</td>
              <td style="text-align: center; padding: 2px 1px;">${formatCurrency(declaredCard)}</td>
              <td style="text-align: center; padding: 2px 1px; font-weight: 700;">${cardDiff === 0 ? 'مطابق' : formatCurrency(cardDiff)}</td>
            </tr>
            <tr style="border-bottom: 1px dashed #ccc;">
              <td style="padding: 2px 1px;"><strong>${isKwd ? 'محافظ وروابط دفع' : 'محافظ إلكترونية'}</strong></td>
              <td style="text-align: center; padding: 2px 1px;">${formatCurrency(expectedWallet)}</td>
              <td style="text-align: center; padding: 2px 1px;">${formatCurrency(declaredWallet)}</td>
              <td style="text-align: center; padding: 2px 1px; font-weight: 700;">${walletDiff === 0 ? 'مطابق' : formatCurrency(walletDiff)}</td>
            </tr>
            <tr style="border-bottom: 1px dashed #ccc;">
              <td style="padding: 2px 1px;"><strong>${isKwd ? 'كي نت / دفع إلكتروني' : 'تحويل إنستاباي'}</strong></td>
              <td style="text-align: center; padding: 2px 1px;">${formatCurrency(expectedInstapay)}</td>
              <td style="text-align: center; padding: 2px 1px;">${formatCurrency(declaredInstapay)}</td>
              <td style="text-align: center; padding: 2px 1px; font-weight: 700;">${instapayDiff === 0 ? 'مطابق' : formatCurrency(instapayDiff)}</td>
            </tr>
            ${expectedCredit > 0 ? `
            <tr style="border-bottom: 1px dashed #ccc;">
              <td style="padding: 2px 1px;"><strong>آجل (ذمم عملاء)</strong></td>
              <td style="text-align: center; padding: 2px 1px;">${formatCurrency(expectedCredit)}</td>
              <td style="text-align: center; padding: 2px 1px; color: #555;">ذمة عميل</td>
              <td style="text-align: center; padding: 2px 1px; color: #888;">—</td>
            </tr>` : ''}
            ${expectedDelivery > 0 ? `
            <tr style="border-bottom: 1px dashed #ccc;">
              <td style="padding: 2px 1px;"><strong>دليفري (مناديب)</strong></td>
              <td style="text-align: center; padding: 2px 1px;">${formatCurrency(expectedDelivery)}</td>
              <td style="text-align: center; padding: 2px 1px; color: #555;">مع المندوب</td>
              <td style="text-align: center; padding: 2px 1px; color: #888;">—</td>
            </tr>` : ''}
            <tr style="border-top: 1.5px solid #000; font-weight: 800; background: #f1f5f9;">
              <td style="padding: 2px 1px;">${hasDrawerMovements ? `إجمالي مبيعات الوردية (${shift.saleCount || 0} فواتير)` : 'إجمالي المبيعات والتحصيل'}</td>
              <td style="text-align: center; padding: 2px 1px;">${formatCurrency(shiftSalesTotal)}</td>
              <td style="text-align: center; padding: 2px 1px;">${hasDrawerMovements ? formatCurrency(declaredCard + declaredWallet + declaredInstapay) : formatCurrency(declaredCash + declaredCard + declaredWallet + declaredInstapay)}</td>
              <td style="text-align: center; padding: 2px 1px; font-weight: 800;">${hasDrawerMovements ? (electronicDiff === 0 ? 'مطابق' : formatCurrency(electronicDiff)) : (totalShiftDiscrepancy === 0 ? 'مطابق' : formatCurrency(totalShiftDiscrepancy))}</td>
            </tr>
          </tbody>
        </table>

        ${freelanceFee > 0 ? `
        <div style="display: flex; justify-content: space-between; font-size: 9px; margin-top: 1px; color: #333;">
          <span>(-) أجر الطيارين (رسوم توصيل):</span>
          <span>-${formatCurrency(freelanceFee)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-weight: 800; border-top: 1px dashed #888; padding-top: 1px; margin-top: 1px;">
          <span>صافي مبيعات المتجر:</span>
          <span>${formatCurrency(netStoreSales)}</span>
        </div>` : ''}
        ${tipSalesTotal > 0 ? `
        <div style="display: flex; justify-content: space-between; font-size: 9px; margin-top: 3px; padding: 2px 4px; background: #f8fafc; border: 1px dashed #475569; border-radius: 3px;">
          <span><strong>إكراميات مستحقة للعمالة (Tips):</strong></span>
          <strong>${formatCurrency(tipSalesTotal)}</strong>
        </div>` : ''}
      </div>

      <!-- Section 2: Movements and Expenses Breakdown -->
      <div style="border-bottom: 1px dashed #000; padding-bottom: 4px; margin-bottom: 4px;">
        <div style="font-weight: 800; font-size: 10px; margin-bottom: 3px; background: #eee; padding: 1px 4px;">
          [2] حركات ومنصرفات نقدية الدرج
        </div>

        ${manualCashInItems.length > 0 ? `
        <div style="font-weight: 700; margin-top: 1px; font-size: 9.5px;">+ إيداع نقدي بالدرج (يدوياً):</div>
        ${manualCashInItems.map((item) => `
          <div style="display: flex; justify-content: space-between; padding-right: 6px; font-size: 9px;">
            <span>${cleanNote(item.note)}</span>
            <strong>+${formatCurrency(item.amount)}</strong>
          </div>
        `).join('')}` : ''}

        ${(manualCashIn > 0 || deliveryCashIn > 0) ? `
        <div style="display: flex; justify-content: space-between; border-top: 1px dashed #bbb; padding-top: 1px; margin-top: 2px; margin-bottom: 3px; font-weight: 700; font-size: 9px;">
          <span>إجمالي الإيداعات بالدرج:</span>
          <span>+${formatCurrency(manualCashIn + deliveryCashIn)}</span>
        </div>` : ''}

        ${cashOutItems.length > 0 ? `
        <div style="font-weight: 700; margin-top: 1px; font-size: 9.5px;">- مسحوبات نقدية من الدرج:</div>
        ${cashOutItems.map((item) => `
          <div style="display: flex; justify-content: space-between; padding-right: 6px; font-size: 9px;">
            <span>${cleanNote(item.note)}</span>
            <strong>-${formatCurrency(item.amount)}</strong>
          </div>
        `).join('')}` : ''}

        ${expenseItems.length > 0 ? `
        <div style="font-weight: 700; margin-top: 1px; font-size: 9.5px;">- مصروفات تشغيلية ونثرية:</div>
        ${expenseItems.map((item) => `
          <div style="display: flex; justify-content: space-between; padding-right: 6px; font-size: 9px;">
            <span>${cleanNote(item.note)}</span>
            <strong>-${formatCurrency(item.amount)}</strong>
          </div>
        `).join('')}` : ''}

        ${supplierItems.length > 0 ? `
        <div style="font-weight: 700; margin-top: 1px; font-size: 9.5px;">- سداد دفعات موردين:</div>
        ${supplierItems.map((item) => `
          <div style="display: flex; justify-content: space-between; padding-right: 6px; font-size: 9px;">
            <span>${cleanNote(item.note)}</span>
            <strong>-${formatCurrency(item.amount)}</strong>
          </div>
        `).join('')}` : ''}

        ${returnItems.length > 0 ? `
        <div style="font-weight: 700; margin-top: 1px; font-size: 9.5px;">- مرتجع مبيعات نقدي (كاش):</div>
        ${returnItems.map((item) => `
          <div style="display: flex; justify-content: space-between; padding-right: 6px; font-size: 9px;">
            <span>${cleanNote(item.note)}</span>
            <strong>-${formatCurrency(item.amount)}</strong>
          </div>
        `).join('')}` : ''}

        <div style="display: flex; justify-content: space-between; border-top: 1px solid #000; padding-top: 2px; margin-top: 2px; font-weight: 800;">
          <span>إجمالي المنصرف من الدرج:</span>
          <span>-${formatCurrency(totalOutflows)}</span>
        </div>
      </div>

      <!-- Section 3: Cash Reconciliation Formula -->
      <div style="border-bottom: 1px dashed #000; padding-bottom: 4px; margin-bottom: 4px;">
        <div style="font-weight: 800; font-size: 10px; margin-bottom: 3px; background: #eee; padding: 1px 4px;">
          [3] جرد ومطابقة نقدية الدرج (الكاش)
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span>رصيد الافتتاح (العهدة):</span>
          <strong>${formatCurrency(openingCash)}</strong>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span>(+) مبيعات نقدية (كاش):</span>
          <strong>+${formatCurrency(rawCashSales)}</strong>
        </div>
        ${manualCashIn > 0 ? `
        <div style="display: flex; justify-content: space-between;">
          <span>(+) إيداعات نقدية يدوية:</span>
          <strong>+${formatCurrency(manualCashIn)}</strong>
        </div>` : ''}
        ${deliveryCashIn > 0 ? `
        <div style="display: flex; justify-content: space-between;">
          <span>(+) تحصيلات مناديب دليفري:</span>
          <strong>+${formatCurrency(deliveryCashIn)}</strong>
        </div>` : ''}
        ${customerCollections > 0 ? `
        <div style="display: flex; justify-content: space-between;">
          <span>(+) تحصيلات عملاء نقدي:</span>
          <strong>+${formatCurrency(customerCollections)}</strong>
        </div>` : ''}
        ${cancelledSaleCash > 0 ? `
        <div style="display: flex; justify-content: space-between;">
          <span>(+) نقدية فواتير ملغاة:</span>
          <strong>+${formatCurrency(cancelledSaleCash)}</strong>
        </div>` : ''}
        <div style="display: flex; justify-content: space-between;">
          <span>(-) إجمالي المنصرف من الدرج:</span>
          <strong>-${formatCurrency(totalOutflows)}</strong>
        </div>

        <div style="display: flex; justify-content: space-between; border-top: 1px solid #000; padding-top: 2px; margin-top: 2px; font-weight: 800;">
          <span>صافي النقدية المتوقعة بالدرج:</span>
          <span>${formatCurrency(dynamicExpectedCash)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-weight: 800;">
          <span>النقدية الفعلية المعدودة (إقرار):</span>
          <span>${formatCurrency(declaredCash)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-weight: 800; border-top: 1px dashed #000; padding-top: 1px; margin-top: 1px;">
          <span>فارق نقدية الدرج:</span>
          <span>${formatVarianceText(drawerVariance)}</span>
        </div>
      </div>

      <!-- Section 4: Executive Decision & Final Summary -->
      <div style="border: 1.5px solid #000; border-radius: 4px; padding: 4px 6px; margin-bottom: 4px; background: #fafafa;">
        <div style="font-weight: 800; font-size: 10.5px; margin-bottom: 3px; text-align: center; border-bottom: 1px solid #000; padding-bottom: 1px;">
          [4] الخلاصة والقرار التنفيذي للوردية
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 1px;">
          <span>النقدية الموردة للخزينة:</span>
          <strong>${formatCurrency(declaredCash)}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 1px;">
          <span>فارق نقدية الدرج:</span>
          <strong>${formatVarianceText(drawerVariance)}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 1px;">
          <span>فارق المدفوعات الإلكترونية:</span>
          <strong>${formatVarianceText(electronicDiff)}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; font-weight: 800; font-size: 11px; border-top: 1.5px solid #000; padding-top: 2px; margin-top: 2px;">
          <span>إجمالي الفارق النهائي للوردية:</span>
          <span>${formatVarianceText(totalShiftDiscrepancy)}</span>
        </div>
      </div>

      <!-- Section 5: Notes & Audit -->
      ${shift.openingNote || cleanCloseNote || shift.managerReviewNote ? `
      <div style="border-bottom: 1px dashed #000; padding-bottom: 4px; margin-bottom: 4px; font-size: 9px;">
        ${shift.openingNote ? `<div><strong>ملاحظة الافتتاح:</strong> ${escapeHtml(shift.openingNote)}</div>` : ''}
        ${cleanCloseNote ? `<div><strong>ملاحظة الإغلاق:</strong> ${escapeHtml(cleanCloseNote)}</div>` : ''}
        ${shift.managerReviewNote ? `<div><strong>ملاحظة اعتماد المدير:</strong> ${escapeHtml(shift.managerReviewNote)}</div>` : ''}
      </div>` : ''}

      <!-- Section 6: Signatures Footer (Side by Side) -->
      <div style="display: flex; justify-content: space-between; padding-top: 4px; margin-top: 2px; font-size: 9.5px; page-break-inside: avoid;">
        <div>توقيع الكاشير: ........................</div>
        <div>اعتماد الإدارة: ........................</div>
      </div>
    </div>
  `;
}

export function printCashDrawerShiftReceipt(
  shift: CashierShift,
  storeName?: string,
  options?: ShiftReceiptOptions
): void {
  const isClosed = Boolean(shift.closedAt || shift.status === 'closed');
  const reportType = options?.reportType || (isClosed ? 'Z' : 'X');
  const html = generateCashDrawerSettlementReceiptHtml(shift, storeName, { ...options, reportType });
  const title = reportType === 'X'
    ? `تقرير X (X-Report) - وردية ${shift.docNo || shift.id}`
    : `تقرير Z (Z-Report) - وردية ${shift.docNo || shift.id}`;
  printHtmlDocument(title, html, {
    pageSize: 'receipt',
    layout: 'centered',
  });
}

export function printXReport(shift: CashierShift, storeName?: string): void {
  printCashDrawerShiftReceipt(shift, storeName, { reportType: 'X' });
}

export function printZReport(shift: CashierShift, storeName?: string): void {
  printCashDrawerShiftReceipt(shift, storeName, { reportType: 'Z' });
}


