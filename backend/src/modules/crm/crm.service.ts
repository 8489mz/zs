import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { KYSELY_DB } from '../../database/database.constants';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';

export interface DealQueryFilters {
  stage?: string;
  search?: string;
  source?: string;
  priority?: string;
  assignedUserId?: number;
}

export interface CreateDealInput {
  title: string;
  expectedAmount?: number;
  currency?: string;
  probability?: number;
  stage?: string;
  expectedCloseDate?: string | null;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  companyName?: string;
  source?: string;
  priority?: string;
  assignedUserId?: number | null;
  customerId?: number | null;
  lostReason?: string;
  notes?: string;
}

export interface UpdateDealInput {
  title?: string;
  stage?: string;
  expectedAmount?: number;
  currency?: string;
  probability?: number;
  expectedCloseDate?: string | null;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  companyName?: string;
  source?: string;
  priority?: string;
  assignedUserId?: number | null;
  customerId?: number | null;
  lostReason?: string;
  notes?: string;
}

export interface CreateActivityInput {
  activityType: string;
  summary: string;
  dueDate?: string | null;
}

@Injectable()
export class CrmService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  async listDeals(filters: DealQueryFilters, auth: AuthContext) {
    const scope = requireTenantScope(auth);

    let query = (this.db as any)
      .selectFrom('crm_deals as d')
      .leftJoin('users as u', 'd.assigned_user_id', 'u.id')
      .leftJoin('customers as c', 'd.customer_id', 'c.id')
      .select([
        'd.id',
        'd.tenant_id as tenantId',
        'd.title',
        'd.stage',
        'd.expected_amount as expectedAmount',
        'd.currency',
        'd.probability',
        'd.expected_close_date as expectedCloseDate',
        'd.contact_name as contactName',
        'd.contact_phone as contactPhone',
        'd.contact_email as contactEmail',
        'd.company_name as companyName',
        'd.source',
        'd.priority',
        'd.assigned_user_id as assignedUserId',
        'u.username as assignedUserName',
        'd.customer_id as customerId',
        'c.name as customerName',
        'd.lost_reason as lostReason',
        'd.notes',
        'd.created_by as createdBy',
        'd.created_at as createdAt',
        'd.updated_at as updatedAt',
      ])
      .where('d.tenant_id', '=', scope.tenantId);

    if (filters.stage && filters.stage !== 'all') {
      query = query.where('d.stage', '=', filters.stage);
    }
    if (filters.source && filters.source !== 'all') {
      query = query.where('d.source', '=', filters.source);
    }
    if (filters.priority && filters.priority !== 'all') {
      query = query.where('d.priority', '=', filters.priority);
    }
    if (filters.assignedUserId) {
      query = query.where('d.assigned_user_id', '=', Number(filters.assignedUserId));
    }
    if (filters.search && filters.search.trim()) {
      const term = `%${filters.search.trim().toLowerCase()}%`;
      query = query.where((eb: any) =>
        eb.or([
          eb(sql`lower(d.title)`, 'like', term),
          eb(sql`lower(coalesce(d.contact_name, ''))`, 'like', term),
          eb(sql`lower(coalesce(d.contact_phone, ''))`, 'like', term),
          eb(sql`lower(coalesce(d.company_name, ''))`, 'like', term),
        ])
      );
    }

    const rows = await query.orderBy('d.created_at', 'desc').execute();

