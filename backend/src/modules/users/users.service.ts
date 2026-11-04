import { Inject, Injectable, Logger } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { AppError } from '../../common/errors/app-error';
import { paginateRows } from '../../common/utils/pagination';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { AuditService } from '../../core/audit/audit.service';
import { UpsertUserDto } from './dto/upsert-user.dto';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { isPlatformTenantId, requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { createPasswordRecord, verifyPassword } from '../../core/auth/utils/password-hasher';
import { assertStrongPassword } from '../../core/auth/utils/password-policy';
import { ensureUsersPayload, filterUsers, mapUserRow, normalizeBranchIds, normalizeUserId, normalizeUserListQuery, summarizeUsers } from './helpers/users.helper';
import { TransactionHelper } from '../../database/helpers/transaction.helper';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { generatePhoneSearchVariants, validateAndNormalizePhone } from '../../core/utils/phone-utils';
import { resolveUserLimit, isUserLimitReached } from './engines/user-plan-limit.engine';
import { AuthCacheService } from '../../core/auth/services/auth-cache.service';

function parseStoredPermissions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function samePermissionSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((item) => set.has(item));
}

// INV-USER-GRANT-SUBSET: role rank for the grant ceiling. The DTO allows
// exactly three roles; the ordering is evidenced by the existing
// super_admin-to-admin demotion outside the platform tenant and by the
// demotion/session-revocation handling of super_admin/admin as the
// elevated roles. Unknown role strings rank 0 (fail closed).
function roleRank(role: unknown): number {
  if (role === 'super_admin') return 3;
  if (role === 'admin') return 2;
  if (role === 'cashier') return 1;
  return 0;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
    private readonly authCache: AuthCacheService = new AuthCacheService(),
  ) {}

  private scope(actor: AuthContext) { return requireTenantScope(actor); }
  private tenantPredicate(actor: AuthContext, alias?: string) {
    const { tenantId } = this.scope(actor);
    return sql<boolean>`${sql.ref(alias ? `${alias}.tenant_id` : 'tenant_id')} = ${tenantId}`;
  }

  private async assertCurrentUserPassword(password: string, auth: AuthContext): Promise<void> {
    const providedPassword = String(password || '').trim();
    if (!providedPassword) throw new AppError('يرجى إدخال كلمة المرور الحالية لتأكيد الإجراء', 'CURRENT_USER_PASSWORD_REQUIRED', 400);
    const scope = this.scope(auth);
    const result = await sql<{ id: number, is_active: boolean | number | string, password_hash: string, password_salt: string }>`select id, is_active, password_hash, password_salt from users where id = ${auth.userId} and tenant_id = ${scope.tenantId} limit 1`.execute(this.db);
    const user = result.rows?.[0] || null;
    if (!user || user.is_active === false || user.is_active === 0 || user.is_active === 'false') throw new AppError('المستخدم الحالي غير موجود', 'CURRENT_USER_NOT_FOUND', 400);
    const passwordCheck = await verifyPassword(providedPassword, String(user.password_hash || ''), String(user.password_salt || ''));
    if (!passwordCheck.valid) throw new AppError('كلمة المرور غير صحيحة، يرجى المحاولة مرة أخرى', 'CURRENT_USER_PASSWORD_INVALID', 400);
  }

  private async ensureUniqueUsername(username: string, actor: AuthContext, excludeId?: number): Promise<void> {
    const row = await this.db
      .selectFrom('users')
      .select(['id'])
      .where(sql`LOWER(username)`, '=', username.toLowerCase())
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();

    if (row && (!excludeId || Number(row.id) !== excludeId)) {
      throw new AppError('Username already exists', 'USERNAME_EXISTS', 400);
    }
  }

  private normalizePhone(phone?: string | null, countryCode?: string): string {
    const result = validateAndNormalizePhone(phone, countryCode);
    if (!result.isValid) {
      throw new AppError(result.error || 'رقم الهاتف المحمول غير صالح', 'INVALID_PHONE', 400);
    }
    return result.normalized;
  }

  private async ensureUniquePhone(phone: string | null, actor: AuthContext, excludeId?: number): Promise<void> {
    if (!phone) return;
    const variants = generatePhoneSearchVariants(phone);
    const row = await this.db
      .selectFrom('users')
      .select(['id', 'username', 'phone'])
      .where('phone', 'in', variants)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();

    if (row && (!excludeId || Number(row.id) !== excludeId)) {
      throw new AppError('رقم الهاتف مسجل بالفعل لمستخدم آخر في المنشأة', 'PHONE_EXISTS', 400);
    }
  }

  private async loadBranchMap(userIds: number[], actor: AuthContext): Promise<Map<number, string[]>> {
    const map = new Map<number, string[]>();
    if (!userIds.length) return map;
    const { tenantId } = this.scope(actor);

    const rows = await sql<{ user_id: number; branch_id: number }>`
      select user_id, branch_id
      from user_branches
      where tenant_id = ${tenantId} and user_id in (${sql.join(userIds)})
      order by user_id asc, branch_id asc
    `.execute(this.db);

    for (const row of rows.rows) {
      const userId = Number(row.user_id);
      const branchId = String(row.branch_id);
      const current = map.get(userId) ?? [];
      current.push(branchId);
      map.set(userId, current);
    }

    return map;
  }

  private async replaceUserBranches(
    userId: number,
    branchIds: string[] | undefined,
    actor: AuthContext,
    trx: Kysely<Database> = this.db
  ): Promise<void> {
    // If branchIds is undefined (omitted in request), preserve existing associations! (CORE-006)
    if (branchIds === undefined) {
      return;
    }

    const normalized = normalizeBranchIds(branchIds);
    const { tenantId, accountId } = this.scope(actor);

    // Explicit empty array clears associations
    if (!normalized.length) {
      await sql`delete from user_branches where tenant_id = ${tenantId} and user_id = ${userId}`.execute(trx);
      return;
    }

    // Validate ALL target branches belong to this tenant before deleting existing associations (CORE-006)
    const existingBranches = await trx
      .selectFrom('branches')
      .select('id')
      .where('id', 'in', normalized)
      .where('tenant_id', '=', tenantId)
      .execute();

    const validBranchIds = new Set(existingBranches.map((b) => Number(b.id)));
    const invalidBranches = normalized.filter((id) => !validBranchIds.has(id));

    if (invalidBranches.length > 0) {
      throw new AppError(
        `الفرع المحدد غير موجود أو لا يتبع لهذه المنشأة: [${invalidBranches.join(', ')}]`,
        'INVALID_BRANCH_ASSIGNMENT',
        400
      );
    }

    await sql`delete from user_branches where tenant_id = ${tenantId} and user_id = ${userId}`.execute(trx);

    const values = normalized.map((branchId) => sql`(${userId}, ${branchId}, ${tenantId}, ${accountId})`);
    await sql`
      insert into user_branches (user_id, branch_id, tenant_id, account_id)
      values ${sql.join(values)}
      on conflict (user_id, branch_id) do nothing
    `.execute(trx);
  }

  private async assertValidDefaultBranch(
    branchId: number | string | null | undefined,
    tenantId: string,
    trx: Kysely<Database> = this.db
  ): Promise<number | null> {
    if (branchId === null || branchId === undefined || branchId === '') {
      return null;
    }
    const numId = Number(branchId);
    if (!Number.isInteger(numId) || numId <= 0) {
      return null;
    }

    const branch = await trx
      .selectFrom('branches')
      .select('id')
      .where('id', '=', numId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!branch) {
      throw new AppError('الفرع الافتراضي المحدد غير موجود أو لا يتبع لهذه المنشأة', 'CROSS_TENANT_BRANCH_FORBIDDEN', 400);
    }

    return numId;
  }

  async getPlanLimitForTenant(tenantId: string, actor: AuthContext, activeUsersCount: number): Promise<{
    maxUsers: number | null;
    isUnlimited: boolean;
    isLimitReached: boolean;
    activeUsersCount: number;
    planName: string;
    planCode: string | null;
  }> {
    const isPlatformTenant = isPlatformTenantId(tenantId);
    const isPlatformAdmin = actor.role === 'super_admin' && isPlatformTenant;

    if (isPlatformAdmin) {
      return {
        maxUsers: null,
        isUnlimited: true,
        isLimitReached: false,
        activeUsersCount,
        planName: 'مالك المنظومة (غير مقيد)',
        planCode: 'PLATFORM',
      };
    }

    const tenant = await this.db
      .selectFrom('tenants')
      .select(['id', 'plan_id', 'status'])
      .where('id', '=', tenantId)
      .executeTakeFirst();

    // 1. فحص الاشتراك النشط من tenant_subscriptions مربوطاً بـ saas_plans
    let activeSub: any;
    try {
      activeSub = await this.db
        .selectFrom('tenant_subscriptions as s')
        .leftJoin('saas_plans as p', 'p.id', 's.plan_id')
        .select([
          's.id as subscription_id',
          's.plan_id as sub_plan_id',
          'p.id as saas_plan_id',
          'p.max_users',
          'p.code as plan_code',
          'p.name as plan_name',
          'p.feature_plan_id',
        ])
        .where('s.tenant_id', '=', tenantId)
        .where('s.status', 'in', ['active', 'past_due'])
        .orderBy('s.created_at', 'desc')
        .executeTakeFirst();
    } catch {
      activeSub = undefined;
    }

    // 2. قراءة الباقة من saas_plans بالربط: tenants.plan_id ⇄ saas_plans.code أو feature_plan_id
    let planFromDb: { id: number; max_users: number | null; code: string; name: string; feature_plan_id: string | null } | undefined;
    if (tenant?.plan_id) {
      const cleanPlan = tenant.plan_id.trim();
      const codeUpper = cleanPlan.replace(/^plan_/, '').toUpperCase();
      try {
        planFromDb = await this.db
          .selectFrom('saas_plans')
          .select(['id', 'max_users', 'code', 'name', 'feature_plan_id'])
          .where((eb) =>
            eb.or([
              eb('feature_plan_id', '=', cleanPlan),
              eb('code', '=', codeUpper),
              eb(sql<string>`LOWER(code)`, '=', cleanPlan.toLowerCase()),
            ]),
          )
          .where('is_active', '=', true)
          .executeTakeFirst();
      } catch {
        planFromDb = undefined;
      }
    }

    // مزامنة علاجية تلقائية إذا كان الاشتراك معلقاً على باقة قديمة تختلف عن باقة المنشأة الحالية
    if (activeSub && planFromDb && activeSub.sub_plan_id !== planFromDb.id) {
      try {
        await this.db
          .updateTable('tenant_subscriptions')
          .set({
            plan_id: planFromDb.id,
            updated_at: new Date(),
          })
          .where('id', '=', activeSub.subscription_id)
          .execute();

        activeSub.max_users = planFromDb.max_users;
        activeSub.plan_code = planFromDb.code;
        activeSub.plan_name = planFromDb.name;
        activeSub.feature_plan_id = planFromDb.feature_plan_id;
        activeSub.sub_plan_id = planFromDb.id;
      } catch (err) {
        this.logger.warn(`Failed to auto-heal tenant subscription for ${tenantId}: ${err}`);
      }
    }

    const limit = resolveUserLimit({
      hasActiveSubscription: Boolean(activeSub),
      subscriptionMaxUsers: activeSub?.max_users,
      subscriptionPlanCode: activeSub?.plan_code,
      subscriptionFeaturePlanId: activeSub?.feature_plan_id,
      planFoundInDb: Boolean(planFromDb),
      planFromDbMaxUsers: planFromDb?.max_users,
      tenantPlanId: tenant?.plan_id,
      isTrial: tenant?.status === 'trial',
    });

    const isUnlimited = limit === null;
    const isLimitReached = !isUnlimited && activeUsersCount >= limit;
    const planName = planFromDb?.name || activeSub?.plan_name || (tenant?.status === 'trial' ? 'فترة تجريبية' : 'الافتراضية');
    const planCode = planFromDb?.code || activeSub?.plan_code || null;

    return {
      maxUsers: limit,
      isUnlimited,
      isLimitReached,
      activeUsersCount,
      planName,
      planCode,
    };
  }

  async listUsers(query: Record<string, unknown>, actor: AuthContext): Promise<Record<string, unknown>> {
    const normalizedQuery = normalizeUserListQuery(query);

    const allRows = await this.db.selectFrom('users').selectAll().where(this.tenantPredicate(actor)).orderBy('id', 'asc').execute();
    const branchMap = await this.loadBranchMap(allRows.map((row) => Number(row.id)), actor);
    const allMappedUsers = allRows.map((row) => mapUserRow(row, branchMap.get(Number(row.id)) ?? []));
    const users = filterUsers(
      allMappedUsers,
      normalizedQuery,
    );

    const canManageUsers = actor.role === 'super_admin' || actor.role === 'admin' || (actor.permissions && (actor.permissions.includes('canManageUsers') || actor.permissions.includes('canEditUsers')));
    const sanitizedUsers = canManageUsers
      ? users
      : users.map((u) => ({
          id: u.id,
          username: u.username,
          phone: u.phone || null,
          name: u.name,
          role: u.role,
          isActive: u.isActive,
          branchIds: u.branchIds,
          defaultBranchId: u.defaultBranchId,
          permissions: [],
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: null,
        }));

    const paged = paginateRows(sanitizedUsers, query, { defaultSize: 10 });
    const summary = summarizeUsers(allMappedUsers);
    const activeCount = allMappedUsers.filter((u) => u.isActive !== false).length;
    const scope = this.scope(actor);
    const planLimit = await this.getPlanLimitForTenant(scope.tenantId, actor, activeCount);

    return {
      users: paged.rows,
      pagination: {
        page: paged.pagination.page,
        pageSize: paged.pagination.pageSize,
        total: sanitizedUsers.length,
        totalPages: paged.pagination.totalPages,
      },
      summary,
      planLimit,
      scope,
    };
  }

  // INV-USER-GRANT-SUBSET: no actor may grant a permission they do not
  // themselves hold, the granted role may not exceed the actor's own
  // role, and '*' may be granted only from the platform tenant. The
  // actor's stored row (read in the same transaction) is authoritative;
  // when no actor row exists (synthetic actors in specs and internal
  // callers), the server-set AuthContext role/permissions are used,
  // never anything from the payload. Callers: executeUserCreate (every
  // creation is a grant to another user) and executeUserUpdate for
  // other-row updates; the SELF_PROMOTION_FORBIDDEN guard governs
  // own-row edits and runs first.
  private async assertGrantWithinActorScope(trx: Kysely<Database>, payload: UpsertUserDto, actor: AuthContext): Promise<void> {
    const scope = this.scope(actor);
    const isPlatformTenant = isPlatformTenantId(scope.tenantId);
    const actorRow = await trx
      .selectFrom('users')
      .select(['role', 'permissions_json'])
      .where('id', '=', actor.userId)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();
    const actorRole = actorRow ? String(actorRow.role) : actor.role;
    const actorPermissions = actorRow ? parseStoredPermissions(actorRow.permissions_json) : (actor.permissions ?? []);
    const writtenPermissions = payload.permissions ?? [];
    if (writtenPermissions.includes('*') && !isPlatformTenant) {
      throw new AppError('Only the platform tenant may grant the all-permissions grant', 'GRANT_STAR_FORBIDDEN', 403);
    }
    if (!actorPermissions.includes('*')) {
      const held = new Set(actorPermissions);
      if (writtenPermissions.some((permission) => !held.has(permission))) {
        throw new AppError('You cannot grant a permission you do not hold', 'GRANT_EXCEEDS_ACTOR_PERMISSIONS', 403);
      }
    }
    if (typeof payload.role === 'string' && payload.role) {
      const effectiveRole = payload.role === 'super_admin' && !isPlatformTenant ? 'admin' : payload.role;
      if (roleRank(effectiveRole) > roleRank(actorRole)) {
        throw new AppError('You cannot grant a role above your own', 'GRANT_ROLE_ABOVE_ACTOR', 403);
      }
    }
  }

  // INV-USER-PEER-ADMIN-ACTIONS: the actor's stored role rank (same
  // authoritative read as the grant guard; the AuthContext role is only
  // the fallback when no actor row exists).
  private async actorRoleRank(trx: Kysely<Database>, actor: AuthContext): Promise<number> {
    const actorRow = await trx
      .selectFrom('users')
      .select('role')
      .where('id', '=', actor.userId)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();
    return roleRank(actorRow ? String(actorRow.role) : actor.role);
  }

  // INV-USER-PEER-ADMIN-ACTIONS: an actor may reset the password of, or
  // change the active state of, only a user whose stored role ranks
  // strictly BELOW their own. A peer-or-higher target fails closed
  // (403), so a delegated admin can neither take over a fellow admin's
  // account nor disable/enable one. The check fires only on a real
  // password reset or a real active-state change: an omitted isActive
  // writes true, so re-enabling a disabled peer by omitting the field
  // is a status change too. Role demotion is deliberately NOT covered
  // here — downward grants stay governed by INV-USER-GRANT-SUBSET.
  private async assertPeerAdminActionAllowed(
    trx: Kysely<Database>,
    existing: { role: unknown; is_active: unknown },
    payload: UpsertUserDto,
    actor: AuthContext,
  ): Promise<void> {
    const isPasswordReset = Boolean(payload.password);
    const writtenActive = payload.isActive !== false;
    const storedActive = existing.is_active !== false && existing.is_active !== 0;
    const isStatusChange = writtenActive !== storedActive;
    if (!isPasswordReset && !isStatusChange) return;
    if (roleRank(existing.role) >= (await this.actorRoleRank(trx, actor))) {
      throw new AppError(
        isPasswordReset
          ? 'You cannot reset the password of a user at your rank or above'
          : 'You cannot change the active state of a user at your rank or above',
        isPasswordReset ? 'PASSWORD_RESET_TARGET_RANK_FORBIDDEN' : 'STATUS_CHANGE_TARGET_RANK_FORBIDDEN',
        403,
      );
    }
  }

  private async executeUserCreate(trx: Kysely<Database>, payload: UpsertUserDto, actor: AuthContext): Promise<number> {
    const scope = this.scope(actor);
    await this.assertGrantWithinActorScope(trx, payload, actor);
    if (!payload.password) {
      throw new AppError('Password is required', 'PASSWORD_REQUIRED', 400);
    }

    await this.ensureUniqueUsername(payload.username, actor);
    if (!payload.phone || !String(payload.phone).trim()) {
      throw new AppError('رقم الهاتف المحمول مطلوب', 'PHONE_REQUIRED', 400);
    }
    const cleanPhone = this.normalizePhone(payload.phone, payload.countryCode);
    await this.ensureUniquePhone(cleanPhone, actor);
    assertStrongPassword(payload.password, { role: payload.role });

    const isPlatformTenant = isPlatformTenantId(scope.tenantId);
    const isPlatformAdmin = actor.role === 'super_admin' && isPlatformTenant;

    if (!isPlatformTenant && payload.username.trim().toLowerCase() === 'zs') {
      throw new AppError('اسم المستخدم "zs" محجوز حصرياً لإدارة المنصة المركزية ولا يمكن استخدامه داخل الشركات المستضافة.', 'RESERVED_PLATFORM_USERNAME', 400);
    }

    if (!isPlatformAdmin) {
      const activeUsers = await trx.selectFrom('users').select(['id']).where(this.tenantPredicate(actor)).where('is_active', '=', true).execute();
      const planLimit = await this.getPlanLimitForTenant(scope.tenantId, actor, activeUsers.length);

      if (planLimit.isLimitReached) {
        throw new AppError(`وصلت للحد الأقصى لعدد المستخدمين في باقتك (${planLimit.maxUsers} مستخدمين). يرجى ترقية الباقة لإضافة مستخدمين جدد.`, 'PLAN_USER_LIMIT_REACHED', 403);
      }
    }

    let effectiveRole = payload.role;
    if (effectiveRole === 'super_admin' && !isPlatformTenant) {
      effectiveRole = 'admin';
    }

    // Validate foreign-tenant defaultBranchId (CORE-007)
    const validatedDefaultBranchId = await this.assertValidDefaultBranch(payload.defaultBranchId, scope.tenantId, trx);
    const passwordRecord = await createPasswordRecord(payload.password);

    const result = await trx
      .insertInto('users')
      .values(({
        username: payload.username.trim(),
        phone: cleanPhone,
        password_hash: passwordRecord.hash,
        password_salt: passwordRecord.salt,
        role: effectiveRole,
        is_active: payload.isActive !== false,
        permissions_json: JSON.stringify(payload.permissions ?? []),
        display_name: payload.name?.trim() || payload.username.trim(),
        default_branch_id: validatedDefaultBranchId,
        must_change_password: payload.mustChangePassword === true,
        failed_login_count: 0,
        locked_until: null,
        last_login_at: null,
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
      } as any))
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const newId = Number(result.id);
    await this.replaceUserBranches(newId, payload.branchIds, actor, trx);
    return newId;
  }

  async createUser(payload: UpsertUserDto, actor: AuthContext): Promise<Record<string, unknown>> {
    // Atomic user creation in transaction (CORE-006)
    const newId = await this.tx.runInTransaction(this.db, async (trx) => {
      return this.executeUserCreate(trx, payload, actor);
    });

    const created = await this.db.selectFrom('users').selectAll().where('id', '=', newId).where(this.tenantPredicate(actor)).executeTakeFirstOrThrow();
    await this.audit.log('إضافة مستخدم', `تمت إضافة المستخدم ${created.username} بواسطة ${actor.username}`, actor);

    const usersState = await this.listUsers({ includeInactive: true, page: 1, pageSize: 1000 }, actor);
    const branchMap = await this.loadBranchMap([newId], actor);
    return {
      ok: true,
      user: mapUserRow(created, branchMap.get(newId) ?? []),
      users: usersState.users,
    };
  }

  private async executeUserUpdate(trx: Kysely<Database>, id: number, payload: UpsertUserDto, actor: AuthContext, keepSessionId?: string): Promise<any> {
    const existing = await trx
      .selectFrom('users')
      .selectAll()
      .where('id', '=', id)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();

    if (!existing) {
      throw new AppError('User not found', 'USER_NOT_FOUND', 404);
    }

    // INV-USER-SELF-PROMOTION-FORBIDDEN: an actor must never change their
    // own role or permissions through this helper (which serves both the
    // single update and the bulk sync). The comparison runs against the
    // values the update WOULD store: the effective role (after the
    // super_admin demotion below) and the permission set the payload
    // would write (an omitted permissions array writes []). Any
    // self-edit that repeats the stored role and permissions is
    // unaffected; grants to other users are governed by
    // INV-USER-GRANT-SUBSET below. Checked first, before
    // any uniqueness work, so a forbidden self-promotion fails fast.
    if (id === actor.userId) {
      const guardScope = this.scope(actor);
      const guardRole = payload.role === 'super_admin' && !isPlatformTenantId(guardScope.tenantId) ? 'admin' : payload.role;
      if (guardRole !== existing.role) {
        throw new AppError('You cannot change your own role', 'SELF_PROMOTION_FORBIDDEN', 403);
      }
      const storedPermissions = parseStoredPermissions(existing.permissions_json);
      const writtenPermissions = payload.permissions ?? [];
      if (!samePermissionSet(storedPermissions, writtenPermissions)) {
        throw new AppError('You cannot change your own permissions', 'SELF_PROMOTION_FORBIDDEN', 403);
      }
    }

    // INV-USER-GRANT-SUBSET: grants to OTHER users must stay within the
    // actor's own holdings (checked before any uniqueness work, so a
    // forbidden grant fails fast like the self-guard above).
    if (id !== actor.userId) {
      await this.assertGrantWithinActorScope(trx, payload, actor);
      // INV-USER-PEER-ADMIN-ACTIONS: password resets and active-state
      // changes on peer-or-higher targets fail closed here too, before
      // any uniqueness work.
      await this.assertPeerAdminActionAllowed(trx, existing, payload, actor);
    }

    await this.ensureUniqueUsername(payload.username, actor, id);
    let updatedPhone: string | null | undefined = undefined;
    if (payload.phone !== undefined) {
      if (!payload.phone || !String(payload.phone).trim()) {
        throw new AppError('رقم الهاتف المحمول مطلوب ولا يمكن تركه فارغاً', 'PHONE_REQUIRED', 400);
      }
      updatedPhone = this.normalizePhone(payload.phone, payload.countryCode);
      await this.ensureUniquePhone(updatedPhone, actor, id);
    }

    const scope = this.scope(actor);
    const isPlatformTenant = isPlatformTenantId(scope.tenantId);

    if (!isPlatformTenant && payload.username.trim().toLowerCase() === 'zs') {
      throw new AppError('اسم المستخدم "zs" محجوز حصرياً لإدارة المنصة المركزية ولا يمكن استخدامه داخل الشركات المستضافة.', 'RESERVED_PLATFORM_USERNAME', 400);
    }

    if (existing.username.toLowerCase() === 'zs' && isPlatformTenant) {
      if (payload.username.trim().toLowerCase() !== 'zs') {
        throw new AppError('لا يمكن تغيير اسم مستخدم السوبر أدمن الرئيسي للمنظومة.', 'CANNOT_RENAME_PLATFORM_SUPER_ADMIN', 400);
      }
      if (payload.role && payload.role !== 'super_admin') {
        throw new AppError('لا يمكن تخفيض رتبة السوبر أدمن الرئيسي للمنظومة.', 'CANNOT_DEMOTE_PLATFORM_SUPER_ADMIN', 400);
      }
      if (payload.isActive === false) {
        throw new AppError('لا يمكن تعطيل حساب السوبر أدمن الرئيسي للمنظومة.', 'CANNOT_DEACTIVATE_PLATFORM_SUPER_ADMIN', 400);
      }
    }

    let effectiveRole = payload.role;
    if (effectiveRole === 'super_admin' && !isPlatformTenant) {
      effectiveRole = 'admin';
    }

    const updates: Record<string, unknown> = {
      username: payload.username.trim(),
      role: effectiveRole,
      is_active: payload.isActive !== false,
      permissions_json: JSON.stringify(payload.permissions ?? []),
      display_name: payload.name?.trim() || payload.username.trim(),
      must_change_password: payload.mustChangePassword === true,
    };

    if (payload.defaultBranchId !== undefined) {
      updates.default_branch_id = await this.assertValidDefaultBranch(payload.defaultBranchId, scope.tenantId, trx);
    }

    if (updatedPhone !== undefined) {
      updates.phone = updatedPhone;
    }

    if (payload.password) {
      // Role falls back to the stored role when the update does not
      // carry one; the admin/super_admin demotion in non-platform
      // tenants does not matter here (both require 12).
      assertStrongPassword(payload.password, { role: payload.role ?? existing.role });
      const passwordRecord = await createPasswordRecord(payload.password);
      updates.password_hash = passwordRecord.hash;
      updates.password_salt = passwordRecord.salt;
      updates.must_change_password = false;
      updates.failed_login_count = 0;
      updates.locked_until = null;
    }

    await trx.updateTable('users').set(updates).where('id', '=', id).where(this.tenantPredicate(actor)).execute();
    await this.replaceUserBranches(id, payload.branchIds, actor, trx);

    // Guaranteed Session Revocation (CORE-005):
    // Demoted, disabled, or password-reset users must lose unauthorized sessions immediately
    const isDemoted = existing.role !== effectiveRole && (existing.role === 'super_admin' || existing.role === 'admin') && effectiveRole !== existing.role;
    const isDisabled = payload.isActive === false;
    const isPasswordReset = Boolean(payload.password);
    const shouldRevokeAll = isDisabled || isDemoted || (isPasswordReset && !keepSessionId);

    let sessionCleanup = trx
      .deleteFrom('sessions')
      .where('user_id', '=', id)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`);

    if (keepSessionId && !shouldRevokeAll) {
      sessionCleanup = sessionCleanup.where('id', '!=', keepSessionId);
    }
    await sessionCleanup.execute();

    return await trx.selectFrom('users').selectAll().where('id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirstOrThrow();
  }

  async updateUser(id: number, payload: UpsertUserDto, actor: AuthContext, keepSessionId?: string): Promise<Record<string, unknown>> {
    // Atomic user update in transaction (CORE-006)
    const updated = await this.tx.runInTransaction(this.db, async (trx) => {
      return this.executeUserUpdate(trx, id, payload, actor, keepSessionId);
    });

    // Invalidate cached authorization immediately on commit (CORE-005)
    this.authCache.invalidateUserSessions(id);

    await this.audit.log('تعديل مستخدم', `تم تحديث المستخدم ${updated.username} بواسطة ${actor.username}`, actor);

    const usersState = await this.listUsers({ includeInactive: true, page: 1, pageSize: 1000 }, actor);
    const branchMap = await this.loadBranchMap([id], actor);
    return {
      ok: true,
      user: mapUserRow(updated, branchMap.get(id) ?? []),
      users: usersState.users,
    };
  }

  async changePassword(payload: ChangePasswordDto, actor: AuthContext): Promise<Record<string, unknown>> {
    const id = Number(actor.userId);
    const scope = this.scope(actor);
    const existing = await this.db.selectFrom('users').selectAll().where('id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirst();
    
    if (!existing) {
      throw new AppError('User not found', 'USER_NOT_FOUND', 404);
    }

    const verification = await verifyPassword(payload.oldPassword, String(existing.password_hash || ''), String(existing.password_salt || ''));
    if (!verification.valid) {
      throw new AppError('كلمة المرور القديمة غير صحيحة', 'INVALID_OLD_PASSWORD', 400);
    }

    assertStrongPassword(payload.newPassword, { role: existing.role });
    const passwordRecord = await createPasswordRecord(payload.newPassword);

    await this.tx.runInTransaction(this.db, async (trx) => {
      await trx.updateTable('users')
        .set({
          password_hash: passwordRecord.hash,
          password_salt: passwordRecord.salt,
          must_change_password: false,
          failed_login_count: 0,
          locked_until: null,
        } as any)
        .where('id', '=', id)
        .where(this.tenantPredicate(actor))
        .execute();

      // Revoke all other sessions in DB (CORE-005)
      let sessionCleanup = trx
        .deleteFrom('sessions')
        .where('user_id', '=', id)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`);
      if (actor.sessionId) {
        sessionCleanup = sessionCleanup.where('id', '!=', actor.sessionId);
      }
      await sessionCleanup.execute();
    });

    // Invalidate cached authorization immediately! (CORE-005)
    this.authCache.invalidateUserSessions(id);

    await this.audit.log('تغيير كلمة المرور', `المستخدم ${existing.username} قام بتغيير كلمة المرور الخاصة به`, actor);

    return { ok: true, message: 'تم تغيير كلمة المرور بنجاح' };
  }

  async updateProfile(payload: UpdateProfileDto, actor: AuthContext): Promise<Record<string, unknown>> {
    const id = Number(actor.userId);
    const existing = await this.db.selectFrom('users').selectAll().where('id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirst();
    if (!existing) {
      throw new AppError('User not found', 'USER_NOT_FOUND', 404);
    }

    const updates: Record<string, unknown> = {};
    if (payload.username) {
      await this.ensureUniqueUsername(payload.username, actor, id);
      updates.username = payload.username.trim();
    }
    if (payload.name !== undefined) {
      updates.display_name = payload.name.trim() || (payload.username || existing.username).trim();
    }
    if (payload.phone !== undefined) {
      if (!payload.phone || !String(payload.phone).trim()) {
        throw new AppError('رقم الهاتف المحمول مطلوب ولا يمكن تركه فارغاً', 'PHONE_REQUIRED', 400);
      }
      const cleanPhone = this.normalizePhone(payload.phone, payload.countryCode);
      await this.ensureUniquePhone(cleanPhone, actor, id);
      updates.phone = cleanPhone;
    }

    if (Object.keys(updates).length > 0) {
      await this.db.updateTable('users').set(updates).where('id', '=', id).where(this.tenantPredicate(actor)).execute();
      await this.audit.log('تعديل الملف الشخصي', `المستخدم ${existing.username} قام بتعديل بيانات ملفه الشخصي`, actor);
    }

    const updated = await this.db.selectFrom('users').selectAll().where('id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirstOrThrow();
    const branchMap = await this.loadBranchMap([id], actor);
    
    return {
      ok: true,
      user: mapUserRow(updated, branchMap.get(id) ?? []),
      message: 'تم تحديث البيانات بنجاح'
    };
  }

  async syncUsers(usersPayload: UpsertUserDto[], actor: AuthContext, actorSessionId?: string): Promise<Record<string, unknown>> {
    ensureUsersPayload(usersPayload);

    // All-or-nothing transactional bulk sync (CORE-006)
    const affectedUserIds = await this.tx.runInTransaction(this.db, async (trx) => {
      const ids: number[] = [];
      for (const entry of usersPayload) {
        const id = normalizeUserId((entry as unknown as { id?: string | number }).id);
        if (id > 0) {
          await this.executeUserUpdate(trx, id, entry, actor, Number(id) === actor.userId ? actorSessionId : undefined);
          ids.push(id);
        } else {
          const newId = await this.executeUserCreate(trx, entry, actor);
          ids.push(newId);
        }
      }
      return ids;
    });

    // Guaranteed cache invalidation for all affected users (CORE-005)
    for (const uid of affectedUserIds) {
      this.authCache.invalidateUserSessions(uid);
    }

    await this.audit.log('تعديل المستخدمين', `تم تحديث ${usersPayload.length} مستخدم/صلاحية بواسطة ${actor.username}`, actor);
    const usersState = await this.listUsers({ includeInactive: true, page: 1, pageSize: 1000 }, actor);

    return {
      ok: true,
      users: usersState.users,
    };
  }

  async deleteUser(id: number, managerPin: string | undefined, actor: AuthContext): Promise<Record<string, unknown>> {
    await this.assertCurrentUserPassword(managerPin || '', actor);

    const existing = await this.db.selectFrom('users').selectAll().where('id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirst();
    if (!existing) {
      throw new AppError('User not found', 'USER_NOT_FOUND', 404);
    }
    if (existing.username.toLowerCase() === 'zs' || (existing.role === 'super_admin' && isPlatformTenantId(existing.tenant_id))) {
      throw new AppError('لا يمكن حذف حساب السوبر أدمن الرئيسي للمنظومة.', 'CANNOT_DELETE_PLATFORM_SUPER_ADMIN', 400);
    }
    if (Number(existing.id) === Number(actor.userId)) {
      throw new AppError('Cannot delete current user', 'CURRENT_USER_DELETE_FORBIDDEN', 400);
    }

    const { tenantId } = this.scope(actor);
    try {
      await this.tx.runInTransaction(this.db, async (trx) => {
        await sql`delete from user_branches where tenant_id = ${tenantId} and user_id = ${id}`.execute(trx);
        await trx.deleteFrom('sessions').where('user_id', '=', id).where(sql<boolean>`tenant_id = ${tenantId}`).execute();
        
        // Nullify audit logs actor reference scoped strictly to current tenant to allow deleting users who only have login/audit history
        await sql`update audit_logs set created_by = null where tenant_id = ${tenantId} and created_by = ${id}`.execute(trx);

        await trx.deleteFrom('users').where('id', '=', id).where(this.tenantPredicate(actor)).execute();
      });

      // Invalidate cached authorization immediately! (CORE-005)
      this.authCache.invalidateUserSessions(id);
    } catch (err: any) {
      if (err?.code === '23503' || String(err?.message || '').includes('violates foreign key constraint')) {
        throw new AppError(
          'لا يمكن حذف هذا المستخدم لوجود فواتير أو حركات مخزنية مسجلة باسمه. يمكنك تعطيل حسابه بدلاً من الحذف للحفاظ على السجلات المالية.',
          'USER_HAS_TRANSACTIONS',
          400,
        );
      }
      throw err;
    }
    await this.audit.log('حذف مستخدم', `تم حذف المستخدم ${existing.username} بواسطة ${actor.username}`, actor);

    const usersState = await this.listUsers({ includeInactive: true, page: 1, pageSize: 1000 }, actor);
    return {
      ok: true,
      removedUserId: String(existing.id),
      users: usersState.users,
    };
  }

  async unlockUser(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const existing = await this.db.selectFrom('users').selectAll().where('id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirst();
    if (!existing) {
      throw new AppError('User not found', 'USER_NOT_FOUND', 404);
    }

    await this.db
      .updateTable('users')
      .set({
        failed_login_count: 0,
        locked_until: null,
      })
      .where('id', '=', id)
      .where(this.tenantPredicate(actor))
      .execute();

    const updated = await this.db.selectFrom('users').selectAll().where('id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirstOrThrow();
    await this.audit.log('فتح مستخدم', `تم فتح المستخدم ${updated.username} بواسطة ${actor.username}`, actor);

    const usersState = await this.listUsers({ includeInactive: true, page: 1, pageSize: 1000 }, actor);
    const branchMap = await this.loadBranchMap([id], actor);
    return {
      ok: true,
      user: mapUserRow(updated, branchMap.get(id) ?? []),
      users: usersState.users,
    };
  }

  async bulkDisableUsers(userIds: number[], actor: AuthContext, actorSessionId?: string): Promise<Record<string, unknown>> {
    const requestedIds = Array.from(new Set((userIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)));
    if (!requestedIds.length) {
      throw new AppError('لا يوجد مستخدمون ضمن التحديد.', 'BULK_DISABLE_EMPTY_SELECTION', 400);
    }

    const selectedRows = await this.db
      .selectFrom('users')
      .selectAll()
      .where('id', 'in', requestedIds)
      .where(this.tenantPredicate(actor))
      .orderBy('id', 'asc')
      .execute();

    if (!selectedRows.length) {
      return {
        ok: true,
        disabledCount: 0,
        skippedCount: requestedIds.length,
        skipped: requestedIds.map((id) => ({ id: String(id), username: `user-${id}`, reason: 'المستخدم غير موجود ضمن نفس النسخة.' })),
        message: 'لا يوجد مستخدم قابل للإيقاف ضمن التحديد الحالي.',
      };
    }

    const allTenantUsers = await this.db
      .selectFrom('users')
      .select(['id', 'role', 'is_active'])
      .where(this.tenantPredicate(actor))
      .execute();

    // INV-USER-PEER-ADMIN-ACTIONS: the actor's stored role rank decides
    // which selected rows may be disabled at all (same authoritative
    // read as the update-path guard; the AuthContext role is only the
    // fallback when no actor row exists).
    const bulkActorRow = await this.db
      .selectFrom('users')
      .select('role')
      .where('id', '=', actor.userId)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();
    const bulkActorRank = roleRank(bulkActorRow ? String(bulkActorRow.role) : actor.role);

    const activePrivilegedIds = new Set(
      allTenantUsers
        .filter((row) => row.is_active !== false && (row.role === 'admin' || row.role === 'super_admin'))
        .map((row) => Number(row.id)),
    );

    const skipped: Array<{ id: string; username: string; reason: string }> = [];
    const allowedIds: number[] = [];
    const selectedActivePrivilegedAllowedIds: number[] = [];

    for (const row of selectedRows) {
      const id = Number(row.id);
      const username = String(row.username || '');

      if (id === Number(actor.userId)) {
        skipped.push({ id: String(id), username, reason: 'لا يمكن إيقاف الحساب الحالي.' });
        continue;
      }

      if (row.role === 'super_admin') {
        skipped.push({ id: String(id), username, reason: 'لا يمكن إيقاف حساب السوبر أدمن.' });
        continue;
      }

      // INV-USER-PEER-ADMIN-ACTIONS: only users strictly below the
      // actor's rank may be bulk-disabled; a peer-or-higher admin is
      // skipped with a reason, like the existing self/super_admin
      // skips, and still counts toward the last-admin protection.
      if (roleRank(row.role) >= bulkActorRank) {
        skipped.push({ id: String(id), username, reason: 'لا يمكن إيقاف مستخدم بنفس رتبتك أو أعلى.' });
        continue;
      }

      allowedIds.push(id);
     const rowRole = String(row.role || '');
if (row.is_active !== false && (rowRole === 'admin' || rowRole === 'super_admin')) {
        selectedActivePrivilegedAllowedIds.push(id);
      }
    }

    const remainingPrivilegedIfDisabled = activePrivilegedIds.size - selectedActivePrivilegedAllowedIds.length;
    if (remainingPrivilegedIfDisabled < 1 && selectedActivePrivilegedAllowedIds.length > 0) {
      const protectedSet = new Set(selectedActivePrivilegedAllowedIds);
      for (const row of selectedRows) {
        const id = Number(row.id);
        if (!protectedSet.has(id)) continue;
        skipped.push({
          id: String(id),
          username: String(row.username || ''),
          reason: 'لا يمكن إيقاف آخر حساب إداري فعّال.',
        });
      }
      for (let i = allowedIds.length - 1; i >= 0; i -= 1) {
        if (protectedSet.has(allowedIds[i])) {
          allowedIds.splice(i, 1);
        }
      }
    }

    if (allowedIds.length) {
      const { tenantId } = this.scope(actor);
      await this.tx.runInTransaction(this.db, async (trx) => {
        await trx
          .updateTable('users')
          .set({ is_active: false } as any)
          .where('id', 'in', allowedIds)
          .where(this.tenantPredicate(actor))
          .execute();

        let sessionCleanup = trx
          .deleteFrom('sessions')
          .where('user_id', 'in', allowedIds)
          .where(sql<boolean>`tenant_id = ${tenantId}`);
        if (actorSessionId && allowedIds.includes(Number(actor.userId))) {
          sessionCleanup = sessionCleanup.where('id', '!=', actorSessionId);
        }
        await sessionCleanup.execute();
      });

      // Invalidate cached authorization immediately! (CORE-005)
      for (const uid of allowedIds) {
        this.authCache.invalidateUserSessions(uid);
      }
    }

    const disabledUsers = selectedRows.filter((row) => allowedIds.includes(Number(row.id)));
    if (disabledUsers.length) {
      await this.audit.log(
        'إيقاف مستخدمين (دفعة)',
        `تم إيقاف ${disabledUsers.length} مستخدم/مستخدمين بواسطة ${actor.username}${skipped.length ? ` مع تخطي ${skipped.length}` : ''}`,
        actor,
      );
    }

    return {
      ok: true,
      disabledCount: disabledUsers.length,
      skippedCount: skipped.length,
      skipped,
      message: disabledUsers.length
        ? `تم إيقاف ${disabledUsers.length} مستخدم.`
        : 'لا يوجد مستخدم قابل للإيقاف ضمن التحديد الحالي.',
    };
  }
}
