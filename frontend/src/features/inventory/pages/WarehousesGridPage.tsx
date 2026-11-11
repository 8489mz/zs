import { useTranslation } from 'react-i18next';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/shared/components/page-header';
import { StatsGrid } from '@/shared/components/stats-grid';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { PackageIcon, WarehouseIcon, EditIcon, TrashIcon, ArrowLeftIcon, ClipboardIcon, TruckIcon } from '@/shared/components/icons/AppIcons';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { CustomSelect } from '@/shared/ui/custom-select';
import { systemConfirm, systemAlert } from '@/shared/components/system-alert';
import { useInventoryActionCatalog } from '@/features/inventory/hooks/useInventoryActionCatalog';
import { inventoryApi } from '@/features/inventory/api/inventory.api';
import { useCreateLocationMutation, useUpdateLocationMutation, useDeleteLocationMutation } from '@/shared/hooks/use-location-mutations';
import { formatCurrency } from '@/lib/format';
import { WarehousesNavTabs } from '@/features/inventory/components/WarehousesNavTabs';
import type { Location } from '@/types/domain';

const LOCATION_TYPE_OPTIONS = [
  { value: 'internal_warehouse', label: 'مخزن داخلي (لا يظهر كأرصدة فروع)' },
  { value: 'branch_stock', label: 'رصيد فرع (متاح للبيع)' },
  { value: 'quarantine', label: 'حجر صحي (غير متاح للبيع)' },
];

function formatLocationType(type?: string) {
  if (!type) return 'مخزن نشط';
  const map: Record<string, string> = {
    internal_warehouse: 'مخزن داخلي',
    branch_stock: 'متاح للبيع',
    store: 'معرض بيع',
    main: 'مخزن رئيسي',
    warehouse: 'مستودع',
    transit: 'مخزن ترانزيت',
    damaged: 'مخزن تالف',
    quarantine: 'حجر صحي (غير متاح للبيع)',
    van_stock: 'سيارة توزيع (فان)',
  };
  return map[type] || type;
}

