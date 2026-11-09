/* R8-E (INV-REST-KPI-OUTAGE-TRUTH): the KPI strip used to render
 * fallback zeros whenever the tickets query had no data — first load in
 * flight AND a failed query both produced 0/0/0/0, so during an outage
 * the strip reported an idle kitchen while the tickets area below it
 * said "disconnected". The strip now takes the same state decision the
 * tickets area uses, plus `stats: null` for "no data", and renders '—'
 * (with a marker when the query has failed) instead of fake zeros.
 *
 * Case 2 is base-red: at base (c371a838) the strip requires numeric
 * stats and renders them directly, so `stats = null` cannot even be
 * passed and no marker exists. Case 4 is the discriminator: a genuine
 * all-zero success must still render 0 with NO marker and NO '—' — it
 * catches a fix that "solves" the outage by hiding zeros everywhere.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KdsKpiStrip } from './KdsKpiStrip';

const DISCONNECTED_MARKER = 'غير متصل — بيانات غير متوفرة';
const STALE_MARKER = 'بيانات قديمة — غير محدّثة';

describe('KdsKpiStrip outage truth (INV-REST-KPI-OUTAGE-TRUTH)', () => {
  it('renders the real counts when the query is healthy', () => {
    render(
      <KdsKpiStrip
        stats={{ pendingCount: 3, cookingCount: 2, readyCount: 1, criticalCount: 4 }}
        state="tickets"
      />,
    );

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    expect(screen.queryByText(DISCONNECTED_MARKER)).not.toBeInTheDocument();
    expect(screen.queryByText(STALE_MARKER)).not.toBeInTheDocument();
  });

  it('shows — with the disconnected marker when the query fails with no data, never fake zeros', () => {
    render(<KdsKpiStrip stats={null} state="disconnected" />);

    // All four values are "no data", not zero.
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.getByText(DISCONNECTED_MARKER)).toBeInTheDocument();
    expect(screen.queryByText(STALE_MARKER)).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('keeps the last-known counts with the stale marker when the query fails with prior data', () => {
    render(
      <KdsKpiStrip
        stats={{ pendingCount: 3, cookingCount: 2, readyCount: 1, criticalCount: 0 }}
        state="stale"
      />,
    );

    // The last-known numbers stay — they are not zeroed — and the strip
    // says they may be out of date.
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText(STALE_MARKER)).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    expect(screen.queryByText(DISCONNECTED_MARKER)).not.toBeInTheDocument();
  });

  it('a genuine all-zero success still renders 0 with no marker and no —', () => {
    render(
      <KdsKpiStrip
        stats={{ pendingCount: 0, cookingCount: 0, readyCount: 0, criticalCount: 0 }}
        state="standby"
      />,
    );

    expect(screen.getAllByText('0')).toHaveLength(4);
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    expect(screen.queryByText(DISCONNECTED_MARKER)).not.toBeInTheDocument();
    expect(screen.queryByText(STALE_MARKER)).not.toBeInTheDocument();
  });

  it('shows — with no marker while the first load is in flight', () => {
    render(<KdsKpiStrip stats={null} state="loading" />);

    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText(DISCONNECTED_MARKER)).not.toBeInTheDocument();
    expect(screen.queryByText(STALE_MARKER)).not.toBeInTheDocument();
  });
});
