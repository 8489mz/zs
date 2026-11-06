/*
New file: frontend/src/features/hr/components/attendance/AttendanceRangeTable.spec.tsx
Pins the equal-times 24h bug in the range table (INV-ATTENDANCE-EQUAL-TIMES-ZERO).

THE GAP: same as the daily table — getRowMinutes wrapped with `end <= start`,
so equal check-in and check-out times wrapped to a full 1440 minutes and the
row showed "24 س 0 د" with the footer inflated by 24 hours.

THE RULE: equal times mean zero worked minutes. The midnight wrap applies
only when end < start (a real night shift). When both times are present and
valid but equal, the cell shows "0 س 0 د"; absent / leave / missing times
still show "—".

WHAT THIS PINS, driving the REAL AttendanceRangeTable:
- 18:09 -> 18:09 shows "0 س 0 د" (not "24 س 0 د").
- 18:09 -> 18:30 still shows "0 س 21 د".
- 22:00 -> 06:00 (night shift) still shows "8 س 0 د".
- Footer totals the three rows: 0 + 21 + 480 = 501 min = "8.35 ساعة (8 س و 21 د)".
*/

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AttendanceRangeTable } from '@/features/hr/components/attendance/AttendanceRangeTable';
import type { HrAttendanceRecord } from '@/types/domain';

const baseRow = (overrides: Partial<HrAttendanceRecord>): HrAttendanceRecord => ({
  employeeId: '1',
  employeeNo: '001',
  employeeName: 'موظف اختبار',
  workDate: '2026-11-05',
  status: 'present',
  compensationType: 'monthly',
  ...overrides,
});

describe('AttendanceRangeTable equal times', () => {
  it('shows 0 س 0 د for equal times, keeps 21 minutes and the night shift', () => {
    const rows = [
      baseRow({ employeeId: '1', checkInAt: '2026-11-05T18:09:00', checkOutAt: '2026-11-05T18:09:00' }),
      baseRow({ employeeId: '2', employeeNo: '002', employeeName: 'موظف ثان', checkInAt: '2026-11-05T18:09:00', checkOutAt: '2026-11-05T18:30:00' }),
      baseRow({ employeeId: '3', employeeNo: '003', employeeName: 'موظف ليلي', checkInAt: '2026-11-05T22:00:00', checkOutAt: '2026-11-06T06:00:00' }),
    ];

    render(
      <MemoryRouter>
        <AttendanceRangeTable rows={rows} />
      </MemoryRouter>,
    );

    expect(screen.getByText('0 س 0 د')).toBeTruthy();
    expect(screen.getByText('0 س 21 د')).toBeTruthy();
    expect(screen.getByText('8 س 0 د')).toBeTruthy();
    expect(screen.getByText('8.35 ساعة (8 س و 21 د)')).toBeTruthy();
  });
});
