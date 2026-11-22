import type { MaritimeJob } from '../../api/maritime-freight.api';
import { escapeHtml, getTrackingQrCode } from './print-helpers';

/**
 * Generates and prints a standardized IATA Neutral Air Waybill (AWB)
 * conforming to IATA Cargo Services Conference Resolutions.
 */
export function printAirWaybill(job: MaritimeJob, companyName = 'منظومة Z-Systems للشحن والخدمات اللوجستية') {
  const printWindow = window.open('', '_blank', 'width=950,height=1000');
  if (!printWindow) return;

  const awbNumber = job.mawb_number || job.hawb_number || job.job_number;
  const grossWeight = Number(job.gross_weight_kg || 0);
  const chargeableWeight = Number(job.chargeable_weight_kg || job.gross_weight_kg || 0);
  const totalCbm = Number(job.total_cbm || 0);
  const packages = Number(job.package_count || 1);

  const html = `
    <!DOCTYPE html>
    <html dir="ltr" lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Air Waybill - ${awbNumber}</title>
        <style>
          @page { size: A4 portrait; margin: 10mm; }
          body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #0f172a; margin: 0; padding: 12px; line-height: 1.3; }
          .awb-container { border: 2px solid #0f172a; }
          .awb-header { display: grid; grid-template-columns: 2fr 1.2fr; border-bottom: 2px solid #0f172a; }
          .awb-title-box { padding: 12px; background: #f8fafc; border-left: 2px solid #0f172a; text-align: center; }
          .awb-title { font-size: 17px; font-weight: 900; letter-spacing: 1.5px; color: #170e5e; margin: 0 0 4px; }
          .awb-doc-num { font-size: 15px; font-weight: 800; color: #0f172a; font-family: monospace; }
          .awb-forwarder { padding: 12px; }
          .awb-forwarder h2 { margin: 0 0 2px; font-size: 16px; color: #170e5e; }

          .grid-2 { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid #0f172a; }
          .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; border-bottom: 1px solid #0f172a; }
          .grid-4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; border-bottom: 1px solid #0f172a; }

          .cell { padding: 6px 10px; border-right: 1px solid #0f172a; }
          .cell:last-child { border-right: none; }
          .cell-label { font-size: 8px; font-weight: 800; text-transform: uppercase; color: #475569; margin-bottom: 2px; }
          .cell-content { font-size: 10.5px; font-weight: 600; min-height: 24px; }

          table.cargo-table { width: 100%; border-collapse: collapse; margin: 0; }
          table.cargo-table th { background: #f1f5f9; border-bottom: 2px solid #0f172a; border-right: 1px solid #cbd5e1; padding: 6px 8px; font-size: 8.5px; font-weight: 800; text-transform: uppercase; text-align: left; }
          table.cargo-table td { padding: 7px 8px; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; font-size: 10.5px; }
          table.cargo-table th:last-child, table.cargo-table td:last-child { border-right: none; }

          .awb-footer { display: grid; grid-template-columns: 2fr 1fr; border-top: 2px solid #0f172a; font-size: 8.5px; }
          .legal-notice { padding: 8px 10px; color: #64748b; font-size: 8px; line-height: 1.25; border-right: 1px solid #0f172a; }
          .signature-box { padding: 8px 10px; text-align: center; }
          .sign-line { margin-top: 36px; border-top: 1px dashed #475569; padding-top: 4px; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="awb-container">
          <div class="awb-header">
            <div class="awb-forwarder">
              <h2>${escapeHtml(companyName)}</h2>
              <div style="color: #475569; font-size: 9px;">INTERNATIONAL AIR FREIGHT FORWARDING & LOGISTICS (IATA CARGO AGENT)</div>
              <div style="margin-top: 4px; font-size: 10px;">Air Carrier / Airline: <strong>${escapeHtml(job.shipping_line_name)}</strong></div>
            </div>
            <div class="awb-title-box">
              <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                <div style="flex: 1; text-align: left;">
                  <div class="awb-title">AIR WAYBILL</div>
                  <div class="awb-doc-num">AWB NO: ${awbNumber}</div>
                  <div style="font-size: 9px; color: #64748b; margin-top: 3px;">Job Ref: ${escapeHtml(job.job_number)}</div>
                </div>
                ${job.tracking_token || job.mawb_number || job.hawb_number || job.job_number ? `
                <div style="display: flex; flex-direction: column; align-items: center; border: 1px solid #cbd5e1; padding: 4px; border-radius: 4px; background: #ffffff;">
                  ${getTrackingQrCode(job.tracking_token || job.mawb_number || job.hawb_number || job.job_number, 56)}
                  <span style="font-size: 6px; font-weight: 800; color: #170e5e; margin-top: 2px;">CARGO iQ TRACKING</span>
                </div>
                ` : ''}
              </div>
            </div>
          </div>

          <div class="grid-2">
            <div class="cell">
              <div class="cell-label">1. SHIPPER'S NAME AND ADDRESS</div>
              <div class="cell-content">${escapeHtml(job.shipper_details || 'AS PER COMMERCIAL INVOICE')}</div>
            </div>
            <div class="cell">
              <div class="cell-label">AIRLINE BOOKING / FLIGHT DETAILS</div>
              <div class="cell-content">
                <strong>Flight: ${escapeHtml(job.flight_number || 'TBA')}</strong> | Date: <strong>${job.flight_date || job.etd || 'TBA'}</strong><br/>
                ${job.hawb_number ? `<span style="font-size: 9px; color: #475569;">HAWB: ${escapeHtml(job.hawb_number)}</span>` : ''}
              </div>
            </div>
          </div>

          <div class="grid-2">
            <div class="cell">
              <div class="cell-label">2. CONSIGNEE'S NAME AND ADDRESS</div>
              <div class="cell-content"><strong>${escapeHtml(job.customer_name)}</strong><br/>${escapeHtml(job.consignee_details || 'DIRECT AIR DELIVERY')}</div>
            </div>
            <div class="cell">
              <div class="cell-label">3. ISSUING CARRIER'S AGENT / NOTIFY PARTY</div>
              <div class="cell-content">${escapeHtml(job.notify_party || companyName)}</div>
            </div>
          </div>

          <div class="grid-4">
            <div class="cell">
              <div class="cell-label">AIRPORT OF DEPARTURE (POL)</div>
              <div class="cell-content"><strong>${escapeHtml(job.pol_name)}</strong><br/><span style="font-family: monospace; font-size: 10px;">IATA: ${escapeHtml(job.pol_code)}</span></div>
            </div>
            <div class="cell">
              <div class="cell-label">AIRPORT OF DESTINATION (POD)</div>
              <div class="cell-content"><strong>${escapeHtml(job.pod_name)}</strong><br/><span style="font-family: monospace; font-size: 10px;">IATA: ${escapeHtml(job.pod_code)}</span></div>
            </div>
            <div class="cell">
              <div class="cell-label">CARGO NATURE / TYPE</div>
              <div class="cell-content"><strong>${job.air_cargo_type || 'General Cargo'}</strong></div>
            </div>
            <div class="cell">
              <div class="cell-label">CHGS CODES / PAYMENT</div>
              <div class="cell-content"><strong>${job.payment_term?.toUpperCase() || 'PREPAID'}</strong></div>
            </div>
          </div>

          <table class="cargo-table">
            <thead>
              <tr>
                <th style="width: 50px;">No. of Pieces</th>
                <th style="width: 100px;">Gross Weight</th>
                <th style="width: 80px;">Rate Class</th>
                <th style="width: 110px;">Chargeable Weight</th>
                <th style="width: 90px;">Volume (CBM)</th>
                <th>Nature and Quantity of Goods (incl. Dimensions)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="font-weight: 700; text-align: center;">${packages} PCS</td>
                <td style="font-weight: 700;">${grossWeight.toLocaleString()} KG</td>
                <td style="text-align: center;">Q (Quantity)</td>
                <td style="font-weight: 800; color: #170e5e;">${chargeableWeight.toLocaleString()} KG</td>
                <td>${totalCbm.toFixed(2)} CBM</td>
                <td>
                  <strong>${escapeHtml(job.notes || 'Air Freight Cargo / General Merchandise')}</strong><br/>
                  <span style="font-size: 9px; color: #64748b;">Handling: Keep Dry | Standard Air Cargo Security Screened</span>
                </td>
              </tr>
            </tbody>
          </table>

          <div class="awb-footer">
            <div class="legal-notice">
              It is agreed that the goods described herein are accepted in apparent good order and condition for carriage SUBJECT TO THE CONDITIONS OF CONTRACT ON THE REVERSE HEREOF. ALL GOODS MAY BE CARRIED BY ANY OTHER MEANS INCLUDING ROAD OR ANY OTHER AIR CARRIER. The Warsaw Convention or the Montreal Convention may be applicable.
            </div>
            <div class="signature-box">
              <div style="font-weight: 700;">${escapeHtml(companyName)}</div>
              <div style="font-size: 8px; color: #64748b;">Signature of Issuing Carrier or its Agent</div>
              <div class="sign-line">Authorized Signatory</div>
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
