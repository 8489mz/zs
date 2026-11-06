import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { catalogApi } from '@/lib/api/catalog';
import { accountsApi } from '@/features/accounts/api/accounts.api';
import { formatCurrency } from '@/lib/format';
import { invalidateAccountsDomain, invalidateCatalogDomain } from '@/app/query-invalidation';
import { useAccountsRouteState } from '@/features/accounts/hooks/useAccountsRouteState';
import { extractCreatedEntityId } from '@/lib/api/extract-created-entity-id';

type BalanceCarrier = { id?: string | number; name?: string; balance?: number | string };

export function useAccountsWorkspaceController() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCustomerId = searchParams.get('customerId') || '';
  const initialSupplierId = searchParams.get('supplierId') || '';

  const [selectedCustomerId, setSelectedCustomerId] = useState(initialCustomerId);
  const [selectedSupplierId, setSelectedSupplierId] = useState(initialSupplierId);

  // Clear query params after reading them so they don't persist unnecessarily
  useEffect(() => {
    if (initialCustomerId || initialSupplierId) {
      setSearchParams({}, { replace: true });
    }
  }, [initialCustomerId, initialSupplierId, setSearchParams]);

  const [quickCustomerName, setQuickCustomerName] = useState('');
  const [quickCustomerPhone, setQuickCustomerPhone] = useState('');
  const [quickSupplierName, setQuickSupplierName] = useState('');
  const [quickSupplierPhone, setQuickSupplierPhone] = useState('');
  const [customerLedgerPage, setCustomerLedgerPage] = useState(1);
  const [customerLedgerPageSize, setCustomerLedgerPageSize] = useState(10);
  const [customerLedgerSearch, setCustomerLedgerSearch] = useState('');
  const [supplierLedgerPage, setSupplierLedgerPage] = useState(1);
  const [supplierLedgerPageSize, setSupplierLedgerPageSize] = useState(10);
  const [supplierLedgerSearch, setSupplierLedgerSearch] = useState('');

  const routeState = useAccountsRouteState(
    selectedCustomerId,
    selectedSupplierId,
    { page: customerLedgerPage, pageSize: customerLedgerPageSize, search: customerLedgerSearch },
    { page: supplierLedgerPage, pageSize: supplierLedgerPageSize, search: supplierLedgerSearch }
  );

  const {
    customersQuery,
    suppliersQuery,
    customerBalancesQuery,
    supplierBalancesQuery,
    customerLedgerQuery,
    supplierLedgerQuery,
    customers,
    suppliers,
    customerBalanceOptions,
    supplierBalanceOptions,
    customerEntries,
    supplierEntries,
    customerLedgerSummary,
    supplierLedgerSummary,
    customerLedgerPagination,
    supplierLedgerPagination,
  } = routeState;

  const balanceMap = useMemo(() => {
    const map = new Map<string, number>();
    (customerBalanceOptions as BalanceCarrier[]).forEach((customer) => {
      map.set(String(customer.id || ''), Number(customer.balance || 0));
    });
    return map;
  }, [customerBalanceOptions]);

  const mergedCustomerLedgerOptions = useMemo(() => {
    return (customers as BalanceCarrier[]).map((customer) => ({
      ...customer,
      balance: balanceMap.has(String(customer.id || ''))
        ? Number(balanceMap.get(String(customer.id || '')) || 0)
        : Number(customer.balance || 0),
    }));
  }, [customers, balanceMap]);

  const supplierBalanceMap = useMemo(() => {
    const map = new Map<string, number>();
    (supplierBalanceOptions as BalanceCarrier[]).forEach((supplier) => {
      map.set(String(supplier.id || ''), Number(supplier.balance || 0));
    });
    return map;
  }, [supplierBalanceOptions]);

  const mergedSupplierLedgerOptions = useMemo(() => {
    return (suppliers as BalanceCarrier[]).map((supplier) => ({
      ...supplier,
      balance: supplierBalanceMap.has(String(supplier.id || ''))
        ? Number(supplierBalanceMap.get(String(supplier.id || '')) || 0)
        : Number(supplier.balance || 0),
    }));
  }, [suppliers, supplierBalanceMap]);

  const collectableCustomers = useMemo(() => {
    return [...mergedCustomerLedgerOptions].sort((a, b) => {
      const balA = Number((a as BalanceCarrier).balance || 0);
      const balB = Number((b as BalanceCarrier).balance || 0);
      return balB - balA;
    });
  }, [mergedCustomerLedgerOptions]);

  const payableSuppliers = useMemo(
    () => mergedSupplierLedgerOptions.filter((supplier) => Number((supplier as BalanceCarrier).balance || 0) > 0),
    [mergedSupplierLedgerOptions]
  );

  const totalCustomerBalance = useMemo(
    () => mergedCustomerLedgerOptions.reduce((sum, customer) => sum + Number((customer as BalanceCarrier).balance || 0), 0),
    [mergedCustomerLedgerOptions]
  );
  const totalSupplierBalance = useMemo(
    () => mergedSupplierLedgerOptions.reduce((sum, supplier) => sum + Number((supplier as BalanceCarrier).balance || 0), 0),
    [mergedSupplierLedgerOptions]
  );

  const selectedCustomer = useMemo(
    () => mergedCustomerLedgerOptions.find((customer) => String((customer as BalanceCarrier).id || '') === selectedCustomerId) || null,
    [mergedCustomerLedgerOptions, selectedCustomerId]
  );
  const selectedSupplier = useMemo(
    () => mergedSupplierLedgerOptions.find((supplier) => String((supplier as BalanceCarrier).id || '') === selectedSupplierId) || null,
    [mergedSupplierLedgerOptions, selectedSupplierId]
  );

  // The payment form must offer the deep-linked supplier even when its
  // balance is zero (e.g. a contractual advance, which the card itself
  // advertises): payableSuppliers alone would leave the form without its
  // target and the card would render its empty state instead of the form.
  const supplierPaymentSuppliers = useMemo(() => {
    if (!selectedSupplier) return payableSuppliers;
    if (payableSuppliers.some((supplier) => String((supplier as BalanceCarrier).id || '') === String((selectedSupplier as BalanceCarrier).id || ''))) {
      return payableSuppliers;
    }
    return [...payableSuppliers, selectedSupplier];
  }, [payableSuppliers, selectedSupplier]);

  const accountsNextStep = useMemo(() => {
    if (selectedCustomer) return `راجع كشف ${selectedCustomer.name} ثم سجّل التحصيل أو صدّر الكشف.`;
    if (selectedSupplier) return `راجع كشف ${selectedSupplier.name} ثم سجّل الدفع أو اطبع الحركة.`;
    return 'اختر عميلًا أو موردًا من القوائم ثم راجع الكشف قبل تسجيل الحركة.';
  }, [selectedCustomer, selectedSupplier]);

  const accountsGuidanceCards = useMemo(
    () => [
      {
        key: 'scope',
        label: 'ما الذي تراه الآن؟',
        value: selectedCustomer && selectedSupplier ? 'عميل ومورد محددان' : selectedCustomer ? 'كشف عميل محدد' : selectedSupplier ? 'كشف مورد محدد' : 'تحصيل + دفع + كشف حساب'
      },
      { key: 'next', label: 'الخطوة الأنسب الآن', value: accountsNextStep },
      { key: 'focus', label: 'التركيز الحالي', value: selectedCustomer?.name || selectedSupplier?.name || 'مراجعة الكشوف المالية' },
      {
        key: 'balance',
        label: 'المؤشر المالي الأوضح',
        value: selectedCustomer
          ? formatCurrency(Number((selectedCustomer as BalanceCarrier).balance || 0))
          : selectedSupplier
            ? formatCurrency(Number((selectedSupplier as BalanceCarrier).balance || 0))
            : formatCurrency(Math.max(totalCustomerBalance, totalSupplierBalance))
      }
    ],
    [accountsNextStep, selectedCustomer, selectedSupplier, totalCustomerBalance, totalSupplierBalance]
  );

  const overviewStats = useMemo(
    () => [
      { label: 'عدد العملاء', value: customers.length },
      { label: 'عدد الموردين', value: suppliers.length },
      { label: 'أرصدة العملاء', value: formatCurrency(totalCustomerBalance) },
      { label: 'أرصدة الموردين', value: formatCurrency(totalSupplierBalance) }
    ],
    [customers.length, suppliers.length, totalCustomerBalance, totalSupplierBalance]
  );

  const queryClient = useQueryClient();

  useEffect(() => {
    setCustomerLedgerPage(1);
  }, [selectedCustomerId, customerLedgerSearch]);

  useEffect(() => {
    setSupplierLedgerPage(1);
  }, [selectedSupplierId, supplierLedgerSearch]);

  const quickCustomerMutation = useMutation({
    mutationFn: (payload: unknown) => catalogApi.createCustomer(payload),
    onSuccess: async () => {
      await Promise.all([
        invalidateCatalogDomain(queryClient, { includeCustomers: true, includeCustomerBalances: true }),
        invalidateAccountsDomain(queryClient)
      ]);
    }
  });

  const quickSupplierMutation = useMutation({
    mutationFn: (payload: unknown) => catalogApi.createSupplier(payload),
    onSuccess: async () => {
      await Promise.all([
        invalidateCatalogDomain(queryClient, { includeSuppliers: true, includeSupplierBalances: true }),
        invalidateAccountsDomain(queryClient)
      ]);
    }
  });

  async function handleQuickCustomerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = quickCustomerName.trim();
    if (!name) return;
    const created = await quickCustomerMutation.mutateAsync({
      name,
      phone: quickCustomerPhone.trim(),
      address: '',
      balance: 0,
      type: 'cash',
      creditLimit: 0
    });
    setQuickCustomerName('');
    setQuickCustomerPhone('');
    setSelectedCustomerId(extractCreatedEntityId(created));
  }

  async function handleQuickSupplierSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = quickSupplierName.trim();
    if (!name) return;
    const created = await quickSupplierMutation.mutateAsync({
      name,
      phone: quickSupplierPhone.trim(),
      address: '',
      balance: 0,
      notes: ''
    });
    setQuickSupplierName('');
    setQuickSupplierPhone('');
    setSelectedSupplierId(extractCreatedEntityId(created));
  }

  async function exportCustomerLedger() {
    if (!selectedCustomerId) return;
    const payload = await accountsApi.listAllCustomerLedger(selectedCustomerId, customerLedgerSearch);
    return payload.entries;
  }

  async function exportSupplierLedger() {
    if (!selectedSupplierId) return;
    const payload = await accountsApi.listAllSupplierLedger(selectedSupplierId, supplierLedgerSearch);
    return payload.entries;
  }

  const selectTopCustomer = () => {
    const topCustomer = [...mergedCustomerLedgerOptions].sort((a, b) => Number((b as BalanceCarrier).balance || 0) - Number((a as BalanceCarrier).balance || 0))[0];
    setSelectedCustomerId(String((topCustomer as BalanceCarrier | undefined)?.id || ''));
  };

  const selectTopSupplier = () => {
    const topSupplier = [...mergedSupplierLedgerOptions].sort((a, b) => Number((b as BalanceCarrier).balance || 0) - Number((a as BalanceCarrier).balance || 0))[0];
    setSelectedSupplierId(String((topSupplier as BalanceCarrier | undefined)?.id || ''));
  };

  return {
    routeState,
    customersQuery,
    suppliersQuery,
    customerBalancesQuery,
    supplierBalancesQuery,
    customerLedgerQuery,
    supplierLedgerQuery,
    customers,
    suppliers,
    collectableCustomers,
    payableSuppliers,
    supplierPaymentSuppliers,
    customerBalanceOptions: mergedCustomerLedgerOptions,
    supplierBalanceOptions: mergedSupplierLedgerOptions,
    customerEntries,
    supplierEntries,
    customerLedgerSummary,
    supplierLedgerSummary,
    customerLedgerPagination,
    supplierLedgerPagination,
    overviewStats,
    accountsGuidanceCards,
    selectedCustomerId,
    selectedSupplierId,
    selectedCustomer,
    selectedSupplier,
    customerLedgerSearch,
    supplierLedgerSearch,
    quickCustomerName,
    quickCustomerPhone,
    quickSupplierName,
    quickSupplierPhone,
    quickCustomerMutation,
    quickSupplierMutation,
    setSelectedCustomerId,
    setSelectedSupplierId,
    setCustomerLedgerSearch,
    setSupplierLedgerSearch,
    setCustomerLedgerPage,
    setSupplierLedgerPage,
    setCustomerLedgerPageSize,
    setSupplierLedgerPageSize,
    setQuickCustomerName,
    setQuickCustomerPhone,
    setQuickSupplierName,
    setQuickSupplierPhone,
    handleQuickCustomerSubmit,
    handleQuickSupplierSubmit,
    exportCustomerLedger,
    exportSupplierLedger,
    selectTopCustomer,
    selectTopSupplier,
    customerLedgerSearchValue: customerLedgerSearch,
    supplierLedgerSearchValue: supplierLedgerSearch,
  };
}
