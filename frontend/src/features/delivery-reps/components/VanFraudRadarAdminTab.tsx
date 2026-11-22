import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vanSalesApi } from '../api/van-sales.api';
import { FraudRadarHeader } from './van-fraud-radar/fraud-radar-header';
import { FraudRadarKpiGrid } from './van-fraud-radar/fraud-radar-kpi-grid';
import { FraudRadarFilterBar } from './van-fraud-radar/fraud-radar-filter-bar';
import { FraudRadarRiskMatrix } from './van-fraud-radar/fraud-radar-risk-matrix';
import { FraudRadarEventsFeed } from './van-fraud-radar/fraud-radar-events-feed';


export function VanFraudRadarAdminTab() {
  const [periodDays, setPeriodDays] = useState<string>('30');
  const [selectedRepId, setSelectedRepId] = useState<string>('all');
  const [selectedEventCode, setSelectedEventCode] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const {
    data: radarData,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['van-fraud-radar-summary', periodDays, selectedRepId],
    queryFn: () =>
      vanSalesApi.getFraudRadarSummary({
        days: Number(periodDays) || 30,
        repId: selectedRepId !== 'all' ? Number(selectedRepId) : undefined,
      }),
    staleTime: 15_000,
  });

  const repOptions = useMemo(() => {
    const base = [{ value: 'all', label: 'جميع مناديب التوزيع' }];
    if (!radarData?.repProfiles) return base;
    for (const p of radarData.repProfiles) {
      base.push({
        value: String(p.repId),
        label: `${p.repName}${p.totalSuspicionEvents > 0 ? ` (${p.totalSuspicionEvents} شبهة)` : ''}`,
      });
    }
    return base;
  }, [radarData?.repProfiles]);

  const filteredProfiles = useMemo(() => {
    const profiles = radarData?.repProfiles || [];
    if (!searchQuery.trim()) return profiles;
    const q = searchQuery.toLowerCase().trim();
    return profiles.filter(
      (p) =>
        p.repName.toLowerCase().includes(q) ||
        (p.phone || '').toLowerCase().includes(q) ||
        p.flags.some((f) => f.toLowerCase().includes(q)),
    );
  }, [radarData?.repProfiles, searchQuery]);

  const filteredEvents = useMemo(() => {
    const events = radarData?.recentEvents || [];
    return events.filter((ev) => {
      if (selectedEventCode !== 'all' && ev.eventCode !== selectedEventCode) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchRep = (ev.repName || '').toLowerCase().includes(q);
        const matchCust = (ev.customerName || '').toLowerCase().includes(q);
        const matchTitle = (ev.titleAr || '').toLowerCase().includes(q);
        const matchDetails = (ev.detailsAr || '').toLowerCase().includes(q);
        return matchRep || matchCust || matchTitle || matchDetails;
      }
      return true;
    });
  }, [radarData?.recentEvents, selectedEventCode, searchQuery]);

  const kpis = radarData?.kpis;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      {/* Institutional Header Card */}
      <FraudRadarHeader
        isFetching={isFetching}
        refetch={refetch}
      />

      {/* KPI Cards Grid */}
      <FraudRadarKpiGrid
        isLoading={isLoading}
        kpis={kpis}
      />

      {/* Filters Bar */}
      <FraudRadarFilterBar
        periodDays={periodDays}
        setPeriodDays={setPeriodDays}
        selectedRepId={selectedRepId}
        setSelectedRepId={setSelectedRepId}
        repOptions={repOptions}
        selectedEventCode={selectedEventCode}
        setSelectedEventCode={setSelectedEventCode}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
      />

      {/* Section 1: Rep Risk Matrix Table */}
      <FraudRadarRiskMatrix
        filteredProfiles={filteredProfiles}
        isLoading={isLoading}
      />

      {/* Section 2: Chronological Suspicion Events Feed */}
      <FraudRadarEventsFeed
        filteredEvents={filteredEvents}
        isLoading={isLoading}
      />
    </div>
  );
}
