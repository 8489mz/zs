import { AppError } from '../../../common/errors/app-error';

export type UserQueryInput = Record<string, unknown>;

export interface UserListQuery {
  search: string;
  role: string;
  includeInactive: boolean;
}

export interface UserRowLike {
  id: number | string;
  username: string;
  phone?: string | null;
  role: string;
  permissions_json?: unknown;
  display_name?: string | null;
  default_branch_id?: number | string | null;
  is_active?: boolean | number | null;
  must_change_password?: boolean | number | null;
  failed_login_count?: number | string | null;
  locked_until?: Date | string | null;
  last_login_at?: Date | string | null;
}

export interface UserViewModel {
  id: string;
  username: string;
  phone?: string | null;
  role: string;
  permissions: string[];
  name: string;
  branchIds: string[];
  defaultBranchId: string;
  isActive: boolean;
  mustChangePassword: boolean;
  failedLoginCount: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
}

function safeJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.map((item) => String(item).trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function normalizeUserListQuery(query: UserQueryInput): UserListQuery {
  return {
    search: String(query.search || '')
      .trim()
      .toLowerCase(),
    role: String(query.role || '').trim(),
    includeInactive: String(query.includeInactive || 'true') !== 'false',
  };
}

export function mapUserRow(row: UserRowLike, branchIds: string[]): UserViewModel {
  return {
    id: String(row.id),
    username: row.username,
    phone: row.phone || null,
    role: row.role,
    permissions: safeJsonArray(row.permissions_json),
    name: row.display_name || row.username,
    branchIds,
    defaultBranchId: row.default_branch_id ? String(row.default_branch_id) : '',
    isActive: Boolean(row.is_active),
    mustChangePassword: Boolean(row.must_change_password),
    failedLoginCount: Number(row.failed_login_count || 0),
    lockedUntil: row.locked_until instanceof Date ? row.locked_until.toISOString() : row.locked_until || null,
    lastLoginAt: row.last_login_at instanceof Date ? row.last_login_at.toISOString() : row.last_login_at || null,
  };
}

export function filterUsers(users: UserViewModel[], normalizedQuery: UserListQuery): UserViewModel[] {
  let filtered = users;

  if (!normalizedQuery.includeInactive) {
    filtered = filtered.filter((row) => row.isActive === true);
  }

  if (normalizedQuery.role) {
    filtered = filtered.filter((row) => String(row.role) === normalizedQuery.role);
  }

  if (normalizedQuery.search) {
    filtered = filtered.filter((row) => {
      const username = String(row.username || '').toLowerCase();
      const name = String(row.name || '').toLowerCase();
      const phone = String(row.phone || '').toLowerCase();
      return (
        username.includes(normalizedQuery.search) ||
        name.includes(normalizedQuery.search) ||
        phone.includes(normalizedQuery.search)
      );
    });
  }

  return filtered;
}

export interface UserSummaryDto {
  total: number;
  totalItems: number;
  active: number;
  inactive: number;
  superAdmins: number;
  admins: number;
  cashiers: number;
  locked: number;
  activePrivilegedUsers: number;
}

export function summarizeUsers(users: UserViewModel[]): UserSummaryDto {
  let active = 0;
  let superAdmins = 0;
  let admins = 0;
  let cashiers = 0;
  let locked = 0;
  let activePrivilegedUsers = 0;

  const now = Date.now();

  for (const user of users) {
    const isUserActive = user.isActive !== false;
    if (isUserActive) {
      active++;
    }

    const lockedUntilMs = user.lockedUntil ? new Date(user.lockedUntil).getTime() : 0;
    const isLocked = Number(user.failedLoginCount || 0) >= 5 || lockedUntilMs > now;
    if (isLocked) {
      locked++;
    }

    if (user.role === 'super_admin') {
      superAdmins++;
      if (isUserActive) activePrivilegedUsers++;
    } else if (user.role === 'admin') {
      admins++;
      if (isUserActive) activePrivilegedUsers++;
    } else if (user.role === 'cashier') {
      cashiers++;
    }
  }

  return {
    total: users.length,
    totalItems: users.length,
    active,
    inactive: users.length - active,
    superAdmins,
    admins,
    cashiers,
    locked,
    activePrivilegedUsers,
  };
}

export function normalizeBranchIds(branchIds: string[] | undefined): number[] {
  return Array.from(
    new Set((branchIds ?? []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)),
  );
}

export function normalizeUserId(value: string | number | undefined): number {
  const id = Number(value || 0);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

export function ensureUsersPayload(usersPayload: unknown): asserts usersPayload is Array<Record<string, unknown>> {
  if (!Array.isArray(usersPayload)) {
    throw new AppError('users payload must be an array', 'USERS_PAYLOAD_INVALID', 400);
  }
}
