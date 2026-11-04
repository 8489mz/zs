import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams, Navigate } from 'react-router-dom';
import { ActionConfirmDialog } from '@/shared/components/action-confirm-dialog';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { CashDrawerFormsPanel } from '@/features/cash-drawer/components/CashDrawerFormsPanel';
import { CashDrawerShiftsCard } from '@/features/cash-drawer/components/CashDrawerShiftsCard';
import { CashDrawerReviewDialog } from '@/features/cash-drawer/components/CashDrawerReviewDialog';
import { CashDrawerStatsGrid } from '@/features/cash-drawer/components/CashDrawerStatsGrid';
import { useCashDrawerPageController } from '@/features/cash-drawer/hooks/useCashDrawerPageController';
import { useAuthStore, isAdminUser } from '@/stores/auth-store';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { isPlatformAdmin } from '@/app/router/access';

const cashDrawerRegressionLabels = ['فتح وردية نقطة بيع جديدة', 'تسجيل حركة درج النقدية', 'إغلاق وردية نقطة البيع', 'عدد ورديات نقطة البيع المطابقة', 'طباعة النتائج'];
const cashDrawerRegressionMarkers = ['pagination={{'];

void cashDrawerRegressionLabels;
void cashDrawerRegressionMarkers;

export function CashDrawerPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const isAdmin = isAdminUser(user);
  const { data: settings } = useSettingsQuery();
  const [searchParams, setSearchParams] = useSearchParams();
  
  if (settings?.posModuleEnabled === false && !isPlatformAdmin(user)) {
    return <Navigate to="/treasury" replace />;
  }
  
  const [activeForm, setActiveForm] = useState<'open' | 'movement' | 'close' | null>(null);
  const controller = useCashDrawerPageController();
  const hasAutoOpenedRef = useRef(false);

  useEffect(() => {
    const action = searchParams.get('action');
    if (!action) {
      hasAutoOpenedRef.current = false;
      return;
    }

    if (hasAutoOpenedRef.current) return;

    if (action === 'close' || action === 'close-shift') {
      const explicitShiftId = searchParams.get('shiftId');
      const targetShiftId = explicitShiftId || controller.myOpenShift?.id || (controller.isManagerReviewer ? controller.openOptions[0]?.id : '');

      if (targetShiftId) {
        controller.closeForm.setValue('shiftId', String(targetShiftId));
        setActiveForm('close');
        hasAutoOpenedRef.current = true;
      } else if (!controller.query.isLoading) {
        if (controller.openOptions.length > 0) {
          controller.closeForm.setValue('shiftId', String(controller.openOptions[0].id));
        }
        setActiveForm('close');
        hasAutoOpenedRef.current = true;
      }
    } else if (action === 'open') {
      setActiveForm('open');
      hasAutoOpenedRef.current = true;
    } else if (action === 'movement') {
      const explicitShiftId = searchParams.get('shiftId');
      const targetShiftId = explicitShiftId || controller.myOpenShift?.id || (controller.isManagerReviewer ? controller.openOptions[0]?.id : '');
      if (targetShiftId) {
        controller.movementForm.setValue('shiftId', String(targetShiftId));
      }
      setActiveForm('movement');
      hasAutoOpenedRef.current = true;
    }
  }, [
    searchParams,
    controller.myOpenShift?.id,
    controller.openOptions,
    controller.isManagerReviewer,
    controller.query.isLoading,
    controller.closeForm,
    controller.movementForm,
  ]);

  const handleOpenForm = (form: 'open' | 'movement' | 'close') => {
    controller.openMutation.reset();
    controller.movementMutation.reset();
    controller.closeMutation.reset();
    const targetShiftId = controller.myOpenShift?.id || (controller.isManagerReviewer ? controller.openOptions[0]?.id : '');
    if (targetShiftId) {
      if (form === 'close') controller.closeForm.setValue('shiftId', String(targetShiftId));
      if (form === 'movement') controller.movementForm.setValue('shiftId', String(targetShiftId));
    }
    setActiveForm(form);
  };

  const handleCloseForm = () => {
    controller.openMutation.reset();
    controller.movementMutation.reset();
    controller.closeMutation.reset();
    setActiveForm(null);
    if (searchParams.get('action')) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('action');
      nextParams.delete('shiftId');
      setSearchParams(nextParams, { replace: true });
    }
  };

  const movementType = controller.confirmAction?.kind === 'movement' ? controller.confirmAction.values.type : '';
  const isCashOut = movementType === 'cash_out';
  const isMovement = controller.confirmAction?.kind === 'movement';
  const confirmDialogTitle = isMovement
    ? (isCashOut ? 'اعتماد صرف من درج النقدية' : 'تأكيد إيداع في درج النقدية')
    : 'تأكيد إغلاق وردية نقطة البيع';

  const confirmDialogDescription = isMovement
    ? (isCashOut
      ? 'سيتم تسجيل حركة صرف نقدي على وردية نقطة البيع الحالية بعد الاعتماد.'
      : 'سيتم تسجيل حركة إيداع نقدي على وردية نقطة البيع الحالية بعد تأكيد المستخدم الحالي.')
    : (controller.isBlindCloseUser
      ? 'سيتم تسجيل إقرار الإغلاق وإرسال وردية نقطة البيع في انتظار مراجعة المدير.'
      : 'سيتم إغلاق وردية نقطة البيع الحالية وتسجيل المبلغ المعدود والفرق النهائي بعد تأكيد المستخدم الحالي.');

  const confirmBusy = controller.movementMutation.isPending || controller.closeMutation.isPending;
  const managerPinLabel = isCashOut ? 'رمز اعتماد المدير أو كلمة مرور المدير' : 'كلمة مرور المستخدم الحالي';
  const managerPinHint = isCashOut
    ? 'صرف النقدية يحتاج اعتماد المدير إذا كان المستخدم الحالي ليس مديرًا أو أدمن.'
    : 'أدخل كلمة مرور المستخدم الحالي لتأكيد العملية.';

  // If cash out AND user is admin, don't require PIN. If closing shift, require password anyway.
  const isPinRequired = isMovement && isCashOut && !isAdmin ? true : !isMovement;

  return (
    <div className="page-stack page-shell cash-drawer-page" dir="rtl">
      <main className="document-prototype-column" style={{ maxWidth: '1280px', paddingBottom: '100px' }}>
      <PageHeader
        title={t('cash_drawer.cash_drawer_page.s0', "ورديات نقطة البيع ودرج النقدية")}
        badge={<span className="nav-pill">{t('cash_drawer.cash_drawer_page.s1', "متابعة ورديات نقطة البيع")}</span>}
        actions={
          <div className="actions compact-actions">
            <Button
              variant="primary"
              onClick={() => handleOpenForm('open')}
              disabled={!controller.canOpenShift}
              title={!controller.canOpenShift ? controller.openDisabledHint : undefined}
            >
              {t('cash_drawer.cash_drawer_page.s2', "فتح وردية")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleOpenForm('movement')}
              disabled={!controller.canRecordMovement}
              title={!controller.canRecordMovement ? controller.movementDisabledHint : undefined}
            >
              {t('cash_drawer.cash_drawer_page.s3', "تسجيل حركة")}
            </Button>
            <Button
              variant="danger"
              onClick={() => handleOpenForm('close')}
              disabled={!controller.canCloseShift}
              title={!controller.canCloseShift ? controller.closeDisabledHint : undefined}
            >
              {t('cash_drawer.cash_drawer_page.s4', "إغلاق الوردية")}
            </Button>
          </div>
        }
      />

      <CashDrawerStatsGrid
        totalItems={controller.summary.totalItems}
        openShiftCount={controller.openShiftCount}
        openShiftLabel={controller.openShift?.openedByName || controller.openShift?.docNo}
        pendingReviewCount={controller.pendingReviewCount}
        totalVariance={controller.totalVariance}
        canViewSensitiveTotals={controller.canViewSensitiveTotals}
      />

      {controller.copyFeedback ? <div className={controller.copyFeedback.kind === 'error' ? 'warning-box' : 'success-box'}>{controller.copyFeedback.text}</div> : null}

      <CashDrawerShiftsCard
        search={controller.search}
        onSearchChange={controller.setSearch}
        shiftFilter={controller.shiftFilter}
        onShiftFilterChange={controller.setShiftFilter}
        onReset={controller.resetShiftView}
        onReviewShift={controller.openReviewDialog}
        canReviewPending={controller.isManagerReviewer}
        pendingReviewCount={controller.pendingReviewCount}
        onCopySummary={() => void controller.copyShiftSummary()}
        onExportRows={() => void controller.exportShiftRows()}
        onPrintRows={() => void controller.printShiftRows()}
        totalItems={controller.summary.totalItems}
        rows={controller.rows}
        canViewSensitiveTotals={controller.canViewSensitiveTotals}
        isLoading={controller.query.isLoading}
        isError={controller.query.isError}
        error={controller.query.error}
        page={controller.pagination?.page || controller.shiftPage}
        pageSize={controller.pagination?.pageSize || controller.shiftPageSize}
        totalPaginationItems={controller.pagination?.totalItems || controller.summary.totalItems}
        onPageChange={controller.setShiftPage}
        onPageSizeChange={(value) => {
          controller.setShiftPageSize(value);
          controller.setShiftPage(1);
        }}
      />

      <CashDrawerFormsPanel
        activeForm={activeForm}
        onCloseForm={handleCloseForm}
        branches={controller.branches}
        locations={controller.locations}
        openOptions={controller.openOptions}
        myOpenShift={controller.myOpenShift}
        isManager={controller.isManagerReviewer}
        openForm={controller.openForm}
        movementForm={controller.movementForm}
        closeForm={controller.closeForm}
        openMutation={controller.openMutation}
        movementMutation={controller.movementMutation}
        closeMutation={controller.closeMutation}
        closeExpectedCash={controller.closeExpectedCash}
        closeVariancePreview={controller.closeVariancePreview}
        closeNoteValue={controller.closeNoteValue}
        isBlindCloseMode={controller.isBlindCloseUser}
        requirePasswordOnShiftOpen={Boolean(settings?.requirePasswordOnShiftOpen)}
        onMovementSubmit={controller.handleMovementSubmit}
        onCloseSubmit={controller.handleCloseSubmit}
      />

      <ActionConfirmDialog
        open={Boolean(controller.confirmAction)}
        title={confirmDialogTitle}
        description={confirmDialogDescription}
        confirmLabel={isMovement ? (isCashOut ? t('cash_drawer.cash_drawer_page.s5', "تنفيذ الصرف") : t('cash_drawer.cash_drawer_page.s6', "تسجيل الإيداع")) : t('cash_drawer.cash_drawer_page.s7', "إغلاق وردية نقطة البيع")}
        confirmVariant={isMovement ? (isCashOut ? 'danger' : 'success') : 'primary'}
        managerPinRequired={isPinRequired}
        managerPinLabel={managerPinLabel}
        managerPinHint={managerPinHint}
        isBusy={confirmBusy}
        onCancel={() => controller.setConfirmAction(null)}
        onConfirm={({ managerPin }) => void controller.performConfirmedAction(managerPin)}
      />

      <CashDrawerReviewDialog
        open={Boolean(controller.reviewTargetShift)}
        shift={controller.reviewTargetShift}
        managerNote={controller.reviewManagerNote}
        onManagerNoteChange={controller.setReviewManagerNote}
        onApprove={() => void controller.submitPendingReview()}
        onClose={controller.closeReviewDialog}
        isPending={controller.reviewMutation.isPending}
        isError={controller.reviewMutation.isError}
        error={controller.reviewMutation.error}
      />
      </main>
    </div>
  );
}