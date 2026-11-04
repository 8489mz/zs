import { Link } from 'react-router-dom';
import { Button } from '@/shared/ui/button';
import { PageHeader } from '@/shared/components/page-header';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { ActionConfirmDialog } from '@/shared/components/action-confirm-dialog';
import { PurchaseDetailCard } from '@/features/purchases/components/PurchaseDetailCard';
import { PurchaseEditDialog } from '@/features/purchases/components/PurchaseEditDialog';
import { PurchasesKpiSection, TopSuppliersCard } from '@/features/purchases/components/purchases-workspace/PurchasesOverviewSection';
import { PurchasesRegisterCard } from '@/features/purchases/components/purchases-workspace/PurchasesRegisterCard';
import { MarginProtectionModal } from '@/features/purchases/components/MarginProtectionModal';
import { usePurchasesWorkspaceController } from '@/features/purchases/components/purchases-workspace/usePurchasesWorkspaceController';
import { printPurchaseDocument } from '@/features/purchases/lib/purchases-workspace.helpers';
import { PurchasesNavTabs } from '@/features/purchases/components/PurchasesNavTabs';
import { useTranslation } from 'react-i18next';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';

export function PurchasesWorkspace() {
  const { t: __t } = useTranslation();
  const { t } = useTranslation();
  const controller = usePurchasesWorkspaceController();
  const settingsQuery = useSettingsQuery();
  const selectedPurchase = controller.selectedPurchase;
  const canEditSelectedPurchase = Boolean(controller.canEditInvoices && selectedPurchase && selectedPurchase.status !== 'cancelled');

  return (
    <div className="page-stack page-shell purchases-workspace">
      <main className="document-prototype-column" style={{ paddingBottom: '32px' }}>
        <PageHeader
          title={t('purchases_workspace.title', 'المشتريات')}
          description={t('purchases_workspace.description', 'إدارة فواتير الشراء، متابعة التوريدات وحسابات الموردين.')}
          badge={<span className="nav-pill">{controller.totalItems} {t('purchases_workspace.invoices_unit', 'فاتورة')}</span>}
          actions={
            <div className="actions compact-actions">
              <Link to="/purchases/new">
                <Button variant="primary" style={{ backgroundColor: '#170e5e', borderColor: '#170e5e', fontWeight: 700 }}>
                  {t('purchases_workspace.new_purchase_invoice', '+ إنشاء فاتورة شراء')}
                </Button>
              </Link>
              <Link to="/purchases/reorder"><Button variant="secondary">{t('purchases_workspace.smart_reorder', 'مقترح إعادة الطلب الذكي')}</Button></Link>
              <Link to="/purchases/rfqs"><Button variant="secondary">{t('purchases_workspace.rfqs', 'عروض أسعار الموردين (RFQ)')}</Button></Link>
              <Button variant="secondary" onClick={controller.resetPurchasesView}>{t('common.reset', 'إعادة ضبط')}</Button>
              <Button variant="secondary" onClick={() => void controller.copyPurchasesSummary()} disabled={!controller.totalItems}>{t('common.copy', 'نسخ')}</Button>
              <Button variant="secondary" onClick={() => void controller.exportPurchasesCsv()} disabled={!controller.totalItems}>{t('common.export', 'تصدير')}</Button>
              <Button variant="secondary" onClick={() => void controller.printPurchasesRegister()} disabled={!controller.totalItems || !controller.canPrint}>{t('common.print', 'طباعة')}</Button>
            </div>
          }
        />

        <PurchasesNavTabs currentTab="invoices" />

        <PurchasesKpiSection totalItems={controller.totalItems} summary={controller.summary || null} />

        <PurchasesRegisterCard {...controller} selectedPurchase={selectedPurchase} summary={controller.summary || null} />

        {/* Modal for Purchase Details */}
        <StandardDialog
          open={Boolean(selectedPurchase)}
          onClose={() => controller.setSelectedPurchaseId('')}
          title={`${t('purchases_workspace.invoice_details', 'تفاصيل فاتورة الشراء')} ${selectedPurchase?.docNo || ''}`}
          subtitle={t('purchases_workspace.invoice_details_sub', 'عرض كامل لبنود وأطراف ومصاريف الفاتورة')}
          maxWidth="960px"
          footerActions={
            <StandardDialogFooter
              onCancel={() => controller.setSelectedPurchaseId('')}
              cancelLabel={t('common.close', 'إغلاق')}
            />
          }
        >
          <PurchaseDetailCard
            purchase={selectedPurchase || undefined}
            onPrint={controller.canPrint && selectedPurchase ? () => printPurchaseDocument(selectedPurchase, settingsQuery.data) : undefined}
            onEdit={canEditSelectedPurchase && selectedPurchase ? () => controller.setPurchaseToEdit(selectedPurchase) : undefined}
            onCancel={canEditSelectedPurchase && selectedPurchase ? () => controller.setPurchaseToCancel(selectedPurchase) : undefined}
            onRefresh={() => { controller.purchasesQuery.purchasesQuery.refetch(); controller.setSelectedPurchaseId(''); }}
          />
        </StandardDialog>

        <TopSuppliersCard
          topSuppliers={controller.topSuppliers}
          exportTopSuppliersCsv={controller.exportTopSuppliersCsv}
          printTopSuppliers={controller.printTopSuppliers}
        />

      <PurchaseEditDialog
        open={Boolean(controller.purchaseToEdit)}
        purchase={controller.purchaseToEdit || undefined}
        isBusy={controller.updateMutation.isPending}
        errorMessage={controller.updateMutation.isError ? (controller.updateMutation.error instanceof Error ? controller.updateMutation.error.message : __t('purchases.purchases_workspace.s0', "تعذر حفظ التعديل")) : ''}
        onCancel={() => { controller.setPurchaseToEdit(null); controller.updateMutation.reset(); }}
        onSave={async (payload) => {
          if (!controller.purchaseToEdit) return;
          await controller.updateMutation.mutateAsync({ purchase: controller.purchaseToEdit, payload });
          controller.setSelectedPurchaseId(controller.purchaseToEdit.id);
          controller.setPurchaseToEdit(null);
        }}
      />

      <MarginProtectionModal
        open={Boolean(controller.repricingInsights?.purchaseId)}
        purchaseId={controller.repricingInsights?.purchaseId || 0}
        onClose={() => controller.setRepricingInsights(null)}
      />

      <ActionConfirmDialog open={Boolean(controller.purchaseToCancel)} title={__t('purchases.purchases_workspace.s1', "تأكيد إلغاء فاتورة الشراء")} description={controller.cancelDescription} confirmLabel={__t('purchases.purchases_workspace.s2', "نعم، إلغاء الفاتورة")} managerPinRequired managerPinLabel={__t('purchases.purchases_workspace.s7', "رمز اعتماد المدير أو كلمة مرور المدير")} managerPinPlaceholder={__t('purchases.purchases_workspace.s8', "أدخل رمز اعتماد المدير أو كلمة مرور المدير")} managerPinHint={__t('purchases.purchases_workspace.s3', "هذه العملية تحتاج اعتماد المدير: أدخل رمز اعتماد المدير أو كلمة مرور حساب مدير.")} reasonRequired reasonLabel={__t('purchases.purchases_workspace.s4', "سبب إلغاء فاتورة الشراء")} reasonHint={__t('purchases.purchases_workspace.s5', "اكتب سببًا واضحًا حتى يبقى محفوظًا في السجل ويرجع له المدير لاحقًا.")} reasonPlaceholder={__t('purchases.purchases_workspace.s6', "مثال: تم إدخال الفاتورة مرتين أو إلغاء الاستلام")} isBusy={controller.cancelMutation.isPending} onCancel={() => controller.setPurchaseToCancel(null)} onConfirm={async ({ managerPin, reason }) => {
        if (!controller.purchaseToCancel) return;
        await controller.cancelMutation.mutateAsync({ purchaseId: controller.purchaseToCancel.id, reason, managerPin });
        controller.setSelectedPurchaseId(controller.purchaseToCancel.id);
        controller.setPurchaseToCancel(null);
      }} />
      </main>
    </div>
  );
}
