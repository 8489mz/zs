import { Injectable, Inject, BadRequestException, Logger } from '@nestjs/common';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../../../../database/database.constants';
import { Database } from '../../../../database/database.types';
import { TaxSettingsService } from '../tax-settings/tax-settings.service';
import { ZatcaPhase2Service, ZatcaPhase2Result } from './zatca-phase2.service';

export interface ZatcaSubmissionResult {
  success: boolean;
  saleId: number;
  docNo: string | null;
  uuid: string;
  invoiceType: 'standard' | 'simplified';
  action: 'clearance' | 'reporting';
  status: 'cleared' | 'reported' | 'warning' | 'rejected' | 'failed';
  httpStatus?: number;
  validationResults?: any;
  message: string;
  clearedXml?: string | null;
}

export interface ZatcaBulkSubmissionSummary {
  success: boolean;
  total: number;
  cleared: number;
  reported: number;
  warning: number;
  rejected: number;
  failed: number;
  results: ZatcaSubmissionResult[];
}

@Injectable()
export class ZatcaSubmissionService {
  private readonly logger = new Logger(ZatcaSubmissionService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly zatcaPhase2Service: ZatcaPhase2Service,
    private readonly taxSettings: TaxSettingsService,
  ) {}

  /**
   * Resolves the official ZATCA API base URL based on environment
   */
  getZatcaBaseUrl(env: string): string {
    switch (env) {
      case 'production':
        return 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core';
      case 'simulation':
        return 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation';
      case 'sandbox':
      default:
        return 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal';
    }
  }

  /**
   * Retrieves pending invoices waiting for ZATCA transmission or needing re-submission
   */
  async getPendingInvoices(tenantId: string) {
    const rows = await this.db
      .selectFrom('sales')
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'posted')
      .where((eb) =>
        eb.or([
          eb('zatca_status', 'is', null),
          eb('zatca_status', 'in', ['not_submitted', 'generated', 'failed', 'rejected']),
        ]),
      )
      .select([
        'id',
        'doc_no',
        'created_at',
        'total',
        'tax_amount',
        'customer_name',
        'zatca_status',
        'zatca_invoice_type',
        'zatca_uuid',
        'zatca_icv',
        'zatca_submitted_at',
      ])
      .orderBy('id', 'asc')
      .execute();

