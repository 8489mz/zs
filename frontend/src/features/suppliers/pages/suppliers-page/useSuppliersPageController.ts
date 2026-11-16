import { useEffect, useMemo, useState } from 'react';
import { formatCurrency } from '@/lib/format';
import type { Supplier } from '@/types/domain';
import { useSuppliersPageQuery } from '@/features/suppliers/hooks/useSuppliersPageQuery';
import { useDeleteSupplierMutation } from '@/features/suppliers/hooks/useSupplierActions';
import { useSuppliersPageActions } from '@/features/suppliers/hooks/useSuppliersPageActions';
import { useHasAnyPermission } from '@/shared/hooks/use-permission';

export function useSuppliersPageController() {
  const [search, setSearch] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [supplierToDelete, setSupplierToDelete] = useState<Supplier | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filterMode, setFilterMode] = useState<'all' | 'debt' | 'withNotes'>('all');

  const suppliersQuery = useSuppliersPageQuery({ page, pageSize, q: search, filter: filterMode });
  const deleteMutation = useDeleteSupplierMutation(() => {
    setSelectedSupplier(null);
    setSupplierToDelete(null);
  });
  const canDelete = useHasAnyPermission('canDelete');
  const canPrint = useHasAnyPermission('canPrint');
  const rows = useMemo(() => suppliersQuery.data?.suppliers || [], [suppliersQuery.data?.suppliers]);
  const activeSelectedSupplier = useMemo(
    () => (selectedSupplier ? rows.find((supplier) => String(supplier.id) === String(selectedSupplier.id)) || selectedSupplier : null),
    [rows, selectedSupplier],
  );
  const summary = suppliersQuery.data?.summary;
  const actions = useSuppliersPageActions({
    search,
    filterMode,
    summary,
    onBulkDeleteSuccess: () => {
      setSelectedIds([]);
      setBulkDeleteOpen(false);
      if (selectedSupplier && selectedIds.includes(String(selectedSupplier.id))) setSelectedSupplier(null);
    },
  });

  useEffect(() => {
    if (selectedSupplier && !rows.some((supplier) => String(supplier.id) === String(selectedSupplier.id))) setSelectedSupplier(null);
  }, [rows, selectedSupplier]);

  const selectedSuppliers = useMemo(() => rows.filter((supplier) => selectedIds.includes(String(supplier.id))), [rows, selectedIds]);
  const totalBalance = Number(summary?.totalBalance || 0);
  const withNotes = Number(summary?.withNotes || 0);
  const suppliersNextStep = selectedSupplier ? (canDelete ? 'المورد محدد الآن. عدّل البيانات أو احذف السجل من اللوحة الجانبية.' : 'المورد محدد الآن. راجع البيانات أو حدّثها من اللوحة الجانبية.') : rows.length ? 'اختر المورد الأنسب من النتائج لفتح بطاقة التعديل فورًا.' : 'ابدأ بالفلتر المناسب أو أضف موردًا جديدًا ثم اختره من السجل.';
  const supplierGuidanceCards = useMemo(() => ([
    { key: 'scope', label: 'ما الذي تراه الآن؟', value: filterMode === 'all' ? 'كل الموردين' : filterMode === 'debt' ? 'موردون عليهم رصيد' : 'موردون لديهم ملاحظات' },
    { key: 'next', label: 'الخطوة الأنسب الآن', value: suppliersNextStep },
    { key: 'focus', label: 'التركيز الحالي', value: selectedSupplier ? selectedSupplier.name : (search.trim() || 'سجل الموردين بالكامل') },
    { key: 'balance', label: 'المؤشر المالي الأوضح', value: selectedSupplier ? formatCurrency(selectedSupplier.balance || 0) : formatCurrency(totalBalance) },
  ]), [filterMode, search, selectedSupplier, suppliersNextStep, totalBalance]);

  function resetSuppliersView() {
    setSearch('');
    setFilterMode('all');
    setSelectedSupplier(null);
    setSelectedIds([]);
    setPage(1);
  }

  return {
    search, setSearch, selectedSupplier: activeSelectedSupplier, setSelectedSupplier, supplierToDelete, setSupplierToDelete,
    selectedIds, setSelectedIds, bulkDeleteOpen, setBulkDeleteOpen, page, setPage, pageSize, setPageSize,
    filterMode, setFilterMode, suppliersQuery, deleteMutation, canDelete, canPrint, rows, summary,
    selectedSuppliers, totalBalance, withNotes, supplierGuidanceCards, resetSuppliersView,
    ...actions,
  };
}
