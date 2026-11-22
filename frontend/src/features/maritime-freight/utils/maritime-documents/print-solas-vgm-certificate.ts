import type { MaritimeJob, MaritimeContainer } from '../../api/maritime-freight.api';
import { escapeHtml, getTrackingQrCode } from './print-helpers';
import { todayLocalDateKey } from '@/lib/format';

/**
 * Generates and prints an official SOLAS Verified Gross Mass (VGM) Certificate
 * conforming to IMO SOLAS Chapter VI Regulation 2 and international maritime safety standards.
 */
export function printSolasVgmCertificate(
  job: MaritimeJob,
  container?: MaritimeContainer,
  vgmDetails?: {
    method?: 'method_1' | 'method_2';
    verifiedGrossMassKg?: number;
    tareWeightKg?: number;
    cargoWeightKg?: number;
    weighingStation?: string;
    scaleId?: string;
    calibrationCertNo?: string;
    signatoryName?: string;
    weighingDate?: string;
  },
  companyName = 'منظومة Z-Systems للشحن الملاحي الدولي',
) {
  const printWindow = window.open('', '_blank', 'width=950,height=1000');
  if (!printWindow) return;

  const targetContainer = container || job.containers?.[0];
  const containerNo = targetContainer?.container_number || 'CONU0000000';
  const containerType = targetContainer?.container_type || "40' HC";
  const sealNo = targetContainer?.seal_number || '—';

  const method = vgmDetails?.method || (targetContainer as any)?.vgm_method || 'method_1';
  const isMethod1 = method === 'method_1';
  const tareWeight = Number(vgmDetails?.tareWeightKg || (targetContainer as any)?.tare_weight_kg || (containerType.includes('20') ? 2250 : 3850));
  const grossWeight = Number(vgmDetails?.verifiedGrossMassKg || (targetContainer as any)?.vgm_weight_kg || targetContainer?.gross_weight_kg || 0);
  const cargoWeight = Number(vgmDetails?.cargoWeightKg || (targetContainer as any)?.cargo_weight_kg || Math.max(0, grossWeight - tareWeight));
  const weighingStation = vgmDetails?.weighingStation || (targetContainer as any)?.weighing_station || 'محطة الميزان المعتمدة بميناء الشحن';
  const scaleId = vgmDetails?.scaleId || (targetContainer as any)?.scale_id || 'CAL-SCALE-01';
  const calibrationCertNo = vgmDetails?.calibrationCertNo || (targetContainer as any)?.calibration_cert_no || 'ISO/IEC-17025-VGM';
  const signatoryName = vgmDetails?.signatoryName || (targetContainer as any)?.vgm_signatory_name || job.customer_name || 'Authorized Signatory';
  const weighingDate = vgmDetails?.weighingDate || (targetContainer as any)?.vgm_weighing_date || todayLocalDateKey();
  const vgmCertNo = `VGM-${escapeHtml(job.job_number)}-${containerNo.slice(-4)}`;

  const html = `
    <!DOCTYPE html>
    <html dir="ltr" lang="en">
      <head>
        <meta charset="utf-8" />
        <title>SOLAS VGM Certificate - ${escapeHtml(vgmCertNo)}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11.5px; color: #0f172a; margin: 0; padding: 20px; line-height: 1.45; }
          .vgm-container { border: 2px solid #170e5e; border-radius: 8px; padding: 20px; }
          .vgm-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #170e5e; padding-bottom: 14px; margin-bottom: 16px; }
          .vgm-title { font-size: 18px; font-weight: 900; color: #170e5e; margin: 0 0 4px; letter-spacing: 0.5px; }
          .vgm-badge { background: #eff6ff; border: 1.5px solid #1d4ed8; padding: 8px 14px; border-radius: 6px; text-align: right; }
          .vgm-badge h4 { margin: 0; font-size: 13px; color: #1e40af; font-family: monospace; }

          .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
          .card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; background: #f8fafc; }
          .card-title { font-size: 10px; font-weight: 800; color: #170e5e; text-transform: uppercase; margin-bottom: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
          .row { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px; }
          .row span:first-child { color: #64748b; font-weight: 600; }
          .row span:last-child { font-weight: 700; color: #0f172a; }

          .vgm-mass-banner { background: #f0fdf4; border: 2px solid #16a34a; border-radius: 8px; padding: 16px; margin-bottom: 20px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; text-align: center; }
          .mass-item strong { display: block; font-size: 10px; color: #166534; text-transform: uppercase; margin-bottom: 4px; }
          .mass-item .val { font-size: 20px; font-weight: 900; color: #14532d; font-family: monospace; }

          .method-box { background: #eff6ff; border: 1px solid #93c5fd; border-radius: 6px; padding: 12px; margin-bottom: 20px; }
          .method-box strong { color: #1e40af; font-size: 12px; }

          .sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; text-align: center; }
          .sign-box { border-top: 1px dashed #64748b; padding-top: 8px; font-size: 10.5px; font-weight: 700; }
          .legal-footer { margin-top: 30px; font-size: 9px; color: #64748b; line-height: 1.4; border-top: 1px solid #e2e8f0; padding-top: 10px; }
        </style>
      </head>
      <body>
        <div class="vgm-container">
          <div class="vgm-header">
            <div>
              <div class="vgm-title">SOLAS VERIFIED GROSS MASS (VGM) CERTIFICATE</div>
              <div style="font-size: 10.5px; color: #475569;">Conforming to IMO SOLAS Convention Chapter VI, Regulation 2 / MSC.1/Circ.1475</div>
              <div style="font-size: 11px; font-weight: 700; color: #170e5e; margin-top: 4px;">${escapeHtml(companyName)}</div>
            </div>
            <div style="display: flex; align-items: center; gap: 12px;">
              <div class="vgm-badge">
                <div style="font-size: 9px; color: #64748b;">CERTIFICATE NO.</div>
                <h4>${escapeHtml(vgmCertNo)}</h4>
                <div style="font-size: 9px; color: #475569; margin-top: 2px;">Job: #${escapeHtml(job.job_number)}</div>
              </div>
              <div style="border: 1px solid #cbd5e1; padding: 4px; border-radius: 4px; background: #ffffff;">
                ${getTrackingQrCode(job.tracking_token || job.job_number, 52)}
              </div>
            </div>
          </div>

          <div class="vgm-mass-banner">
            <div class="mass-item">
              <strong>Verified Gross Mass (VGM)</strong>
              <div class="val" style="color: #15803d; font-size: 22px;">${grossWeight.toLocaleString()} KG</div>
            </div>
            <div class="mass-item">
              <strong>Container Tare Weight</strong>
              <div class="val" style="color: #0369a1;">${tareWeight.toLocaleString()} KG</div>
            </div>
            <div class="mass-item">
              <strong>Cargo Net Mass</strong>
              <div class="val" style="color: #475569;">${cargoWeight.toLocaleString()} KG</div>
            </div>
          </div>

          <div class="method-box">
            <strong>Verification Method Applied:</strong>
            <div style="margin-top: 4px; font-size: 11px; color: #1e3a8a;">
              ${isMethod1
                ? 'Method 1: Weighing the packed container using calibrated and certified weighing equipment (Weighbridge / Port scale).'
                : 'Method 2: Weighing all packages and cargo items including pallets, dunnage, and securing material, plus the tare mass of the container.'}
            </div>
          </div>

          <div class="grid-2">
            <div class="card">
              <div class="card-title">Container & Vessel Information</div>
              <div class="row"><span>Container Number:</span><span style="font-family: monospace; font-size: 12px; color: #170e5e;">${escapeHtml(containerNo)}</span></div>
              <div class="row"><span>Container Type / Size:</span><span>${escapeHtml(containerType)}</span></div>
              <div class="row"><span>Seal Number:</span><span style="font-family: monospace;">${escapeHtml(sealNo)}</span></div>
              <div class="row"><span>Ocean Carrier / Line:</span><span>${escapeHtml(job.shipping_line_name)}</span></div>
              <div class="row"><span>Vessel / Voyage:</span><span>${escapeHtml(job.vessel_name || 'TBN')} / ${escapeHtml(job.voyage_number || '—')}</span></div>
              <div class="row"><span>B/L or Booking No:</span><span>${escapeHtml(job.hbl_number || job.booking_number || job.job_number)}</span></div>
            </div>

            <div class="card">
              <div class="card-title">Weighing Station & Scale Verification</div>
              <div class="row"><span>Weighing Facility:</span><span>${escapeHtml(weighingStation)}</span></div>
              <div class="row"><span>Scale / Weighbridge ID:</span><span style="font-family: monospace;">${escapeHtml(scaleId)}</span></div>
              <div class="row"><span>Calibration Certificate:</span><span style="font-family: monospace;">${escapeHtml(calibrationCertNo)}</span></div>
              <div class="row"><span>Weighing Date & Time:</span><span>${escapeHtml(weighingDate)}</span></div>
              <div class="row"><span>Port of Loading (POL):</span><span>${escapeHtml(job.pol_name)} (${escapeHtml(job.pol_code)})</span></div>
              <div class="row"><span>Port of Discharge (POD):</span><span>${escapeHtml(job.pod_name)} (${escapeHtml(job.pod_code)})</span></div>
            </div>
          </div>

          <div class="sign-grid">
            <div class="sign-box">
              Shipper / Authorized Representative<br/>
              <strong>${escapeHtml(signatoryName)}</strong>
              <div style="margin-top: 35px; border-top: 1px dashed #475569; padding-top: 4px;">Authorized Signature & Company Stamp</div>
            </div>
            <div class="sign-box">
              Weighbridge Officer / Station Supervisor<br/>
              <strong>Certified Weighing Facility</strong>
              <div style="margin-top: 35px; border-top: 1px dashed #475569; padding-top: 4px;">Scale Operator Signature</div>
            </div>
          </div>

          <div class="legal-footer">
            <strong>Declaration of Compliance:</strong> The undersigned hereby certifies that the gross mass of the container identified above has been determined in accordance with the International Convention for the Safety of Life at Sea (SOLAS), Chapter VI, Regulation 2. It is acknowledged that this document forms the regulatory basis for vessel stowage planning and maritime safety.
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