export function WarehousesGridPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { locationsQuery, branchesQuery } = useInventoryActionCatalog();
  const locations = locationsQuery.data || [];

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'fixed' | 'van_stock' | 'all'>('fixed');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);

  const fixedCount = useMemo(() => locations.filter((l) => l.locationType !== 'van_stock').length, [locations]);
  const vanCount = useMemo(() => locations.filter((l) => l.locationType === 'van_stock').length, [locations]);
  const allCount = locations.length;

  // Form state
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [branchId, setBranchId] = useState('');
  const [locationType, setLocationType] = useState<'internal_warehouse' | 'branch_stock' | 'quarantine'>('internal_warehouse');

  const branchOptions = useMemo(() => [
    { value: '', label: 'بدون ربط (فرع رئيسي)' },
    ...(branchesQuery.data || []).map((b) => ({ value: String(b.id), label: b.name })),
  ], [branchesQuery.data]);

  const createMutation = useCreateLocationMutation(() => {
    setModalOpen(false);
    locationsQuery.refetch();
  });
  const updateMutation = useUpdateLocationMutation(() => {
    setModalOpen(false);
    locationsQuery.refetch();
  });
  const deleteMutation = useDeleteLocationMutation(() => {
    locationsQuery.refetch();
  });

  const { data: overviewData, isLoading: isOverviewLoading } = useQuery({
    queryKey: ['inventory', 'advanced-overview'],
    queryFn: inventoryApi.advancedOverview,
  });

  const totalValue = overviewData?.totalGlobalValue || 0;
  const avgLocationValue = locations.length > 0 ? totalValue / locations.length : 0;
  const uniqueBranches = new Set(locations.map((loc) => loc.branchName || loc.branchId).filter(Boolean)).size;

  const stats = [
    { key: 'total_value', label: 'إجمالي قيمة المخزون (Landed Cost)', value: formatCurrency(totalValue) },
    { key: 'total_locations', label: 'إجمالي أماكن المخزون', value: locations.length },
    { key: 'unique_branches', label: 'الفروع التابعة', value: uniqueBranches || 1 },
    { key: 'avg_value', label: 'متوسط قيمة المخزن', value: formatCurrency(avgLocationValue) },
  ] as const;

  const handleEdit = (loc: Location, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingLocation(loc);
    setName(loc.name);
    setCode(loc.code || '');
    setBranchId(String(loc.branchId || ''));
    setLocationType((loc as any).locationType || 'internal_warehouse');
    setModalOpen(true);
  };

  const handleCreate = () => {
    setEditingLocation(null);
    setName('');
    setCode('');
    setBranchId('');
    setLocationType('internal_warehouse');
    setModalOpen(true);
  };

  const handleDelete = async (loc: Location, e: React.MouseEvent) => {
    e.stopPropagation();
    if (loc.locationType === 'van_stock') {
      await systemAlert({
        title: 'مستودع سيارة توزيع',
        message: `المستودع "${loc.name}" مرتبط تشغيلياً بملف مندوب توزيع وأسطول الحركة ومبيعات الفان الميدانية. لحذفه أو إيقافه، يُرجى إدارة المندوب من قسم مناديب التوزيع والأسطول.`,
        variant: 'warning',
      });
      return;
    }
    const confirmed = await systemConfirm({
      title: 'حذف المخزن',
      message: `هل أنت متأكد من حذف المخزن "${loc.name}"؟`,
      confirmText: 'نعم، حذف',
      cancelText: 'إلغاء',
      variant: 'danger',
    });
    if (!confirmed) return;
    deleteMutation.mutate(String(loc.id));
  };

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingLocation) {
      updateMutation.mutate({ locationId: String(editingLocation.id), values: { name, code, branchId, locationType } });
    } else {
      createMutation.mutate({ name, code, branchId, locationType });
    }
  };

  const filteredLocations = useMemo(() => {
    let list = locations;
    if (typeFilter === 'fixed') {
      list = list.filter((l) => l.locationType !== 'van_stock');
    } else if (typeFilter === 'van_stock') {
      list = list.filter((l) => l.locationType === 'van_stock');
    }

    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter((l) => 
      l.name.toLowerCase().includes(q) || 
      (l.code && l.code.toLowerCase().includes(q)) ||
      (l.branchName && l.branchName.toLowerCase().includes(q))
    );
  }, [locations, typeFilter, search]);

  return (
    <main className="document-prototype-column" dir="rtl" style={{ paddingBottom: '32px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
      <PageHeader 
        title={t('inventory.warehouses_grid_page.s0', "أماكن المخزون")} 
        description={t('inventory.warehouses_grid_page.s1', "استعراض وإدارة أماكن التخزين والفروع ومتابعة الأرصدة والقيم المالية")} 
        actions={(
          <div className="actions compact-actions page-header-actions">
            <Button 
              variant="primary"
              onClick={handleCreate}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginInlineEnd: 6 }}><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              {t('inventory.warehouses_grid_page.s2', "إضافة مخزن جديد")}
            </Button>
            </div>
        )}
      />

      <WarehousesNavTabs currentTab="grid" />

      <StatsGrid items={stats} className="stats-grid compact-grid grid-cols-4" />

      {/* Filter / Search Bar */}
      <div className="surface-card" style={{
        padding: '12px 16px',
        marginBottom: '16px',
        borderRadius: '12px',
        boxShadow: '0 2px 6px rgba(15, 23, 42, 0.02)',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
      }}>
        {/* Type Filter Segmented Nav */}
        <div className="warehouse-filter-nav" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={typeFilter === 'fixed'}
            className={`warehouse-filter-btn ${typeFilter === 'fixed' ? 'warehouse-filter-btn--active' : ''}`}
            onClick={() => setTypeFilter('fixed')}
          >
            <WarehouseIcon size={15} />
            <span>{t('inventory.warehouses_grid_page.filter_fixed', "المستودعات والفروع")}</span>
            <span className="warehouse-filter-badge">{fixedCount}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={typeFilter === 'van_stock'}
            className={`warehouse-filter-btn ${typeFilter === 'van_stock' ? 'warehouse-filter-btn--active' : ''}`}
            onClick={() => setTypeFilter('van_stock')}
          >
            <TruckIcon size={15} />
            <span>{t('inventory.warehouses_grid_page.filter_van', "سيارات التوزيع والمناديب")}</span>
            <span className="warehouse-filter-badge">{vanCount}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={typeFilter === 'all'}
            className={`warehouse-filter-btn ${typeFilter === 'all' ? 'warehouse-filter-btn--active' : ''}`}
            onClick={() => setTypeFilter('all')}
          >
            <PackageIcon size={15} />
            <span>{t('inventory.warehouses_grid_page.filter_all', "كافة الأماكن")}</span>
            <span className="warehouse-filter-badge">{allCount}</span>
          </button>
        </div>

        {/* Search Input */}
        <div style={{ flex: '1 1 280px', maxWidth: '380px', minWidth: '220px' }}>
          <input
            type="text"
            placeholder={t('inventory.warehouses_grid_page.s4', "ابحث باسم المخزن أو الكود أو الفرع...")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid var(--border, #cbd5e1)',
              fontSize: '13px',
              boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      <section className="document-prototype-section">
        <div className="section-header-compact-row">
          <h3 className="document-prototype-section-title">{t('inventory.warehouses_grid_page.s5', "قائمة أماكن المخزون")}</h3>
          <div className="section-header-actions-group">
            <span className="nav-pill" style={{ fontSize: '11px', padding: '2px 8px' }}>
              {typeFilter === 'van_stock' 
                ? t('inventory.warehouses_grid_page.van_locations_count', "سيارات التوزيع:") 
                : typeFilter === 'fixed'
                ? t('inventory.warehouses_grid_page.fixed_locations_count', "المستودعات والفروع:")
                : t('inventory.warehouses_grid_page.s6', "إجمالي الأماكن:")} {filteredLocations.length}
            </span>
          </div>
        </div>

        {locationsQuery.isLoading || isOverviewLoading ? (
          <div className="muted small" style={{ padding: 32, textAlign: 'center' }}>{t('inventory.warehouses_grid_page.s7', "جاري تحميل المخازن...")}</div>
        ) : filteredLocations.length === 0 ? (
          <div className="muted small" style={{ padding: 32, textAlign: 'center' }}>
            {typeFilter === 'van_stock'
              ? t('inventory.warehouses_grid_page.no_vans_found', "لا توجد سيارات توزيع مطابقة")
              : typeFilter === 'fixed'
              ? t('inventory.warehouses_grid_page.no_fixed_found', "لا توجد مستودعات ثابتة مطابقة")
              : t('inventory.warehouses_grid_page.s8', "لا توجد مخازن مطابقة للبحث")}
          </div>
        ) : (
          <div className="warehouses-locations-grid">
            {filteredLocations.map((loc) => {
              const locInfo = overviewData?.locations?.find((l: any) => String(l.id) === String(loc.id));
              const locValue = locInfo?.totalValue || 0;
              const productCount = locInfo?.categories?.reduce((sum: number, c: any) => sum + (c.productCount || 0), 0) || 0;

              return (
                <div 
                  key={loc.id} 
                  className="surface-card hoverable-card warehouse-compact-card"
                  onClick={() => navigate(`/inventory/warehouses/${loc.id}`)}
                >
                  <div className="warehouse-card-top-row">
                    <div className="warehouse-card-identity">
                      <div 
                        className="warehouse-card-icon"
                        style={loc.locationType === 'van_stock' ? {
                          backgroundColor: '#f5f3ff',
                          borderColor: '#ddd6fe',
                        } : undefined}
                      >
                        {loc.locationType === 'van_stock' ? (
                          <TruckIcon size={20} color="#6d28d9" />
                        ) : (
                          <WarehouseIcon size={20} color="#170e5e" />
                        )}
                      </div>
                      <div className="warehouse-card-titles">
                        <div className="warehouse-card-title-row">
                          <h3 className="warehouse-card-title" title={loc.name}>{loc.name}</h3>
                        </div>
                        <div className="warehouse-card-subtitle-row">
                          <span className="warehouse-card-branch-name">
                            {loc.branchName ? `الفرع: ${loc.branchName}` : loc.code ? `كود: ${loc.code}` : t('inventory.warehouses_grid_page.s9', "موقع رئيسي")}
                          </span>
                          <span className={`warehouse-type-badge ${
                            loc.locationType === 'branch_stock' 
                              ? 'badge-branch-sale' 
                              : loc.locationType === 'van_stock'
                              ? 'badge-van-stock'
                              : 'badge-internal-stock'
                          }`}>
                            {formatLocationType(loc.locationType)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="warehouse-card-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={(e) => handleEdit(loc, e)}
                        title={t('inventory.warehouses_grid_page.s10', "تعديل المخزن")}
                        className="warehouse-action-btn edit-btn"
                      >
                        <EditIcon size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDelete(loc, e)}
                        title={loc.locationType === 'van_stock' 
                          ? t('inventory.warehouses_grid_page.van_delete_notice', "مستودع سيارة مرتبط بالمناديب والأسطول") 
                          : t('inventory.warehouses_grid_page.s11', "حذف المخزن")}
                        className="warehouse-action-btn delete-btn"
                        style={loc.locationType === 'van_stock' ? { opacity: 0.55 } : undefined}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="warehouse-card-bottom-row">
                    <div className="warehouse-card-metrics">
                      <div className="warehouse-count-pill">
                        <PackageIcon size={12} color="#64748b" />
                        <span>{productCount} {t('inventory.warehouses_grid_page.s12', "أصناف")}</span>
                      </div>
                      <div className="warehouse-value-amount">
                        {formatCurrency(locValue)}
                      </div>
                    </div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }} onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => navigate(`/inventory/counts?locationId=${loc.id}`)}
                        title={t('inventory.warehouses_grid_page.count_btn_title', "بدء جرد هذا المخزن")}
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          color: '#170e5e',
                          backgroundColor: '#eef2ff',
                          border: '1px solid #c7d2fe',
                          borderRadius: '6px',
                          padding: '3px 8px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          cursor: 'pointer',
                        }}
                      >
                        <ClipboardIcon size={12} />
                        <span>{t('inventory.warehouses_grid_page.count_btn', "جرد")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(`/inventory/issue-order/new?fromLocationId=${loc.id}`)}
                        title={t('inventory.warehouses_grid_page.transfer_btn_title', "إذن صرف أو تحويل من هذا المخزن")}
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          color: '#047857',
                          backgroundColor: '#ecfdf5',
                          border: '1px solid #a7f3d0',
                          borderRadius: '6px',
                          padding: '3px 8px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          cursor: 'pointer',
                        }}
                      >
                        <TruckIcon size={12} />
                        <span>{t('inventory.warehouses_grid_page.transfer_btn', "صرف وتحويل")}</span>
                      </button>
                      <div className="warehouse-details-link" style={{ marginInlineStart: '4px' }}>
                        <span>{t('inventory.warehouses_grid_page.s13', "عرض الأصناف")}</span>
                        <ArrowLeftIcon size={14} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Dialog for Create/Edit Location */}
      <StandardDialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingLocation ? t('inventory.warehouses_grid_page.s14', "تعديل بيانات المخزن") : t('inventory.warehouses_grid_page.s15', "إضافة مخزن جديد")}
        subtitle={t('inventory.warehouses_grid_page.s16', "إدارة بيانات وتصنيف المخزن والفرع التابع له")}
        size="md"
        footerActions={
          <StandardDialogFooter
            onCancel={() => setModalOpen(false)}
            cancelLabel={t('inventory.warehouses_grid_page.s17', "إلغاء")}
            primaryLabel={editingLocation ? t('inventory.warehouses_grid_page.s18', "حفظ التعديلات") : t('inventory.warehouses_grid_page.s19', "إضافة المخزن")}
            onPrimary={() => {
              const form = document.getElementById('location-form') as HTMLFormElement | null;
              if (form) form.requestSubmit();
            }}
            isPrimaryLoading={createMutation.isPending || updateMutation.isPending}
            isPrimaryDisabled={createMutation.isPending || updateMutation.isPending || !name.trim()}
          />
        }
      >
        <form onSubmit={onSave} className="form-grid single-col" id="location-form" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Field label={t('inventory.warehouses_grid_page.s20', "اسم المخزن")}>
            <input required value={name} onChange={(e) => setName(e.target.value)} disabled={createMutation.isPending || updateMutation.isPending} placeholder={t('inventory.warehouses_grid_page.s21', "مثال: المخزن الرئيسي")} />
          </Field>
          <Field label={t('inventory.warehouses_grid_page.s22', "كود المخزن")}>
            <input value={code} onChange={(e) => setCode(e.target.value)} disabled={createMutation.isPending || updateMutation.isPending} placeholder={t('inventory.warehouses_grid_page.s23', "اختياري")} />
          </Field>
          <Field label={t('inventory.warehouses_grid_page.s24', "الفرع المرتبط")}>
            <CustomSelect
              value={branchId}
              onChange={(val) => setBranchId(val)}
              options={branchOptions}
              disabled={createMutation.isPending || updateMutation.isPending}
              placeholder={t('inventory.warehouses_grid_page.s25', "اختر الفرع المرتبط")}
            />
          </Field>
          <Field label={t('inventory.warehouses_grid_page.s26', "نوع المخزن")}>
            <CustomSelect
              value={locationType}
              onChange={(val) => setLocationType(val as 'internal_warehouse' | 'branch_stock' | 'quarantine')}
              options={LOCATION_TYPE_OPTIONS}
              disabled={createMutation.isPending || updateMutation.isPending}
              placeholder={t('inventory.warehouses_grid_page.s27', "اختر نوع المخزن")}
            />
          </Field>
        </form>
      </StandardDialog>
    </main>
  );
}
