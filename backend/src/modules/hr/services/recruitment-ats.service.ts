import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import { getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import { HrService } from '../hr.service';
import { AuditService } from '../../../core/audit/audit.service';
import {
  CreateJobOpeningDto,
  CreateApplicantDto,
  UpdateApplicantStageDto,
  HireApplicantDto,
} from '../dto/recruitment-ats.dto';
import {
  validateStageTransition,
  checkJobOpeningHeadcount,
  calculateRecruitmentFunnel,
} from '../engines/recruitment-ats.engine';

@Injectable()
export class RecruitmentAtsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly hrService: HrService,
    private readonly audit: AuditService,
  ) {}

  private assertAccess(auth: AuthContext): void {
    if (auth.role === 'super_admin' || auth.permissions.includes('*') || auth.permissions.includes('hrEmployees')) {
      return;
    }
    throw new ForbiddenException('Missing required HR & Recruitment permissions');
  }

  /**
   * 1. Job Openings Management
   */
  async createJobOpening(auth: AuthContext, dto: CreateJobOpeningDto): Promise<any> {
    this.assertAccess(auth);
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;

    const countRes = await (this.db as any)
      .selectFrom('recruitment_job_openings')
      .select(sql<number>`COUNT(*)`.as('count'))
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    const seq = Number(countRes?.count || 0) + 1;
    const jobCode = formatDailyDocumentNumber('JOB', seq, new Date(), 4, await getTenantTimezone(this.db, tenantId));
    const id = `job_${randomUUID()}`;

    await (this.db as any)
      .insertInto('recruitment_job_openings')
      .values({
        id,
        tenant_id: tenantId,
        job_code: jobCode,
        title: dto.title,
        department: dto.department,
        experience_years_min: dto.experienceYearsMin || 0,
        headcount: dto.headcount || 1,
        hired_count: 0,
        description: dto.description || null,
        requirements: dto.requirements || null,
        status: dto.status || 'published',
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();

    return { success: true, id, jobCode };
  }

  async getJobOpenings(auth: AuthContext, params?: { status?: string; search?: string }): Promise<any[]> {
    this.assertAccess(auth);
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;

    let query = (this.db as any)
      .selectFrom('recruitment_job_openings as j')
      .select([
        'j.id',
        'j.job_code',
        'j.title',
        'j.department',
        'j.experience_years_min',
        'j.headcount',
        'j.hired_count',
        'j.description',
        'j.requirements',
        'j.status',
        'j.created_at',
      ])
      .where('j.tenant_id', '=', tenantId);

    if (params?.status && params.status !== 'all') {
      query = query.where('j.status', '=', params.status);
    }
    if (params?.search && params.search.trim()) {
      const term = `%${params.search.trim()}%`;
      query = query.where((eb: any) =>
        eb.or([eb('j.job_code', 'ilike', term), eb('j.title', 'ilike', term), eb('j.department', 'ilike', term)]),
      );
    }

    const jobs = await query.orderBy('j.created_at', 'desc').execute();

    // Fetch applicant counts per job
    const jobIds = jobs.map((j: any) => j.id);
    if (jobIds.length === 0) return [];

    const applicantCounts = await (this.db as any)
      .selectFrom('recruitment_applicants')
      .select(['job_id', sql<number>`COUNT(*)`.as('applicant_count')])
      .where('tenant_id', '=', tenantId)
      .where('job_id', 'in', jobIds)
      .groupBy('job_id')
      .execute();

    const countsMap = new Map(applicantCounts.map((a: any) => [a.job_id, Number(a.applicant_count || 0)]));

    return jobs.map((j: any) => ({
      ...j,
      applicantCount: countsMap.get(j.id) || 0,
    }));
  }

  /**
   * 2. Applicants & Talent Pools Management
   */
  async createApplicant(auth: AuthContext, dto: CreateApplicantDto): Promise<any> {
    this.assertAccess(auth);
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;

    const countRes = await (this.db as any)
      .selectFrom('recruitment_applicants')
      .select(sql<number>`COUNT(*)`.as('count'))
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    const seq = Number(countRes?.count || 0) + 1;
    const applicantNumber = formatDailyDocumentNumber(
      'APP',
      seq,
      new Date(),
      4,
      await getTenantTimezone(this.db, tenantId),
    );
    const id = `app_${randomUUID()}`;

    await (this.db as any)
      .insertInto('recruitment_applicants')
      .values({
        id,
        tenant_id: tenantId,
        job_id: dto.jobId || null,
        applicant_number: applicantNumber,
        full_name: dto.fullName,
        email: dto.email || null,
        phone: dto.phone,
        expected_salary: dto.expectedSalary || null,
        experience_years: dto.experienceYears || 0,
        stage: 'new',
        rating: dto.rating || 3,
        talent_pool_tag: dto.talentPoolTag || null,
        cv_url: dto.cvUrl || null,
        interview_notes: dto.interviewNotes || null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();

    return { success: true, id, applicantNumber };
  }

  async getApplicants(
    auth: AuthContext,
    params?: { stage?: string; jobId?: string; talentPoolTag?: string; search?: string },
  ): Promise<any[]> {
    this.assertAccess(auth);
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;

    let query = (this.db as any)
      .selectFrom('recruitment_applicants as a')
      .leftJoin('recruitment_job_openings as j', 'j.id', 'a.job_id')
      .select([
        'a.id',
        'a.job_id',
        'j.title as job_title',
        'j.job_code',
        'j.department as job_department',
        'a.applicant_number',
        'a.full_name',
        'a.email',
        'a.phone',
        'a.expected_salary',
        'a.experience_years',
        'a.stage',
        'a.rating',
        'a.talent_pool_tag',
        'a.cv_url',
        'a.interview_notes',
        'a.hired_employee_id',
        'a.created_at',
      ])
      .where('a.tenant_id', '=', tenantId);

    if (params?.stage && params.stage !== 'all') {
      query = query.where('a.stage', '=', params.stage);
    }
    if (params?.jobId && params.jobId !== 'all') {
      query = query.where('a.job_id', '=', params.jobId);
    }
    if (params?.talentPoolTag && params.talentPoolTag !== 'all') {
      query = query.where('a.talent_pool_tag', '=', params.talentPoolTag);
    }
    if (params?.search && params.search.trim()) {
      const term = `%${params.search.trim()}%`;
      query = query.where((eb: any) =>
        eb.or([
          eb('a.applicant_number', 'ilike', term),
          eb('a.full_name', 'ilike', term),
          eb('a.phone', 'ilike', term),
          eb('a.email', 'ilike', term),
        ]),
      );
    }

    return query.orderBy('a.created_at', 'desc').execute();
  }

  async updateApplicantStage(
    auth: AuthContext,
    id: string,
    dto: UpdateApplicantStageDto,
  ): Promise<{ success: boolean }> {
    this.assertAccess(auth);
    const { tenantId } = requireTenantScope(auth);

    // Serialize with hireApplicant. Otherwise a stale stage edit may overwrite
    // 'hired' after an employee and a contract were successfully created.
    return this.db.transaction().execute(async (trx) => {
      const applicant = await (trx as any)
        .selectFrom('recruitment_applicants')
        .selectAll()
        .where('id', '=', id)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();
      if (!applicant) throw new NotFoundException('Applicant not found');

      const check = validateStageTransition(applicant.stage, dto.stage);
      if (!check.valid) throw new BadRequestException(check.reason);
      const updates: any = { stage: dto.stage, updated_at: new Date() };
      if (dto.interviewNotes !== undefined) updates.interview_notes = dto.interviewNotes;
      if (dto.rating !== undefined) updates.rating = dto.rating;
      await (trx as any)
        .updateTable('recruitment_applicants')
        .set(updates)
        .where('id', '=', id)
        .where('tenant_id', '=', tenantId)
        .execute();
      return { success: true };
    });
  }

  /**
   * 3. 1-Click "Hire to Employee" Workflow
   */
  async hireApplicant(
    auth: AuthContext,
    id: string,
    dto: HireApplicantDto,
  ): Promise<{ success: boolean; employeeId: number }> {
    this.assertAccess(auth);
    if (!['super_admin', 'admin'].includes(auth.role) && !auth.permissions.includes('hrSalaryManage')) {
      throw new ForbiddenException('Hiring with a salary contract requires hrSalaryManage permission');
    }
    const { tenantId } = requireTenantScope(auth);
    const result = await this.db.transaction().execute(async (trx) => {
      const applicant = await (trx as any)
        .selectFrom('recruitment_applicants')
        .selectAll()
        .where('id', '=', id)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();
      if (!applicant) throw new NotFoundException('Applicant not found');
      if (applicant.stage === 'hired' || applicant.hired_employee_id) {
        throw new BadRequestException('تم تعيين هذا المرشح بالفعل');
      }
      let job: any = null;
      if (applicant.job_id) {
        job = await (trx as any)
          .selectFrom('recruitment_job_openings')
          .selectAll()
          .where('id', '=', applicant.job_id)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();
        if (!job || job.status === 'closed') throw new BadRequestException('الوظيفة غير متاحة للتعيين');
        if (!checkJobOpeningHeadcount(job.headcount, job.hired_count).canHire) {
          throw new BadRequestException('اكتمل العدد المطلوب لهذه الوظيفة');
        }
      }
      const parts = String(applicant.full_name || '')
        .trim()
        .split(/\s+/);
      const employeeId = await this.hrService.createEmployeeFromRecruitment(
        trx,
        {
          firstName: parts[0] || '',
          lastName: parts.slice(1).join(' '),
          phone: String(applicant.phone || ''),
          email: String(applicant.email || ''),
          branchId: dto.branchId,
          salary: dto.customSalary !== undefined ? dto.customSalary : Number(applicant.expected_salary || 0),
        },
        auth,
      );

      await (trx as any)
        .updateTable('recruitment_applicants')
        .set({ stage: 'hired', hired_employee_id: employeeId, updated_at: new Date() })
        .where('id', '=', id)
        .where('tenant_id', '=', tenantId)
        .execute();
      if (job) {
        const hiredCount = Number(job.hired_count || 0) + 1;
        await (trx as any)
          .updateTable('recruitment_job_openings')
          .set({
            hired_count: hiredCount,
            status: hiredCount >= Number(job.headcount) ? 'closed' : job.status,
            updated_at: new Date(),
          })
          .where('id', '=', job.id)
          .where('tenant_id', '=', tenantId)
          .execute();
      }
      return { success: true, employeeId };
    });
    await this.audit.log('Hire HR applicant', `Applicant #${id} hired as employee #${result.employeeId}`, auth);
    return result;
  }

  /**
   * 4. Recruitment Funnel Metrics
   */
  async getFunnelMetrics(auth: AuthContext): Promise<any> {
    this.assertAccess(auth);
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;

    const applicants = await (this.db as any)
      .selectFrom('recruitment_applicants')
      .select(['stage'])
      .where('tenant_id', '=', tenantId)
      .execute();

    const jobs = await (this.db as any)
      .selectFrom('recruitment_job_openings')
      .select(['status'])
      .where('tenant_id', '=', tenantId)
      .execute();

    const openJobs = jobs.filter((j: any) => j.status === 'published').length;

    return {
      funnel: calculateRecruitmentFunnel(applicants),
      openJobsCount: openJobs,
      totalJobsCount: jobs.length,
    };
  }
}
