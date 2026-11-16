import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppToolbar } from '@/stores/toolbar-store';
import { PageHeader } from '@/shared/components/page-header';
import { StatsGrid } from '@/shared/components/stats-grid';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { pharmacyApi } from '@/features/pharmacy/api/pharmacy.api';
import { inventoryApi } from '@/shared/api/inventory.api';
import type { PharmacyBatch } from '@/features/pharmacy/types/pharmacy.types';
import { PackageIcon, PlusIcon } from '@/shared/components/icons/AppIcons';

const BATCH_STATUS_OPTIONS = [
  { value: 'active', label: 'صالحة ونشطة' },
  { value: 'near_expiry', label: 'وشيكة الانتهاء' },
  { value: 'expired', label: 'منتهية الصلاحية' },
  { value: 'returned', label: 'مرتجعة للشركة' },
];

export function InventoryBatchesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  useAppToolbar([
    { label: 'المخزون والمستودعات', to: '/inventory' },
    { label: 'إدارة التشغيلات وتواريخ الصلاحية' },
  ]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  // INV-VAN-GENERIC-FEFO: second tab lists the generic batch ledger
  // (inventory_batches). Pharmacy tab behavior is unchanged; generic
  // batches are born at intake only, so the add/edit modal stays
  // pharmacy-only.
  const [tab, setTab] = useState<'pharmacy' | 'generic'>('pharmacy');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingBatch, setEditingBatch] = useState<Partial<PharmacyBatch> | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'batches', tab, searchQuery, statusFilter, page],
    queryFn: () =>
      tab === 'generic'
        ? inventoryApi.listInventoryBatches({
            q: searchQuery,
            status: statusFilter,
            page,
            pageSize: 20,
          })
        : pharmacyApi.listBatches({
            q: searchQuery,
            status: statusFilter,
            page,
            pageSize: 20,
          }),
  });

  const upsertMutation = useMutation({
    mutationFn: pharmacyApi.upsertBatch,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'batches'] });
      queryClient.invalidateQueries({ queryKey: ['pharmacy', 'batches'] });
      setModalOpen(false);
      setEditingBatch(null);
    },
  });

  const totalItems = data?.pagination?.totalItems || (data?.batches?.length || 0);
  const batchesList = (data?.batches || []) as Array<PharmacyBatch & { product_name?: string; product_barcode?: string }>;

  const activeCount = batchesList.filter((b) => b.status === 'active').length;
  const nearExpiryCount = batchesList.filter((b) => b.status === 'near_expiry').length;
  const expiredCount = batchesList.filter((b) => b.status === 'expired').length;
  const returnedCount = batchesList.filter((b) => b.status === 'returned').length;

  const handleOpenAdd = () => {
    setEditingBatch({
      batch_number: '',
      expiry_date: '',
      quantity: 1,
      unit_cost: 0,
      supplier_name: '',
      status: 'active',
      notes: '',
    });
    setModalOpen(true);
  };

  const handleSetQuickExpiry = (monthsAhead: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() + monthsAhead);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    setEditingBatch((prev) => ({ ...prev, expiry_date: `${yyyy}-${mm}` }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBatch || !editingBatch.batch_number || !editingBatch.expiry_date) return;
    upsertMutation.mutate(editingBatch);
  };

  return (
    <div className="page-stack page-shell inventory-batches-page" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '100px', width: '100%' }}>
        <PageHeader
          title={t('inventory.inventory_batches_page.s0', "إدارة التشغيلات وتواريخ الصلاحية (Lots & Expiration)")}
          description={t('inventory.inventory_batches_page.s1', "تتبع أرقام التشغيلات (Batches)، تواريخ الصلاحية، وأرصدة الدفعات عبر المستودعات لجميع الأصناف")}
          badge={<span className="nav-pill">{totalItems} {t('inventory.inventory_batches_page.s2', "تشغيلة مسجلة")}</span>}
          actions={
            <div className="actions compact-actions page-header-actions">
              {tab === 'pharmacy' && (
                <Button type="button" onClick={handleOpenAdd} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <PlusIcon size={16} />
                  <span>{t('inventory.inventory_batches_page.s3', "إضافة تشغيلة جديدة")}</span>
                </Button>
              )}
            </div>
          }
        />

        {/* KPI Summary Cards */}
        <div style={{ marginBottom: '16px' }}>
          <StatsGrid
            items={[
              {
                key: 'total',
                label: t('inventory.inventory_batches_page.s4', "إجمالي التشغيلات"),
                value: `${totalItems} تشغيلة`,
              },
              {
                key: 'active',
                label: t('inventory.inventory_batches_page.s5', "تشغيلات صالحة ونشطة"),
                value: `${activeCount} صالحة`,
              },
              {
                key: 'near-expiry',
                label: t('inventory.inventory_batches_page.s6', "وشيكة الانتهاء (≤ 60 يوم)"),
                value: `${nearExpiryCount} وشيكة`,
              },
              {
                key: 'expired',
                label: t('inventory.inventory_batches_page.s7', "منتهية الصلاحية"),
                value: `${expiredCount} منتهية`,
              },
              {
                key: 'returned',
                label: t('inventory.inventory_batches_page.s8', "مرتجعة للمورد"),
                value: `${returnedCount} مرتجعة`,
              },
            ]}
          />
        </div>

        {/* Main Workspace Panel */}
        <section className="document-prototype-section workspace-panel">
          <div className="section-header-compact-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h2 className="document-prototype-section-title" style={{ margin: 0 }}>{t('inventory.inventory_batches_page.s9', "سجل تشغيلات المخزون وتواريخ الصلاحية")}</h2>
              <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#64748b' }}>{t('inventory.inventory_batches_page.s10', "تتبع أرقام التشغيلات، الدفعات، وأرصدة المستودعات")}</p>
            </div>
          </div>

          {/* INV-VAN-GENERIC-FEFO: ledger tabs — pharmacy batches vs
              generic (non-drug) batches. Generic batches are born at
              intake only; the add/edit modal stays pharmacy-only. */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <Button
              type="button"
              variant={tab === 'pharmacy' ? 'primary' : 'secondary'}
              onClick={() => { setTab('pharmacy'); setPage(1); }}
            >
              {t('inventory.inventory_batches_page.s53', "تشغيلات الأدوية")}
            </Button>
            <Button
              type="button"
              variant={tab === 'generic' ? 'primary' : 'secondary'}
              onClick={() => { setTab('generic'); setPage(1); }}
            >
              {t('inventory.inventory_batches_page.s54', "تشغيلات عامة")}
            </Button>
          </div>

          {/* Filter and Search Bar */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '16px', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '10px', flex: 1, minWidth: '280px' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                placeholder={t('inventory.inventory_batches_page.s11', "بحث برقم التشغيلة، اسم الصنف، الباركود، أو المورد...")}
                style={{ width: '100%', padding: '8px 12px', fontSize: '0.85rem', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          <div style={{ width: '200px' }}>
            <CustomSelect
              value={statusFilter}
              onChange={(val) => { setStatusFilter(val); setPage(1); }}
              options={[
                { value: 'all', label: t('inventory.inventory_batches_page.s12', "جميع الحالات") },
                { value: 'active', label: t('inventory.inventory_batches_page.s13', "صالحة ونشطة") },
                { value: 'near_expiry', label: t('inventory.inventory_batches_page.s14', "وشيكة الانتهاء") },
                { value: 'expired', label: t('inventory.inventory_batches_page.s15', "منتهية الصلاحية") },
                { value: 'returned', label: t('inventory.inventory_batches_page.s16', "مرتجعة للمورد") },
              ]}
            />
          </div>
        </div>

        {/* Table Container */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
          {isLoading ? (
            <div style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>{t('inventory.inventory_batches_page.s17', "جارٍ تحميل التشغيلات...")}</div>
          ) : batchesList.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
              <PackageIcon size={32} color="#94a3b8" style={{ margin: '0 auto 8px auto', display: 'block' }} />
              <div>{t('inventory.inventory_batches_page.s18', "لا توجد تشغيلات مسجلة تطابق معايير البحث.")}</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'right' }}>
                <thead style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  <tr>
                    <th style={{ padding: '10px 14px', color: '#475569' }}>{t('inventory.inventory_batches_page.s19', "رقم التشغيلة")}</th>
                    <th style={{ padding: '10px 14px', color: '#475569' }}>{t('inventory.inventory_batches_page.s20', "اسم الصنف")}</th>
                    <th style={{ padding: '10px 14px', color: '#475569' }}>{t('inventory.inventory_batches_page.s21', "الباركود")}</th>
                    <th style={{ padding: '10px 14px', color: '#475569' }}>{t('inventory.inventory_batches_page.s22', "تاريخ الصلاحية")}</th>
                    <th style={{ padding: '10px 14px', color: '#475569' }}>{t('inventory.inventory_batches_page.s23', "الرصيد المتاح")}</th>
                    <th style={{ padding: '10px 14px', color: '#475569' }}>{t('inventory.inventory_batches_page.s24', "تكلفة الوحدة")}</th>
                    <th style={{ padding: '10px 14px', color: '#475569' }}>{t('inventory.inventory_batches_page.s25', "المورد")}</th>
                    <th style={{ padding: '10px 14px', color: '#475569' }}>{t('inventory.inventory_batches_page.s26', "الحالة")}</th>
                    <th style={{ padding: '10px 14px', color: '#475569' }}>{t('inventory.inventory_batches_page.s27', "إجراء")}</th>
                  </tr>
                </thead>
                <tbody>
                  {batchesList.map((batch) => {
                    const isExp = batch.status === 'expired';
                    const isNear = batch.status === 'near_expiry';
                    const isRet = batch.status === 'returned';

                    let statusBg = '#f0fdf4';
                    let statusColor = '#166534';
                    let statusLabel = t('inventory.inventory_batches_page.s28', "صالحة ونشطة");

                    if (isExp) {
                      statusBg = '#fef2f2';
                      statusColor = '#991b1b';
                      statusLabel = t('inventory.inventory_batches_page.s29', "منتهية الصلاحية");
                    } else if (isNear) {
                      statusBg = '#fffbeb';
                      statusColor = '#92400e';
                      statusLabel = t('inventory.inventory_batches_page.s30', "وشيكة الانتهاء");
                    } else if (isRet) {
                      statusBg = '#f1f5f9';
                      statusColor = '#475569';
                      statusLabel = t('inventory.inventory_batches_page.s31', "مرتجعة");
                    }

                    return (
                      <tr key={batch.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 14px', fontWeight: 700, fontFamily: 'monospace' }}>{batch.batch_number}</td>
                        <td style={{ padding: '10px 14px', fontWeight: 600 }}>{batch.product_name || '—'}</td>
                        <td style={{ padding: '10px 14px', color: '#64748b', fontFamily: 'monospace' }}>{batch.product_barcode || '—'}</td>
                        <td style={{ padding: '10px 14px', fontFamily: 'monospace', direction: 'ltr', textAlign: 'left' }}>
                          <span style={{ fontWeight: 600, color: isExp ? '#dc2626' : isNear ? '#d97706' : '#0f172a' }}>
                            {batch.expiry_date || '—'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', fontWeight: 700 }}>{Number(batch.quantity || 0).toLocaleString()}</td>
                        <td style={{ padding: '10px 14px' }}>{Number(batch.unit_cost || 0).toFixed(2)}</td>
                        <td style={{ padding: '10px 14px', color: '#64748b' }}>{batch.supplier_name || '—'}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600, background: statusBg, color: statusColor }}>
                            {statusLabel}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          {tab === 'pharmacy' ? (
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => { setEditingBatch(batch); setModalOpen(true); }}
                              style={{ padding: '3px 8px', fontSize: '0.75rem' }}
                            >
                              {t('inventory.inventory_batches_page.s32', "تعديل")}
                            </Button>
                          ) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

        {/* Add/Edit Modal */}
        <StandardDialog
          open={Boolean(modalOpen && editingBatch)}
          onClose={() => setModalOpen(false)}
          title={editingBatch?.id ? `تعديل التشغيلة #${editingBatch.batch_number}` : t('inventory.inventory_batches_page.s33', "إضافة تشغيلة جديدة للمستودع")}
          subtitle={t('inventory.inventory_batches_page.s34', "تحديد رقم التشغيلة وتاريخ انتهاء الصلاحية والكميات المستودعية")}
          size="md"
          footerActions={
            <StandardDialogFooter
              onCancel={() => setModalOpen(false)}
              cancelLabel={t('inventory.inventory_batches_page.s35', "إلغاء")}
              primaryLabel={upsertMutation.isPending ? t('inventory.inventory_batches_page.s36', "جاري الحفظ...") : t('inventory.inventory_batches_page.s37', "حفظ بيانات التشغيلة")}
              onPrimary={() => {
                const form = document.getElementById('batch-form') as HTMLFormElement | null;
                if (form) form.requestSubmit();
              }}
              isPrimaryLoading={upsertMutation.isPending}
              isPrimaryDisabled={upsertMutation.isPending}
            />
          }
        >
          {editingBatch && (
            <form id="batch-form" onSubmit={handleSave} dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    {t('inventory.inventory_batches_page.s38', "رقم التشغيلة (Batch / Lot No) *")}
                  </label>
                  <input
                    value={editingBatch.batch_number || ''}
                    onChange={(e) => setEditingBatch((prev) => ({ ...prev, batch_number: e.target.value.toUpperCase() }))}
                    placeholder={t('inventory.inventory_batches_page.s39', "مثال: LOT-2026-X1")}
                    dir="ltr"
                    required
                    style={{ width: '100%', padding: '7px 10px', fontSize: '0.85rem', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    {t('inventory.inventory_batches_page.s40', "تاريخ الصلاحية (YYYY-MM أو YYYY-MM-DD) *")}
                  </label>
                  <input
                    value={editingBatch.expiry_date || ''}
                    onChange={(e) => setEditingBatch((prev) => ({ ...prev, expiry_date: e.target.value }))}
                    placeholder="YYYY-MM"
                    dir="ltr"
                    required
                    style={{ width: '100%', padding: '7px 10px', fontSize: '0.85rem', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box' }}
                  />
                  <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                    <button type="button" onClick={() => handleSetQuickExpiry(3)} style={{ fontSize: '0.7rem', padding: '2px 6px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '4px', cursor: 'pointer' }}>{t('inventory.inventory_batches_page.s41', "+3 أشهر")}</button>
                    <button type="button" onClick={() => handleSetQuickExpiry(6)} style={{ fontSize: '0.7rem', padding: '2px 6px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '4px', cursor: 'pointer' }}>{t('inventory.inventory_batches_page.s42', "+6 أشهر")}</button>
                    <button type="button" onClick={() => handleSetQuickExpiry(12)} style={{ fontSize: '0.7rem', padding: '2px 6px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '4px', cursor: 'pointer' }}>{t('inventory.inventory_batches_page.s43', "+سنة")}</button>
                    <button type="button" onClick={() => handleSetQuickExpiry(24)} style={{ fontSize: '0.7rem', padding: '2px 6px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '4px', cursor: 'pointer' }}>{t('inventory.inventory_batches_page.s44', "+سنتين")}</button>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    {t('inventory.inventory_batches_page.s45', "الكمية الرصيد *")}
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={editingBatch.quantity ?? 1}
                    onChange={(e) => setEditingBatch((prev) => ({ ...prev, quantity: Number(e.target.value) }))}
                    required
                    style={{ width: '100%', padding: '7px 10px', fontSize: '0.85rem', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    {t('inventory.inventory_batches_page.s46', "تكلفة الوحدة (Unit Cost)")}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editingBatch.unit_cost ?? 0}
                    onChange={(e) => setEditingBatch((prev) => ({ ...prev, unit_cost: Number(e.target.value) }))}
                    style={{ width: '100%', padding: '7px 10px', fontSize: '0.85rem', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    {t('inventory.inventory_batches_page.s47', "المورد / جهة التوريد")}
                  </label>
                  <input
                    value={editingBatch.supplier_name || ''}
                    onChange={(e) => setEditingBatch((prev) => ({ ...prev, supplier_name: e.target.value }))}
                    placeholder={t('inventory.inventory_batches_page.s48', "اسم المورد أو شركة التوزيع")}
                    style={{ width: '100%', padding: '7px 10px', fontSize: '0.85rem', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    {t('inventory.inventory_batches_page.s49', "الحالة")}
                  </label>
                  <CustomSelect
                    value={editingBatch.status || 'active'}
                    onChange={(val) => setEditingBatch((prev) => ({ ...prev, status: val as any }))}
                    options={BATCH_STATUS_OPTIONS}
                    placeholder={t('inventory.inventory_batches_page.s50', "اختر حالة التشغيلة")}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  {t('inventory.inventory_batches_page.s51', "ملاحظات")}
                </label>
                <input
                  value={editingBatch.notes || ''}
                  onChange={(e) => setEditingBatch((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder={t('inventory.inventory_batches_page.s52', "أي ملاحظات إضافية حول التشغيلة...")}
                  style={{ width: '100%', padding: '7px 10px', fontSize: '0.85rem', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box' }}
                />
              </div>
            </form>
          )}
        </StandardDialog>
      </main>
    </div>
  );
}
export default InventoryBatchesPage;
