/*
 * Clock P8 — frontend "now" buttons + JE/PDC defaults from server time (RC-7).
 *
 * THE DEFECT: the "now" buttons filled check-in/check-out times from the
 * client clock's HH:mm, and the JE/PDC/payroll date defaults came from the
 * client clock (the JE/PDC ones from a UTC slice, so they were yesterday
 * for the first two hours after midnight in the tenant's zone). A device
 * clock set hours off moved posted dates.
 *
 * THE FIX: the shared useServerClock hook derives "now" from the SERVER
 * instant the page's list response already carries (serverTime, ISO) in
 * the tenant zone (serverTimezone) — the quick-shortcut anchor pattern:
 * anchor the server epoch once, then add performance.now() elapsed, so
 * the displayed time keeps ticking without trusting the client clock.
 * Pure helpers serverDayKey / serverTimeHHmm do the zone math; the hook
 * owns the anchor. The date inputs stay user-editable; only the DEFAULT
 * comes from the server.
 *
 * WHAT THIS PINS, driving the REAL code (no duplicated formula):
 * - The pure helpers on a frozen instant (2026-04-08T21:30Z = 23:30 Cairo
 *   04-08, 00:30 Kuwait 04-09): the day key and HH:mm flip across the
 *   midnight boundary exactly where the tenant zone says they do.
 * - The REAL DailyAttendanceTable: with the client clock faked to 10:15
 *   UTC and serverTime frozen at 21:30Z in Asia/Kuwait, the "now" button
 *   fills 00:30 (the server's Kuwait time), not 10:15 (the client clock).
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { serverDayKey, serverTimeHHmm } from '@/shared/hooks/use-server-clock';
import { DailyAttendanceTable } from '@/features/hr/components/attendance/DailyAttendanceTable';
import { ManualAttendanceModal } from '@/features/hr/components/attendance/ManualAttendanceModal';
import { PdcChequeActionModal } from '@/features/accounting/components/PdcChequeActionModal';
import { ManualJournalEntryDialog } from '@/features/accounting/components/ManualJournalEntryDialog';
import {CreatePayrollRunModal, type PayrollDraft} from '@/features/hr/components/payroll/CreatePayrollRunModal';
import type { HrAttendanceRecord } from '@/types/domain';
import type { PdcCheque } from '@/features/accounting/api/accounting.api';

const FROZEN_SERVER_TIME = '2026-04-08T21:30:00.000Z';

describe('server clock helpers', () => {
  it('derives the day key and HH:mm in the tenant zone, across midnight', () => {
    expect(serverDayKey(FROZEN_SERVER_TIME, 'Asia/Kuwait')).toBe('2026-04-09');
    expect(serverDayKey(FROZEN_SERVER_TIME, 'Africa/Cairo')).toBe('2026-04-08');
    expect(serverTimeHHmm(FROZEN_SERVER_TIME, 'Asia/Kuwait')).toBe('00:30');
    expect(serverTimeHHmm(FROZEN_SERVER_TIME, 'Africa/Cairo')).toBe('23:30');
  });

  it('falls back to the Africa/Cairo zone when no zone is given', () => {
    expect(serverDayKey(FROZEN_SERVER_TIME)).toBe('2026-04-08');
    expect(serverTimeHHmm(FROZEN_SERVER_TIME)).toBe('23:30');
  });

  it('returns an empty string for an unparseable instant', () => {
    expect(serverDayKey('not-a-date', 'Asia/Kuwait')).toBe('');
    expect(serverTimeHHmm('not-a-date', 'Asia/Kuwait')).toBe('');
  });
});

describe('DailyAttendanceTable now button', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T10:15:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fills the server Kuwait time, not the client clock time', () => {
    const onUpdateDraft = vi.fn();
    const row: HrAttendanceRecord = {
      employeeId: '1',
      employeeNo: '001',
      employeeName: 'موظف اختبار',
      workDate: '2026-04-09',
      status: 'present',
      compensationType: 'monthly',
    } as HrAttendanceRecord;

    render(
      <DailyAttendanceTable
        rows={[row]}
        draftByEmployeeId={{}}
        onUpdateDraft={onUpdateDraft}
        onSaveRow={vi.fn()}
        serverTime={FROZEN_SERVER_TIME}
        serverTimezone="Asia/Kuwait"
      />,
    );

    const nowButtons = screen.getAllByTitle('وضع الوقت الحالي');
    fireEvent.click(nowButtons[0]);

    expect(onUpdateDraft).toHaveBeenCalledWith('1', expect.objectContaining({ checkInAt: '00:30' }));
  });
});

describe('ManualAttendanceModal current-time button', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T10:15:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fills the server Kuwait time, not the client clock time', () => {
    const setTimeInput = vi.fn();

    render(
      <ManualAttendanceModal
        prompt={{
          rowId: '1',
          employeeId: 1,
          workDate: '2026-04-09',
          type: 'check_in',
          defaultTime: '09:00',
          employeeName: 'موظف اختبار',
          employeeNo: 'E1',
          scheduledTime: '09:00',
        }}
        timeInput=""
        setTimeInput={setTimeInput}
        isPending={false}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        serverTime={FROZEN_SERVER_TIME}
        serverTimezone="Asia/Kuwait"
      />,
    );

    fireEvent.click(screen.getByText('توقيت الآن'));
    expect(setTimeInput).toHaveBeenCalledWith('00:30');
  });
});

describe('PdcChequeActionModal action date', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T10:15:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults the action date to the server Kuwait day, not the client UTC slice', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const cheque = {
      id: 1,
      cheque_number: 'CHQ-1',
      partner_name: 'عميل اختبار',
      amount: 1000,
      currency: 'EGP',
      bank_name: 'بنك اختبار',
    } as unknown as PdcCheque;

    render(
      <QueryClientProvider client={client}>
        <PdcChequeActionModal
          open
          action="collect"
          cheque={cheque}
          onClose={vi.fn()}
          serverTime={FROZEN_SERVER_TIME}
          serverTimezone="Asia/Kuwait"
        />
      </QueryClientProvider>,
    );

    expect(screen.getByDisplayValue('2026-04-09')).toBeTruthy();
  });
});

describe('ManualJournalEntryDialog entry date', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T10:15:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults the entry date to the server Kuwait day, not the client UTC slice', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <ManualJournalEntryDialog
          open
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          serverTime={FROZEN_SERVER_TIME}
          serverTimezone="Asia/Kuwait"
        />
      </QueryClientProvider>,
    );

    expect(screen.getByDisplayValue('2026-04-09')).toBeTruthy();
  });
});

describe('CreatePayrollRunModal daily preset', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T10:15:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('presets "today only" to the server Kuwait day, not the client UTC slice', () => {
    const onDraftChange = vi.fn();
    const draft: PayrollDraft = {
      periodMonth: '2026-04',
      payFrequency: 'daily',
      startDate: '2026-04-01',
      endDate: '2026-04-30',
      notes: '',
    };

    render(
      <CreatePayrollRunModal
        isOpen
        onClose={vi.fn()}
        draft={draft}
        onDraftChange={onDraftChange}
        onSubmit={vi.fn()}
        isPending={false}
        canManagePayroll
        hasCreatePayrollRun
        formError=""
        employees={[]}
        isEgypt
        serverTime={FROZEN_SERVER_TIME}
        serverTimezone="Asia/Kuwait"
      />,
    );

    fireEvent.click(screen.getByText(/اليوم فقط/));
    expect(onDraftChange).toHaveBeenCalledTimes(1);
    const updater = onDraftChange.mock.calls[0][0] as (prev: PayrollDraft) => PayrollDraft;
    const next = updater(draft);
    expect(next.startDate).toBe('2026-04-09');
    expect(next.endDate).toBe('2026-04-09');
  });
});
