import { PropsWithChildren, useEffect } from 'react';
import { keepPreviousData, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/http';
import { LocaleProvider } from '@/shared/locale/LocaleProvider';
import { SystemAlertProvider } from '@/shared/components/system-alert';

import { useAuthStore } from '@/stores/auth-store';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { applyAccentColorToDocument } from '@/lib/theme';
import { setGlobalSystemCurrency } from '@/lib/currencies';
import { usePosExitTrace } from './pos-exit-trace';

function ThemeProvider({ children }: PropsWithChildren) {
  const theme = useAuthStore((state) => state.theme);
  const user = useAuthStore((state) => state.user);
  const { data: settings } = useSettingsQuery({ enabled: Boolean(user) });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.setAttribute('data-theme', 'dark');
    } else {
      root.classList.remove('dark');
      root.setAttribute('data-theme', 'light');
    }
  }, [theme]);

  useEffect(() => {
    applyAccentColorToDocument(settings?.accentColor);
  }, [settings?.accentColor]);

  useEffect(() => {
    if (settings?.currency) {
      setGlobalSystemCurrency(settings.currency);
    }
  }, [settings?.currency]);

  return <>{children}</>;
}

function shouldRetry(failureCount: number, error: unknown) {
  const status = (error as { status?: number })?.status;
  if (status === 401 || status === 403 || status === 404) {
    return false;
  }
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403 || error.status === 404) {
      return false;
    }
    // Network errors (e.g. backend startup or temporary connection delay)
    if (error.code === 'network_error' || error.status === 0) {
      return failureCount < 3;
    }
  }

  return failureCount < 1;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: shouldRetry,
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      placeholderData: keepPreviousData,
      networkMode: 'always'
    },
    mutations: {
      retry: false,
      networkMode: 'always'
    }
  }
});

export function AppProviders({ children }: PropsWithChildren) {
  // INV-POS-EXIT-TRACE: flag-gated (localStorage `zs:pos-exit-trace=1`) runtime
  // trace of one POS exit; inert when the flag is off.
  usePosExitTrace(queryClient);
  useEffect(() => {
    const runtime = (window as unknown as { electronRuntime?: { onBackendReady?: (cb: () => void) => () => void } }).electronRuntime;
    if (runtime && typeof runtime.onBackendReady === 'function') {
      return runtime.onBackendReady(() => {
        queryClient.invalidateQueries();
      });
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SystemAlertProvider>
          <LocaleProvider>{children}</LocaleProvider>
        </SystemAlertProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
