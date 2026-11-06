import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { useAppToolbar } from '@/stores/toolbar-store';
import { CameraBarcodeScannerModal } from '@/shared/components/CameraBarcodeScannerModal';
import { DraftRestoredBanner } from '@/shared/components/DraftRestoredBanner';
import { IssueOrderSuccessModal } from '../components/issue-order/IssueOrderSuccessModal';
import { IssueOrderHeaderSection } from '../components/issue-order/IssueOrderHeaderSection';
import { IssueOrderItemsTable } from '../components/issue-order/IssueOrderItemsTable';
import { IssueOrderMobileCards } from '../components/issue-order/IssueOrderMobileCards';
import { useNewIssueOrderController } from '../components/issue-order/useNewIssueOrderController';

export function NewIssueOrderPage() {
  const { t } = useTranslation();
  const {
    navigate,
    user,
    fromLocationId,
    setFromLocationId,
    fromLocationQuery,
    setFromLocationQuery,
    toLocationQuery,
    setToLocationQuery,
    recipientName,
    setRecipientName,
    note,
    setNote,
    lines,
    summary,
    isSubmitting,
    isPolling,
    errorMsg,
    cameraScanLineId,
    setCameraScanLineId,
    createdTransfers,
    issueMode,
    setIssueMode,
    isDraftRestored,
    clearDraft,
    handleClearDraft,
    dismissRestoredNotice,
    products,
    locationOptions,
    destinationOptions,
    handleSelectDestination,
    handleClearDestination,
    stocks,
    productOptions,
    fetchProductOptions,
    addLine,
    removeLine,
    handleSelectProduct,
    handleQtyKeyDown,
    updateLine,
    handleSubmit,
    handlePrintA4,
    handlePrintReceipt,
    handleCameraScanForLine,
    resetForm,
  } = useNewIssueOrderController();

  useAppToolbar([
    { label: 'المخزون', to: '/inventory' },
    { label: 'إذن صرف جديد' },
  ]);

  return (
    <div dir="rtl" style={{ width: '100%' }}>
      <IssueOrderSuccessModal
        createdTransfers={createdTransfers}
        onPrintReceipt={handlePrintReceipt}
        onPrintA4={handlePrintA4}
        onNewTransfer={resetForm}
        onClose={() => {
          resetForm();
          navigate('/inventory');
        }}
      />

      <div className="document-prototype-column" style={{ paddingBottom: '100px', maxWidth: '1280px', width: 'min(100%, 1280px)', margin: '0 auto' }}>
        <PageHeader
          title={t('inventory.new_issue_order_page.s0', "إذن صرف جديد")}
          onBack={() => navigate('/inventory')}
          badge={<span className="document-prototype-status-badge is-draft">{t('inventory.new_issue_order_page.s1', "مسودة")}</span>}
          actions={
            <div className="document-prototype-topbar-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button
                variant="secondary"
                type="button"
                className="purchase-prototype-toolbar-action purchase-prototype-toolbar-action-secondary"
                onClick={() => {
                  clearDraft();
                  navigate('/inventory');
                }}
                style={{ color: 'var(--danger-color)', borderColor: 'rgba(239, 68, 68, 0.3)' }}
              >
                <span>{t('inventory.new_issue_order_page.s2', "إلغاء المسودة")}</span>
              </Button>

              <Button
                type="button"
                className="purchase-prototype-toolbar-action purchase-prototype-toolbar-action-primary"
                onClick={handleSubmit}
                disabled={isSubmitting || !!createdTransfers.length}
              >
                <span>{isPolling ? t('inventory.new_issue_order_page.s3', "جارٍ تأكيد العملية...") : isSubmitting ? t('inventory.new_issue_order_page.s4', "جارٍ الحفظ...") : t('inventory.new_issue_order_page.s5', "اعتماد إذن الصرف")}</span>
              </Button>
            </div>
          }
        />

        {isDraftRestored && (
          <div style={{ padding: '0 24px', marginTop: '16px' }}>
            <DraftRestoredBanner
              show={isDraftRestored}
              onClear={handleClearDraft}
              onDismiss={dismissRestoredNotice}
            />
          </div>
        )}

        {errorMsg && (
          <div style={{ padding: '0 24px', marginTop: '16px', marginBottom: '-8px' }}>
            <div role="alert" aria-live="polite" style={{
              background: 'rgba(248, 113, 113, 0.08)',
              border: '1px solid rgba(248, 113, 113, 0.18)',
              color: '#b91c1c',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: 700,
              padding: '0.5rem 0.75rem',
              width: '100%',
            }}>
              {errorMsg}
            </div>
          </div>
        )}

        <IssueOrderHeaderSection
          fromLocationQuery={fromLocationQuery}
          setFromLocationQuery={setFromLocationQuery}
          setFromLocationId={setFromLocationId}
          toLocationQuery={toLocationQuery}
          setToLocationQuery={setToLocationQuery}
          onSelectDestination={handleSelectDestination}
          onClearDestination={handleClearDestination}
          locationOptions={locationOptions}
          destinationOptions={destinationOptions}
          issueMode={issueMode}
          setIssueMode={setIssueMode}
          dispatcherName={user?.displayName || user?.username || ''}
          recipientName={recipientName}
          setRecipientName={setRecipientName}
        />

        <section className="document-prototype-section">
          <h3 className="document-prototype-section-title">{t('inventory.new_issue_order_page.s6', "الأصناف")}</h3>
          <div className="document-prototype-grid">
            <IssueOrderItemsTable
              lines={lines}
              fromLocationId={fromLocationId}
              products={products}
              locationOptions={locationOptions}
              productOptions={productOptions}
              fetchProductOptions={fetchProductOptions}
              stocks={stocks}
              onSelectProduct={handleSelectProduct}
              onUpdateLine={updateLine}
              onRemoveLine={removeLine}
              onQtyKeyDown={handleQtyKeyDown}
              summary={summary}
            />

            <IssueOrderMobileCards
              lines={lines}
              fromLocationId={fromLocationId}
              products={products}
              locationOptions={locationOptions}
              productOptions={productOptions}
              fetchProductOptions={fetchProductOptions}
              stocks={stocks}
              onSelectProduct={handleSelectProduct}
              onUpdateLine={updateLine}
              onRemoveLine={removeLine}
              onQtyKeyDown={handleQtyKeyDown}
              onOpenScanner={(id) => setCameraScanLineId(id)}
            />

            <div style={{ marginTop: '12px' }}>
              <button
                type="button"
                className="purchase-prototype-add-line-btn"
                onClick={addLine}
                style={{
                  color: 'var(--primary-color)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>+</span> {t('inventory.new_issue_order_page.s7', "إضافة صنف جديد")}
              </button>
            </div>
          </div>
        </section>

        {/* Section: Notes & Totals Summary */}
        <section className="document-prototype-bottom-grid" style={{ marginTop: '16px' }}>
          {/* Notes Card */}
          <div className="document-prototype-section">
            <h3 className="document-prototype-section-title">{t('inventory.new_issue_order_page.s8', "ملاحظات")}</h3>
            <div className="document-prototype-grid">
              <textarea
                className="purchase-prototype-field-input"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder={t('inventory.new_issue_order_page.s9', "أي ملاحظات إضافية على إذن الصرف...")}
                style={{ minHeight: '110px', resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          {/* Totals / Summary Card */}
          <div className="document-prototype-section document-totals-card">
            <h3 className="document-prototype-section-title">{t('inventory.new_issue_order_page.summary_title', "ملخص إذن الصرف")}</h3>
            <div className="document-totals-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ color: 'var(--text-secondary, #64748b)', fontWeight: 600 }}>
                  {t('inventory.new_issue_order_page.items_count', "عدد الأصناف:")}
                </span>
                <strong style={{ color: '#0f172a', fontSize: '1rem', fontWeight: 800 }}>
                  {summary.itemsCount} {t('inventory.new_issue_order_page.items_unit', "صنف")}
                </strong>
              </div>
              <div className="document-total-grand" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0 4px', borderTop: '2px solid #e2e8f0', marginTop: '6px' }}>
                <span style={{ color: '#170e5e', fontWeight: 700, fontSize: '0.95rem' }}>
                  {t('inventory.new_issue_order_page.total_pieces', "عدد القطع:")}
                </span>
                <strong style={{ color: '#170e5e', fontSize: '1.25rem', fontWeight: 900 }}>
                  {summary.totalPieces} {t('inventory.new_issue_order_page.pieces_unit', "قطعة")}
                </strong>
              </div>
            </div>
          </div>
        </section>
      </div>

      <CameraBarcodeScannerModal
        isOpen={cameraScanLineId !== null}
        onClose={() => setCameraScanLineId(null)}
        onScan={handleCameraScanForLine}
        title={t('inventory.new_issue_order_page.s10', "مسح باركود الصنف بكاميرا الهاتف")}
      />
    </div>
  );
}

export default NewIssueOrderPage;
