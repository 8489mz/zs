import { NotFoundException, Injectable } from '@nestjs/common';
import { type Kysely } from '../../database/kysely';
import { type Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { CreateMaritimeJobDto } from './dto/create-job.dto';
import { CreateJobDocumentDto } from './dto/job-document.dto';

/**
 * MaritimeFreightConsolidationDocumentsService — slice S15 of the
 * maritime-freight split. Pure move of 5 methods from
 * MaritimeFreightService (Consolidation Sub-Jobs + Document Binder).
 * No behavior change: the bodies are byte-identical; the facade keeps
 * thin delegates with the same names and signatures. Deps are db +
 * the BOUND CROSS-SLICE dep (S12 createJob); no mail/WhatsApp/posting/
 * kernel, no Logger (S15 is not one of the 6 logger slices). On the
 * generation tree the facade binds its OWN createJob method
 * (this.createJob.bind(this)) — the S12 slice instance does not exist
 * yet; MERGE-OWNED REPOINT: when S12 lands (it merges before S15),
 * repoint the bind to this.jobsCoreService.createJob.bind(
 * this.jobsCoreService). Functionally identical either way (the facade
 * method becomes a thin delegate after S12 merges). No visibility
 * change — all 5 methods are public; all 5 are called from the
 * controller, so all 5 get facade delegates. The e-Folder banner
 * travels byte-identical into the slice before listJobDocuments
 * (file #8 S9 precedent); the Consolidation banner stays in the
 * facade for S17 (stored-money pin end-marker — S15 does not take
 * it, or the S17 patch would fail to apply at merge); the SOA banner
 * stays in the facade (S7 takes it). The consolidation-totals pin
 * reads createConsolidationSubJob's body for its funnel call — the
 * body is preserved byte-identical in this file, so the per-slice
 * read works at merge (merge-owned repoint). Clock/guard: all zero
 * in the moved text — no dates, no money helpers, no transactions,
 * so there is no PGlite hang shape in S15.
 */

export interface MaritimeFreightConsolidationDocumentsDeps {
  db: Kysely<Database>;
  // Bound cross-slice dep (same name as the facade member, so the moved
  // bodies are byte-identical). createJob lives in S12; the facade binds
  // it. Return type is Promise<any> (the caller returns it through
  // unchanged — createConsolidationSubJob returns the created sub-job).
  createJob: (auth: AuthContext, dto: CreateMaritimeJobDto) => Promise<any>;
}

@Injectable()
export class MaritimeFreightConsolidationDocumentsService {
  private readonly db: Kysely<Database>;
  private readonly createJob: (auth: AuthContext, dto: CreateMaritimeJobDto) => Promise<any>;

  constructor(deps: MaritimeFreightConsolidationDocumentsDeps) {
    this.db = deps.db;
    this.createJob = deps.createJob;
  }

  async listConsolidationSubJobs(auth: AuthContext, parentJobId: string | number) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db
      .selectFrom('maritime_jobs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('parent_job_id', '=', String(parentJobId))
      .orderBy('id', 'desc')
      .execute();
  }

  async createConsolidationSubJob(auth: AuthContext, parentJobId: string | number, dto: Partial<CreateMaritimeJobDto>) {
    const { tenantId } = requireTenantScope(auth);
    const parentJob = await this.db
      .selectFrom('maritime_jobs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', String(parentJobId))
      .executeTakeFirst();

    if (!parentJob) throw new NotFoundException('Parent Master Job not found');

    const subJobDto: CreateMaritimeJobDto = {
      ...dto,
      parentJobId: String(parentJobId),
      isConsolidationMaster: false,
      customerName: dto.customerName || 'عميل تجزئة مشترك',
      shippingLineName: parentJob.shipping_line_name,
      shippingLineId: parentJob.shipping_line_id,
      polCode: parentJob.pol_code,
      polName: parentJob.pol_name,
      podCode: parentJob.pod_code,
      podName: parentJob.pod_name,
      vesselName: parentJob.vessel_name || undefined,
      voyageNumber: parentJob.voyage_number || undefined,
      bookingNumber: parentJob.booking_number || undefined,
      mblNumber: parentJob.mbl_number || undefined,
      direction: parentJob.direction,
      transportMode: parentJob.transport_mode,
      etd: parentJob.etd || undefined,
      eta: parentJob.eta || undefined,
    } as CreateMaritimeJobDto;

    return await this.createJob(auth, subJobDto);
  }

  // ==========================================
  // 3. Digital Shipment e-Folder / Document Binder
  // ==========================================

  async listJobDocuments(auth: AuthContext, jobId: string | number) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db
      .selectFrom('maritime_job_documents')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', String(jobId))
      .orderBy('id', 'desc')
      .execute();
  }

  async createJobDocument(auth: AuthContext, jobId: string | number, dto: CreateJobDocumentDto, uploadedBy?: string) {
    const { tenantId } = requireTenantScope(auth);
    const [doc] = await this.db
      .insertInto('maritime_job_documents')
      .values({
        tenant_id: tenantId,
        job_id: String(jobId),
        doc_type: dto.docType,
        title: dto.title,
        file_name: dto.fileName,
        file_url: dto.fileUrl,
        file_size_bytes: dto.fileSizeBytes || 0,
        mime_type: dto.mimeType || 'application/pdf',
        notes: dto.notes || null,
        uploaded_by: uploadedBy || (auth.userId ? `User #${auth.userId}` : 'Admin'),
      })
      .returningAll()
      .execute();

    return doc;
  }

  async deleteJobDocument(auth: AuthContext, jobId: string | number, docId: string | number) {
    const { tenantId } = requireTenantScope(auth);
    await this.db
      .deleteFrom('maritime_job_documents')
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', String(jobId))
      .where('id', '=', String(docId))
      .execute();

    return { success: true };
  }
}
