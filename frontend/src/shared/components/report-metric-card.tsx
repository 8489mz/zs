import { AnimatedValue } from '@/shared/components/animated-value';
import { BarChartIcon, CheckCircleIcon, AlertTriangleIcon, AlertCircleIcon } from '@/shared/components/icons/AppIcons';
import React from 'react';

interface ReportMetricCardProps {
  label: string;
  value: number;
  helper?: string;
  tone?: 'primary' | 'success' | 'warning' | 'danger';
  formatter?: (value: number) => string;
  decimals?: number;
  progress?: number;
  /* INV-REPORTS-PARTIAL-TOTALS: while any source behind `value` is still
  loading, the card shows a loading state instead of a number. A card must
  never display a partial total (a `?? 0` fallback or a value from only
  one of several sources) as if it were final. */
  isLoading?: boolean;
}

const TONE_ICONS: Record<string, React.ReactNode> = {
  primary: <BarChartIcon size={16} />,
  success: <CheckCircleIcon size={16} color="var(--color-success, #16a34a)" />,
  warning: <AlertTriangleIcon size={16} color="var(--color-warning, #d97706)" />,
  danger: <AlertCircleIcon size={16} color="var(--color-danger, #dc2626)" />,
};

export function ReportMetricCard({
  label,
  value,
  helper,
  tone = 'primary',
  formatter,
  decimals = 0,
  progress,
  isLoading = false,
}: ReportMetricCardProps) {
  const normalizedProgress = isLoading ? 0 : Math.max(0, Math.min(100, Number(progress || 0)));

  return (
    <article className={`report-metric-card tone-${tone}`}>
      <div className="rmc-accent-bar" aria-hidden="true" />
      <div className="rmc-body">
        <div className="rmc-header">
          <span className="rmc-icon" aria-hidden="true">{TONE_ICONS[tone] || <BarChartIcon size={16} />}</span>
          <span className="report-metric-label">{label}</span>
        </div>
        <strong className="report-metric-value" aria-busy={isLoading || undefined}>
          {isLoading ? (
            <span
              className="report-metric-value-loading"
              role="status"
              aria-label="جاري تحميل البيانات..."
              style={{ display: 'inline-block', width: '84px', height: '1em', borderRadius: '6px', background: '#e2e8f0', verticalAlign: 'middle' }}
            />
          ) : (
            <AnimatedValue value={value} formatter={formatter} decimals={decimals} />
          )}
        </strong>
        {helper ? <small className="report-metric-helper">{helper}</small> : null}
        <div className="report-progress-track" aria-hidden="true">
          <span className="report-progress-fill" style={{ width: `${normalizedProgress}%` }} />
        </div>
      </div>
    </article>
  );
}
