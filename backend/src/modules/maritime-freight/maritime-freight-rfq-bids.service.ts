import { NotFoundException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { sql, type Kysely } from '../../database/kysely';
import { type Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { SubmitMaritimeBidDto } from './dto/submit-bid.dto';
import { formatLocalCalendarDay } from '../../common/utils/tenant-timezone.util';
import { type MaritimeMailService } from './maritime-mail.service';
import nodemailer from 'nodemailer';

/**
 * MaritimeFreightRfqBidsService — slice S2 of the maritime-freight split.
 * Pure move of 5 methods from MaritimeFreightService (RFQs + bids:
 * dispatch + submit + award + the two carrier-text parsers). No
 * behavior change: the bodies are byte-identical; the facade keeps thin
 * delegates with the same names and signatures. Deps are db + the
 * bound maritimeMailService (used once, by dispatchRfqEmails — the
 * only method in the file that sends mail); no cross-slice deps. The
 * slice declares its own Logger (prep §4 — S2 is one of the 6 logger
 * slices); the facade logger stays (merge-owned prune decision).
 * dispatchRfqEmails (213L) sends real emails and is UNPINNED — pure
 * move, recorded, not a blocker. submitBid + awardBid are PINNED
 * (maritime-rfq-terminal-state drives them). The two parsers are sync
 * (no async) and are called from the automation scheduler, not in-class.
 * Clock travels verbatim: parseCarrierBookingText carries one
 * new Date(x) parse + one toISOString() (pure moves, no UTC-slice
 * normalizer, no instant comparison). awardBid carries the slice's
 * only this.db.transaction() (safe tx site — no callees inside it,
 * prep §9). The '4. Bids Management' + two AI-parser banners travel
 * byte-identical into the slice (file #8 S9 precedent). No spec
 * repoint travels in this patch — merge-owned.
 */

export interface MaritimeFreightRfqBidsDeps {
  db: Kysely<Database>;
  // Bound dep (same name as the facade member, so the moved body is
  // byte-identical). maritimeMailService is used by ONE method in the
  // whole file: dispatchRfqEmails (this slice).
  maritimeMailService: MaritimeMailService;
}

/**
 * The day key of a date written in carrier text. A dash date
 * (YYYY-MM-DD) parses as a UTC-midnight Date, so it keys from
 * the UTC slice; every other accepted shape (15 Nov 2026,
 * 2026/11/15, 11/15/2026) parses as a host-local midnight Date,
 * so it keys from its local parts — the UTC slice would show
 * the previous day on east hosts. Unparseable text passes
 * through unchanged, as before.
 */
export function rfqDateKey(rawDate: string): string {
  const parsed = new Date(rawDate);
  if (isNaN(parsed.getTime())) return rawDate;
  if (/^\d{4}-\d{2}-\d{2}/.test(rawDate)) return parsed.toISOString().split('T')[0];
  return formatLocalCalendarDay(parsed);
}

@Injectable()
export class MaritimeFreightRfqBidsService {
  private readonly logger = new Logger(MaritimeFreightRfqBidsService.name);
  private readonly db: Kysely<Database>;
  private readonly maritimeMailService: MaritimeMailService;

  constructor(deps: MaritimeFreightRfqBidsDeps) {
    this.db = deps.db;
    this.maritimeMailService = deps.maritimeMailService;
  }

  async dispatchRfqEmails(auth: AuthContext, rfqId: string, customLineIds?: number[]) {
    const { tenantId } = requireTenantScope(auth);
    const rfq = await this.db
      .selectFrom('maritime_rfqs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', rfqId)
      .executeTakeFirst();

    if (!rfq) throw new NotFoundException('RFQ not found');

    const lineIds: number[] =
      Array.isArray(customLineIds) && customLineIds.length > 0
        ? customLineIds
        : Array.isArray(rfq.target_line_ids)
          ? rfq.target_line_ids
          : [];

    if (lineIds.length === 0) {
      return { sentCount: 0, message: 'No target shipping lines selected' };
    }

    const carriers = await this.db
      .selectFrom('shipping_lines')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', 'in', lineIds.map(String))
      .execute();
    if (new Set(carriers.map((carrier) => String(carrier.id))).size !== new Set(lineIds.map(String)).size) {
      throw new BadRequestException('One or more shipping lines do not belong to this tenant');
    }
    if (Array.isArray(customLineIds) && customLineIds.length > 0) {
      await this.db
        .updateTable('maritime_rfqs')
        .set({ target_line_ids: JSON.stringify(customLineIds) })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', rfqId)
        .execute();
    }

    let sentCount = 0;
    // Fetch custom mail configuration configured by user in maritime settings
    const mailConfigRow = await this.db
      .selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', 'maritime_mail_config')
      .executeTakeFirst();

    let customMailConfig: any = null;
    if (mailConfigRow?.value) {
      try {
        customMailConfig =
          typeof mailConfigRow.value === 'string' ? JSON.parse(mailConfigRow.value) : mailConfigRow.value;
      } catch {}
    }

    // Query tenant and core settings for dynamic tenant branding fallbacks
    const tenantRow = await this.db
      .selectFrom('tenants')
      .select(['business_name', 'owner_email', 'owner_phone'])
      .where('id', '=', tenantId)
      .executeTakeFirst();

    const companySettingsRows = await this.db
      .selectFrom('settings')
      .select(['key', 'value'])
      .where('tenant_id', '=', tenantId)
      .where('key', 'in', ['companyName', 'storeName', 'email', 'phone'])
      .execute();

    const companySettings = companySettingsRows.reduce<Record<string, string>>((acc, r) => {
      try {
        acc[r.key] = JSON.parse(r.value);
      } catch {
        acc[r.key] = r.value;
      }
      return acc;
    }, {});

    const defaultCompanyName =
      companySettings.companyName ||
      companySettings.storeName ||
      tenantRow?.business_name ||
      'إدارة العمليات واللوجستيات';
    const defaultCompanyEmail = companySettings.email || tenantRow?.owner_email || '';
    const defaultCompanyPhone = companySettings.phone || tenantRow?.owner_phone || '';

    const host = String(customMailConfig?.smtpHost || process.env.SMTP_HOST || '').trim();
    const port = Number(customMailConfig?.smtpPort || process.env.SMTP_PORT || 587);
    const user = String(customMailConfig?.smtpUser || process.env.SMTP_USER || '').trim();
    const pass = String(customMailConfig?.smtpPassword || process.env.SMTP_PASSWORD || '').trim();
    const rawFromEmail = String(customMailConfig?.fromEmail || '').trim();
    const fromEmail =
      rawFromEmail && rawFromEmail.includes('@')
        ? rawFromEmail
        : user && user.includes('@')
          ? user
          : defaultCompanyEmail || String(process.env.SMTP_FROM || '').trim();
    const fromName = String(customMailConfig?.fromName?.trim() || defaultCompanyName).trim();

    let transporter: any = null;
    if (host && user && pass) {
      try {
        transporter = nodemailer.createTransport({
          host,
          port,
          secure: port === 465,
          auth: { user, pass },
          tls: { rejectUnauthorized: false },
          connectionTimeout: 5000,
          greetingTimeout: 5000,
          socketTimeout: 5000,
        });
      } catch (err: any) {
        this.logger.warn(`Mailer config exists but failed to initialize: ${err?.message}`);
      }
    }

    const replacePlaceholders = (templateStr: string, carrierName: string) => {
      return templateStr
        .replace(/{{rfq_number}}/g, rfq.rfq_number || '')
        .replace(/{{carrier_name}}/g, carrierName || '')
        .replace(/{{pol_code}}/g, rfq.pol_code || '')
        .replace(/{{pod_code}}/g, rfq.pod_code || '')
        .replace(/{{pol_name}}/g, rfq.pol_name || '')
        .replace(/{{pod_name}}/g, rfq.pod_name || '')
        .replace(/{{container_count}}/g, String(rfq.container_count || 1))
        .replace(/{{container_type}}/g, rfq.container_type || '40HC')
        .replace(/{{cargo_mode}}/g, rfq.cargo_mode || 'FCL')
        .replace(/{{commodity}}/g, rfq.commodity_description || 'General Cargo')
        .replace(/{{target_free_days}}/g, String(rfq.target_free_days || 14))
        .replace(/{{incoterm}}/g, rfq.incoterm || 'FOB')
        .replace(/{{company_name}}/g, fromName)
        .replace(/{{company_email}}/g, fromEmail)
        .replace(/{{company_phone}}/g, defaultCompanyPhone);
    };

    const sendPromises = carriers.map(async (carrier) => {
      const targetEmail = carrier.rfq_email || carrier.email;
      if (!targetEmail) return;

      let subject = `[${rfq.rfq_number}] Freight Rate Inquiry: ${rfq.pol_code} to ${rfq.pod_code} (${rfq.container_count}x ${rfq.container_type})`;
      if (customMailConfig?.emailSubjectTemplate?.trim()) {
        subject = replacePlaceholders(
          customMailConfig.emailSubjectTemplate,
          carrier.name_en || carrier.name_ar || 'Carrier',
        );
        if (!subject.includes(rfq.rfq_number)) {
          subject = `[${rfq.rfq_number}] ` + subject;
        }
      }

      const magicLinkUrl = `${process.env.APP_PUBLIC_URL || 'https://app.zsystemai.com'}/portal/carrier-quote/${rfq.id}?carrier=${encodeURIComponent(carrier.code)}&token=${encodeURIComponent(rfq.public_quote_token || '')}`;

      const introHtml = customMailConfig?.emailIntroTemplate?.trim()
        ? `<p>${replacePlaceholders(customMailConfig.emailIntroTemplate, carrier.name_en || carrier.name_ar || 'Carrier').replace(/\n/g, '<br>')}</p>`
        : `<p>Dear <strong>${carrier.name_en || carrier.name_ar || 'Carrier'}</strong> Pricing Desk,</p>
           <p>Please provide your most competitive ocean freight spot rate for the following inquiry:</p>`;

      const signatureHtml = customMailConfig?.emailSignatureTemplate?.trim()
        ? `<div style="margin-top: 24px; padding-top: 14px; border-top: 1px solid #e2e8f0; color: #475569; font-size: 13px;">${replacePlaceholders(customMailConfig.emailSignatureTemplate, '').replace(/\n/g, '<br>')}</div>`
        : `<div style="margin-top: 24px; padding-top: 14px; border-top: 1px solid #e2e8f0; color: #475569; font-size: 13px;">Best regards,<br><strong>${fromName}</strong> Operations Desk<br>${fromEmail}</div>`;

      const html = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 650px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px;">
          <h2 style="color: #170e5e; margin-top: 0;">Ocean Freight Rate Inquiry</h2>
          ${introHtml}
          <table style="border-collapse: collapse; width: 100%; margin: 16px 0; border: 1px solid #e2e8f0; font-size: 13px;">
            <tr style="background: #f8fafc;"><td style="padding: 8px 12px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Reference</td><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">${rfq.rfq_number}</td></tr>
            <tr><td style="padding: 8px 12px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Port of Loading (POL)</td><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">${rfq.pol_name} (${rfq.pol_code})</td></tr>
            <tr style="background: #f8fafc;"><td style="padding: 8px 12px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Port of Discharge (POD)</td><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">${rfq.pod_name} (${rfq.pod_code})</td></tr>
            <tr><td style="padding: 8px 12px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Equipment</td><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">${rfq.container_count} x ${rfq.container_type} (${rfq.cargo_mode})</td></tr>
            <tr style="background: #f8fafc;"><td style="padding: 8px 12px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Commodity</td><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">${rfq.commodity_description || 'General Cargo'}</td></tr>
            <tr><td style="padding: 8px 12px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Target Free Days</td><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">${rfq.target_free_days} Days at Destination</td></tr>
            <tr style="background: #f8fafc;"><td style="padding: 8px 12px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Incoterm / Payment</td><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">${rfq.incoterm} (${rfq.payment_term})</td></tr>
          </table>
          <p style="margin-top: 16px;">
            <a href="${magicLinkUrl}" style="background-color: #170e5e; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
              Submit Your Quote Online Here
            </a>
          </p>
          <p style="color: #64748b; font-size: 12px; margin-top: 12px;">Or simply reply directly to this email keeping [${rfq.rfq_number}] in the subject line.</p>
          ${signatureHtml}
        </div>
      `;

      if (transporter) {
        try {
          await transporter.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to: targetEmail,
            subject,
            html,
          });
          sentCount++;

          // Automatically archive sent RFQ email into IMAP Sent folder
          this.maritimeMailService
            .appendSentEmailToImap(tenantId, {
              fromName,
              fromEmail,
              to: targetEmail,
              subject,
              html,
            })
            .catch((err) => {
              this.logger.warn(`Failed to archive sent RFQ to IMAP Sent: ${err?.message}`);
            });
        } catch (err: any) {
          this.logger.error(`Failed to send RFQ email to ${targetEmail}: ${err?.message}`);
          if (process.env.APP_MODE !== 'CLOUD_SAAS') {
            this.logger.log(
              `[SIMULATION FALLBACK] RFQ Email recorded for ${carrier.name_en} <${targetEmail}>: ${subject}`,
            );
            sentCount++;
          }
        }
      } else {
        this.logger.log(`[SIMULATION] RFQ Email dispatched to ${carrier.name_en} <${targetEmail}>: ${subject}`);
        sentCount++;
      }
    });

    await Promise.allSettled(sendPromises);

    await this.db
      .updateTable('maritime_rfqs')
      .set({ status: 'sent', updated_at: sql`NOW()` })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', rfqId)
      .execute();

    return { sentCount, message: `Dispatched RFQ inquiries to ${sentCount} carriers` };
  }

  // --------------------------------------------------------------------------
  // 4. Bids Management
  // --------------------------------------------------------------------------
  async submitBid(auth: AuthContext, dto: SubmitMaritimeBidDto) {
    const { tenantId } = requireTenantScope(auth);
    const rfq = await this.db
      .selectFrom('maritime_rfqs')
      .select(['id', 'status'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', dto.rfqId)
      .executeTakeFirst();

    if (!rfq) throw new NotFoundException('RFQ not found');

    // INV-MARITIME-RFQ-TERMINAL-STATE: the staff bid path carries the
    // same terminal-state guard as the public magic-link path
    // (submitPublicCarrierBid) -- no new bids on an awarded, closed or
    // cancelled RFQ. Message kept identical to the public path.
    if (['awarded', 'closed', 'cancelled'].includes(rfq.status)) {
      throw new BadRequestException('طلب عروض الأسعار مغلق أو تم ترسيته بالفعل ولا يمكن تقديم عروض إضافية');
    }

    // A public magic-link bid may name a carrier but cannot attach a
    // shipping_line record from another tenant, even if its global ID leaks.
    if (dto?.shippingLineId != null && String(dto.shippingLineId).trim()) {
      const tenantLine = await this.db
        .selectFrom('shipping_lines')
        .select('id')
        .where('id', '=', String(dto.shippingLineId))
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (!tenantLine) throw new BadRequestException('Shipping line does not belong to this company');
    }

    const oceanFreight = Number(dto.oceanFreight || 0);
    const thcOrigin = Number(dto.thcOrigin || 0);
    const thcDestination = Number(dto.thcDestination || 0);
    const bafCharges = Number(dto.bafCharges || 0);
    const otherCharges = Number(dto.otherCharges || 0);

    if (oceanFreight < 0 || thcOrigin < 0 || thcDestination < 0 || bafCharges < 0 || otherCharges < 0) {
      throw new BadRequestException('مبالغ عروض أسعار الناقل لا يمكن أن تكون سالبة');
    }

    const totalFreightCost = oceanFreight + thcOrigin + thcDestination + bafCharges + otherCharges;

    const [bid] = await this.db
      .insertInto('maritime_rfq_bids')
      .values({
        tenant_id: tenantId,
        rfq_id: dto.rfqId,
        shipping_line_id: dto.shippingLineId ? String(dto.shippingLineId) : null,
        shipping_line_name: dto.shippingLineName,
        ocean_freight: oceanFreight,
        currency: dto.currency || 'USD',
        thc_origin: thcOrigin,
        thc_destination: thcDestination,
        baf_charges: bafCharges,
        other_charges: otherCharges,
        total_freight_cost: totalFreightCost,
        transit_time_days: dto.transitTimeDays || 0,
        free_days: dto.freeDays || 14,
        validity_date: dto.validityDate || null,
        submission_channel: dto.submissionChannel || 'manual',
        raw_bid_data: dto.rawBidData ? JSON.stringify(dto.rawBidData) : null,
        notes: dto.notes || null,
      })
      .returningAll()
      .execute();

    // Update RFQ status to bids_received if it was sent or draft
    if (rfq.status === 'sent' || rfq.status === 'draft') {
      await this.db
        .updateTable('maritime_rfqs')
        .set({ status: 'bids_received', updated_at: sql`NOW()` })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', dto.rfqId)
        .execute();
    }

    return bid;
  }

  async awardBid(auth: AuthContext, bidId: string) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db.transaction().execute(async (trx: any) => {
      const bid = await trx
        .selectFrom('maritime_rfq_bids')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', bidId)
        .executeTakeFirst();

      if (!bid) throw new NotFoundException('Bid not found');

      // Lock RFQ row to prevent concurrent race conditions
      await sql`SELECT id FROM maritime_rfqs WHERE tenant_id = ${tenantId} AND id = ${bid.rfq_id} FOR UPDATE`.execute(
        trx,
      );

      // INV-MARITIME-RFQ-TERMINAL-STATE: a closed or cancelled RFQ
      // never gains or changes a winner. The row is already locked
      // above, so the status read here is the decision-time status.
      // Re-award within an open or already-awarded RFQ stays allowed:
      // no un-award endpoint exists, and a carrier backing out must
      // not strand the RFQ -- that choice is flagged in the invariant
      // for reversal. A bid whose RFQ row is gone fails closed.
      const rfqRow = await trx
        .selectFrom('maritime_rfqs')
        .select('status')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', bid.rfq_id)
        .executeTakeFirst();
      if (!rfqRow) throw new NotFoundException('RFQ not found');
      if (rfqRow.status === 'closed' || rfqRow.status === 'cancelled') {
        throw new BadRequestException('طلب عروض الأسعار مغلق أو ملغى ولا يمكن ترسية عروض عليه');
      }

      // Un-award any previous bids on the same RFQ
      await trx
        .updateTable('maritime_rfq_bids')
        .set({ is_awarded: false, awarded_at: null })
        .where('tenant_id', '=', tenantId)
        .where('rfq_id', '=', bid.rfq_id)
        .execute();

      // Award this bid
      const [awardedBid] = await trx
        .updateTable('maritime_rfq_bids')
        .set({ is_awarded: true, awarded_at: sql`NOW()` })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', bidId)
        .returningAll()
        .execute();

      // Update RFQ status to awarded
      await trx
        .updateTable('maritime_rfqs')
        .set({ status: 'awarded', updated_at: sql`NOW()` })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', bid.rfq_id)
        .execute();

      return awardedBid;
    });
  }

  // AI & Regex text parser for carrier email bids
  parseCarrierEmailText(rawText: string) {
    let text = String(rawText || '');
    // Strip document numbers (e.g. RFQ-261007-0010, INQ-261007-0005, MSK-...) so digits are not mistaken for prices or free days
    text = text.replace(/\[?(?:RFQ|INQ|QUO|JOB|MSK|BKG)-[A-Z0-9-]+\]?/gi, ' ');

    let oceanFreight = 0;
    let currency = 'USD';
    let freeDays = 14;
    let transitTimeDays = 0;
    let thcOrigin = 0;
    let thcDestination = 0;

    // Currency match with word boundaries
    if (/\b(?:EUR|€)\b/i.test(text)) currency = 'EUR';
    else if (/\b(?:SAR|ريال)\b/i.test(text)) currency = 'SAR';
    else if (/\b(?:EGP|جنيه|جنية)\b/i.test(text)) currency = 'EGP';

    // Ocean Freight Match
    const ofMatch =
      text.match(
        /(?:ocean\s*freight|freight\s*rate|base\s*rate|spot\s*rate|sea\s*freight|\bBAS\b|\bO\/?F\b)\s*[:=-]?\s*(?:\$|USD|EUR|€|EGP|SAR)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
      ) ||
      text.match(/(?:freight|rate)\s*[:=-]\s*(?:\$|USD|EUR|€|EGP|SAR)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i) ||
      text.match(/(?:usd|\$)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i) ||
      text.match(/([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:usd|\$)/i);
    if (ofMatch && ofMatch[1]) {
      oceanFreight = parseFloat(ofMatch[1].replace(/,/g, ''));
    }

    // Free Days Match
    const fdMatch =
      text.match(/(?:free\s*(?:days|time)|detention|demurrage)(?:[^\d\n\r]*?)[:=]?\s*([0-9]{1,2})/i) ||
      text.match(/([0-9]{1,2})\s*(?:days?\s*free|free\s*days?|f\/?d)/i);
    if (fdMatch && fdMatch[1]) {
      freeDays = parseInt(fdMatch[1], 10);
    }

    // Transit Time Match
    const ttMatch = text.match(/(?:transit\s*time|tt|transit)(?:[^\d\n\r]*?)[:=]?\s*([0-9]{1,2})/i);
    if (ttMatch && ttMatch[1]) {
      transitTimeDays = parseInt(ttMatch[1], 10);
    }

    // Origin THC
    const oThcMatch = text.match(
      /(?:origin\s*thc|thc\s*origin|o\.?thc)(?:[^\d\n\r$]*?)[:=]?\s*\$?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    );
    if (oThcMatch && oThcMatch[1]) {
      thcOrigin = parseFloat(oThcMatch[1].replace(/,/g, ''));
    }

    // Destination THC
    const dThcMatch = text.match(
      /(?:dest(?:ination)?\s*thc|thc\s*dest(?:ination)?|d\.?thc)(?:[^\d\n\r$]*?)[:=]?\s*\$?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    );
    if (dThcMatch && dThcMatch[1]) {
      thcDestination = parseFloat(dThcMatch[1].replace(/,/g, ''));
    }

    // Generic THC fallback
    if (!thcOrigin && !thcDestination) {
      const thcMatch = text.match(/thc\s*[:=]?\s*\$?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
      if (thcMatch && thcMatch[1]) {
        thcOrigin = parseFloat(thcMatch[1].replace(/,/g, ''));
      }
    }

    const totalEstimated = oceanFreight + thcOrigin + thcDestination;

    return {
      oceanFreight,
      currency,
      freeDays,
      transitTimeDays,
      thcOrigin,
      thcDestination,
      totalEstimated,
    };
  }

  // AI & Regex text parser for Carrier Booking Confirmations
  parseCarrierBookingText(rawText: string) {
    const text = String(rawText || '');
    let bookingNumber: string | null = null;
    let shippingLineName: string | null = null;
    let vesselName: string | null = null;
    let voyageNumber: string | null = null;
    let polName: string | null = null;
    let podName: string | null = null;
    let etd: string | null = null;
    let eta: string | null = null;
    let portCutOff: string | null = null;
    let mblNumber: string | null = null;
    const containers: Array<{ containerNumber: string; containerType: string }> = [];

    // 1. Detect Shipping Line
    const lines = [
      { name: 'Maersk Line', match: /\b(?:maersk|safmarine|sealand)\b/i },
      { name: 'MSC Mediterranean Shipping', match: /\bmsc\b/i },
      { name: 'CMA CGM', match: /\b(?:cma\s*cgm|cma)\b/i },
      { name: 'Hapag-Lloyd', match: /\bhapag(?:-lloyd)?\b/i },
      { name: 'Cosco Shipping Lines', match: /\bcosco\b/i },
      { name: 'Evergreen Line', match: /\bevergreen\b/i },
      { name: 'Ocean Network Express (ONE)', match: /\b(?:one|ocean\s*network\s*express)\b/i },
      { name: 'Yang Ming', match: /\byang\s*ming\b/i },
      { name: 'ZIM Integrated', match: /\bzim\b/i },
      { name: 'Wan Hai Lines', match: /\bwan\s*hai\b/i },
    ];
    for (const l of lines) {
      if (l.match.test(text)) {
        shippingLineName = l.name;
        break;
      }
    }

    // 2. Booking Number
    const bkgMatch =
      text.match(
        /(?:booking\s*(?:reference|ref|number|no|confirmation|#)|bkg\s*(?:no|#)?)\s*[:=]?\s*([A-Z0-9-]{5,30})/i,
      ) ||
      text.match(/booking\s*[:=]\s*([A-Z0-9-]{5,30})/i) ||
      text.match(/\b([0-9]{9})\b/);
    if (bkgMatch && bkgMatch[1]) {
      bookingNumber = bkgMatch[1].trim();
    }

    // 3. Vessel Name & Voyage
    const vesselMatch = text.match(
      /(?:vessel\s*(?:name)?|mother\s*vessel|ship\s*name)\s*[:=]?\s*([A-Za-z0-9\s.-]+?)(?=\s*(?:voyage|voy|etd|pol|pod|\n|$))/i,
    );
    if (vesselMatch && vesselMatch[1]) {
      vesselName = vesselMatch[1].replace(/[\r\n]+/g, ' ').trim();
    }

    const voyMatch = text.match(/(?:voyage\s*(?:no|number|#)?|voy\s*(?:no|#)?)\s*[:=]?\s*([A-Z0-9-]{2,14})/i);
    if (voyMatch && voyMatch[1]) {
      voyageNumber = voyMatch[1].trim();
    }

    // Helper for date extraction
    const extractDate = (labelRegex: RegExp): string | null => {
      const match = text.match(labelRegex);
      if (!match || !match[1]) return null;
      return rfqDateKey(match[1].trim());
    };

    // 4. ETD / ETA / Cut-off
    etd = extractDate(
      /(?:etd|departure\s*date|sailing\s*date|est\.?\s*dep\.?)\s*[:=]?\s*([0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}|[0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{2,4}|[0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4})/i,
    );
    eta = extractDate(
      /(?:eta|arrival\s*date|est\.?\s*arr\.?)\s*[:=]?\s*([0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}|[0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{2,4}|[0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4})/i,
    );
    portCutOff = extractDate(
      /(?:port\s*cut[- ]?off|cy\s*cut[- ]?off|closing\s*date|cargo\s*cut[- ]?off|cut[- ]?off)\s*[:=]?\s*([0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}|[0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{2,4}|[0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4})/i,
    );

    // 5. POL / POD
    const polMatch = text.match(
      /(?:pol|port\s*of\s*loading|origin\s*port|from)\s*[:=]?\s*([A-Za-z0-9\s,.-]+?)(?=\s*(?:pod|port\s*of\s*discharge|to|etd|\n|$))/i,
    );
    if (polMatch && polMatch[1]) {
      polName = polMatch[1].replace(/[\r\n]+/g, ' ').trim();
    }

    const podMatch = text.match(
      /(?:pod|port\s*of\s*discharge|destination\s*port|to)\s*[:=]?\s*([A-Za-z0-9\s,.-]+?)(?=\s*(?:eta|vessel|\n|$))/i,
    );
    if (podMatch && podMatch[1]) {
      podName = podMatch[1].replace(/[\r\n]+/g, ' ').trim();
    }

    // 6. Master B/L Number
    const mblMatch = text.match(/(?:master\s*b\/?l|mbl|ocean\s*b\/?l|b\/?l\s*no)\s*[:=]?\s*([A-Z0-9-]{6,25})/i);
    if (mblMatch && mblMatch[1]) {
      mblNumber = mblMatch[1].trim();
    } else if (bookingNumber) {
      mblNumber = bookingNumber;
    }

    // 7. Containers Match (e.g. MSKU9482710)
    const containerRegex = /\b([A-Z]{4}\s?[0-9]{7})\b/g;
    let matchC: RegExpExecArray | null;
    const foundContainers = new Set<string>();
    while ((matchC = containerRegex.exec(text)) !== null) {
      const cleanNum = matchC[1].replace(/\s+/g, '').toUpperCase();
      if (!foundContainers.has(cleanNum)) {
        foundContainers.add(cleanNum);
        containers.push({
          containerNumber: cleanNum,
          containerType: /20/i.test(text) ? '20GP' : '40HC',
        });
      }
    }

    return {
      bookingNumber,
      shippingLineName,
      vesselName,
      voyageNumber,
      polName,
      podName,
      etd,
      eta,
      portCutOff,
      mblNumber,
      containers,
    };
  }
}
