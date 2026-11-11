import { useTranslation } from 'react-i18next';
import { useState, useMemo } from 'react';
import { PageHeader } from '@/shared/components/page-header';
import { FormSection } from '@/shared/components/form-section';
import { DataTable } from '@/shared/components/data-table/DataTable';
import type { DataTableColumn } from '@/shared/components/data-table/DataTable.types';
import { Location } from '@/types/domain';
import { useInventoryActionCatalog } from '@/features/inventory/hooks/useInventoryActionCatalog';
import { useCreateLocationMutation, useUpdateLocationMutation, useDeleteLocationMutation } from '@/shared/hooks/use-location-mutations';
import { Field } from '@/shared/ui/field';
import { Button } from '@/shared/ui/button';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { CustomSelect } from '@/shared/ui/custom-select';
import { systemConfirm } from '@/shared/components/system-alert';
import { EditIcon, TrashIcon, PlusIcon } from '@/shared/components/icons/AppIcons';

const LOCATION_TYPE_OPTIONS = [
  { value: 'internal_warehouse', label: 'مخزن داخلي (لا يظهر كأرصدة فروع)' },
  { value: 'branch_stock', label: 'رصيد فرع (متاح للبيع)' },
  { value: 'quarantine', label: 'حجر صحي (غير متاح للبيع)' },
];

export function LocationsManagementPage() {
  const { t } = useTranslation();
  const { locationsQuery, branchesQuery } = useInventoryActionCatalog();
  
  const [modalOpen, setModalOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [branchId, setBranchId] = useState('');
  const [locationType, setLocationType] = useState<'internal_warehouse' | 'branch_stock' | 'quarantine'>('internal_warehouse');

  const branchOptions = useMemo(() => [
    { value: '', label: 'بدون ربط (فرع رئيسي)' },
    ...(branchesQuery.data || []).map((b) => ({ value: String(b.id), label: b.name })),
  ], [branchesQuery.data]);

  const createMutation = useCreateLocationMutation(() => setModalOpen(false));
  const updateMutation = useUpdateLocationMutation(() => setModalOpen(false));
  const deleteMutation = useDeleteLocationMutation();

  const locations = locationsQuery.data || [];

  const handleEdit = (location: Location) => {
    setEditingLocation(location);
    setName(location.name);
    setCode(location.code || '');
    setBranchId(String(location.branchId || ''));
    setLocationType((location as any).locationType || 'internal_warehouse');
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

  const handleDelete = async (location: Location) => {
    const confirmed = await systemConfirm({
      title: 'حذف المخزن',
      message: `هل أنت متأكد من حذف المخزن "${location.name}"؟`,
      confirmText: 'نعم، حذف',
      cancelText: 'إلغاء',
      variant: 'danger',
    });
    if (!confirmed) return;
    deleteMutation.mutate(String(location.id));
  };

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingLocation) {
      updateMutation.mutate({ locationId: String(editingLocation.id), values: { name, code, branchId, locationType } });
    } else {
      createMutation.mutate({ name, code, branchId, locationType });
    }
  };

  const columns: DataTableColumn<Location>[] = [
    { key: 'id', header: 'الرقم', cell: (row) => row.id },
    { key: 'name', header: 'الاسم', cell: (row) => row.name },
    { key: 'code', header: 'الكود', cell: (row) => row.code || '-' },
    { key: 'locationType', header: 'النوع', cell: (row) => row.locationType === 'branch_stock' ? 'رصيد فرع' : row.locationType === 'quarantine' ? 'حجر صحي' : 'مخزن داخلي' },
    { key: 'branchName', header: 'الفرع', cell: (row) => (row as any).branchName || row.branchId || 'الرئيسي' },
    {
      key: 'actions',
      header: '',
      cell: (row) => (
        <div className="actions" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end', display: 'flex', gap: '6px' }}>
          <Button variant="secondary" onClick={() => handleEdit(row)} title={t('inventory.locations_management_page.s0', "تعديل")} style={{ padding: '4px 8px', height: '32px' }}>
            <EditIcon size={14} />
          </Button>
          <Button variant="secondary" onClick={() => handleDelete(row)} title={t('inventory.locations_management_page.s1', "حذف")} style={{ padding: '4px 8px', height: '32px', color: 'var(--text-danger)' }}>
            <TrashIcon size={14} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="page-stack page-shell locations-page" dir="rtl">
      <main className="document-prototype-column" style={{ maxWidth: '1280px', margin: '0 auto', width: '100%', paddingBottom: '32px' }}>
      <PageHeader
        title={t('inventory.locations_management_page.s2', "إدارة أماكن المخزون")}
        description={t('inventory.locations_management_page.s3', "إضافة، تعديل، وحذف أماكن المخزون في النظام")}
        actions={(
          <Button variant="primary" onClick={handleCreate}>
            <PlusIcon size={16} style={{ marginLeft: 8 }} />
            {t('inventory.locations_management_page.s4', "إضافة مخزن")}
          </Button>
        )}
      />

      <FormSection title={t('inventory.locations_management_page.s5', "قائمة المخازن")}>
        <DataTable
          columns={columns}
          data={locations}
          getRowKey={(row) => String(row.id)}
          loading={locationsQuery.isLoading}
        />
      </FormSection>

      <StandardDialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingLocation ? t('inventory.locations_management_page.s6', "تعديل المخزن") : t('inventory.locations_management_page.s7', "إضافة مخزن جديد")}
        subtitle={t('inventory.locations_management_page.s8', "تحديد خصائص المخزن والفرع المرتبط ونوعه التشغيلي")}
        size="md"
        footerActions={
          <StandardDialogFooter
            onCancel={() => setModalOpen(false)}
            cancelLabel={t('inventory.locations_management_page.s9', "إلغاء")}
            primaryLabel={editingLocation ? t('inventory.locations_management_page.s10', "حفظ التعديلات") : t('inventory.locations_management_page.s11', "إضافة المخزن")}
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
          <Field label={t('inventory.locations_management_page.s12', "اسم المخزن")}>
            <input required value={name} onChange={(e) => setName(e.target.value)} disabled={createMutation.isPending || updateMutation.isPending} placeholder={t('inventory.locations_management_page.s13', "مثال: المخزن الرئيسي")} />
          </Field>
          <Field label={t('inventory.locations_management_page.s14', "كود المخزن")}>
            <input value={code} onChange={(e) => setCode(e.target.value)} disabled={createMutation.isPending || updateMutation.isPending} placeholder={t('inventory.locations_management_page.s15', "اختياري")} />
          </Field>
          <Field label={t('inventory.locations_management_page.s16', "الفرع")}>
            <CustomSelect
              value={branchId}
              onChange={(val) => setBranchId(val)}
              options={branchOptions}
              disabled={createMutation.isPending || updateMutation.isPending}
              placeholder={t('inventory.locations_management_page.s17', "اختر الفرع المرتبط")}
            />
          </Field>
          <Field label={t('inventory.locations_management_page.s18', "نوع المخزن")}>
            <CustomSelect
              value={locationType}
              onChange={(val) => setLocationType(val as 'internal_warehouse' | 'branch_stock' | 'quarantine')}
              options={LOCATION_TYPE_OPTIONS}
              disabled={createMutation.isPending || updateMutation.isPending}
              placeholder={t('inventory.locations_management_page.s19', "اختر نوع المخزن")}
            />
          </Field>
        </form>
      </StandardDialog>
      </main>
    </div>
  );
}
