import { act } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '@/stores/auth-store';
import type { AuthTenant, AuthUser } from '@/types/auth';
import { HrSectionNav } from './HrSectionNav';

const hrTenant: AuthTenant = {
  id: 'tenant-hr',
  accountId: 'acc-hr',
  slug: 'hr-tenant',
  businessName: 'HR Tenant',
  activityType: 'retail_general',
  status: 'active',
  isTrial: false,
  trialEndsAt: null,
  trialDaysRemaining: null,
  features: ['sales', 'catalog', 'sessions', 'cashDrawer', 'reports', 'hr'],
};

function makeUser(role: AuthUser['role'], permissions: string[]): AuthUser {
  return {
    id: `u-${role}`,
    username: role,
    role,
    permissions,
    displayName: role,
    branchIds: ['b-1'],
    defaultBranchId: 'b-1',
  };
}

afterEach(() => {
  act(() => {
    useAuthStore.setState({ user: null, tenant: null });
  });
});

describe('HrSectionNav permission filtering', () => {
  it('hides unauthorized HR tabs completely for an attendance-only cashier', () => {
    act(() => {
      useAuthStore.setState({
        user: makeUser('cashier', ['sales', 'cashDrawer', 'hr', 'hrAttendance']),
        tenant: hrTenant,
      });
    });

    const { container } = render(
      <MemoryRouter initialEntries={['/hr/attendance']}>
        <HrSectionNav />
      </MemoryRouter>,
    );

    expect(container.querySelector('nav')).toBeNull();
    expect(screen.queryByTitle('الموظفون')).not.toBeInTheDocument();
    expect(screen.queryByTitle('المرتبات')).not.toBeInTheDocument();
    expect(screen.queryByTitle('السلف')).not.toBeInTheDocument();
    expect(screen.queryByTitle('التقارير')).not.toBeInTheDocument();
    expect(screen.queryByTitle('الإعدادات')).not.toBeInTheDocument();
    expect(screen.queryByTitle('مخالصات نهاية الخدمة')).not.toBeInTheDocument();
  });

  it('shows only authorized tabs when user has partial HR permissions (attendance + loans)', () => {
    act(() => {
      useAuthStore.setState({
        user: makeUser('cashier', ['hr', 'hrAttendance', 'hrLoans']),
        tenant: hrTenant,
      });
    });

    render(
      <MemoryRouter initialEntries={['/hr/attendance']}>
        <HrSectionNav />
      </MemoryRouter>,
    );

    expect(screen.getByTitle('نظرة عامة')).toBeInTheDocument();
    expect(screen.getByTitle('الحضور والانصراف')).toBeInTheDocument();
    expect(screen.getByTitle('السلف')).toBeInTheDocument();
    expect(screen.queryByTitle('الموظفون')).not.toBeInTheDocument();
    expect(screen.queryByTitle('المرتبات')).not.toBeInTheDocument();
    expect(screen.queryByTitle('الإعدادات')).not.toBeInTheDocument();
  });

  it('shows all HR tabs for an admin with full HR permissions', () => {
    act(() => {
      useAuthStore.setState({
        user: makeUser('admin', ['*']),
        tenant: hrTenant,
      });
    });

    render(
      <MemoryRouter initialEntries={['/hr']}>
        <HrSectionNav />
      </MemoryRouter>,
    );

    expect(screen.getByTitle('نظرة عامة')).toBeInTheDocument();
    expect(screen.getByTitle('الموظفون')).toBeInTheDocument();
    expect(screen.getByTitle('الحضور والانصراف')).toBeInTheDocument();
    expect(screen.getByTitle('المرتبات')).toBeInTheDocument();
    expect(screen.getByTitle('مخالصات نهاية الخدمة')).toBeInTheDocument();
    expect(screen.getByTitle('التقارير')).toBeInTheDocument();
    expect(screen.getByTitle('الإعدادات')).toBeInTheDocument();
  });
});
