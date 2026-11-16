import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { PageHeader } from '@/shared/components/page-header';
import { ActionConfirmDialog } from '@/shared/components/action-confirm-dialog';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { StatsGrid } from '@/shared/components/stats-grid';
import { formatCurrency } from '@/lib/format';
import { SupplierForm } from '@/features/suppliers/components/SupplierForm';
import { SupplierEditorCard } from '@/features/suppliers/components/SupplierEditorCard';
import { SuppliersRegisterCard } from '@/features/suppliers/pages/suppliers-page/SuppliersRegisterCard';
import { useSuppliersPageController } from '@/features/suppliers/pages/suppliers-page/useSuppliersPageController';

export function SuppliersPage() {
  const { t: __t } = useTranslation();
  const { t } = useTranslation();
  const controller = useSuppliersPageController();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const stats = [
    { key: 'suppliers', label: t('suppliers.count', 'عدد الموردين'), value: controller.summary?.totalSuppliers || 0 },
    { key: 'balance', label: t('suppliers.total_balances', 'إجمالي الأرصدة'), value: formatCurrency(controller.totalBalance) },
    { key: 'notes', label: t('suppliers.with_notes', 'عليهم ملاحظات'), value: controller.withNotes },
    { key: 'matched', label: t('suppliers.matched', 'مطابقون للبحث'), value: controller.summary?.totalSuppliers || 0 },
  ] as const;

  return (
    <div className="page-stack page-shell suppliers-page">
      <main className="document-prototype-column" style={{ paddingBottom: '32px' }}>
        <PageHeader
          title={t('sidebar.suppliers', 'الموردون')}
          description={t('suppliers_page.description', 'إدارة سجل الموردين، كشوف الحسابات والأرصدة مع إمكانية البحث والإضافة السريعة.')}
          badge={<span className="nav-pill">{controller.summary?.totalSuppliers || 0} {t('suppliers_page.supplier_unit', 'مورد')}</span>}
          actions={
            <div className="actions compact-actions">
              <Button variant="primary" onClick={() => setIsCreateOpen(true)}>{t('suppliers.new_supplier', '+ مورد جديد')}</Button>
              <Button variant="secondary" onClick={controller.resetSuppliersView}>{t('common.reset', 'إعادة ضبط')}</Button>
              <Button variant="secondary" onClick={controller.exportSuppliersCsv} disabled={!controller.summary?.totalSuppliers}>{t('common.export', 'تصدير')}</Button>
              <Button variant="secondary" onClick={() => void controller.copySuppliersSummary()} disabled={!controller.summary?.totalSuppliers}>{t('common.copy', 'نسخ')}</Button>
              <Button variant="secondary" onClick={controller.printSuppliersRegister} disabled={!controller.summary?.totalSuppliers || !controller.canPrint}>{t('common.print', 'طباعة')}</Button>
            </div>
          }
        />
        <StatsGrid items={stats} />

        <SuppliersRegisterCard {...controller} onOpenCreate={() => setIsCreateOpen(true)} />

        {/* Modal for Creating Supplier */}
        <StandardDialog
          open={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          title={t('suppliers_page.add_new_title', 'إضافة مورد جديد')}
          subtitle={t('suppliers_page.add_new_sub', 'تسجيل بيانات المورد وتفاصيل الحساب والرصيد الافتتاحي في النظام')}
          width="min(680px, 95vw)"
          minHeight="auto"
        >
          <SupplierForm onSuccess={() => setIsCreateOpen(false)} />
        </StandardDialog>

        {/* Modal for Editing Supplier */}
        <StandardDialog
          open={Boolean(controller.selectedSupplier)}
          onClose={() => controller.setSelectedSupplier(null)}
          compact
          title={controller.selectedSupplier ? `ملف المورد: ${controller.selectedSupplier.name}` : ''}
          subtitle={__t('suppliers.modal.edit_subtitle', "إدارة البيانات الأساسية، فواتير الخدمات، وكشف الحساب والمدفوعات")}
          width="min(1080px, 96vw)"
          minHeight="min(620px, 90vh)"
        >
          <SupplierEditorCard
            supplier={controller.selectedSupplier || undefined}
            onSaved={() => controller.setSelectedSupplier(null)}
            canDelete={controller.canDelete}
            onRequestDelete={() => controller.selectedSupplier && controller.setSupplierToDelete(controller.selectedSupplier)}
          />
        </StandardDialog>

        <ActionConfirmDialog
          open={Boolean(controller.supplierToDelete)}
          title={__t('suppliers.suppliers_page.s2', "تأكيد حذف المورد")}
          description={controller.supplierToDelete ? `سيتم حذف المورد ${controller.supplierToDelete.name}. إذا كان المورد مستخدمًا داخل أصناف فعالة فسيمنع الخادم الحذف، وسيظهر السبب مباشرة.` : ''}
          confirmLabel={__t('suppliers.suppliers_page.s3', "نعم، حذف المورد")}
          isBusy={controller.deleteMutation.isPending}
          onCancel={() => controller.setSupplierToDelete(null)}
          onConfirm={async () => {
            if (!controller.supplierToDelete) return;
            await controller.deleteMutation.mutateAsync(controller.supplierToDelete.id);
            controller.setSelectedIds((current: string[]) => current.filter((id) => id !== String(controller.supplierToDelete?.id)));
            if (controller.selectedSupplier?.id === controller.supplierToDelete.id) {
              controller.setSelectedSupplier(null);
            }
          }}
        />

        <ActionConfirmDialog
          open={controller.bulkDeleteOpen}
          title={__t('suppliers.suppliers_page.s4', "تأكيد حذف الموردين المحددين")}
          description={controller.selectedSuppliers.length ? `سيتم محاولة حذف ${controller.selectedSuppliers.length} موردًا دفعة واحدة. أي مورد مستخدم داخل أصناف أو حركات قائمة سيرفضه الخادم وسيظهر السبب بعد المحاولة.` : __t('suppliers.suppliers_page.s5', "لا يوجد موردون محددون.")}
          confirmLabel={__t('suppliers.suppliers_page.s6', "نعم، حذف المحدد")}
          isBusy={controller.bulkDeleteMutation.isPending}
          onCancel={() => controller.setBulkDeleteOpen(false)}
          onConfirm={async () => {
            if (!controller.selectedIds.length) return;
            await controller.bulkDeleteMutation.mutateAsync(controller.selectedIds);
          }}
        />
      </main>
    </div>
  );
}
