import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { i18n as I18nInstance, TOptions } from 'i18next';

/**
 * Cached i18n `t()` for the POS hot path (INV: pos render-cost, cached t).
 *
 * i18next does NOT cache resolved keys: every `t()` call pays the full
 * lookup/formatting overhead, and the POS grid + cart issue thousands of
 * identical 2-arg calls (`t(key, 'default')`) per render. This module
 * memoizes the plain cases behind a module-level Map and leaves every
 * other call on the real `t()`.
 *
 * SAFETY (do not weaken without a spec proving the new case):
 * - The cache key embeds the language read FRESH from `i18n.language` at
 *   call time, never from a closure, so a language switch can never serve
 *   the previous language's strings.
 * - Only calls with NO `count` / `context` / `replace` / `returnObjects` /
 *   interpolation options are cached (a bare default-value string, or an
 *   options object holding only `defaultValue` and the default `ns`).
 *   Everything else passes through to the real `t()` uncached.
 * - Only string results are cached.
 * - The cache is cleared on `languageChanged` and on resource-store
 *   `added` / `removed`. The store clear is REQUIRED, not optional: the
 *   app auto-translates missing keys in `en` (parseMissingKeyHandler in
 *   `frontend/src/lib/i18n.ts`), so a cached missing-key fallback would
 *   freeze if the key is later added to the bundle.
 * - The global `i18n.t` is NOT wrapped: only components that opt in via
 *   `useCachedT()` get cached reads, so the blast radius stays in POS.
 */

const cache = new Map<string, string>();

/** Instances already wired with the invalidation listeners below. */
const wiredInstances = new WeakSet<object>();

function clearCache(): void {
  cache.clear();
}

function ensureInvalidation(i18n: I18nInstance): void {
  if (wiredInstances.has(i18n)) return;
  wiredInstances.add(i18n);
  // Both events are rare; clear-all keeps every invalidation path trivially
  // correct instead of tracking per-key lifetimes.
  i18n.on('languageChanged', clearCache);
  i18n.store.on('added', clearCache);
  i18n.store.on('removed', clearCache);
}

type CachedTOptions = string | TOptions | undefined;

function isCacheableOptions(options: CachedTOptions): boolean {
  if (options === undefined || typeof options === 'string') return true;
  // Object form: only a bare default-value lookup in the default namespace.
  // Any other key (count, context, replace, returnObjects, lng, ...) or a
  // non-default ns means the result depends on more than (language, ns,
  // key, defaultValue) and must not be cached.
  const ns = (options as TOptions).ns;
  if (ns !== undefined && ns !== 'translation') return false;
  return Object.keys(options).every((key) => key === 'defaultValue' || key === 'ns');
}

/**
 * Cached equivalent of `i18n.t(key, defaultValue?)` for plain lookups.
 * Non-cacheable calls (options objects with count/context/...) fall
 * through to the real `t()` and are never read from or written to the
 * cache.
 */
export function cachedTranslate(
  i18n: I18nInstance,
  key: string,
  options?: string | TOptions,
): string {
  ensureInvalidation(i18n);
  if (!isCacheableOptions(options)) {
    return i18n.t(key, options as TOptions) as unknown as string;
  }
  const defaultValue = typeof options === 'string' ? options : options?.defaultValue;
  const ns =
    typeof options === 'object' && options?.ns ? String(options.ns) : 'translation';
  const cacheKey = `${i18n.language}\0${ns}\0${key}\0${defaultValue ?? ''}`;
  const hit = cache.get(cacheKey);
  if (hit !== undefined) return hit;
  const result = i18n.t(key, options as TOptions | string) as unknown;
  if (typeof result === 'string') cache.set(cacheKey, result);
  return result as string;
}

/** Test hook: drops every cached entry (the listeners do this live). */
export function clearCachedTranslations(): void {
  cache.clear();
}

/**
 * Returns a `t(key, defaultValue?)` function whose plain lookups are
 * served from the module cache. `useTranslation` inside keeps this
 * component subscribed to `languageChanged` and store `added`/`removed`,
 * so it re-renders with fresh strings whenever either fires — the cache
 * alone never decides what is on screen.
 */
export function useCachedT(): (key: string, defaultValue?: string) => string {
  const { i18n } = useTranslation();
  return useCallback(
    (key: string, defaultValue?: string) => cachedTranslate(i18n, key, defaultValue),
    [i18n],
  );
}
