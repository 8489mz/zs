export type Permission = string;

export interface AuthUser {
  id: string;
  username: string;
  role: 'super_admin' | 'admin' | 'cashier';
  permissions: Permission[];
  displayName: string;
  branchIds: string[];
  defaultBranchId: string;
  tenantId?: string;
  accountId?: string;
  isPlatformImpersonation?: boolean;
  mustChangePassword?: boolean;
  usingDefaultAdminPassword?: boolean;
}

export interface AuthTenant {
  id: string;
  accountId: string;
  slug: string;
  businessName: string;
  activityType?: string;
  pillar?: string;
  status: 'trial' | 'active' | 'suspended' | 'expired' | string;
  isTrial: boolean;
  trialEndsAt: string | null;
  trialDaysRemaining: number | null;
  createdAt?: string | null;
  features?: string[];
  planId?: string | null;
  plan?: string;
  extraFeatures?: string[];
}

export interface AuthMeResponse {
  user: AuthUser;
  tenant?: AuthTenant | null;
  settings: {
    storeName: string;
    theme: string;
    uiLanguage?: 'ar' | 'en' | string;
    isEtaActive?: boolean;
    onboardingCompleted?: boolean;
  };
  security: {
    mustChangePassword: boolean;
    usingDefaultAdminPassword?: boolean;
  };
}

export interface AuthLoginResponse extends AuthMeResponse {
  ok?: boolean;
  mustChangePassword?: boolean;
  expiresAt?: string;
  sessionId?: string;
  /** MFA-1: كلمة المرور صحت لكن لا جلسة بعد — الرد يحمل تحدياً قصير العمر بدل `sessionId`. */
  mfaRequired?: boolean;
  mfaToken?: string;
  username?: string;
}
