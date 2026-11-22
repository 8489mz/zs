import { useMemo, useState } from 'react';
import { buildRange, buildTodayRange } from '@/features/reports/lib/reports-format';

export function useReportsWorkspaceState() {
  const defaultRange = useMemo(() => buildRange(30), []);
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [submittedRange, setSubmittedRange] = useState(defaultRange);
  const [locationId, setLocationId] = useState<'all' | string>('all');
  const [submittedLocationId, setSubmittedLocationId] = useState<'all' | string>('all');
  const [userId, setUserId] = useState<'all' | string>('all');
  const [submittedUserId, setSubmittedUserId] = useState<'all' | string>('all');
  // F13 (trial problem 18): discounted-invoices-only filter for the sales
  // report. Draft until applied, like location/user above.
  const [discountedOnly, setDiscountedOnly] = useState(false);
  const [submittedDiscountedOnly, setSubmittedDiscountedOnly] = useState(false);
  const [inventoryPage, setInventoryPage] = useState(1);
  const [inventoryPageSize, setInventoryPageSize] = useState(10);
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryFilter, setInventoryFilter] = useState<'all' | 'attention' | 'low' | 'out' | 'dead'>('all');
  const [deadStockDays, setDeadStockDays] = useState<number>(60);
  const [balancesPage, setBalancesPage] = useState(1);
  const [balancesPageSize, setBalancesPageSize] = useState(10);
  const [balancesSearch, setBalancesSearch] = useState('');
  const [balancesFilter, setBalancesFilter] = useState<'all' | 'high-balance' | 'over-limit'>('all');
  const [employeesPage, setEmployeesPage] = useState(1);
  const [employeesPageSize, setEmployeesPageSize] = useState(10);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [employeeRole, setEmployeeRole] = useState<'all' | 'super_admin' | 'admin' | 'cashier'>('all');
  const [employeeActivityType, setEmployeeActivityType] = useState<'all' | 'sales' | 'returns' | 'purchases' | 'expenses' | 'shifts' | 'audit'>('all');

  const applyPresetRange = (range: { from: string; to: string }) => {
    setFrom(range.from);
    setTo(range.to);
    setSubmittedRange(range);
    setSubmittedLocationId(locationId);
    setSubmittedUserId(userId);
    setSubmittedDiscountedOnly(discountedOnly);
    setInventoryPage(1);
    setBalancesPage(1);
    setEmployeesPage(1);
  };

  const applyScope = () => {
    setSubmittedRange({ from, to });
    setSubmittedLocationId(locationId);
    setSubmittedUserId(userId);
    setSubmittedDiscountedOnly(discountedOnly);
    setInventoryPage(1);
    setBalancesPage(1);
    setEmployeesPage(1);
  };

  const resetRange = () => {
    setLocationId('all');
    setUserId('all');
    setSubmittedLocationId('all');
    setSubmittedUserId('all');
    setDiscountedOnly(false);
    setSelectedEmployeeId('');
    applyPresetRange(defaultRange);
    // After applyPresetRange: it submits the still-stale draft value, so
    // the submitted flag is cleared explicitly here (last setter wins).
    setSubmittedDiscountedOnly(false);
  };

  return {
    defaultRange,
    from,
    to,
    submittedRange,
    locationId,
    submittedLocationId,
    userId,
    submittedUserId,
    discountedOnly,
    submittedDiscountedOnly,
    inventoryPage,
    inventoryPageSize,
    inventorySearch,
    inventoryFilter,
    deadStockDays,
    balancesPage,
    balancesPageSize,
    balancesSearch,
    balancesFilter,
    employeesPage,
    employeesPageSize,
    employeeSearch,
    selectedEmployeeId,
    employeeRole,
    employeeActivityType,
    setFrom,
    setTo,
    setSubmittedRange,
    setLocationId,
    setSubmittedLocationId,
    setUserId,
    setSubmittedUserId,
    setDiscountedOnly,
    setSubmittedDiscountedOnly,
    setInventoryPage,
    setInventoryPageSize,
    setInventorySearch,
    setInventoryFilter,
    setDeadStockDays,
    setBalancesPage,
    setBalancesPageSize,
    setBalancesSearch,
    setBalancesFilter,
    setEmployeesPage,
    setEmployeesPageSize,
    setEmployeeSearch,
    setSelectedEmployeeId,
    setEmployeeRole,
    setEmployeeActivityType,
    applyPresetDays: (days: number) => applyPresetRange(buildRange(days)),
    applyTodayPreset: () => applyPresetRange(buildTodayRange()),
    applyPresetRange,
    applyScope,
    resetRange,
  };
}
