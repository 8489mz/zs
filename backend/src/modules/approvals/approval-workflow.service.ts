import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Inject, Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { KYSELY_DB } from '../../database/database.constants';
import { Kysely, Transaction, sql } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { WhatsAppGatewayService } from '../settings/services/whatsapp-gateway.service';

/*
 * D9 — CreateApprovalRuleDto is converted from an interface to a
 * class IN PLACE (Rule 5), so the real global pipe validates it. No
 * frontend caller exists for this endpoint — the positive case is the
 * interface shape.
 * - module is purchase_orders ONLY (the service throws otherwise — D8
 *   settlement precedent); requiredRole is 'admin' ONLY (the service
 *   throws otherwise).
 * - minAmount is optional @Min(0) (the service defaults 0, throws on
 *   negative); tierLevel is optional @IsInt @Min(1) (the service
 *   defaults 1).
 */
export class CreateApprovalRuleDto {
  @IsEnum(['purchase_orders'])
  module!: 'purchase_orders';

  @IsOptional()
  @IsNumber()
  @Min(0)
  minAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  tierLevel?: number;

  @IsOptional()
  @IsEnum(['admin'])
  requiredRole?: string;

  @IsOptional()
  @IsNumber()
  approverUserId?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export interface ApprovalRequestFilter {
  status?: string;
  module?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class ApprovalWorkflowService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly whatsappService: WhatsAppGatewayService,
  ) {}

  private requireManager(auth: AuthContext): void {
    if (auth.role !== 'admin' && auth.role !== 'super_admin') {
      throw new ForbiddenException('إدارة قواعد الموافقة تتطلب صلاحية مدير.');
    }
  }

  async getRules(auth: AuthContext) {
    this.requireManager(auth);
    const { tenantId } = requireTenantScope(auth);
    return await this.db
      .selectFrom('approval_rules')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('module', 'asc')
      .orderBy('min_amount', 'asc')
      .orderBy('tier_level', 'asc')
      .execute();
  }

  async createRule(dto: CreateApprovalRuleDto, auth: AuthContext) {
    this.requireManager(auth);
    const { tenantId } = requireTenantScope(auth);
    if (dto.module !== 'purchase_orders') throw new BadRequestException('الموافقات مفعلة لأوامر الشراء فقط حالياً.');
    const minAmount = Number(dto.minAmount ?? 0);
    const maxAmount = dto.maxAmount !== undefined && dto.maxAmount !== null ? Number(dto.maxAmount) : null;
    const tierLevel = Number(dto.tierLevel ?? 1);
    const requiredRole = dto.requiredRole || 'admin';
    if (
      !Number.isFinite(minAmount) ||
      minAmount < 0 ||
      (maxAmount !== null && (!Number.isFinite(maxAmount) || maxAmount < minAmount))
    )
      throw new BadRequestException('نطاق المبلغ غير صالح.');
    if (!Number.isInteger(tierLevel) || tierLevel < 1) throw new BadRequestException('مستوى الموافقة غير صالح.');
    if (requiredRole !== 'admin') throw new BadRequestException('الدور المتاح لاعتماد أوامر الشراء هو admin فقط.');

    const result = await this.db
      .insertInto('approval_rules')
      .values({
        tenant_id: tenantId,
        module: dto.module,
        min_amount: minAmount,
        max_amount: maxAmount,
        tier_level: tierLevel,
        required_role: requiredRole,
        approver_user_id: dto.approverUserId ?? null,
        notes: dto.notes ?? null,
        is_active: true,
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow();

    return { ok: true, rule: result };
  }

  async updateRule(id: string, dto: Partial<CreateApprovalRuleDto> & { isActive?: boolean }, auth: AuthContext) {
    this.requireManager(auth);
    const { tenantId } = requireTenantScope(auth);
    if (dto.module !== undefined && dto.module !== 'purchase_orders')
      throw new BadRequestException('الموافقات مفعلة لأوامر الشراء فقط حالياً.');
    if (dto.requiredRole !== undefined && dto.requiredRole !== 'admin')
      throw new BadRequestException('الدور المتاح هو admin فقط.');
    const updateData: any = { updated_at: sql`NOW()` };
    if (dto.minAmount !== undefined) updateData.min_amount = Number(dto.minAmount);
    if (dto.maxAmount !== undefined) updateData.max_amount = dto.maxAmount === null ? null : Number(dto.maxAmount);
    if (dto.tierLevel !== undefined) updateData.tier_level = Number(dto.tierLevel);
    if (dto.requiredRole !== undefined) updateData.required_role = dto.requiredRole;
    if (dto.approverUserId !== undefined) updateData.approver_user_id = dto.approverUserId;
    if (dto.isActive !== undefined) updateData.is_active = dto.isActive;
    if (dto.notes !== undefined) updateData.notes = dto.notes;

    const result = await this.db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('approval_rules')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id as any)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw new NotFoundException('قاعدة الموافقة غير موجودة.');
      const minAmount = Number(dto.minAmount ?? current.min_amount);
      const maxAmount =
        dto.maxAmount === undefined
          ? current.max_amount === null
            ? null
            : Number(current.max_amount)
          : dto.maxAmount === null
            ? null
            : Number(dto.maxAmount);
      const tierLevel = Number(dto.tierLevel ?? current.tier_level);
      if (
        !Number.isFinite(minAmount) ||
        minAmount < 0 ||
        (maxAmount !== null && (!Number.isFinite(maxAmount) || maxAmount < minAmount))
      )
        throw new BadRequestException('نطاق المبلغ غير صالح.');
      if (!Number.isInteger(tierLevel) || tierLevel < 1) throw new BadRequestException('مستوى الموافقة غير صالح.');
      if (Object.keys(dto).some((key) => key !== 'notes'))
        await this.assertNoPendingRequests(trx, tenantId, current.module);
      return trx
        .updateTable('approval_rules')
        .set(updateData)
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id as any)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
    return { ok: true, rule: result };
  }

