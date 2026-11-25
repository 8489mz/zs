/**
 * محرك احتساب وتدقيق حدود المستخدمين للباقات — مصدر واحد للحقيقة
 * Single Source of Truth for Plan User Limits
 *
 * الثوابت الحاكمة:
 * 1. الأرقام تُقرأ حصرياً من جدول `saas_plans` بالربط (tenants.plan_id ⇄ saas_plans.code / feature_plan_id).
 * 2. قيمة `max_users = NULL` في `saas_plans` تعني **بلا حد (غير محدود)** مثل باقة التجارة الشاملة.
 * 3. التفرقة الحاسمة بين `NULL` وبين «عدم وجود اشتراك أو باقة معروفة»:
 *    - `NULL` في باقة معتمدة = غير محدود (لا يُقفل الزر ولا يُمنع المستخدم).
 *    - عدم وجود باقة ولا اشتراك إطلاقاً = السقوط على الافتراضي (5 للتجربة، 3 للافتراضي).
 */

import { resolvePlanRank } from '../../../core/tenant/plan-tier.util';

export type UserLimit = number | null;

export interface UserLimitInput {
  /** قيمة max_users من جدول saas_plans للاشتراك النشط (null تعني غير محدود) */
  subscriptionMaxUsers?: UserLimit | undefined;
  /** كود الباقة من الاشتراك النشط (مثل OMNICHANNEL, ULTIMATE, PRO, BASIC) */
  subscriptionPlanCode?: string | null;
  /** معرف خطة الميزات للاشتراك النشط (مثل plan_omnichannel, plan_ultimate) */
  subscriptionFeaturePlanId?: string | null;
  /** هل يوجد اشتراك نشط أو تحت فترة السماح للمنشأة */
  hasActiveSubscription: boolean;
  /** قيمة max_users المقروءة من saas_plans عبر الربط tenants.plan_id ⇄ saas_plans.code / feature_plan_id */
  planFromDbMaxUsers?: UserLimit | undefined;
  /** هل وُجدت الباقة في جدول saas_plans */
  planFoundInDb?: boolean;
  /** كود أو معرف الباقة المعلق على المنشأة (tenants.plan_id) */
  tenantPlanId?: string | null;
  /** هل المنشأة في فترة تجريبية (status === 'trial') */
  isTrial: boolean;
}

export const DEFAULT_TRIAL_USER_LIMIT = 5;
export const DEFAULT_USER_LIMIT = 3;

/**
 * تحديد الحد الأقصى للمستخدمين المسموح بهم للمنشأة:
 * null تعني غير محدود (Unlimited)
 */
export function resolveUserLimit(input: UserLimitInput): UserLimit {
  const rawSubCode = String(input.subscriptionPlanCode || '').toUpperCase();
  const rawSubFeature = String(input.subscriptionFeaturePlanId || '').toLowerCase();
  const rawTenantPlan = String(input.tenantPlanId || '').toLowerCase();

  // هل باقة المنشأة الحالية صراحة غير محدودة؟
  const isTenantPlanUnlimited =
    rawTenantPlan.includes('omnichannel') ||
    rawTenantPlan.includes('ultimate') ||
    rawTenantPlan.includes('enterprise') ||
    rawTenantPlan.includes('commerce') ||
    rawTenantPlan.includes('تجارة');

  // هل باقة الاشتراك النشط صراحة غير محدودة؟
  const isSubscriptionUnlimited =
    rawSubCode === 'OMNICHANNEL' ||
    rawSubCode === 'ULTIMATE' ||
    rawSubCode === 'ENTERPRISE' ||
    rawSubFeature.includes('omnichannel') ||
    rawSubFeature.includes('ultimate') ||
    rawSubFeature.includes('enterprise') ||
    rawSubFeature.includes('commerce') ||
    (input.hasActiveSubscription && input.subscriptionMaxUsers === null);

  // 1. إذا كانت باقة المنشأة أو الاشتراك غير محدودة (Ultimate / Omnichannel / Enterprise)
  if (isTenantPlanUnlimited || isSubscriptionUnlimited) {
    return null; // غير محدود
  }

  // 2. إذا كانت الباقة مسجلة للمنشأة وموجودة في saas_plans، فلها الأولوية في حال تعارضها مع اشتراك قديم
  if (input.planFoundInDb) {
    if (input.planFromDbMaxUsers === null) {
      return null; // غير محدود
    }
    if (typeof input.planFromDbMaxUsers === 'number' && input.planFromDbMaxUsers > 0) {
      return input.planFromDbMaxUsers;
    }
  }

  // 3. مطابقة صريحة لاسم/معرف الباقة المعلق على المنشأة (tenants.plan_id)
  const resolvedRank = resolvePlanRank(rawTenantPlan);
  if (rawTenantPlan.includes('pro') || resolvedRank === 2) {
    const subUsers =
      typeof input.subscriptionMaxUsers === 'number' && (rawSubCode === 'PRO' || rawSubCode.endsWith('_L2'))
        ? input.subscriptionMaxUsers
        : 0;
    return Math.max(subUsers, 6);
  }

  // 4. إذا كان الاشتراك نشطاً
  if (input.hasActiveSubscription) {
    if (input.subscriptionMaxUsers === null) {
      return null;
    }
    if (typeof input.subscriptionMaxUsers === 'number' && input.subscriptionMaxUsers > 0) {
      return input.subscriptionMaxUsers;
    }
  }

  if (rawSubCode === 'PRO' || rawSubCode.endsWith('_L2')) {
    return 6;
  }

  if (resolvedRank === 3 || rawSubCode.endsWith('_L3')) {
    return 25;
  }

  // 5. لا اشتراك ولا باقة معروفة في saas_plans: نسقط على الافتراضي
  return input.isTrial ? DEFAULT_TRIAL_USER_LIMIT : DEFAULT_USER_LIMIT;
}

/**
 * فحص هل تم الوصول للحد الأقصى للمستخدمين
 */
export function isUserLimitReached(limit: UserLimit, activeUsersCount: number): boolean {
  if (limit === null) return false; // غير محدود
  return activeUsersCount >= limit;
}

/**
 * الوصف النصي للحد لعرضه في الإشعارات والواجهات
 */
export function describeUserLimit(limit: UserLimit): string {
  return limit === null ? 'غير محدود' : String(limit);
}
