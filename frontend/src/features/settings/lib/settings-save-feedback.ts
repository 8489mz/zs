/*
 * INV-REST-SUCCESS-FEEDBACK-TRUTH (Restaurant Batch 9, T2).
 *
 * THE LIE: useSettingsUpdateMutation toasted "تم حفظ وتطبيق كافة إعدادات
 * النظام بنجاح!" unconditionally, even when the server silently overrode
 * the value the user asked for. A warehousing tenant could pick Simple
 * Retail (enableEnterpriseFeatures: false) or switch POS on, watch the
 * success toast, and find both values reverted on reload — the vertical
 * force (form defaults, submit handler, backend read/update paths)
 * discards the choice without a word.
 *
 * THE RULE: a save toast may only claim what the server response
 * confirms. The requested values are compared with the persisted values
 * the server returned; any force-prone boolean key whose requested value
 * did not survive — a different boolean, or the key missing from the
 * response (an unconfirmed value is not a persisted value) — is reported
 * as overridden so the caller can say so plainly instead of toasting
 * success.
 *
 * Keys covered: the two values the vertical force overrides —
 * enableEnterpriseFeatures (forced true) and posModuleEnabled (forced
 * false). Other settings are saved verbatim by the server and need no
 * comparison.
 */

export const FORCED_SETTINGS_KEYS = ['enableEnterpriseFeatures', 'posModuleEnabled'] as const;

export type ForcedSettingsKey = (typeof FORCED_SETTINGS_KEYS)[number];

export const FORCED_SETTINGS_KEY_LABELS_AR: Record<ForcedSettingsKey, string> = {
  enableEnterpriseFeatures: 'نمط التشغيل المؤسسي',
  posModuleEnabled: 'نقاط البيع (POS)',
};

/**
 * Returns the force-prone keys whose requested boolean value was not
 * confirmed by the saved settings. Keys the user did not request (absent
 * or non-boolean in `requested`) are never reported.
 */
export function findOverriddenSettingsValues(
  requested: Record<string, unknown> | null | undefined,
  saved: Record<string, unknown> | null | undefined,
): ForcedSettingsKey[] {
  if (!requested) return [];
  const overridden: ForcedSettingsKey[] = [];
  for (const key of FORCED_SETTINGS_KEYS) {
    const asked = requested[key];
    if (typeof asked !== 'boolean') continue;
    if (!saved || saved[key] !== asked) overridden.push(key);
  }
  return overridden;
}
