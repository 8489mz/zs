/*
 * INV-REST-KPI-OUTAGE-TRUTH (R8-E): the KPI strip used to render fallback
 * zeros whenever the tickets query had no data — first load in flight AND
 * a failed query both produced 0/0/0/0, so during an outage the executive
 * strip calmly reported an idle kitchen while the tickets area below it
 * screamed "disconnected". A manager glancing at the strip alone
 * concluded the kitchen was idle.
 *
 * The strip now renders through the same state decision the tickets area
 * already uses (resolveKitchenTicketsState), and distinguishes no-data
 * from a real zero:
 * - 'loading' (first load, nothing known): every value renders '—', no marker.
 * - 'disconnected' (error, no data): every value renders '—' + a
 *   "غير متصل — بيانات غير متوفرة" marker. Never 0.
 * - 'stale' (error with prior data): the LAST-KNOWN counts render, with a
 *   "بيانات قديمة — غير محدّثة" marker. Never zeroed — the tickets area
 *   keeps showing the same stale tickets, and the strip must agree.
 * - 'standby' / 'tickets' (query healthy): the counts as they are. A
 *   genuine all-zero success still renders 0 with NO marker and NO '—':
 *   0 must remain displayable when it is true.
 *
 * The page passes `data?.stats ?? null` (no zero fallback) plus the
 * already-computed ticketsState. `stats` is null exactly when there is
 * no data to show.
 */

import { useTranslation } from 'react-i18next';
import React from 'react';
import type { KitchenTicketsState } from '@/features/pos/lib/kds-connection-state';

export interface KdsKpiStats {
  pendingCount: number;
  cookingCount: number;
  readyCount: number;
  criticalCount: number;
}

interface KdsKpiStripProps {
  stats: KdsKpiStats | null;
  state: KitchenTicketsState;
}

export const KdsKpiStrip: React.FC<KdsKpiStripProps> = ({ stats, state }) => {
  const { t } = useTranslation();

  // No data means '—', never a fake 0. A real count (including a real 0)
  // renders as its number.
  const value = (count: number | undefined): number | string =>
    count === undefined ? '—' : count;

  const criticalCount = stats?.criticalCount ?? 0;

  // Small badge under the cards, never a 5th card. Loading shows '—'
  // with no marker (nothing is wrong yet); only a failed query is
  // labelled, so a quiet kitchen is never mistaken for a blind one.
  const marker =
    state === 'disconnected'
      ? {
          text: t('pos.kds.kds_kpi_strip.s4', 'غير متصل — بيانات غير متوفرة'),
          color: '#dc2626',
        }
      : state === 'stale'
        ? {
            text: t('pos.kds.kds_kpi_strip.s5', 'بيانات قديمة — غير محدّثة'),
            color: '#b45309',
          }
        : null;

  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        padding: '10px 24px',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '12px',
        }}
      >
        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '8px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#170e5e', display: 'inline-block' }} />
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#475569' }}>{t('pos.kds.kds_kpi_strip.s0', "ورد للتو (جديد):")}</span>
          </div>
          <span style={{ fontSize: '18px', fontWeight: 900, color: '#170e5e' }}>{value(stats?.pendingCount)}</span>
        </div>

        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '8px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#f59e0b', display: 'inline-block' }} />
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#475569' }}>{t('pos.kds.kds_kpi_strip.s1', "قيد التحضير والطهي:")}</span>
          </div>
          <span style={{ fontSize: '18px', fontWeight: 900, color: '#b45309' }}>{value(stats?.cookingCount)}</span>
        </div>

        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '8px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981', display: 'inline-block' }} />
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#475569' }}>{t('pos.kds.kds_kpi_strip.s2', "جاهز للاستلام والتسليم:")}</span>
          </div>
          <span style={{ fontSize: '18px', fontWeight: 900, color: '#15803d' }}>{value(stats?.readyCount)}</span>
        </div>

        <div
          style={{
            backgroundColor: criticalCount > 0 ? '#fef2f2' : '#ffffff',
            border: `1px solid ${criticalCount > 0 ? '#fecaca' : '#e2e8f0'}`,
            borderRadius: '10px',
            padding: '8px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: criticalCount > 0 ? '#ef4444' : '#94a3b8', display: 'inline-block' }} />
            <span
              style={{
                fontSize: '13px',
                fontWeight: 700,
                color: criticalCount > 0 ? '#991b1b' : '#64748b',
              }}
            >
              {t('pos.kds.kds_kpi_strip.s3', "متأخر (>15د):")}
            </span>
          </div>
          <span
            style={{
              fontSize: '18px',
              fontWeight: 900,
              color: criticalCount > 0 ? '#dc2626' : '#64748b',
            }}
          >
            {value(stats?.criticalCount)}
          </span>
        </div>
      </div>

      {marker && (
        <div
          style={{
            marginTop: '8px',
            textAlign: 'center',
            fontSize: '12px',
            fontWeight: 800,
            color: marker.color,
          }}
        >
          {marker.text}
        </div>
      )}
    </div>
  );
};
