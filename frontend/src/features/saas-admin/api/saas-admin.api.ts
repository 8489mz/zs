import { http, resolveRequestUrl } from '@/lib/http';

export interface SaasDiagnosticRow {
  id: number;
  clientName: string;
  clientIdentifier: string;
  appVersion: string;
  logPeriod: string;
  errorCount500: number;
  errorSummary?: {
    totalDetected?: number;
    samples?: string[];
  };
  fileSizeBytes: number;
  uploadedAt: string;
}

export interface SaasDiagnosticsListResponse {
  data: SaasDiagnosticRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export type SaasTenantStatus = 'trial' | 'active' | 'expired' | 'suspended' | string;

// P10 (INV-VAN-GENERAL-FEATURE-OVERRIDES): one super-admin per-tenant
// feature override as returned by getTenantById (granted true = grant,
// false = hide). No row for a feature means the profile default applies.
export type TenantFeatureOverride = {
  featureCode: string;
  granted: boolean;
  reason?: string | null;
};

export type SaasTenantRow = {
  id: string;
  slug: string;
  businessName: string;
  ownerName: string;
  ownerPhone: string;
  ownerEmail: string;
  activityType: string;
  status: SaasTenantStatus;
  trialStartsAt: string | null;
  trialEndsAt: string | null;
  activatedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  trialDaysRemaining: number | null;
  usersCount: number;
  activeUsersCount: number;
  ownerLocked: boolean;
  ownerIsActive: boolean;
  ownerUsername: string;
  planName: string | null;
  planId: string | null;
  extraFeatures: string[];
  featureOverrides?: TenantFeatureOverride[];
  subscriptionStatus: string | null;
  subscriptionEndDate: string | null;
  graceEndDate: string | null;
  lastLoginAt?: string | null;
  lastSeenAt?: string | null;
  isPlatform?: boolean;
};

export type TenantTimelineEvent = {
  id: number;
  action: string;
  details: string;
  actorName: string;
  createdAt: string;
};

export interface SaasPlan {
  id: number;
  code: string;
  name: string;
  price: number;
  currency: string;
  billing_period_months: number;
  max_users: number | null;
  max_branches: number | null;
  feature_plan_id: string | null;
  feature_plan_name?: string;
  subscribers_count?: number;
  is_active: boolean;
  features?: string[];
  created_at: string;
  updated_at: string;
};

export type CreateTrialTenantPayload = {
  slug: string;
  businessName: string;
  branchName?: string;
  ownerName: string;
  ownerPhone: string;
  ownerEmail?: string;
  activityType?: string;
  businessIndustry?: string;
  username: string;
  password?: string;
  days?: number;
  source?: string;
  campaign?: string;
  notes?: string;
  featurePlanId?: string;
  saasPlanId?: number;
};

export type RecordPaymentPayload = {
  amount: number;
  currency: string;
  method: string;
  reference?: string;
  notes?: string;
  date?: string;
};

export const saasAdminApi = {
  tenants: (query?: { status?: string; search?: string }) => {
    const search = new URLSearchParams();
    if (query?.status) search.set('status', query.status);
    if (query?.search) search.set('search', query.search);
    const suffix = search.toString();
    return http<{ tenants: SaasTenantRow[] }>(`/api/saas-admin/tenants${suffix ? `?${suffix}` : ''}`);
  },
  createTrialTenant: (payload: CreateTrialTenantPayload) =>
    http<{
      tenant: SaasTenantRow;
      owner: { username: string; temporaryPassword: string; mustChangePassword: boolean };
    }>('/api/saas-admin/tenants/trial', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  activateTenant: (id: string, payload: { durationMonths?: number; planId?: number; paymentAmount?: number; paymentMethod?: string; paymentReference?: string }) => http<{ ok: boolean }>(`/api/saas-admin/tenants/${encodeURIComponent(id)}/activate`, { method: 'POST', body: JSON.stringify(payload) }),
  suspendTenant: (id: string, notes?: string) => http<{ ok: boolean }>(`/api/saas-admin/tenants/${encodeURIComponent(id)}/suspend`, { method: 'POST', body: JSON.stringify({ notes: notes || '' }) }),
  expireTenant: (id: string, notes?: string) => http<{ ok: boolean }>(`/api/saas-admin/tenants/${encodeURIComponent(id)}/expire`, { method: 'POST', body: JSON.stringify({ notes: notes || '' }) }),
  updateTenantPlan: (id: string, payload: { planId?: string; extraFeatures?: string[]; activityType?: string; featureOverrides?: Array<{ featureCode: string; granted: boolean | null; reason?: string }> }) => http<{ ok: boolean }>(`/api/saas-admin/tenants/${encodeURIComponent(id)}/plan`, { method: 'POST', body: JSON.stringify(payload) }),
  extendTrial: (id: string, days: number) =>
    http<{ ok: boolean; trialEndsAt: string; daysAdded: number }>(`/api/saas-admin/tenants/${encodeURIComponent(id)}/extend-trial`, {
      method: 'POST',
      body: JSON.stringify({ days }),
    }),
  unlockOwner: (id: string) => http<{ ok: boolean }>(`/api/saas-admin/tenants/${encodeURIComponent(id)}/unlock-owner`, { method: 'POST', body: JSON.stringify({}) }),
  resetOwnerPassword: (id: string, newPassword?: string) =>
    http<{ ok: boolean; owner: { username: string; temporaryPassword: string; mustChangePassword: boolean } }>(
      `/api/saas-admin/tenants/${encodeURIComponent(id)}/reset-owner-password`,
      { method: 'POST', body: JSON.stringify({ newPassword }) },
    ),
  deleteTenant: (id: string, payload: { superAdminPassword: string }) =>
    http<{ ok: boolean; message?: string }>(`/api/saas-admin/tenants/${encodeURIComponent(id)}/delete`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateTenantSlug: (id: string, slug: string) =>
    http<{ success: boolean; oldSlug: string; newSlug: string; message: string }>(
      `/api/saas-admin/tenants/${encodeURIComponent(id)}/slug`,
      { method: 'POST', body: JSON.stringify({ slug }) },
    ),
  
  listPlans: () => http<SaasPlan[]>('/api/saas-admin/plans'),
  getPlans: () => http<SaasPlan[]>('/api/saas-admin/plans'),
  listFeaturePlans: () => http<any[]>('/api/saas-admin/feature-plans'),
  getFeaturePlans: () => http<any[]>('/api/saas-admin/feature-plans'),
  createPlan: (payload: { code: string; name: string; price: number; currency?: string; billingPeriodMonths: number; maxUsers?: number | null; maxBranches?: number | null; featurePlanId?: string | null }) => http<{ ok: boolean }>('/api/saas-admin/plans', { method: 'POST', body: JSON.stringify(payload) }),
  updatePlan: (id: number, payload: { code?: string; name?: string; price?: number; currency?: string; billingPeriodMonths?: number; maxUsers?: number | null; maxBranches?: number | null; isActive?: boolean; featurePlanId?: string | null }) => http<{ ok: boolean }>(`/api/saas-admin/plans/${id}`, { method: 'POST', body: JSON.stringify(payload) }),
  deletePlan: (id: number) => http<{ ok: boolean }>(`/api/saas-admin/plans/${id}`, { method: 'DELETE' }),
  getSubscriptions: (id: string) => http<{ subscriptions: any[]; payments: any[] }>(`/api/saas-admin/tenants/${encodeURIComponent(id)}/subscriptions`),
  renewTenant: (id: string, payload: { durationMonths: number; planId: number; paymentAmount?: number; paymentMethod?: string; paymentReference?: string }) => http<{ ok: boolean }>(`/api/saas-admin/tenants/${encodeURIComponent(id)}/renew`, { method: 'POST', body: JSON.stringify(payload) }),
  recordPayment: (id: string, payload: RecordPaymentPayload) => http<{ ok: boolean }>(`/api/saas-admin/tenants/${encodeURIComponent(id)}/payment`, { method: 'POST', body: JSON.stringify(payload) }),
  getTenantById: (id: string) => http<{ tenant: SaasTenantRow }>(`/api/saas-admin/tenants/${encodeURIComponent(id)}`),
  getTenantTimeline: (id: string) => http<{ events: TenantTimelineEvent[] }>(`/api/saas-admin/tenants/${encodeURIComponent(id)}/timeline`),
  impersonateTenant: (id: string) => http<{ ok: boolean; sessionId?: string; originalSessionId: string; loginPayload: Record<string, unknown> }>(`/api/saas-admin/tenants/${encodeURIComponent(id)}/impersonate`, { method: 'POST' }),
  exitImpersonation: (originalSessionId: string) => http<{ ok: boolean; sessionId?: string; loginPayload: Record<string, unknown> }>('/api/saas-admin/exit-impersonation', { method: 'POST', body: JSON.stringify({ originalSessionId }) }),

  // ─── Client Diagnostics ──────────────────────────────────────────────────
  listDiagnostics: (params?: { page?: number; limit?: number; search?: string }) => {
    const sp = new URLSearchParams();
    if (params?.page) sp.set('page', String(params.page));
    if (params?.limit) sp.set('limit', String(params.limit));
    if (params?.search) sp.set('search', params.search);
    const qs = sp.toString();
    return http<SaasDiagnosticsListResponse>(`/api/saas-admin/diagnostics${qs ? `?${qs}` : ''}`);
  },
  downloadDiagnosticUrl: (id: number) => resolveRequestUrl(`/api/saas-admin/diagnostics/${id}/download`),
  deleteDiagnostic: (id: number) =>
    http<{ success: boolean; message: string }>(`/api/saas-admin/diagnostics/${id}`, {
      method: 'DELETE',
    }),

  // ─── Tenant Data Lifecycle ───────────────────────────────────────────────
  seedTenantDemo: (id: string, payload: { activityType: string; wipeExisting?: boolean; seedSales?: boolean; seedOnlineOrders?: boolean }) =>
    http<{ ok: boolean; message: string; activity?: string; productsCount?: number; salesCount?: number; onlineOrdersCount?: number }>(
      `/api/saas-admin/tenants/${encodeURIComponent(id)}/seed-demo`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),
  wipeTenantData: (id: string, payload: { superAdminPassword: string }) =>
    http<{ ok: boolean; message: string }>(
      `/api/saas-admin/tenants/${encodeURIComponent(id)}/wipe-data`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),
};

