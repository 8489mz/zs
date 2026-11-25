/**
 * H9 (D4): the six rep permission flags, server-enforced (PD7 — the
 * flags are controls in the DTO and UI, not notes). The creation path
 * (DeliveryRepsService.create) always stores the full defaults object,
 * so every rep created through the API carries an explicit value for
 * every flag, and saving a rep in the UI writes the full object too.
 *
 * Two cases, kept apart deliberately:
 * - An EXPLICIT permissions object is enforced per key, with a missing
 *   key falling back to the creation defaults below (can_give_discount
 *   false, max 0, can_sell_over_credit_limit false, can_collect_cash
 *   true, can_add_customers true, require_gps_on_visit true,
 *   can_edit_routes false). An explicitly configured rep is therefore
 *   always gated, even if whoever saved it omitted a key.
 * - NO permissions object at all (NULL, unparseable, or a schema
 *   without the column — legacy rows predating the flags, and old spec
 *   fixtures) keeps the PRE-FLAG behaviour: everything was allowed
 *   before the flags existed, so a rep that was never configured keeps
 *   the old behaviour (REP_PERMISSION_LEGACY). Refusing money
 *   operations for an unconfigured rep would silently change legacy
 *   behaviour — e.g. the book-digits spec's 3dp cash-discount case,
 *   whose rep carries no flags — so the legacy case stays permissive
 *   until a supervisor saves that rep's flags, which writes the full
 *   explicit object. Money-strictness therefore applies to every
 *   CONFIGURED rep; an UNCONFIGURED rep is a supervisor action away
 *   from being configured, not a silent behaviour change.
 */
export interface RepPermissionFlags {
  can_edit_routes: boolean;
  can_add_customers: boolean;
  require_gps_on_visit: boolean;
  can_give_discount: boolean;
  // INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING: the per-line discount
  // permission. can_give_discount opens the per-line channel;
  // can_give_invoice_discount opens the invoice (cashDiscountAmount)
  // channel on top of it. A rep with only the first is per-line
  // only; the tenant cap still binds the COMBINED effective discount
  // per invoice for every rep, whatever the permissions say.
  can_give_invoice_discount: boolean;
  // Stored but INERT for enforcement since
  // INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING: the tenant setting
  // vanRepDiscountCapPercent governs for all reps. Kept on the
  // flags object so stored rows keep parsing; never read by the
  // sale path.
  max_discount_percent: number;
  can_sell_over_credit_limit: boolean;
  can_collect_cash: boolean;
}

/** The tenant-level rep discount cap (INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING). */
export const VAN_REP_DISCOUNT_CAP_DEFAULT_PERCENT = 5;

/** Settings keys holding the tenant rep discount cap (either spelling). */
export const VAN_REP_DISCOUNT_CAP_SETTING_KEYS = ['vanRepDiscountCapPercent', 'van_rep_discount_cap_percent'];

/**
 * INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING: the ONE tenant-level rep
 * discount cap, set by the tenant admin, default 5%, applying to ALL
 * reps. Read from the settings table with the same dual-key pattern
 * as vanSettlementRequireSupervisorPin; missing row = 5; clamped
 * 0–100. The stored value may be a bare number, a JSON number, or a
 * numeric string. Runs on any queryable (pool handle or transaction
 * handle) — the sale path calls it on the pool handle before its
 * transaction opens.
 */
export async function getVanRepDiscountCapPercent(queryable: any, tenantId: string): Promise<number> {
  try {
    const row = await queryable
      .selectFrom('settings')
      .select(['value'])
      .where('tenant_id', '=', tenantId)
      .where((eb: any) => eb.or(VAN_REP_DISCOUNT_CAP_SETTING_KEYS.map((key) => eb('key', '=', key))))
      .executeTakeFirst();
    if (row?.value == null || String(row.value).trim() === '') return VAN_REP_DISCOUNT_CAP_DEFAULT_PERCENT;
    let parsed: unknown = row.value;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        parsed = row.value;
      }
    }
    const pct = Number(parsed);
    if (!Number.isFinite(pct)) return VAN_REP_DISCOUNT_CAP_DEFAULT_PERCENT;
    return Math.min(100, Math.max(0, pct));
  } catch {
    return VAN_REP_DISCOUNT_CAP_DEFAULT_PERCENT;
  }
}

/** The tenant-level cash-discount % (INV-VAN-PRICE-LIST-WIRING). */
export const VAN_CASH_DISCOUNT_DEFAULT_PERCENT = 0;

