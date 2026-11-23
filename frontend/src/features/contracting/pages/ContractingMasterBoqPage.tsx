import { useTranslation } from 'react-i18next';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAppToolbar } from '@/stores/toolbar-store';
import { contractingApi } from '../api/contracting.api';
import { MasterBoqItem, MasterBoqTrade } from '../contracting.types';
import { downloadExcelFile } from '@/lib/browser';
import { systemConfirm } from '@/shared/components/system-alert';
import { normalizeTradeCategory, SECTORS, TRADE_ICONS } from './contracting-master-boq-page/contracting-master-boq-shared';
import { ContractingMasterBoqPageHeader } from './contracting-master-boq-page/contracting-master-boq-page-header';
import { ContractingMasterBoqNotification } from './contracting-master-boq-page/contracting-master-boq-notification';
import { ContractingMasterBoqKpiCards } from './contracting-master-boq-page/contracting-master-boq-kpi-cards';
import { ContractingMasterBoqActionsSearch } from './contracting-master-boq-page/contracting-master-boq-actions-search';
import { ContractingMasterBoqSectorTradeFilters } from './contracting-master-boq-page/contracting-master-boq-sector-trade-filters';
import { ContractingMasterBoqTableActionBar } from './contracting-master-boq-page/contracting-master-boq-table-action-bar';
import { ContractingMasterBoqTable } from './contracting-master-boq-page/contracting-master-boq-table';
import { ContractingMasterBoqCreateEditModal } from './contracting-master-boq-page/contracting-master-boq-create-edit-modal';
import { ContractingMasterBoqExcelImportModal } from './contracting-master-boq-page/contracting-master-boq-excel-import-modal';
export { normalizeTradeCategory } from './contracting-master-boq-page/contracting-master-boq-shared';


