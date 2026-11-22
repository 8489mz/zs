import type { MaritimeJob, MaritimeContainer } from '../../api/maritime-freight.api';
import { escapeHtml, getTrackingQrCode } from './print-helpers';

/**
 * Generates and prints official Shipping Instructions (S/I)
 * submitted by the Freight Forwarder to Ocean Carriers / Airlines before B/L or AWB draft issuance.
 */
export function printShippingInstructions(
  job: MaritimeJob,
  containers: MaritimeContainer[] = [],
  companyName = 'منظومة Z-Systems للشحن الدولي واللوجستيات',
) {
  const printWindow = window.open('', '_blank', 'width=950,height=1000');
  if (!printWindow) return;

  const containersList = containers.length > 0 ? containers : (job.containers || []);
  const totalWeight = containersList.reduce((sum, c) => sum + Number(c.gross_weight_kg || 0), Number(job.gross_weight_kg || 0));
  const totalCbm = containersList.reduce((sum, c) => sum + Number(c.cbm || 0), Number(job.total_cbm || 0));
  const siNo = `SI-${escapeHtml(job.job_number)}`;

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
        <title>Shipping Instructions - ${escapeHtml(siNo)}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #0f172a; margin: 0; padding: 18px; line-height: 1.4; }
          .si-container { border: 2px solid #170e5e; border-radius: 8px; padding: 18px; }
          .si-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #170e5e; padding-bottom: 12px; margin-bottom: 16px; }
          .si-title { font-size: 18px; font-weight: 900; color: #170e5e; margin: 0 0 4px; }
          .si-badge { background: #eff6ff; border: 1.5px solid #1d4ed8; padding: 8px 14px; border-radius: 6px; text-align: right; }
          .si-badge h4 { margin: 0; font-size: 14px; color: #1e40af; font-family: monospace; }

          .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
          .card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; background: #f8fafc; }
          .card-title { font-size: 9.5px; font-weight: 800; color: #170e5e; text-transform: uppercase; margin-bottom: 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px; }
          .card-content { font-size: 11px; font-weight: 600; line-height: 1.45; }

          table.cargo-table { width: 100%; border-collapse: collapse; margin: 14px 0; }
          table.cargo-table th { background: #170e5e; color: #ffffff; padding: 6px 8px; font-size: 9px; font-weight: 800; text-transform: uppercase; text-align: left; }
          table.cargo-table td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 10.5px; }

          .terms-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; background: #eff6ff; padding: 10px 14px; border-radius: 6px; border: 1px solid #bfdbfe; }
          .term-item strong { display: block; font-size: 8.5px; color: #1e40af; text-transform: uppercase; }
          .term-item span { font-size: 11.5px; font-weight: 800; color: #0f172a; }

          .sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 30px; text-align: center; }
          .sign-box { border-top: 1px dashed #64748b; padding-top: 8px; font-size: 10.5px; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="si-container">
          <div class="si-header">
            <div>
              <div class="si-title">SHIPPING INSTRUCTIONS (S/I)</div>
              <div style="font-size: 10px; color: #64748b;">FREIGHT FORWARDER STANDARD B/L ISSUANCE INSTRUCTIONS</div>
              <div style="font-size: 11px; font-weight: 700; color: #170e5e; margin-top: 3px;">${escapeHtml(companyName)}</div>
            </div>
            <div style="display: flex; align-items: center; gap: 12px;">
              <div class="si-badge">
                <div style="font-size: 8.5px; color: #64748b;">S/I REFERENCE NO.</div>
                <h4>${escapeHtml(siNo)}</h4>
                <div style="font-size: 9px; color: #475569; margin-top: 2px;">Booking: ${escapeHtml(job.booking_number || '—')}</div>
              </div>
              <div style="border: 1px solid #cbd5e1; padding: 4px; border-radius: 4px; background: #ffffff;">
                ${getTrackingQrCode(job.tracking_token || job.job_number, 50)}
              </div>
            </div>
          </div>

          <div class="terms-grid">
            <div class="term-item">
              <strong>Carrier / Shipping Line</strong>
              <span>${escapeHtml(job.shipping_line_name)}</span>
            </div>
            <div class="term-item">
              <strong>Vessel & Voyage</strong>
              <span>${escapeHtml(job.vessel_name || 'TBN')} / ${escapeHtml(job.voyage_number || '—')}</span>
            </div>
            <div class="term-item">
              <strong>Freight Payment Term</strong>
              <span style="color: #170e5e;">${job.payment_term === 'collect' ? 'FREIGHT COLLECT' : 'FREIGHT PREPAID'}</span>
            </div>
            <div class="term-item">
              <strong>B/L Type Required</strong>
              <span>${job.bl_type === 'sea_waybill' ? 'SEA WAYBILL / EXPRESS' : 'ORIGINAL (3/3)'}</span>
            </div>
          </div>

          <div class="grid-2">
            <div class="card">
              <div class="card-title">1. Shipper / Exporter</div>
              <div class="card-content">${escapeHtml(job.shipper_details || 'AS PER COMMERCIAL INVOICE')}</div>
            </div>
            <div class="card">
              <div class="card-title">2. Consignee</div>
              <div class="card-content">
                <strong>${escapeHtml(job.customer_name)}</strong><br/>
                ${escapeHtml(job.consignee_details || 'TO ORDER')}
              </div>
            </div>
            <div class="card">
              <div class="card-title">3. Notify Party</div>
              <div class="card-content">${escapeHtml(job.notify_party || 'SAME AS CONSIGNEE')}</div>
            </div>
            <div class="card">
              <div class="card-title">4. Routing & Ports</div>
              <div class="card-content">
                POL: <strong>${escapeHtml(job.pol_name)}</strong> (${escapeHtml(job.pol_code)})<br/>
                POD: <strong>${escapeHtml(job.pod_name)}</strong> (${escapeHtml(job.pod_code)})<br/>
                Cut-off Date: ${escapeHtml(job.port_cut_off ? new Date(job.port_cut_off).toLocaleDateString() : '—')}
              </div>
            </div>
          </div>

          <table class="cargo-table">
            <thead>
              <tr>
                <th style="width: 30px; text-align: center;">#</th>
                <th>Container No.</th>
                <th>Type</th>
                <th>Seal No.</th>
                <th style="text-align: right;">Gross Weight</th>
                <th style="text-align: right;">Measurement</th>
              </tr>
            </thead>
            <tbody>
              ${containerRowsHtml || '<tr><td colspan="6" style="text-align: center; padding: 15px; color: #94a3b8;">No containers registered</td></tr>'}
            </tbody>
            <tfoot>
              <tr style="font-weight: 800; background: #f8fafc;">
                <td colspan="4" style="text-align: right; padding: 6px 10px;">Total Weight & Volume:</td>
                <td style="text-align: right; padding: 6px 10px;">${totalWeight.toLocaleString()} KG</td>
                <td style="text-align: right; padding: 6px 10px;">${totalCbm.toFixed(2)} CBM</td>
              </tr>
            </tfoot>
          </table>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 14px; margin-bottom: 20px; font-size: 10.5px;">
            <strong>Special Instructions & Remarks:</strong>
            <div style="margin-top: 3px; color: #475569;">
              ${escapeHtml(job.notes || 'Please release Draft B/L for shipper verification prior to vessel departure. Clean On Board Bill of Lading required.')}
            </div>
          </div>

          <div class="sign-grid">
            <div class="sign-box">
              Prepared by Forwarder Operations<br/>
              <strong>${escapeHtml(companyName)}</strong>
            </div>
            <div class="sign-box">
              Carrier Booking Confirmation Officer<br/>
              <strong>${escapeHtml(job.shipping_line_name)}</strong>
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
