import type { MaritimeQuotation } from '../../api/maritime-freight.api';
import { escapeHtml, getTrackingQrCode } from './print-helpers';

/**
 * Generates and prints a Formal Freight Forwarding Quotation & Service Proposal (PDF)
 * conforming to international freight brokerage & forwarding standards.
 */
export function printFreightQuotation(quote: MaritimeQuotation, companyName = 'منظومة Z-Systems للشحن والخدمات اللوجستية') {
  const printWindow = window.open('', '_blank', 'width=950,height=1000');
  if (!printWindow) return;

  const modeLabel = quote.transport_mode === 'air' ? 'شحن جوي دولي (AIR FREIGHT)' : quote.transport_mode === 'road' ? 'شحن بري دولي (LAND FREIGHT)' : 'شحن بحري دولي (OCEAN FREIGHT)';
  const quoteDate = quote.created_at ? new Date(quote.created_at).toLocaleDateString('ar-EG') : new Date().toLocaleDateString('ar-EG');
  const validUntil = quote.valid_until || '14 يوماً من تاريخ الإصدار';

  const html = `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8" />
        <title>عرض سعر شحن - ${escapeHtml(quote.quotation_number)}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 11.5px; color: #0f172a; margin: 0; padding: 20px; line-height: 1.5; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #170e5e; padding-bottom: 14px; margin-bottom: 18px; }
          .brand { font-size: 20px; font-weight: 900; color: #170e5e; }
          .quote-badge { background: #f8fafc; border: 2px solid #170e5e; border-radius: 8px; padding: 10px 16px; text-align: right; }
          .quote-title { margin: 0; font-size: 15px; font-weight: 800; color: #170e5e; }
          .quote-num { font-family: monospace; font-size: 14px; font-weight: 800; color: #0f172a; margin-top: 2px; }

          .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
          .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; background: #ffffff; }
          .card-title { font-size: 11px; font-weight: 800; color: #170e5e; margin-bottom: 8px; border-bottom: 1px solid #f1f5f9; padding-bottom: 4px; }
          .row { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px; }
          .row span:first-child { color: #64748b; font-weight: 600; }
          .row span:last-child { font-weight: 700; color: #0f172a; }

          table { width: 100%; border-collapse: collapse; margin: 16px 0; }
          th { background: #170e5e; color: #ffffff; padding: 8px 10px; font-size: 11px; font-weight: 800; text-align: right; }
          td { border-bottom: 1px solid #e2e8f0; padding: 9px 10px; font-size: 11.5px; }

          .total-box { background: #f0fdf4; border: 1.5px solid #22c55e; border-radius: 8px; padding: 14px 18px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: center; }
          .total-val { font-size: 20px; font-weight: 900; color: #15803d; font-family: monospace; }

          .terms-box { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 14px; font-size: 10.5px; color: #475569; line-height: 1.6; margin-bottom: 20px; }
          .terms-box strong { color: #170e5e; }

          .sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 30px; text-align: center; }
          .sign-box { border-top: 1px dashed #64748b; padding-top: 8px; font-size: 11px; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="brand">${escapeHtml(companyName)}</div>
            <div style="font-size: 10.5px; color: #64748b; margin-top: 2px;">قطاع الشحن الدولي وإدارة سلاسل الإمداد اللوجستية</div>
            <div style="font-size: 11px; color: #1e293b; margin-top: 4px;">نوع الخدمة: <strong>${modeLabel}</strong></div>
          </div>
          <div style="display: flex; align-items: center; gap: 14px;">
            <div class="quote-badge">
              <div class="quote-title">عرض سعر شحن رسمي (FREIGHT QUOTATION)</div>
              <div class="quote-num">رقم العرض: ${escapeHtml(quote.quotation_number)}</div>
              <div style="font-size: 10px; color: #64748b; margin-top: 2px;">تاريخ الإصدار: <strong>${quoteDate}</strong> | صالح حتى: <strong>${validUntil}</strong></div>
            </div>
            <div style="display: flex; flex-direction: column; align-items: center; border: 1px solid #cbd5e1; padding: 4px; border-radius: 6px; background: #ffffff;">
              ${getTrackingQrCode(quote.quotation_number, 54)}
              <span style="font-size: 6.5px; font-weight: 800; color: #170e5e; margin-top: 2px;">التحقق من العرض</span>
            </div>
          </div>
        </div>

        <div class="grid-2">
          <div class="card">
            <div class="card-title">بيانات العميل والشاحن (Customer Details)</div>
            <div class="row"><span>اسم العميل:</span><span>${escapeHtml(quote.customer_name)}</span></div>
            <div class="row"><span>رقم الهاتف / الجوال:</span><span>${escapeHtml(quote.customer_phone || '—')}</span></div>
            <div class="row"><span>البريد الإلكتروني:</span><span>${quote.customer_email || '—'}</span></div>
            <div class="row"><span>شرط السداد:</span><span>${quote.payment_term === 'collect' ? 'Freight Collect (تحصيل عند الوصول)' : 'Freight Prepaid (مدفوع مقدماً)'}</span></div>
          </div>

          <div class="card">
            <div class="card-title">تفاصيل ومسار الشحن (Freight Specifications)</div>
            <div class="row"><span>وسيلة الشحن:</span><span>${modeLabel}</span></div>
            <div class="row"><span>نوع الشحنة / البضاعة:</span><span>${quote.air_cargo_type || 'بضائع عامة ومعدات تجارية'}</span></div>
            ${quote.package_count ? `<div class="row"><span>عدد الطرود / الوحدات:</span><span>${quote.package_count} طرد</span></div>` : ''}
            ${quote.gross_weight_kg ? `<div class="row"><span>الوزن الإجمالي الفعلي:</span><span>${Number(quote.gross_weight_kg).toLocaleString()} كجم</span></div>` : ''}
            ${quote.chargeable_weight_kg ? `<div class="row"><span>الوزن الخاضع للتحصيل IATA:</span><span>${Number(quote.chargeable_weight_kg).toLocaleString()} كجم</span></div>` : ''}
            ${quote.total_cbm ? `<div class="row"><span>الحجم الإجمالي:</span><span>${Number(quote.total_cbm).toFixed(2)} م³ (CBM)</span></div>` : ''}
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>بيان بند التسعير والخدمة اللوجستية</th>
              <th>العملة الأساسية</th>
              <th style="text-align: left;">القيمة بالعملة المتعاقد عليها</th>
              <th style="text-align: left;">المعادل بالعملة المحلية</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="text-align: center;">1</td>
              <td>
                <strong>نولون الشحن الدولي والمصروفات الملاحية الملحقة</strong><br/>
                <span style="font-size: 10px; color: #64748b;">تشمل النولون الأساسي، رسوم الموانئ والمناولة (THC)، وتكاليف المتابعة الميدانية</span>
              </td>
              <td>${quote.currency || 'USD'}</td>
              <td style="text-align: left; font-weight: 800; font-family: monospace;">${quote.currency || 'USD'} ${Number(quote.final_total).toLocaleString()}</td>
              <td style="text-align: left; font-weight: 800; font-family: monospace;">${Number(quote.final_total_local).toLocaleString()} EGP/SAR</td>
            </tr>
          </tbody>
        </table>

        <div class="total-box">
          <div>
            <div style="font-size: 13px; font-weight: 800; color: #166534;">السعر الإجمالي النهائي المعتمد للعميل (FINAL TOTAL PAYABLE)</div>
            <div style="font-size: 10.5px; color: #15803d; margin-top: 2px;">شامل كافة الرسوم والنولون الموضح أعلاه بناءً على بيانات الاستفسار</div>
          </div>
          <div class="total-val">
            ${quote.currency || 'USD'} ${Number(quote.final_total).toLocaleString()}
            <div style="font-size: 11px; font-weight: 700; color: #166534; text-align: left;">(≈ ${Number(quote.final_total_local).toLocaleString()} بالعملة المحلية)</div>
          </div>
        </div>

        <div class="terms-box">
          <strong>الشروط والأحكام العامة لعرض السعر (Standard Terms & Trading Conditions):</strong><br/>
          1. العرض ساري لمدة <strong>${validUntil}</strong> ويخضع لتوفر الفراغات والمعدات (Subject to space and equipment availability).<br/>
          2. الأسعار لا تشمل الرسوم والضرائب الجمركية المباشرة، غرامات الفحص والمعاينة بالموانئ، أو غرامات الأرضيات ما لم ينص صراحة على خلاف ذلك.<br/>
          3. فترات السماح بالحاويات تحتسب طبقاً للائحة التوكيل الملاحي والخط الناقل المعمول بها.<br/>
          4. للتعميد وتأكيد الحجز، يرجى التوقيع والختم أدناه وإعادة إرسال النسخة عبر البريد الإلكتروني أو الواتساب.
        </div>

        <div class="sign-grid">
          <div class="sign-box">
            مستشار التسعير وعمليات الشحن<br/>
            <strong>${escapeHtml(companyName)}</strong>
          </div>
          <div class="sign-box">
            موافقة واعتماد العميل / الشاحن<br/>
            <strong>${escapeHtml(quote.customer_name)}</strong>
          </div>
        </div>
      </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 400);
}