export function ContractingMasterBoqPage() {
  const { t: __t } = useTranslation();
  useAppToolbar([
    { label: 'الرئيسية', to: '/dashboard' },
    { label: 'المقاولات والمشاريع', to: '/contracting' },
    { label: 'إعدادات وبنك بنود المقاولات', to: '/contracting/master-boq' },
  ]);

  const [trades, setTrades] = useState<MasterBoqTrade[]>([]);
  const [selectedSector, setSelectedSector] = useState<string>('all');
  const [selectedTrade, setSelectedTrade] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'all' | 'inactive'>('active');
  const [allItems, setAllItems] = useState<MasterBoqItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isExcelImportModalOpen, setIsExcelImportModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MasterBoqItem | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Load trades on mount
  const loadTrades = useCallback(async () => {
    try {
      const data = await contractingApi.getMasterBoqTrades();
      setTrades(data || []);
    } catch (err) {
      console.error('Failed to load trades:', err);
    }
  }, []);

  // Load all items for the selected status filter
  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await contractingApi.getMasterBoqLibrary({
        status: statusFilter,
      });
      setAllItems(data || []);
    } catch (err) {
      console.error('Failed to load master BOQ items:', err);
      setNotification({ type: 'error', text: 'تعذر تحميل بنك البنود المرجعي' });
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadTrades();
  }, [loadTrades]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleDeleteItem = async (item: MasterBoqItem) => {
    const isCustom = item.isCustom;
    const confirmed = await systemConfirm({
      title: isCustom ? 'حذف البند المخصص' : 'استبعاد البند من مكتبة الشركة',
      message: isCustom
        ? `هل أنت متأكد من حذف البند المخصص "${item.name}" نهائياً من بنك البنود؟`
        : `هل أنت متأكد من استبعاد وإخفاء البند القياسي "${item.name}" من مكتبة بنود الشركة؟ (يمكنك استعادته في أي وقت).`,
      confirmText: isCustom ? 'نعم، احذف البند' : 'نعم، استبعد البند',
      variant: isCustom ? 'danger' : 'warning',
    });
    if (!confirmed) return;

    setActioningId(item.id);
    try {
      const res = await contractingApi.deleteMasterBoqItem(item.id);
      setNotification({ type: 'success', text: res.message || 'تم تحديث حالة البند بنجاح' });
      loadItems();
      loadTrades();
    } catch (err: any) {
      setNotification({ type: 'error', text: err?.message || 'تعذر إجراء العملية على البند المرجعي' });
    } finally {
      setActioningId(null);
    }
  };

  const handleToggleItemStatus = async (item: MasterBoqItem, targetActive: boolean) => {
    setActioningId(item.id);
    try {
      await contractingApi.toggleMasterBoqItemStatus(item.id, targetActive);
      setNotification({
        type: 'success',
        text: targetActive ? `تمت إعادة تفعيل البند "${item.name}" بنجاح` : `تم استبعاد البند "${item.name}" من العرض`,
      });
      loadItems();
      loadTrades();
    } catch (err: any) {
      setNotification({ type: 'error', text: err?.message || 'تعذر تغيير حالة تفعيل البند' });
    } finally {
      setActioningId(null);
    }
  };

  // Canonical order of trades for construction sequence
  const CANONICAL_ORDER = useMemo(
    () => [
      'site_mobilization',
      'civil_concrete',
      'masonry_insulation',
      'steel_structure',
      'finishing_decor',
      'doors_windows_aluminum',
      'electrical_lighting',
      'smart_elv_systems',
      'plumbing_sanitary',
      'hvac_mechanical',
      'fire_fighting',
      'site_infrastructure',
    ],
    []
  );

  // Unique trades list with aggregated counts and canonical sorting
  const uniqueTrades = useMemo(() => {
    const map = new Map<string, { tradeCategory: string; tradeNameAr: string; itemsCount: number }>();
    for (const it of allItems) {
      const norm = normalizeTradeCategory(it.tradeCategory);
      if (!map.has(norm)) {
        const matchingTrade = trades.find((t) => normalizeTradeCategory(t.tradeCategory) === norm);
        map.set(norm, {
          tradeCategory: norm,
          tradeNameAr: matchingTrade?.tradeNameAr || it.tradeNameAr || norm,
          itemsCount: 1,
        });
      } else {
        map.get(norm)!.itemsCount += 1;
      }
    }
    const list = Array.from(map.values());
    return list.sort((a, b) => {
      const idxA = CANONICAL_ORDER.indexOf(a.tradeCategory);
      const idxB = CANONICAL_ORDER.indexOf(b.tradeCategory);
      return (idxA >= 0 ? idxA : 99) - (idxB >= 0 ? idxB : 99);
    });
  }, [allItems, trades, CANONICAL_ORDER]);

  // Sector counts computed directly from allItems for 100% mathematical accuracy
  const sectorCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: allItems.length,
    };
    for (const sec of SECTORS) {
      if (sec.id === 'all') continue;
      counts[sec.id] = allItems.filter(
        (it) =>
          sec.tradeCategories.includes(normalizeTradeCategory(it.tradeCategory)) ||
          sec.tradeCategories.includes(it.tradeCategory)
      ).length;
    }
    return counts;
  }, [allItems]);

  // Filtered trades by sector
  const visibleTrades = useMemo(() => {
    if (selectedSector === 'all') {
      return uniqueTrades;
    }
    const sec = SECTORS.find((s) => s.id === selectedSector);
    if (!sec) return uniqueTrades;
    return uniqueTrades.filter(
      (t) =>
        sec.tradeCategories.includes(normalizeTradeCategory(t.tradeCategory)) ||
        sec.tradeCategories.includes(t.tradeCategory)
    );
  }, [uniqueTrades, selectedSector]);

  // Instant in-memory filtering: 0ms latency, zero flicker, zero empty-state collapse
  const filteredItems = useMemo(() => {
    let result = allItems;
    if (selectedTrade !== 'all') {
      result = result.filter(
        (it) =>
          normalizeTradeCategory(it.tradeCategory) === selectedTrade ||
          it.tradeCategory === selectedTrade
      );
    } else if (selectedSector !== 'all') {
      const sec = SECTORS.find((s) => s.id === selectedSector);
      if (sec) {
        result = result.filter(
          (it) =>
            sec.tradeCategories.includes(normalizeTradeCategory(it.tradeCategory)) ||
            sec.tradeCategories.includes(it.tradeCategory)
        );
      }
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (it) =>
          it.itemCode?.toLowerCase().includes(q) ||
          it.name?.toLowerCase().includes(q) ||
          it.description?.toLowerCase().includes(q) ||
          it.tradeNameAr?.toLowerCase().includes(q) ||
          normalizeTradeCategory(it.tradeCategory).includes(q)
      );
    }
    return result;
  }, [allItems, selectedSector, selectedTrade, search]);

  // KPIs
  const totalItemsCount = allItems.length;
  const customItemsCount = allItems.filter((i) => i.isCustom).length;
  const totalTradesCount = uniqueTrades.length;

  const avgMargin = useMemo(() => {
    if (allItems.length === 0) return 0;
    const margins = allItems
      .filter((i) => Number(i.standardPrice) > 0 && Number(i.standardCost) > 0)
      .map((i) => ((Number(i.standardPrice) - Number(i.standardCost)) / Number(i.standardPrice)) * 100);
    if (margins.length === 0) return 0;
    return Math.round(margins.reduce((a, b) => a + b, 0) / margins.length);
  }, [allItems]);

  const handleExportExcel = () => {
    if (filteredItems.length === 0) return;
    const headers = [
      'كود البند',
      'التخصص',
      'مسمى البند',
      'بيان الأعمال والمواصفات',
      'الوحدة',
      'التكلفة المرجعية',
      'سعر البيع',
      'هامش الربح التقديري (%)',
      'نوع البند',
      'الحالة',
    ];
    const rows = filteredItems.map((i) => {
      const price = Number(i.standardPrice) || 0;
      const cost = Number(i.standardCost) || 0;
      const margin = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;
      return [
        i.itemCode,
        i.tradeNameAr || i.tradeCategory,
        i.name,
        i.description,
        i.unit,
        cost,
        price,
        `${margin}%`,
        i.isCustom ? 'مخصص للشركة' : 'نظام قياسي',
        i.isActive ? 'نشط' : 'معطل ومخفي',
      ];
    });
    downloadExcelFile(
      `بنك_بنود_المقاولات_المرجعي_${new Date().toISOString().slice(0, 10)}.xlsx`,
      headers,
      rows,
    );
  };

  return (
    <div className="page-stack page-shell contracting-page" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '80px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
        <ContractingMasterBoqPageHeader
          __t={__t}
          setIsExcelImportModalOpen={setIsExcelImportModalOpen}
          handleExportExcel={handleExportExcel}
          filteredItems={filteredItems}
          loadItems={loadItems}
          loadTrades={loadTrades}
          loading={loading}
        />

        <ContractingMasterBoqNotification
          notification={notification}
          setNotification={setNotification}
        />

        <ContractingMasterBoqKpiCards
          __t={__t}
          totalItemsCount={totalItemsCount}
          totalTradesCount={totalTradesCount}
          customItemsCount={customItemsCount}
          avgMargin={avgMargin}
        />

        <ContractingMasterBoqActionsSearch
          __t={__t}
          search={search}
          setSearch={setSearch}
          setStatusFilter={setStatusFilter}
          statusFilter={statusFilter}
          filteredItems={filteredItems}
        />

        <ContractingMasterBoqSectorTradeFilters
          __t={__t}
          SECTORS={SECTORS}
          selectedSector={selectedSector}
          sectorCounts={sectorCounts}
          setSelectedSector={setSelectedSector}
          setSelectedTrade={setSelectedTrade}
          selectedTrade={selectedTrade}
          allItems={allItems}
          visibleTrades={visibleTrades}
          TRADE_ICONS={TRADE_ICONS}
        />

        <ContractingMasterBoqTableActionBar
          __t={__t}
          setEditingItem={setEditingItem}
          setIsCreateModalOpen={setIsCreateModalOpen}
        />

        <ContractingMasterBoqTable
          loading={loading}
          __t={__t}
          filteredItems={filteredItems}
          actioningId={actioningId}
          setEditingItem={setEditingItem}
          setIsCreateModalOpen={setIsCreateModalOpen}
          handleDeleteItem={handleDeleteItem}
          handleToggleItemStatus={handleToggleItemStatus}
        />

        <ContractingMasterBoqCreateEditModal
          isCreateModalOpen={isCreateModalOpen}
          editingItem={editingItem}
          trades={trades}
          allItems={allItems}
          selectedTrade={selectedTrade}
          setIsCreateModalOpen={setIsCreateModalOpen}
          setEditingItem={setEditingItem}
          loadItems={loadItems}
          loadTrades={loadTrades}
          setNotification={setNotification}
          __t={__t}
        />

        <ContractingMasterBoqExcelImportModal
          isExcelImportModalOpen={isExcelImportModalOpen}
          trades={trades}
          setIsExcelImportModalOpen={setIsExcelImportModalOpen}
          loadItems={loadItems}
          loadTrades={loadTrades}
          setNotification={setNotification}
          __t={__t}
        />
      </main>
    </div>
  );
}
