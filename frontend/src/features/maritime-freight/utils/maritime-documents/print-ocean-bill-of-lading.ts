import type { MaritimeJob, MaritimeContainer } from '../../api/maritime-freight.api';
import { escapeHtml, getTrackingQrCode } from './print-helpers';

/**
 * Generates and prints a standardized Maritime Bill of Lading (B/L)
 * conforming to FIATA/BIMCO multimodal freight standards.
 */
export function printOceanBillOfLading(job: MaritimeJob, containers: MaritimeContainer[] = [], companyName = 'منظومة Z-Systems للشحن الملاحي') {
  const printWindow = window.open('', '_blank', 'width=950,height=1000');
  if (!printWindow) return;

  const containersList = containers.length > 0 ? containers : (job.containers || []);
  const totalWeight = containersList.reduce((sum, c) => sum + Number(c.gross_weight_kg || 0), 0);
  const totalCbm = containersList.reduce((sum, c) => sum + Number(c.cbm || 0), 0);

  const containerRowsHtml = containersList.map((c, idx) => `
    <tr>
      <td style="text-align: center; font-weight: 700;">${idx + 1}</td>
      <td style="font-weight: 800; font-family: monospace;">${escapeHtml(c.container_number)}</td>
      <td>${escapeHtml(c.container_type)}</td>
      <td style="font-family: monospace;">${escapeHtml(c.seal_number || '—')}</td>
      <td style="text-align: right;">${Number(c.gross_weight_kg || 0).toLocaleString()} KG</td>
      <td style="text-align: right;">${Number(c.cbm || 0).toFixed(2)} CBM</td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html dir="ltr" lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Bill of Lading - ${escapeHtml(job.hbl_number || job.job_number)}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #0f172a; margin: 0; padding: 15px; line-height: 1.35; }
          .bl-container { border: 2px solid #0f172a; padding: 0; }
          .bl-header { display: grid; grid-template-columns: 2fr 1fr; border-bottom: 2px solid #0f172a; }
          .bl-title-box { padding: 14px; background: #f8fafc; border-left: 2px solid #0f172a; text-align: center; }
          .bl-title { font-size: 18px; font-weight: 900; letter-spacing: 1px; color: #170e5e; margin: 0 0 4px; }
          .bl-doc-num { font-size: 14px; font-weight: 800; color: #0f172a; font-family: monospace; }
          .bl-forwarder { padding: 14px; }
          .bl-forwarder h2 { margin: 0 0 4px; font-size: 16px; color: #170e5e; }

          .grid-2 { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid #0f172a; }
          .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; border-bottom: 1px solid #0f172a; }
          .grid-4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; border-bottom: 1px solid #0f172a; }

          .cell { padding: 7px 10px; border-right: 1px solid #0f172a; }
          .cell:last-child { border-right: none; }
          .cell-label { font-size: 8.5px; font-weight: 800; text-transform: uppercase; color: #475569; margin-bottom: 2px; }
          .cell-content { font-size: 11px; font-weight: 600; min-height: 28px; }

          table.cargo-table { width: 100%; border-collapse: collapse; margin: 0; }
          table.cargo-table th { background: #f1f5f9; border-bottom: 2px solid #0f172a; border-right: 1px solid #cbd5e1; padding: 6px 8px; font-size: 9px; font-weight: 800; text-transform: uppercase; text-align: left; }
          table.cargo-table td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; font-size: 10.5px; }
          table.cargo-table th:last-child, table.cargo-table td:last-child { border-right: none; }

          .bl-footer { display: grid; grid-template-columns: 2fr 1fr; border-top: 2px solid #0f172a; font-size: 9px; }
          .legal-notice { padding: 10px; color: #64748b; font-size: 8px; line-height: 1.3; border-right: 1px solid #0f172a; }
          .signature-box { padding: 10px; text-align: center; }
          .sign-line { margin-top: 40px; border-top: 1px dashed #475569; padding-top: 4px; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="bl-container">
          <!-- Header -->
          <div class="bl-header">
            <div class="bl-forwarder">
              <h2>${escapeHtml(companyName)}</h2>
              <div style="color: #475569; font-size: 9.5px;">INTERNATIONAL FREIGHT FORWARDING & LOGISTICS SERVICES</div>
              <div style="margin-top: 4px; font-size: 10px;">Carrier / Ocean Line: <strong>${escapeHtml(job.shipping_line_name)}</strong></div>
            </div>
            <div class="bl-title-box">
              <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                <div style="flex: 1; text-align: left;">
                  <div class="bl-title">BILL OF LADING</div>
                  <div class="bl-doc-num">B/L NO: ${escapeHtml(job.hbl_number || job.mbl_number || job.job_number)}</div>
                  <div style="font-size: 9px; color: #64748b; margin-top: 4px;">Job Ref: ${escapeHtml(job.job_number)}</div>
                </div>
                ${job.tracking_token || job.hbl_number || job.job_number ? `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px solid #cbd5e1; padding: 4px; border-radius: 4px; background: #ffffff;">
                  ${getTrackingQrCode(job.tracking_token || job.hbl_number || job.job_number, 58)}
                  <span style="font-size: 6.5px; font-weight: 800; color: #170e5e; margin-top: 2px;">LIVE AIS TRACKING</span>
                </div>
                ` : ''}
              </div>
            </div>
          </div>

          <!-- Parties -->
          <div class="grid-2">
            <div class="cell">
              <div class="cell-label">1. SHIPPER / EXPORTER</div>
              <div class="cell-content">${escapeHtml(job.shipper_details || 'AS PER COMMERCIAL INVOICE')}</div>
            </div>
            <div class="cell">
              <div class="cell-label">BOOKING / EXPORT REF NO.</div>
              <div class="cell-content">
                <strong>${escapeHtml(job.booking_number || 'BKG-' + job.job_number)}</strong>
                ${job.mbl_number ? `<div style="font-size: 9.5px; color: #475569;">MBL: ${escapeHtml(job.mbl_number)}</div>` : ''}
                ${job.acid_number ? `<div style="margin-top: 3px; font-size: 8.5px; color: #166534; background: #f0fdf4; border: 1px solid #86efac; border-radius: 2px; padding: 1px 4px; font-family: monospace;">EGYPT ACID: <strong>${escapeHtml(job.acid_number)}</strong></div>` : ''}
              </div>
            </div>
          </div>

          <div class="grid-2">
            <div class="cell">
              <div class="cell-label">2. CONSIGNEE (NAME & COMPLETE ADDRESS)</div>
              <div class="cell-content"><strong>${escapeHtml(job.customer_name)}</strong><br/>${escapeHtml(job.consignee_details || 'TO ORDER')}</div>
            </div>
            <div class="cell">
              <div class="cell-label">3. NOTIFY PARTY / LOCAL CLEARANCE AGENT</div>
              <div class="cell-content">${escapeHtml(job.notify_party || 'SAME AS CONSIGNEE')}</div>
            </div>
          </div>

          <!-- Vessel & Route -->
          <div class="grid-4">
            <div class="cell">
              <div class="cell-label">VESSEL NAME</div>
              <div class="cell-content">${escapeHtml(job.vessel_name || 'TBN (To Be Nominated)')}</div>
            </div>
            <div class="cell">
              <div class="cell-label">VOYAGE NO.</div>
              <div class="cell-content">${escapeHtml(job.voyage_number || '—')}</div>
            </div>
            <div class="cell">
              <div class="cell-label">PORT OF LOADING (POL)</div>
              <div class="cell-content"><strong>${escapeHtml(job.pol_name)}</strong> (${escapeHtml(job.pol_code)})</div>
            </div>
            <div class="cell">
              <div class="cell-label">PORT OF DISCHARGE (POD)</div>
              <div class="cell-content"><strong>${escapeHtml(job.pod_name)}</strong> (${escapeHtml(job.pod_code)})</div>
            </div>
          </div>

          <!-- Cargo and Container Spec -->
          <div style="min-height: 220px; border-bottom: 2px solid #0f172a;">
            <table class="cargo-table">
              <thead>
                <tr>
                  <th style="width: 35px; text-align: center;">Item</th>
                  <th>Container No.</th>
                  <th>Equipment Type</th>
                  <th>Seal No.</th>
                  <th style="text-align: right;">Gross Weight</th>
                  <th style="text-align: right;">Measurement</th>
                </tr>
              </thead>
              <tbody>
                ${containerRowsHtml || '<tr><td colspan="6" style="text-align: center; padding: 25px; color: #94a3b8;">No container equipment registered</td></tr>'}
              </tbody>
            </table>
          </div>

          <!-- Cargo Summary & Terms -->
          <div class="grid-3">
            <div class="cell">
              <div class="cell-label">FREIGHT & CHARGES PAYMENT</div>
              <div class="cell-content" style="text-transform: uppercase; font-weight: 800; color: #170e5e;">
                FREIGHT ${job.payment_term === 'collect' ? 'COLLECT' : 'PREPAID'}
              </div>
            </div>
            <div class="cell">
              <div class="cell-label">NUMBER OF ORIGINAL B/Ls</div>
              <div class="cell-content"><strong>${job.bl_type === 'sea_waybill' ? 'ZERO (SEA WAYBILL)' : 'THREE (3)'}</strong></div>
            </div>
            <div class="cell">
              <div class="cell-label">TOTAL EQUIPMENT & WEIGHT</div>
              <div class="cell-content">
                <strong>${containersList.length} Container(s)</strong> | ${totalWeight.toLocaleString()} KG | ${totalCbm.toFixed(2)} CBM
              </div>
            </div>
          </div>

          <!-- Footer & Signature -->
          <div class="bl-footer">
            <div class="legal-notice">
              Received by the Carrier in apparent good order and condition, unless otherwise noted hereon, the total number of Containers or packages stated above for carriage to the specified destination. In witness whereof, the Carrier has signed the specified number of Bills of Lading, all of this tenor and date, one of which being accomplished, the others to stand void.
            </div>
            <div class="signature-box">
              <div style="font-size: 8.5px; font-weight: 700; color: #475569;">FOR AND ON BEHALF OF THE CARRIER</div>
              <div class="sign-line">${escapeHtml(companyName)}</div>
              <div style="font-size: 8px; color: #94a3b8; margin-top: 3px;">Date: ${new Date().toLocaleDateString('en-GB')}</div>
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
