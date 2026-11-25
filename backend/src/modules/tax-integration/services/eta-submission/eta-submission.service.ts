import { Inject, Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../../../../database/database.constants';
import { Database } from '../../../../database/database.types';
import { EtaAuthService } from '../eta-auth/eta-auth.service';
import { EtaSerializerService } from '../eta-serializer/eta-serializer.service';
import { TaxSettingsService } from '../tax-settings/tax-settings.service';

@Injectable()
export class EtaSubmissionService {
  private readonly logger = new Logger(EtaSubmissionService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly etaAuthService: EtaAuthService,
    private readonly etaSerializer: EtaSerializerService,
    private readonly taxSettings: TaxSettingsService,
  ) {}

  async getPendingInvoices(tenantId: string) {
    const sales = await this.db
      .selectFrom('sales')
      .where('tenant_id', '=', tenantId)
      .where('eta_status', 'in', ['pending', 'failed'])
      .select(['id', 'doc_no', 'created_at', 'total', 'eta_status', 'customer_name'])
      .orderBy('created_at', 'desc')
      .execute();

    return sales;
  }

  async submitInvoices(tenantId: string, invoiceIds: string[]) {
    if (!invoiceIds || invoiceIds.length === 0) {
      return { success: true, count: 0, message: 'لا توجد فواتير محددة للإرسال' };
    }

    const settings = await this.taxSettings.getSettings(tenantId, 'ETA_EGYPT');
    if (!settings || !settings.client_id || !settings.client_secret || !settings.is_active) {
      throw new BadRequestException('إعدادات مصلحة الضرائب المصرية غير مكتملة أو غير مفعلة لهذا الحساب');
    }

    // Get real ETA access token
    const token = await this.etaAuthService.getAccessToken(tenantId);
    if (!token) {
      throw new BadRequestException('تعذر الحصول على رمز دخول صالح من مصلحة الضرائب');
    }

    const baseUrl =
      settings.environment === 'production'
        ? 'https://api.invoicing.eta.gov.eg'
        : 'https://api.preprod.invoicing.eta.gov.eg';

    // Serialize each sale to ETA format
    const documents: any[] = [];
    for (const id of invoiceIds) {
      try {
        const doc = await this.etaSerializer.serializeSaleToEtaFormat(tenantId, Number(id));
        documents.push(doc);
      } catch (err: any) {
        this.logger.error(`Failed to serialize invoice ${id}: ${err.message}`);
        throw new BadRequestException(`خطأ في معالجة بيانات الفاتورة رقم ${id}: ${err.message}`);
      }
    }

    // Real API submission
    let submissionData: any = null;
    try {
      const response = await fetch(`${baseUrl}/api/v1/documentsubmissions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ documents }),
      });

      if (!response.ok) {
        let errBody: any = null;
        try {
          errBody = await response.json();
        } catch {
          errBody = { message: response.statusText };
        }
        const errorDetail = errBody.error_description || errBody.message || JSON.stringify(errBody);
        this.logger.error(`ETA submission error: ${errorDetail}`);
        throw new BadRequestException(`فشل تقديم الفواتير إلى مصلحة الضرائب: ${errorDetail}`);
      }

      submissionData = await response.json();
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`ETA network or submission error: ${error.message}`);
      throw new BadRequestException(`خطأ أثناء الاتصال بمصلحة الضرائب المصرية: ${error.message}`);
    }

    // INV-ETA-EMPTY-RESPONSE-NEVER-SUBMITS: the submission id comes
    // from ETA or not at all — never invented. A response with no
    // submission id and no document arrays proves nothing about any
    // invoice, so no status below may treat it as acceptance.
    const submissionId: string | null = submissionData?.submissionId ?? null;
    const acceptedDocuments: Array<{ uuid?: string; internalId?: string }> = submissionData?.acceptedDocuments || [];
    const rejectedDocuments: Array<{ internalId?: string; error?: any }> = submissionData?.rejectedDocuments || [];

    // Update accepted documents
    for (const acc of acceptedDocuments) {
      const internalId = acc.internalId;
      if (internalId) {
        await this.db
          .updateTable('sales')
          .set({
            eta_status: 'submitted',
            eta_uuid: acc.uuid || null,
            eta_submission_id: submissionId,
          })
          .where('tenant_id', '=', tenantId)
          .where((eb) =>
            eb.or([eb('doc_no', '=', internalId), eb('id', '=', isNaN(Number(internalId)) ? -1 : Number(internalId))]),
          )
          .execute();
      }
    }

    // Update rejected documents
    for (const rej of rejectedDocuments) {
      const internalId = rej.internalId;
      if (internalId) {
        await this.db
          .updateTable('sales')
          .set({
            eta_status: 'failed',
            eta_submission_id: submissionId,
          })
          .where('tenant_id', '=', tenantId)
          .where((eb) =>
            eb.or([eb('doc_no', '=', internalId), eb('id', '=', isNaN(Number(internalId)) ? -1 : Number(internalId))]),
          )
          .execute();
      }
    }

    // No fallback: when ETA returns neither array, no invoice is
    // marked submitted — every invoice stays in its previous
    // status (pending/failed) so it remains in the pending queue
    // and can be retried or verified via checkSubmissionStatus.
    // Invoices ETA never mentions stay pending the same way.
    const unverifiedCount = Math.max(0, invoiceIds.length - acceptedDocuments.length - rejectedDocuments.length);

    return {
      success: true,
      submissionId,
      acceptedCount: acceptedDocuments.length,
      rejectedCount: rejectedDocuments.length,
      unverifiedCount,
      rejectedDocuments,
      message:
        acceptedDocuments.length === 0 && rejectedDocuments.length === 0
          ? 'لم تؤكد مصلحة الضرائب استلام أي وثيقة؛ بقيت الفواتير معلقة للتحقق أو إعادة الإرسال'
          : rejectedDocuments.length > 0
            ? `تم إرسال ${acceptedDocuments.length} وثيقة ورفض ${rejectedDocuments.length}`
            : 'تم إرسال الفواتير إلى منظومة الضرائب المصرية بنجاح',
    };
  }

  async checkSubmissionStatus(tenantId: string, submissionId: string) {
    const settings = await this.taxSettings.getSettings(tenantId, 'ETA_EGYPT');
    if (!settings) throw new BadRequestException('إعدادات الضرائب غير موجودة');

    const token = await this.etaAuthService.getAccessToken(tenantId);
    const baseUrl =
      settings.environment === 'production'
        ? 'https://api.invoicing.eta.gov.eg'
        : 'https://api.preprod.invoicing.eta.gov.eg';

    try {
      const response = await fetch(`${baseUrl}/api/v1/documentsubmissions/${submissionId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new BadRequestException(`فشل الاستعلام عن حزمة الإرسال: ${response.statusText}`);
      }

      const statusData = await response.json();

      // If document status is returned, update corresponding sales in DB
      const documentSummary = statusData.documentSummary || [];
      for (const doc of documentSummary) {
        if (doc.uuid && doc.status) {
          const mappedStatus =
            doc.status.toLowerCase() === 'valid'
              ? 'valid'
              : doc.status.toLowerCase() === 'invalid'
                ? 'failed'
                : 'submitted';
          await this.db
            .updateTable('sales')
            .set({ eta_status: mappedStatus })
            .where('tenant_id', '=', tenantId)
            .where('eta_uuid', '=', doc.uuid)
            .execute();
        }
      }

      return {
        success: true,
        data: statusData,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(error.message || 'فشل الاستعلام من منظومة الضرائب');
    }
  }

  async getDocumentDetails(tenantId: string, uuid: string) {
    const settings = await this.taxSettings.getSettings(tenantId, 'ETA_EGYPT');
    if (!settings) throw new BadRequestException('إعدادات الضرائب غير موجودة');

    const token = await this.etaAuthService.getAccessToken(tenantId);
    const baseUrl =
      settings.environment === 'production'
        ? 'https://api.invoicing.eta.gov.eg'
        : 'https://api.preprod.invoicing.eta.gov.eg';

    try {
      const response = await fetch(`${baseUrl}/api/v1/documents/${uuid}/raw`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new BadRequestException(`فشل جلب تفاصيل الوثيقة: ${response.statusText}`);
      }

      const rawDoc = await response.json();
      return {
        success: true,
        data: rawDoc,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(error.message || 'فشل جلب بيانات الوثيقة');
    }
  }
}
