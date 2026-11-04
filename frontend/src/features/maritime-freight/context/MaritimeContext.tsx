import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { maritimeApi, MaritimePipelineConfig } from '../api/maritime-freight.api';

interface MaritimeCounts {
  inquiries: number;
  rfqs: number;
  matrixBids: number;
  quotations: number;
  jobs: number;
  containers: number;
  master: number;
  settings: number;
}

interface MaritimeContextType {
  counts: MaritimeCounts;
  refreshCounts: () => Promise<void>;
  refreshKey: number;
  refreshAll: () => Promise<void>;
  isRefreshing: boolean;
  isCreateRfqOpen: boolean;
  setIsCreateRfqOpen: (open: boolean) => void;
  isCreateInquiryOpen: boolean;
  setIsCreateInquiryOpen: (open: boolean) => void;
  pipelineConfig: MaritimePipelineConfig;
  updatePipelineConfig: (newConfig: Partial<MaritimePipelineConfig>) => Promise<void>;
}

const DEFAULT_COUNTS: MaritimeCounts = {
  inquiries: 0,
  rfqs: 0,
  matrixBids: 0,
  quotations: 0,
  jobs: 0,
  containers: 0,
  master: 0,
  settings: 0,
};

const DEFAULT_PIPELINE_CONFIG: MaritimePipelineConfig = {
  enableSeaFreight: true,
  enableAirFreight: true,
  enableRoadFreight: true,
  automationMode: 'hybrid',
  defaultMarginType: 'fixed',
  defaultMarginValue: 200,
  marginFloor: 150,
  rfqCutOffHoursStandard: 24,
  rfqCutOffHoursUrgent: 6,
  earlyAwardingEnabled: true,
  earlyAwardingMinFreeDays: 14,
  requireManualRfqDispatch: false,
  requireManualAwardAndMargin: true,
  requireManualQuoteDispatch: false,
  autoSendWhatsAppQuote: true,
  autoSendEmailQuote: true,
};

let memoryCachedCounts: MaritimeCounts = { ...DEFAULT_COUNTS };

try {
  if (typeof window !== 'undefined') {
    const saved = sessionStorage.getItem('zs_maritime_counts');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object') {
        memoryCachedCounts = { ...DEFAULT_COUNTS, ...parsed };
      }
    }
  }
} catch {
  // ignore storage errors
}

const MaritimeContext = createContext<MaritimeContextType | null>(null);

export function MaritimeProvider({ children }: { children: React.ReactNode }) {
  const [counts, setCounts] = useState<MaritimeCounts>(memoryCachedCounts);
  const [pipelineConfig, setPipelineConfig] = useState<MaritimePipelineConfig>(DEFAULT_PIPELINE_CONFIG);
  const [isCreateRfqOpen, setIsCreateRfqOpen] = useState(false);
  const [isCreateInquiryOpen, setIsCreateInquiryOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pendingConfigSave = useRef<Promise<void> | null>(null);

  const loadPipelineConfig = useCallback(async () => {
    try {
      const data = await maritimeApi.getPipelineSettings().catch(() => null);
      if (data) {
        setPipelineConfig((prev) => ({ ...prev, ...data }));
      }
    } catch (err) {
      console.error('Failed to load pipeline config in context:', err);
    }
  }, []);

  const updatePipelineConfig = useCallback((newConfig: Partial<MaritimePipelineConfig>) => {
    if (pendingConfigSave.current) return pendingConfigSave.current;
    const request = maritimeApi.savePipelineSettings(newConfig)
      .then((updated) => { setPipelineConfig(updated); })
      .finally(() => { pendingConfigSave.current = null; });
    pendingConfigSave.current = request;
    return request;
  }, []);

  const refreshCounts = useCallback(async () => {
    try {
      let newCounts: MaritimeCounts;
      try {
        newCounts = await maritimeApi.getCounts();
      } catch {
        // Fallback to individual calls if fast endpoint is unavailable
        const [inquiriesData, rfqsData, quotesData, jobsData, containersData, portsData, linesData] = await Promise.all([
          maritimeApi.getInquiries().catch(() => []),
          maritimeApi.getRfqs().catch(() => []),
          maritimeApi.getQuotations().catch(() => []),
          maritimeApi.getJobs().catch(() => []),
          maritimeApi.getContainers().catch(() => []),
          maritimeApi.getPorts().catch(() => []),
          maritimeApi.getShippingLines().catch(() => []),
        ]);

        const totalBids = (rfqsData || []).reduce((acc: number, r: any) => acc + (r.bidsCount || 0), 0);

        newCounts = {
          inquiries: (inquiriesData || []).length,
          rfqs: (rfqsData || []).length,
          matrixBids: totalBids,
          quotations: (quotesData || []).length,
          jobs: (jobsData || []).length,
          containers: (containersData || []).length,
          master: (portsData || []).length + (linesData || []).length,
          settings: 0,
        };
      }

      memoryCachedCounts = newCounts;
      try {
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('zs_maritime_counts', JSON.stringify(newCounts));
        }
      } catch {}

      setCounts(newCounts);
    } catch (err) {
      console.error('Failed to load maritime counts:', err);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      setIsRefreshing(true);
      await Promise.all([refreshCounts(), loadPipelineConfig()]);
      setRefreshKey((prev) => prev + 1);
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshCounts, loadPipelineConfig]);

  useEffect(() => {
    refreshCounts();
    loadPipelineConfig();
  }, [refreshCounts, loadPipelineConfig]);

  const value = useMemo(
    () => ({
      counts,
      refreshCounts,
      refreshKey,
      refreshAll,
      isRefreshing,
      isCreateRfqOpen,
      setIsCreateRfqOpen,
      isCreateInquiryOpen,
      setIsCreateInquiryOpen,
      pipelineConfig,
      updatePipelineConfig,
    }),
    [counts, refreshCounts, refreshKey, refreshAll, isRefreshing, isCreateRfqOpen, isCreateInquiryOpen, pipelineConfig, updatePipelineConfig]
  );

  return <MaritimeContext.Provider value={value}>{children}</MaritimeContext.Provider>;
}

export function useMaritime() {
  const ctx = useContext(MaritimeContext);
  if (!ctx) {
    throw new Error('useMaritime must be used within a MaritimeProvider');
  }
  return ctx;
}
