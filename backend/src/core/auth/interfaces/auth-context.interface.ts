export interface AuthContext {
  userId: number;
  sessionId: string;
  username: string;
  role: string;
  permissions: string[];
  tenantId?: string;
  accountId?: string;
  planId?: string;
  extraFeatures?: string[];
  /**
   * P10 (INV-VAN-GENERAL-FEATURE-OVERRIDES): super-admin per-tenant feature
   * overrides loaded from tenant_feature_overrides at login/session
   * resolution — never from the request. A granted feature is ON even
   * where the mode default is OFF; a hidden feature is OFF even where the
   * plan grants it. Checked first by PlanFeatureService.hasFeature.
   */
  featureOverrides?: Record<string, boolean>;
  activityType?: string;
  pillar?: string;
  /**
   * Platform admin driving this session via impersonation, if any. Set from
   * `sessions.impersonated_by`, never from the request, and written onto every audit row
   * so an action taken inside a customer's books is attributable to the person who
   * actually took it rather than to the owner whose identity was borrowed (O34).
   */
  impersonatedBy?: number | null;
}