    return rows.map((r) => ({
      id: String(r.id),
      doc_no: r.doc_no,
      created_at: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      total: Number(r.total || 0),
      tax_amount: Number(r.tax_amount || 0),
      customer_name: r.customer_name || 'عميل نقدي',
      zatca_status: r.zatca_status || 'not_submitted',
      zatca_invoice_type: r.zatca_invoice_type || 'simplified',
      zatca_uuid: r.zatca_uuid,
      zatca_icv: r.zatca_icv ? Number(r.zatca_icv) : null,
      zatca_submitted_at: r.zatca_submitted_at ? new Date(r.zatca_submitted_at).toISOString() : null,
    }));
  }

  /**
   * Submits a single invoice to ZATCA for real-time Clearance (B2B) or Reporting (B2C)
   */
  async submitInvoice(tenantId: string, saleId: number, egsId?: string | number): Promise<ZatcaSubmissionResult> {
    // 1. Build Phase 2 package with sequential ICV and PIH chaining under row-level lock
    const pkg: ZatcaPhase2Result = await this.zatcaPhase2Service.buildZatcaInvoice(tenantId, saleId, egsId);

    // 2. Query the updated sale record and customer to determine invoice type
    const sale = await this.db
      .selectFrom('sales')
      .selectAll()
      .where('id', '=', saleId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirstOrThrow();

    const customer = sale.customer_id
      ? await this.db
          .selectFrom('customers')
          .selectAll()
          .where('id', '=', Number(sale.customer_id))
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst()
      : null;

    const isB2B = Boolean(customer?.tax_number);
    const invoiceType: 'standard' | 'simplified' = isB2B ? 'standard' : 'simplified';
    const action: 'clearance' | 'reporting' = isB2B ? 'clearance' : 'reporting';

    // 3. Resolve active EGS unit and credentials
    const settings = await this.taxSettings.getSettings(tenantId, 'ZATCA_SAUDI');
    const assignedEgsId = sale.zatca_egs_id ?? egsId;
    const egs = assignedEgsId
      ? await this.db
          .selectFrom('zatca_egs_units')
          .selectAll()
          .where('id', '=', String(assignedEgsId))
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst()
      : await this.db
          .selectFrom('zatca_egs_units')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where((eb) =>
            sale.branch_id == null ? eb('branch_id', 'is', null) : eb('branch_id', '=', Number(sale.branch_id)),
          )
          .orderBy('id', 'asc')
          .executeTakeFirst();
    if (!egs || (sale.zatca_egs_id && Number(egs.id) !== Number(sale.zatca_egs_id))) {
      throw new BadRequestException('وحدة التوقيع المرتبطة بالفاتورة غير متاحة');
    }

    const env = egs?.environment || settings?.environment || 'sandbox';
    const baseUrl = this.getZatcaBaseUrl(env);

    const csid = egs?.production_csid || egs?.compliance_csid || 'SIMULATED_CSID_TOKEN';
    const secret = egs?.production_secret || egs?.compliance_secret || 'SIMULATED_SECRET_KEY';

    if (env === 'production' && (!egs?.production_csid || egs.status !== 'production_active')) {
      throw new BadRequestException(
        'وحدة الـ EGS غير مفعلة بشهادة إنتاج معتمدة من هيئة الزكاة. يرجى إتمام خطوات الامتثال والتسجيل أولاً.',
      );
    }

    const authHeader = `Basic ${Buffer.from(`${csid}:${secret}`).toString('base64')}`;

    // 4. Prepare ZATCA API URL & Headers
    const endpoint = isB2B ? `${baseUrl}/invoices/clearance/single` : `${baseUrl}/invoices/reporting/single`;

    const requestHeaders: Record<string, string> = {
      'Accept-Language': 'ar',
      'Accept-Version': 'V2',
      'Content-Type': 'application/json',
      Authorization: authHeader,
    };

    if (isB2B) {
      requestHeaders['Clearance-Status'] = '1';
    }

    const requestBody = {
      invoiceHash: pkg.invoiceHash,
      uuid: pkg.uuid,
      invoice: Buffer.from(pkg.ublXml, 'utf8').toString('base64'),
    };

    let httpStatus = 0;
    let responseStatus: string | null = null;
    let finalStatus: 'cleared' | 'reported' | 'warning' | 'rejected' | 'failed' = 'failed';
    let validationResults: any = null;
    let rawResponse = '';
    let clearedXml: string | null = null;
    let message = '';

    // 5. Execute API Transmission
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(requestBody),
      });

      httpStatus = response.status;
      rawResponse = await response.text();

      let jsonRes: any = null;
      try {
        jsonRes = JSON.parse(rawResponse);
      } catch {
        jsonRes = { raw: rawResponse };
      }

      validationResults = jsonRes?.validationResults || null;

      if (response.ok) {
        if (isB2B) {
          responseStatus = jsonRes?.clearanceStatus || 'CLEARED';
          if (responseStatus === 'CLEARED') {
            finalStatus = 'cleared';
            message = 'تم تخليص واعتماد الفاتورة الضريبية (B2B Clearance) بنجاح من هيئة الزكاة والضريبة والجمارك.';
            if (jsonRes?.clearedInvoice) {
              clearedXml = Buffer.from(jsonRes.clearedInvoice, 'base64').toString('utf8');
            }
          } else {
            finalStatus = 'rejected';
            message = 'رفضت هيئة الزكاة تخليص الفاتورة الضريبية.';
          }
        } else {
          responseStatus = jsonRes?.reportingStatus || 'REPORTED';
          if (responseStatus === 'REPORTED') {
            const hasWarnings = (validationResults?.warningMessages?.length || 0) > 0;
            finalStatus = hasWarnings ? 'warning' : 'reported';
            message = hasWarnings
              ? 'تم إبلاغ الفاتورة المبسطة بنجاح مع وجود ملاحظات تحذيرية من هيئة الزكاة.'
              : 'تم إبلاغ الفاتورة المبسطة (B2C Reporting) بنجاح لهيئة الزكاة.';
          } else {
            finalStatus = 'rejected';
            message = 'فشل إبلاغ الفاتورة المبسطة لهيئة الزكاة.';
          }
        }
      } else {
        responseStatus = isB2B ? jsonRes?.clearanceStatus || 'NOT_CLEARED' : jsonRes?.reportingStatus || 'NOT_REPORTED';
        finalStatus = 'rejected';
        const errCount = validationResults?.errorMessages?.length || 0;
        message = `تم رفض الفاتورة من هيئة الزكاة (كود ${httpStatus})${errCount > 0 ? ` مع ${errCount} أخطاء امتثال` : ''}.`;
      }
    } catch (networkErr: any) {
      // INV-ZATCA-NETWORK-FAILURE-NEVER-CLEARS: a network error means
      // ZATCA was never reached, so nothing was cleared or reported —
      // in EVERY environment, sandbox included. The old fallback
      // marked the invoice 'cleared'/'reported' with a PASS
      // validation on any fetch failure in non-production, which made
      // an unsubmitted invoice look compliant, locked it against
      // edits, and dropped it from the pending queue. A failed
      // submission stays 'failed', keeps its built ICV/PIH package
      // (buildZatcaInvoice reuses it on retry), and remains pending.
      this.logger.warn(`ZATCA live transmission network error for invoice ${saleId}: ${networkErr.message}`);
      httpStatus = 0;
      responseStatus = 'FAILED';
      finalStatus = 'failed';
      message = `فشل الاتصال بخوادم هيئة الزكاة والضريبة والجمارك: ${networkErr.message}`;
      rawResponse = networkErr.message;
    }

    // 6. Persist results in sales record
    await this.db
      .updateTable('sales')
      .set({
        zatca_status: finalStatus,
        zatca_submitted_at: new Date(),
        zatca_response_json: validationResults ? JSON.stringify(validationResults) : null,
        zatca_cleared_xml: clearedXml,
        zatca_egs_id: egs?.id ? Number(egs.id) : null,
        zatca_invoice_type: invoiceType,
        updated_at: new Date(),
      })
      .where('id', '=', sale.id)
      .where('tenant_id', '=', tenantId)
      .execute();

    // 7. Insert permanent audit record into zatca_transmission_logs
    await this.db
      .insertInto('zatca_transmission_logs')
      .values({
        tenant_id: tenantId,
        sale_id: sale.id,
        egs_id: egs?.id ? Number(egs.id) : null,
        action_type: action,
        environment: env,
        request_uuid: pkg.uuid,
        invoice_hash: pkg.invoiceHash,
        http_status: httpStatus || null,
        response_status: responseStatus,
        validation_results: validationResults ? JSON.stringify(validationResults) : null,
        raw_response: rawResponse ? rawResponse.slice(0, 10000) : null,
        created_at: new Date(),
      })
      .execute();

    return {
      success: finalStatus === 'cleared' || finalStatus === 'reported' || finalStatus === 'warning',
      saleId: sale.id,
      docNo: sale.doc_no,
      uuid: pkg.uuid,
      invoiceType,
      action,
      status: finalStatus,
      httpStatus,
      validationResults,
      message,
      clearedXml,
    };
  }

  /**
   * Bulk transmits multiple pending invoices sequentially (preserving ICV/PIH chain integrity)
   */
  async bulkSubmitInvoices(tenantId: string, saleIds: number[]): Promise<ZatcaBulkSubmissionSummary> {
    if (!saleIds || saleIds.length === 0) {
      return {
        success: true,
        total: 0,
        cleared: 0,
        reported: 0,
        warning: 0,
        rejected: 0,
        failed: 0,
        results: [],
      };
    }

    // Sort ascending by ID to respect chronological ICV order
    const sortedIds = [...saleIds].sort((a, b) => a - b);
    const results: ZatcaSubmissionResult[] = [];

    let cleared = 0;
    let reported = 0;
    let warning = 0;
    let rejected = 0;
    let failed = 0;

    for (const id of sortedIds) {
      try {
        const res = await this.submitInvoice(tenantId, id);
        results.push(res);
        if (res.status === 'cleared') cleared++;
        else if (res.status === 'reported') reported++;
        else if (res.status === 'warning') warning++;
        else if (res.status === 'rejected') rejected++;
        else failed++;
      } catch (err: any) {
        this.logger.error(`Error in bulk ZATCA submission for invoice ${id}: ${err.message}`);
        failed++;
        results.push({
          success: false,
          saleId: id,
          docNo: `INV-${id}`,
          uuid: '',
          invoiceType: 'simplified',
          action: 'reporting',
          status: 'failed',
          message: err.message || 'خطأ غير متوقع أثناء معالجة الفاتورة',
        });
      }
    }

    return {
      success: failed === 0 && rejected === 0,
      total: sortedIds.length,
      cleared,
      reported,
      warning,
      rejected,
      failed,
      results,
    };
  }

  /**
   * Retrieves transmission audit logs for inspection and reporting
   */
  async getTransmissionLogs(tenantId: string, saleId?: number, limit = 50) {
    let query = this.db.selectFrom('zatca_transmission_logs').selectAll().where('tenant_id', '=', tenantId);

    if (saleId) {
      query = query.where('sale_id', '=', saleId);
    }

    const rows = await query.orderBy('id', 'desc').limit(limit).execute();

    return rows.map((r) => ({
      id: r.id,
      saleId: r.sale_id,
      egsId: r.egs_id,
      actionType: r.action_type,
      environment: r.environment,
      requestUuid: r.request_uuid,
      invoiceHash: r.invoice_hash,
      httpStatus: r.http_status,
      responseStatus: r.response_status,
      validationResults: r.validation_results,
      createdAt: r.created_at,
    }));
  }
}
