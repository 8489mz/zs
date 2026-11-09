/*
 * INV-REST-SUCCESS-FEEDBACK-TRUTH (Restaurant Batch 9, T2).
 *
 * THE LIE: AppsStorePage toasted "تم تفعيل وتثبيت [X] بنجاح" from the
 * REQUESTED variables, never from the server response — while the backend
 * deletes posModuleEnabled from the payload for non-super-admin actors
 * (protected list) and forces it false for warehousing tenants for any
 * actor. The install toasted success and the store showed the app
 * available to install again on refetch.
 *
 * THE RULE: an install/uninstall toast may only claim what the server
 * response confirms. Every boolean key the toggle requested must come
 * back with exactly that value in the saved settings; any key that comes
 * back different — or is missing from the response (an unconfirmed value
 * is not a persisted value) — means the toggle was rejected, and the
 * caller must say so instead of toasting success.
 */

export type AppToggleFeedback =
  | { kind: 'applied'; enabled: boolean }
  | { kind: 'rejected'; enabled: boolean; rejectedKeys: string[] };

/**
 * Verifies a module toggle against the server response. `requested` is
 * the payload sent to settingsApi.update; `saved` is the settings object
 * the update returned. `enabled` is the value the user asked for (all
 * keys in one toggle share it — installs set every key true, including
 * dependencies pulled in with the app).
 */
export function resolveAppToggleFeedback(
  requested: Record<string, unknown> | null | undefined,
  saved: Record<string, unknown> | null | undefined,
): AppToggleFeedback {
  const keys = requested
    ? Object.keys(requested).filter((key) => typeof requested[key] === 'boolean')
    : [];
  const enabled = keys.length > 0 ? requested![keys[0]] === true : false;
  const rejectedKeys = keys.filter((key) => !saved || saved[key] !== requested![key]);
  if (rejectedKeys.length === 0) return { kind: 'applied', enabled };
  return { kind: 'rejected', enabled, rejectedKeys };
}