/** Settings keys holding the tenant cash-discount % (either spelling). */
export const VAN_CASH_DISCOUNT_SETTING_KEYS = ['cashDiscountPercent', 'cash_discount_percent'];

/**
 * INV-VAN-PRICE-LIST-WIRING: the tenant cash-discount % off the
 * selling price on immediate cash payment (default 0 = off). Same
 * dual-key pattern as getVanRepDiscountCapPercent; missing row = 0;
 * clamped 0–100. This is a SYSTEM discount: it is computed
 * server-side from this setting and NEVER routed through
 * cashDiscountAmount (the rep-entered, cap-gated channel) — a system
 * discount poured into that field would be refused over 5% and
 * would consume the rep's cap.
 */
export async function getCashDiscountPercent(queryable: any, tenantId: string): Promise<number> {
  try {
    const row = await queryable
      .selectFrom('settings')
      .select(['value'])
      .where('tenant_id', '=', tenantId)
      .where((eb: any) => eb.or(VAN_CASH_DISCOUNT_SETTING_KEYS.map((key) => eb('key', '=', key))))
      .executeTakeFirst();
    if (row?.value == null || String(row.value).trim() === '') return VAN_CASH_DISCOUNT_DEFAULT_PERCENT;
    let parsed: unknown = row.value;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        parsed = row.value;
      }
    }
    const pct = Number(parsed);
    if (!Number.isFinite(pct)) return VAN_CASH_DISCOUNT_DEFAULT_PERCENT;
    return Math.min(100, Math.max(0, pct));
  } catch {
    return VAN_CASH_DISCOUNT_DEFAULT_PERCENT;
  }
}

/** Per-key fallbacks for an explicit permissions object (creation defaults). */
export const REP_PERMISSION_DEFAULTS: RepPermissionFlags = {
  can_edit_routes: false,
  can_add_customers: true,
  require_gps_on_visit: true,
  can_give_discount: false,
  can_give_invoice_discount: false,
  max_discount_percent: 0,
  can_sell_over_credit_limit: false,
  can_collect_cash: true,
};

/** Pre-flag behaviour for a rep with no permissions object at all. */
export const REP_PERMISSION_LEGACY: RepPermissionFlags = {
  can_edit_routes: true,
  can_add_customers: true,
  require_gps_on_visit: false,
  can_give_discount: true,
  // INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING: a rep with no
  // permissions object never had an explicit invoice-discount grant,
  // so the invoice channel stays closed (fail closed) while the
  // per-line channel keeps the pre-flag behaviour.
  can_give_invoice_discount: false,
  max_discount_percent: 100,
  can_sell_over_credit_limit: true,
  can_collect_cash: true,
};

export function parseRepPermissions(raw: unknown): RepPermissionFlags {
  let stored: Record<string, any> | null = null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') stored = parsed;
    } catch {
      stored = null;
    }
  } else if (raw && typeof raw === 'object') {
    stored = raw as Record<string, any>;
  }
  // No permissions object at all: pre-flag behaviour (see above).
  if (!stored) return { ...REP_PERMISSION_LEGACY };
  const maxPct = Number(stored.max_discount_percent);
  return {
    ...REP_PERMISSION_DEFAULTS,
    can_edit_routes: stored.can_edit_routes === true,
    can_add_customers: stored.can_add_customers !== false,
    require_gps_on_visit: stored.require_gps_on_visit !== false,
    can_give_discount: stored.can_give_discount === true,
    can_give_invoice_discount: stored.can_give_invoice_discount === true,
    max_discount_percent: Number.isFinite(maxPct) ? Math.min(100, Math.max(0, maxPct)) : 0,
    can_sell_over_credit_limit: stored.can_sell_over_credit_limit === true,
    can_collect_cash: stored.can_collect_cash !== false,
  };
}

/**
 * Loads the acting rep's permission flags from the rep row on the
 * given queryable (pool handle outside a transaction, or the
 * transaction handle inside one — never the pool inside an open
 * transaction, which deadlocks on PGlite). A rep row that cannot be
 * read — missing row, or a schema without a permissions column (old
 * spec fixtures) — parses to the legacy pre-flag behaviour (see
 * parseRepPermissions), never to a throw: the gate must not fail an
 * operation over a missing flags object.
 */
export async function loadRepPermissions(queryable: any, tenantId: string, repId: number): Promise<RepPermissionFlags> {
  try {
    const row = await queryable
      .selectFrom('delivery_representatives')
      .select(['permissions'])
      .where('id', '=', Number(repId))
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    return parseRepPermissions((row as any)?.permissions);
  } catch {
    return parseRepPermissions(null);
  }
}
