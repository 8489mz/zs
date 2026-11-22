import type { MaritimeJob } from '../../api/maritime-freight.api';
import { escapeHtml } from './print-helpers';

/**
 * Generates and prints a Transit & Bonded Warehouse Intake / Storage Receipt
 * (إذن استلام وإيداع مستودع بضائع ترانزيت / إيداع جمركي)
 */
export function printWarehouseReceipt(job: MaritimeJob, receipt: any, companyName = 'منظومة Z-Systems للمستودعات اللوجستية') {
  const printWindow = window.open('', '_blank', 'width=900,height=950');
  if (!printWindow) return;

  const html = `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8" />
        <title>إذن استلام وإيداع مستودع - ${receipt.receipt_number || receipt.receiptNumber}</title>
        <style>
          @page { size: A4 portrait; margin: 15mm; }
          body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 12px; color: #0f172a; margin: 0; padding: 20px; line-height: 1.5; }
          .receipt-border { border: 2px solid #0f172a; padding: 24px; border-radius: 8px; background: #ffffff; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 14px; margin-bottom: 20px; }
          .title { font-size: 18px; font-weight: 800; color: #170e5e; margin: 0 0 4px; }
          .receipt-badge { background: #f8fafc; border: 1.5px solid #0f172a; padding: 8px 14px; border-radius: 6px; text-align: center; font-family: monospace; font-weight: 800; font-size: 14px; }

          .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 16px; }
          .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
          .box { background: #f8fafc; border: 1px solid #cbd5e1; padding: 10px 12px; border-radius: 6px; }
          .box-label { font-size: 10px; font-weight: 700; color: #64748b; margin-bottom: 2px; }
          .box-val { font-size: 13px; font-weight: 700; color: #0f172a; }

          .storage-card { background: #f0fdf4; border: 1.5px solid #22c55e; border-radius: 8px; padding: 14px; margin-bottom: 18px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 8px 10px; font-size: 11px; font-weight: 800; text-align: right; }
          td { border: 1px solid #cbd5e1; padding: 8px 10px; font-size: 12px; }

          .sign-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; margin-top: 36px; text-align: center; }
          .sign-box { border-top: 1px dashed #64748b; padding-top: 8px; font-size: 11px; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="receipt-border">
          <div class="header">
            <div>
              <div class="title">إذن استلام وإيداع مستودع لوجستي / جمركي</div>
              <div style="color: #64748b; font-size: 10.5px;">WAREHOUSE INTAKE & STORAGE RECEIPT (MWR)</div>
              <div style="font-weight: 700; color: #170e5e; margin-top: 4px;">${escapeHtml(companyName)}</div>
            </div>
            <div class="receipt-badge">
              <div style="font-size: 9px; color: #64748b; font-family: sans-serif;">رقم الإذن / RECEIPT NO.</div>
              <div>${receipt.receipt_number || receipt.receiptNumber}</div>
            </div>
          </div>

          <div class="storage-card">
            <div>
              <div class="box-label">عدد الطرود / الطبالي</div>
              <div class="box-val" style="color: #15803d; font-size: 16px;">${receipt.package_count || receipt.packageCount || 1} طرد / وحدة</div>
            </div>
            <div>
              <div class="box-label">الوزن الإجمالي الفعلي</div>
              <div class="box-val" style="color: #15803d; font-size: 16px;">${Number(receipt.gross_weight_kg || receipt.grossWeightKg || 0).toLocaleString()} كجم</div>
            </div>
            <div>
              <div class="box-label">الحجم الإجمالي (CBM)</div>
              <div class="box-val" style="color: #15803d; font-size: 16px;">${Number(receipt.cbm || 0).toFixed(2)} م³</div>
            </div>
          </div>

          <div class="grid-3">
            <div class="box">
              <div class="box-label">العميل / صاحب البضاعة</div>
              <div class="box-val">${escapeHtml(job.customer_name)}</div>
            </div>
            <div class="box">
              <div class="box-label">رقم الشحنة / أمر التشغيل</div>
              <div class="box-val" style="font-family: monospace;">${escapeHtml(job.job_number)}</div>
            </div>
            <div class="box">
              <div class="box-label">تاريخ ووقت الاستلام الفعلي</div>
              <div class="box-val">${receipt.received_date || receipt.receivedDate ? new Date(receipt.received_date || receipt.receivedDate).toLocaleString('ar-EG') : '—'}</div>
            </div>
          </div>

          <div class="grid-2">
            <div class="box">
              <div class="box-label">موقع التخزين والرف (BAY / RACK / BIN)</div>
              <div class="box-val" style="color: #170e5e;">${receipt.bay_rack_bin || receipt.bayRackBin || 'ساحة الاستلام والتفتيش العام'}</div>
            </div>
            <div class="box">
              <div class="box-label">حالة البضاعة بالمستودع</div>
              <div class="box-val">${receipt.warehouse_status === 'released' ? 'تم الإفراج والتسليم للعميل' : 'مودعة ومخزنة بالمستودع'}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>ملاحظات الفحص الظاهري والمطابقة</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="min-height: 48px; color: #334155;">
                  ${receipt.notes || 'تم استلام الطرود بحالة ظاهرية سليمة ومطابقة للمستندات المرفقة دون أي عجز أو تلف ملحوظ.'}
                </td>
              </tr>
            </tbody>
          </table>

          <div class="sign-grid">
            <div class="sign-box">
              أمين المستودع المستلم<br />
              <strong>Storekeeper</strong>
            </div>
            <div class="sign-box">
              مندوب النقل / السائق المسلم<br />
              <strong>Carrier / Driver</strong>
            </div>
            <div class="sign-box">
              إدارة العمليات اللوجستية<br />
              <strong>Operations Control</strong>
            </div>
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