  private async assertNoPendingRequests(trx: Transaction<Database>, tenantId: string, module: string): Promise<void> {
    const pending = await trx
      .selectFrom('approval_requests')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('module', '=', module)
      .where('status', '=', 'pending')
      .limit(1)
      .executeTakeFirst();
    if (pending) throw new BadRequestException('لا يمكن تغيير قاعدة الموافقة مع وجود طلبات اعتماد معلقة.');
  }

  async deleteRule(id: string, auth: AuthContext) {
    this.requireManager(auth);
    const { tenantId } = requireTenantScope(auth);
    await this.db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('approval_rules')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id as any)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw new NotFoundException('قاعدة الموافقة غير موجودة.');
      await this.assertNoPendingRequests(trx, tenantId, current.module);
      await trx
        .deleteFrom('approval_rules')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id as any)
        .execute();
    });
    return { ok: true };
  }

  /**
   * Evaluates if a transaction requires an approval workflow and creates a request if so.
   */
  async checkAndInitiateApproval(
    params: {
      module: string;
      recordId: number | string;
      recordRef: string;
      amount: number;
      currency?: string;
      notes?: string;
    },
    auth: AuthContext,
    queryable: Kysely<Database> | Transaction<Database> = this.db,
  ) {
    const { tenantId } = requireTenantScope(auth);
    const amount = Number(params.amount || 0);

    // Find active matching rules for this module and amount range
    const rules = await queryable
      .selectFrom('approval_rules')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('module', '=', params.module)
      .where('is_active', '=', true)
      .where('min_amount', '<=', amount)
      .where((eb) => eb.or([eb('max_amount', 'is', null), eb('max_amount', '>=', amount)]))
      .orderBy('tier_level', 'asc')
      .forShare()
      .execute();

    if (rules.length === 0) {
      return { requiresApproval: false };
    }

    const maxTier = Math.max(...rules.map((r) => Number(r.tier_level || 1)));
    for (let tier = 1; tier <= maxTier; tier++) {
      if (!rules.some((rule) => Number(rule.tier_level) === tier)) {
        throw new BadRequestException('مستويات الموافقة يجب أن تكون متصلة من المستوى الأول.');
      }
    }

    const createdRequest = await queryable
      .insertInto('approval_requests')
      .values({
        tenant_id: tenantId,
        module: params.module,
        record_id: String(params.recordId),
        record_ref: params.recordRef || `${params.module}-${params.recordId}`,
        amount: amount,
        currency: params.currency || 'EGP',
        current_tier: 1,
        max_tier: maxTier,
        status: 'pending',
        requested_by: auth.userId || 0,
        requested_by_name: auth.username || 'مستخدم النظام',
        notes: params.notes || null,
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow();

    // Log request creation
    await queryable
      .insertInto('approval_request_logs')
      .values({
        tenant_id: tenantId,
        request_id: String(createdRequest.id),
        tier_level: 1,
        action: 'initiated',
        action_by: auth.userId || 0,
        action_by_name: auth.username || 'مستخدم النظام',
        action_role: auth.role || 'user',
        notes: `تم إنشاء طلب اعتماد للمستوى 1 من إجمالي ${maxTier} مستويات.`,
      } as any)
      .execute();

    return {
      requiresApproval: true,
      requestId: createdRequest.id,
      currentTier: 1,
      maxTier,
      status: 'pending',
    };
  }

  notifyPendingApproval(tenantId: string, recordRef: string, amount: number): void {
    this.sendPendingAlertWhatsApp(tenantId, recordRef, amount, 'purchase_orders').catch(() => {});
  }

  private async sendPendingAlertWhatsApp(tenantId: string, recordRef: string, amount: number, module: string) {
    try {
      const managerPhoneSetting = await this.db
        .selectFrom('settings')
        .select(['value'])
        .where('tenant_id', '=', tenantId)
        .where('key', 'in', ['daily_digest_phone', 'whatsapp_gateway_manager_phone', 'owner_phone'])
        .executeTakeFirst();

      if (!managerPhoneSetting?.value) return;

      const moduleLabels: Record<string, string> = {
        purchase_orders: 'أمر شراء',
        purchases: 'فاتورة مشتريات',
        expenses: 'مصروف نقدي',
        treasury_transactions: 'حركة خزينة',
      };

      const moduleName = moduleLabels[module] || module;
      const text =
        `🔔 *تنبيه طلب اعتماد معلق (Z-Systems Approval)*:\n` +
        `يوجد طلب اعتماد معلق لـ ${moduleName} رقم (${recordRef}) بقيمة ${amount.toLocaleString('ar-EG')} ج.م يتطلب مراجعتك واعتمادك في النظام.`;

      await this.whatsappService.sendRawMessage(tenantId, managerPhoneSetting.value, text);
    } catch {
      // Non-blocking alert
    }
  }

  async getRequests(filter: ApprovalRequestFilter, auth: AuthContext) {
    this.requireManager(auth);
    const { tenantId } = requireTenantScope(auth);
    const limit = Math.min(100, Math.max(1, Number(filter.page ? filter.limit || 25 : 50)));
    const offset = Math.max(0, (Number(filter.page || 1) - 1) * limit);

    let query = this.db.selectFrom('approval_requests').selectAll().where('tenant_id', '=', tenantId);

    if (filter.status) {
      query = query.where('status', '=', filter.status);
    }
    if (filter.module) {
      query = query.where('module', '=', filter.module);
    }

    const items = await query.orderBy('created_at', 'desc').limit(limit).offset(offset).execute();

    const countQuery = await this.db
      .selectFrom('approval_requests')
      .select(sql<number>`count(*)::int`.as('total'))
      .where('tenant_id', '=', tenantId)
      .$if(Boolean(filter.status), (qb) => qb.where('status', '=', filter.status!))
      .$if(Boolean(filter.module), (qb) => qb.where('module', '=', filter.module!))
      .executeTakeFirst();

    return {
      items,
      total: countQuery?.total || items.length,
      page: Number(filter.page || 1),
      limit,
    };
  }

  async getPendingCount(auth: AuthContext): Promise<{ count: number }> {
    this.requireManager(auth);
    const { tenantId } = requireTenantScope(auth);
    const res = await this.db
      .selectFrom('approval_requests')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'pending')
      .executeTakeFirst();

    return { count: res?.count || 0 };
  }

  async getRequestDetails(id: string, auth: AuthContext) {
    this.requireManager(auth);
    const { tenantId } = requireTenantScope(auth);
    const request = await this.db
      .selectFrom('approval_requests')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .executeTakeFirst();

    if (!request) throw new NotFoundException('طلب الاعتماد غير موجود.');

    const logs = await this.db
      .selectFrom('approval_request_logs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('request_id', '=', id)
      .orderBy('created_at', 'asc')
      .execute();

    // Fetch corresponding matching rules for this request
    const rules = await this.db
      .selectFrom('approval_rules')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('module', '=', request.module)
      .where('is_active', '=', true)
      .orderBy('tier_level', 'asc')
      .execute();

    return { request, logs, rules };
  }

  async approveRequest(id: string, notes: string, auth: AuthContext) {
    const { tenantId } = requireTenantScope(auth);
    return this.db.transaction().execute(async (trx) => {
      const request = await trx
        .selectFrom('approval_requests')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id as any)
        .forUpdate()
        .executeTakeFirst();
      if (!request) throw new NotFoundException('طلب الاعتماد غير موجود.');
      if (request.status !== 'pending')
        throw new BadRequestException(`لا يمكن اعتماد هذا الطلب لأن حالته الحالية هي: ${request.status}`);
      if (request.module !== 'purchase_orders') throw new BadRequestException('مسار اعتماد هذا النوع غير مفعل.');
      // INV-SOLO-ADMIN-PO-SELF-APPROVAL-OVERRIDE: a shop with only
      // ONE admin could never decide a purchase-order approval
      // request they created — the old ban refused the requester
      // outright, so the order sat in `pending_approval` forever
      // with no second admin to approve it. When the decider is an
      // admin/super_admin, the requester may decide alone — but
      // never silently: the override is stamped into the approval
      // audit trail (`approval_request_logs.notes`) with who decided
      // (requester == decider) and that no second approval is
      // required (INV-SECOND-MANAGER-PASSWORD-REMOVED). A non-admin requester
      // is still refused.
      let soloOverride = false;
      if (Number(request.requested_by) === auth.userId) {
        soloOverride = await this.isSoloAdminOverride(trx, tenantId, auth);
        if (!soloOverride) throw new ForbiddenException('لا يجوز لصاحب الطلب اعتماد مستنده.');
      }

      const currentTier = Number(request.current_tier || 1);
      const maxTier = Number(request.max_tier || 1);
      await this.assertApprover(trx, tenantId, request, auth);

      const final = currentTier >= maxTier;
      if (final) await this.transitionPurchaseOrder(trx, tenantId, request.record_id, 'confirmed');
      await trx
        .insertInto('approval_request_logs')
        .values({
          tenant_id: tenantId,
          request_id: String(request.id),
          tier_level: currentTier,
          action: 'approved',
          action_by: auth.userId,
          action_by_name: auth.username,
          action_role: auth.role,
          notes:
            (notes || `تمت الموافقة على المستوى ${currentTier}.`) +
            (soloOverride ? ` — اعتماد منفرد بقرار إداري — صاحب الطلب ${auth.username} اعتمد مستنده بنفسه` : ''),
        } as any)
        .execute();
      await trx
        .updateTable('approval_requests')
        .set({
          status: final ? 'approved' : 'pending',
          current_tier: final ? currentTier : currentTier + 1,
          updated_at: sql`NOW()`,
        } as any)
        .where('tenant_id', '=', tenantId)
        .where('id', '=', request.id as any)
        .execute();
      return {
        ok: true,
        requestId: request.id,
        status: final ? 'approved' : 'pending',
        currentTier: final ? currentTier : currentTier + 1,
        maxTier,
        isFullyApproved: final,
      };
    });
  }

  async rejectRequest(id: string, reason: string, auth: AuthContext) {
    const { tenantId } = requireTenantScope(auth);
    if (!reason?.trim()) throw new BadRequestException('سبب الرفض إلزامي لتوثيقه في السجل.');
    return this.db.transaction().execute(async (trx) => {
      const request = await trx
        .selectFrom('approval_requests')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id as any)
        .forUpdate()
        .executeTakeFirst();
      if (!request) throw new NotFoundException('طلب الاعتماد غير موجود.');
      if (request.status !== 'pending')
        throw new BadRequestException(`لا يمكن رفض هذا الطلب لأن حالته الحالية هي: ${request.status}`);
      if (request.module !== 'purchase_orders') throw new BadRequestException('مسار رفض هذا النوع غير مفعل.');
      // INV-SOLO-ADMIN-PO-SELF-APPROVAL-OVERRIDE: same solo-admin
      // override as approveRequest — the requester may reject alone
      // when they are an admin/super_admin; no second-manager
      // approval is ever required (INV-SECOND-MANAGER-PASSWORD-REMOVED). The
      // override is stamped into the rejection log row.
      let soloOverride = false;
      if (Number(request.requested_by) === auth.userId) {
        soloOverride = await this.isSoloAdminOverride(trx, tenantId, auth);
        if (!soloOverride) throw new ForbiddenException('لا يجوز لصاحب الطلب رفض مستنده.');
      }
      await this.assertApprover(trx, tenantId, request, auth);
      await this.transitionPurchaseOrder(trx, tenantId, request.record_id, 'draft');
      await trx
        .insertInto('approval_request_logs')
        .values({
          tenant_id: tenantId,
          request_id: String(request.id),
          tier_level: Number(request.current_tier || 1),
          action: 'rejected',
          action_by: auth.userId,
          action_by_name: auth.username,
          action_role: auth.role,
          notes:
            reason.trim() +
            (soloOverride ? ` — رفض منفرد بقرار إداري — صاحب الطلب ${auth.username} رفض مستنده بنفسه` : ''),
        } as any)
        .execute();
      await trx
        .updateTable('approval_requests')
        .set({ status: 'rejected', updated_at: sql`NOW()` } as any)
        .where('tenant_id', '=', tenantId)
        .where('id', '=', request.id as any)
        .execute();
      return { ok: true, status: 'rejected' };
    });
  }

  /**
   * INV-SECOND-MANAGER-PASSWORD-REMOVED: true when the decider is an
   * admin/super_admin — no second-manager approval is ever
   * required, so there is no tenant-size check: whether or not
   * another active admin exists in the tenant, an admin may decide
   * alone with a logged override. A non-admin decider is never a
   * solo override (they are refused by the caller). The `_trx` /
   * `_tenantId` parameters are retained (unused) so the call sites
   * keep their shape.
   */
  private async isSoloAdminOverride(
    _trx: Transaction<Database>,
    _tenantId: string,
    auth: AuthContext,
  ): Promise<boolean> {
    return auth.role === 'admin' || auth.role === 'super_admin';
  }

  private async assertApprover(
    trx: Transaction<Database>,
    tenantId: string,
    request: { module: string; amount: number; current_tier: number },
    auth: AuthContext,
  ): Promise<void> {
    const rules = await trx
      .selectFrom('approval_rules')
      .select(['required_role', 'approver_user_id'])
      .where('tenant_id', '=', tenantId)
      .where('module', '=', request.module)
      .where('is_active', '=', true)
      .where('tier_level', '=', Number(request.current_tier))
      .where('min_amount', '<=', Number(request.amount))
      .where((eb) => eb.or([eb('max_amount', 'is', null), eb('max_amount', '>=', Number(request.amount))]))
      .execute();
    if (
      !rules.some(
        (rule) =>
          (auth.role === rule.required_role || auth.role === 'super_admin') &&
          (rule.approver_user_id === null || Number(rule.approver_user_id) === auth.userId),
      )
    ) {
      throw new ForbiddenException('ليس لديك صلاحية اعتماد هذا المستوى.');
    }
  }

  private async transitionPurchaseOrder(
    trx: Transaction<Database>,
    tenantId: string,
    recordId: string | number,
    status: 'confirmed' | 'draft',
  ): Promise<void> {
    const result = await trx
      .updateTable('purchase_orders')
      .set({ status, updated_at: new Date() })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', Number(recordId))
      .where('status', '=', 'pending_approval')
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) !== 1) throw new BadRequestException('أمر الشراء لم يعد في انتظار الموافقة.');
  }
}
