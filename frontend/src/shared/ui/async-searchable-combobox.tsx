import { useState, useEffect, useRef, useMemo } from 'react';
import { SearchableCombobox, ComboboxOption } from './searchable-combobox';
import { normalizeArabicSearchKey } from '@/lib/arabic-normalization';

export type AsyncSearchableComboboxProps<T extends ComboboxOption> = Omit<React.ComponentProps<typeof SearchableCombobox<T>>, 'options' | 'search'> & {
  fetchOptions: (query: string) => Promise<T[]>;
  debounceMs?: number;
  defaultOptions?: T[];
  refreshKey?: string | number;
  localSearch?: (option: T, query: string) => boolean;
};

const containsDigitLikeCharacter = (value: string) => /[0-9٠-٩۰-۹]/.test(value);

export function AsyncSearchableCombobox<T extends ComboboxOption>({
  fetchOptions,
  debounceMs = 220,
  defaultOptions = [],
  refreshKey,
  localSearch,
  maxResults = 50,
  minSearchLength = 0,
  searchOnSingleDigit = false,
  emptyLabel,
  getLabel,
  ...props
}: AsyncSearchableComboboxProps<T>) {
  const [remoteState, setRemoteState] = useState<{
    query: string;
    refreshKey: string | number | undefined;
    items: T[];
    ready: boolean;
  }>({
    query: '',
    refreshKey,
    items: [],
    ready: false,
  });

  const fetchOptionsRef = useRef(fetchOptions);
  useEffect(() => {
    fetchOptionsRef.current = fetchOptions;
  }, [fetchOptions]);

  const query = props.value.trim();
  const prevQueryRef = useRef(query);

  const hasSearchIntent =
    query.length >= minSearchLength ||
    (searchOnSingleDigit && containsDigitLikeCharacter(props.value));

  const shouldFetchEmpty = query === '' && defaultOptions.length === 0 && minSearchLength <= 0;

  useEffect(() => {
    if (query === '' && !shouldFetchEmpty) {
      prevQueryRef.current = query;
      return;
    }

    if (query !== '' && !hasSearchIntent) {
      prevQueryRef.current = query;
      return;
    }

    let isActive = true;
    const isSameQueryRefresh = prevQueryRef.current === query;
    prevQueryRef.current = query;
    const delay = isSameQueryRefresh ? 0 : debounceMs;

    const handler = setTimeout(async () => {
      try {
        const results = await fetchOptionsRef.current(query);
        if (isActive) {
          setRemoteState({
            query,
            refreshKey,
            items: results,
            ready: true,
          });
        }
      } catch (e) {
        console.error('Error fetching async options:', e);
        if (isActive) {
          setRemoteState({
            query,
            refreshKey,
            items: [],
            ready: true,
          });
        }
      }
    }, delay);

    return () => {
      isActive = false;
      clearTimeout(handler);
    };
  }, [query, debounceMs, refreshKey, hasSearchIntent, shouldFetchEmpty]);

  const isCurrentReady =
    remoteState.ready &&
    remoteState.query === query &&
    remoteState.refreshKey === refreshKey;

  const resolvedOptions = useMemo(() => {
    if (query === '') {
      return defaultOptions.length > 0 ? defaultOptions : (isCurrentReady ? remoteState.items : defaultOptions);
    }

    if (!hasSearchIntent) {
      return [];
    }

    if (isCurrentReady) {
      return remoteState.items;
    }

    // Instant client-side filtering while debouncing / awaiting server response
    // so stale unrelated items from a prior query never flash in the dropdown.
    const pool = defaultOptions.length > 0 ? defaultOptions : remoteState.items;
    if (!pool.length) return [];

    const normQuery = normalizeArabicSearchKey(query);
    const tokens = normQuery ? normQuery.split(/\s+/).filter(Boolean) : [];
    if (!tokens.length) return [];

    return pool.filter((option) => {
      if (localSearch) {
        return localSearch(option, query);
      }
      const extraTerms = String((option as Record<string, unknown>).searchTerms ?? (option as Record<string, unknown>).code ?? '');
      const candidateText = normalizeArabicSearchKey(`${getLabel(option)} ${extraTerms}`);
      return Boolean(candidateText) && tokens.every((token) => candidateText.includes(token));
    });
  }, [defaultOptions, getLabel, hasSearchIntent, isCurrentReady, localSearch, query, remoteState.items]);

  const resolvedEmptyLabel =
    query !== '' && hasSearchIntent && !isCurrentReady && resolvedOptions.length === 0
      ? 'جارٍ البحث...'
      : emptyLabel;

  return (
    <SearchableCombobox
      {...props}
      getLabel={getLabel}
      maxResults={maxResults}
      preserveOrder={query === '' || isCurrentReady}
      minSearchLength={minSearchLength}
      searchOnSingleDigit={searchOnSingleDigit}
      emptyLabel={resolvedEmptyLabel}
      options={resolvedOptions}
      search={() => true}
    />
  );
}