    return {
      ok: true,
      deals: rows.map((r: any) => ({
        ...r,
        id: Number(r.id),
        expectedAmount: Number(r.expectedAmount || 0),
        probability: Number(r.probability || 0),
        assignedUserId: r.assignedUserId ? Number(r.assignedUserId) : null,
        customerId: r.customerId ? Number(r.customerId) : null,
      })),
    };
  }

  async getDeal(id: number, auth: AuthContext) {
    const scope = requireTenantScope(auth);

    const deal = await (this.db as any)
      .selectFrom('crm_deals as d')
      .leftJoin('users as u', 'd.assigned_user_id', 'u.id')
      .leftJoin('customers as c', 'd.customer_id', 'c.id')
      .selectAll('d')
      .select([
        'u.username as assignedUserName',
        'c.name as customerName',
      ])
      .where('d.id', '=', id)
      .where('d.tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!deal) {
      throw new NotFoundException('الفرصة البيعية غير موجودة.');
    }

    const activities = await (this.db as any)
      .selectFrom('crm_activities as a')
      .leftJoin('users as u', 'a.created_by', 'u.id')
      .select([
        'a.id',
        'a.deal_id as dealId',
        'a.activity_type as activityType',
        'a.summary',
        'a.due_date as dueDate',
        'a.is_completed as isCompleted',
        'a.created_by as createdBy',
        'u.username as createdByName',
        'a.created_at as createdAt',
      ])
      .where('a.deal_id', '=', id)
      .where('a.tenant_id', '=', scope.tenantId)
      .orderBy('a.created_at', 'desc')
      .execute();

    return {
      ok: true,
      deal: {
        ...deal,
        id: Number(deal.id),
        expectedAmount: Number(deal.expected_amount || 0),
        probability: Number(deal.probability || 0),
        assignedUserId: deal.assigned_user_id ? Number(deal.assigned_user_id) : null,
        customerId: deal.customer_id ? Number(deal.customer_id) : null,
      },
      activities: activities.map((a: any) => ({
        ...a,
        id: Number(a.id),
        dealId: Number(a.dealId),
        isCompleted: Boolean(a.isCompleted),
      })),
    };
  }

  async createDeal(input: CreateDealInput, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    const title = String(input.title || '').trim();
    if (!title) {
      throw new BadRequestException('عنوان الفرصة البيعية مطلوب.');
    }

    // INV-CRM-ERROR: the close date is required. It used to be silently
    // stored as null, while the create modal's '' died in the validation
    // pipe as a date-format error whose field-naming message the frontend
    // error mapper replaced with the generic 'البيانات المدخلة غير صحيحة.'.
    // A plain BadRequestException with the field-naming Arabic message (no
    // VALIDATION_ERROR code) survives the mapper and names the field.
    const expectedCloseDate = String(input.expectedCloseDate || '').trim();
    if (!expectedCloseDate) {
      throw new BadRequestException('تاريخ الإغلاق مطلوب.');
    }

    const inserted = await this.db
      .insertInto('crm_deals')
      .values({
        tenant_id: scope.tenantId,
        title,
        expected_amount: input.expectedAmount ? Number(input.expectedAmount) : 0,
        currency: input.currency || 'EGP',
        probability: input.probability !== undefined ? Number(input.probability) : 50,
        stage: input.stage || 'new',
        expected_close_date: expectedCloseDate as any,
        contact_name: input.contactName ? String(input.contactName).trim() : null,
        contact_phone: input.contactPhone ? String(input.contactPhone).trim() : null,
        contact_email: input.contactEmail ? String(input.contactEmail).trim() : null,
        company_name: input.companyName ? String(input.companyName).trim() : null,
        source: input.source || 'direct',
        priority: input.priority || 'medium',
        assigned_user_id: input.assignedUserId ? Number(input.assignedUserId) : null,
        customer_id: input.customerId ? Number(input.customerId) : null,
        lost_reason: input.lostReason ? String(input.lostReason).trim() : null,
        notes: input.notes ? String(input.notes).trim() : null,
        created_by: auth.userId ? Number(auth.userId) : null,
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow();

    const dealId = Number(inserted.id);

    // Record initial timeline note
    await this.db
      .insertInto('crm_activities')
      .values({
        tenant_id: scope.tenantId,
        deal_id: dealId,
        activity_type: 'note',
        summary: 'تم إنشاء الفرصة البيعية في النظام.',
        created_by: auth.userId ? Number(auth.userId) : null,
      } as any)
      .execute();

    return {
      ok: true,
      deal: {
        ...inserted,
        id: dealId,
      },
    };
  }

  async updateDeal(id: number, input: UpdateDealInput, auth: AuthContext) {
    const scope = requireTenantScope(auth);

    const existing = await this.db
      .selectFrom('crm_deals')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException('الفرصة البيعية غير موجودة.');
    }

    const updates: Record<string, unknown> = {
      updated_at: sql`NOW()`,
    };

    if (input.title !== undefined) updates.title = String(input.title).trim();
    if (input.stage !== undefined) updates.stage = String(input.stage).trim();
    if (input.expectedAmount !== undefined) updates.expected_amount = Number(input.expectedAmount);
    if (input.currency !== undefined) updates.currency = String(input.currency).trim();
    if (input.probability !== undefined) updates.probability = Number(input.probability);
    if (input.expectedCloseDate !== undefined) updates.expected_close_date = input.expectedCloseDate ? (input.expectedCloseDate as any) : null;
    if (input.contactName !== undefined) updates.contact_name = input.contactName ? String(input.contactName).trim() : null;
    if (input.contactPhone !== undefined) updates.contact_phone = input.contactPhone ? String(input.contactPhone).trim() : null;
    if (input.contactEmail !== undefined) updates.contact_email = input.contactEmail ? String(input.contactEmail).trim() : null;
    if (input.companyName !== undefined) updates.company_name = input.companyName ? String(input.companyName).trim() : null;
    if (input.source !== undefined) updates.source = String(input.source).trim();
    if (input.priority !== undefined) updates.priority = String(input.priority).trim();
    if (input.assignedUserId !== undefined) updates.assigned_user_id = input.assignedUserId ? Number(input.assignedUserId) : null;
    if (input.customerId !== undefined) updates.customer_id = input.customerId ? Number(input.customerId) : null;
    if (input.lostReason !== undefined) updates.lost_reason = input.lostReason ? String(input.lostReason).trim() : null;
    if (input.notes !== undefined) updates.notes = input.notes ? String(input.notes).trim() : null;

    const updated = await this.db
      .updateTable('crm_deals')
      .set(updates as any)
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .returningAll()
      .executeTakeFirst();

    // Log stage change activity if stage changed
    if (input.stage && input.stage !== existing.stage) {
      const stageLabels: Record<string, string> = {
        new: 'فرصة جديدة',
        contacted: 'تم التواصل',
        qualified: 'مؤهل للشراء',
        proposal: 'عرض سعر مرسل',
        negotiation: 'مفاوضات',
        won: 'تم التعاقد (فوز)',
        lost: 'صفقة خاسرة',
      };
      await this.db
        .insertInto('crm_activities')
        .values({
          tenant_id: scope.tenantId,
          deal_id: id,
          activity_type: 'stage_change',
          summary: `تم نقل المرحلة من [${stageLabels[existing.stage] || existing.stage}] إلى [${stageLabels[input.stage] || input.stage}].`,
          created_by: auth.userId ? Number(auth.userId) : null,
        } as any)
        .execute();
    }

    return {
      ok: true,
      deal: {
        ...updated,
        id: Number(updated!.id),
      },
    };
  }

  async deleteDeal(id: number, auth: AuthContext) {
    const scope = requireTenantScope(auth);

    return await this.db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom('crm_activities')
        .where('deal_id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .execute();

      const deleted = await trx
        .deleteFrom('crm_deals')
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();

      if (!deleted || Number(deleted.numDeletedRows) === 0) {
        throw new NotFoundException('الفرصة البيعية غير موجودة.');
      }

      return { ok: true, message: 'تم حذف الفرصة البيعية وسجلاتها بنجاح.' };
    });
  }


  async addActivity(dealId: number, input: CreateActivityInput, auth: AuthContext) {
    const scope = requireTenantScope(auth);

    const deal = await this.db
      .selectFrom('crm_deals')
      .select(['id'])
      .where('id', '=', dealId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!deal) {
      throw new NotFoundException('الفرصة البيعية غير موجودة.');
    }

    const inserted = await this.db
      .insertInto('crm_activities')
      .values({
        tenant_id: scope.tenantId,
        deal_id: dealId,
        activity_type: input.activityType || 'note',
        summary: String(input.summary || '').trim(),
        due_date: input.dueDate ? (input.dueDate as any) : null,
        is_completed: false,
        created_by: auth.userId ? Number(auth.userId) : null,
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow();

    return {
      ok: true,
      activity: {
        ...inserted,
        id: Number(inserted.id),
        dealId: Number(inserted.deal_id),
        isCompleted: Boolean(inserted.is_completed),
      },
    };
  }

  async toggleActivity(activityId: number, auth: AuthContext) {
    const scope = requireTenantScope(auth);

    const existing = await this.db
      .selectFrom('crm_activities')
      .selectAll()
      .where('id', '=', activityId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException('النشاط غير موجود.');
    }

    const nextCompleted = !existing.is_completed;

    const updated = await this.db
      .updateTable('crm_activities')
      .set({ is_completed: nextCompleted } as any)
      .where('id', '=', activityId)
      .where('tenant_id', '=', scope.tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();

    return {
      ok: true,
      activity: {
        ...updated,
        id: Number(updated.id),
        isCompleted: Boolean(updated.is_completed),
      },
    };
  }

  async getPipelineSummary(auth: AuthContext) {
    const scope = requireTenantScope(auth);

    const deals = await this.db
      .selectFrom('crm_deals')
      .select(['stage', 'expected_amount', 'probability'])
      .where('tenant_id', '=', scope.tenantId)
      .execute();

    let totalActiveCount = 0;
    let totalActiveAmount = 0;
    let weightedAmount = 0;
    let wonCount = 0;
    let wonAmount = 0;
    let lostCount = 0;

    const stageBreakdown: Record<string, { count: number; totalAmount: number }> = {
      new: { count: 0, totalAmount: 0 },
      contacted: { count: 0, totalAmount: 0 },
      qualified: { count: 0, totalAmount: 0 },
      proposal: { count: 0, totalAmount: 0 },
      negotiation: { count: 0, totalAmount: 0 },
      won: { count: 0, totalAmount: 0 },
      lost: { count: 0, totalAmount: 0 },
    };

    for (const d of deals) {
      const amount = Number(d.expected_amount || 0);
      const prob = Number(d.probability || 0);
      const stage = d.stage || 'new';

      if (!stageBreakdown[stage]) {
        stageBreakdown[stage] = { count: 0, totalAmount: 0 };
      }
      stageBreakdown[stage].count += 1;
      stageBreakdown[stage].totalAmount += amount;

      if (stage === 'won') {
        wonCount += 1;
        wonAmount += amount;
      } else if (stage === 'lost') {
        lostCount += 1;
      } else {
        totalActiveCount += 1;
        totalActiveAmount += amount;
        weightedAmount += (amount * (prob / 100));
      }
    }

    const closedTotal = wonCount + lostCount;
    const winRate = closedTotal > 0 ? Math.round((wonCount / closedTotal) * 100) : 0;

    return {
      ok: true,
      summary: {
        totalDeals: deals.length,
        totalActiveCount,
        totalActiveAmount,
        weightedAmount: Math.round(weightedAmount),
        wonCount,
        wonAmount,
        lostCount,
        winRate,
        stageBreakdown,
      },
    };
  }

  async convertToCustomer(dealId: number, auth: AuthContext) {
    const scope = requireTenantScope(auth);

    return await this.db.transaction().execute(async (trx) => {
      const deal = await trx
        .selectFrom('crm_deals')
        .selectAll()
        .where('id', '=', dealId)
        .where('tenant_id', '=', scope.tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!deal) {
        throw new NotFoundException('الفرصة البيعية غير موجودة.');
      }

      let customerId = deal.customer_id ? Number(deal.customer_id) : null;

      if (!customerId) {
        const phone = String(deal.contact_phone || '').trim();
        // Check if customer already exists by phone
        if (phone) {
          const existingCust = await trx
            .selectFrom('customers')
            .select(['id'])
            .where('tenant_id', '=', scope.tenantId)
            .where('phone', '=', phone)
            .executeTakeFirst();
          if (existingCust) {
            customerId = Number(existingCust.id);
          }
        }

        // If still no customer, create new
        if (!customerId) {
          const customerName = String(deal.contact_name || deal.company_name || deal.title).trim();
          const createdCustomer = await trx
            .insertInto('customers')
            .values({
              tenant_id: scope.tenantId,
              account_id: scope.accountId,
              name: customerName,
              phone: phone || '',
              company_name: deal.company_name || '',
              address: '',
              balance: 0,
              customer_type: 'cash',
              credit_limit: 0,
              store_credit_balance: 0,
              tax_number: '',
              is_active: true,
            } as any)
            .returning(['id'])
            .executeTakeFirstOrThrow();

          customerId = Number(createdCustomer.id);
        }

        // Update deal with customerId, set stage to won
        await trx
          .updateTable('crm_deals')
          .set({
            customer_id: customerId,
            stage: 'won',
            probability: 100,
            updated_at: sql`NOW()`,
          } as any)
          .where('id', '=', dealId)
          .where('tenant_id', '=', scope.tenantId)
          .execute();

        // Add conversion activity
        await trx
          .insertInto('crm_activities')
          .values({
            tenant_id: scope.tenantId,
            deal_id: dealId,
            activity_type: 'converted',
            summary: `تم تحويل الفرصة بنجاح إلى عميل مسجل برقم #${customerId} وتم وسم الصفقة كـ [تم التعاقد / فوز].`,
            created_by: auth.userId ? Number(auth.userId) : null,
          } as any)
          .execute();
      }

      return {
        ok: true,
        customerId,
        dealId,
        message: 'تم تحويل الفرصة إلى عميل مسجل بنجاح.',
      };
    });
  }
}

