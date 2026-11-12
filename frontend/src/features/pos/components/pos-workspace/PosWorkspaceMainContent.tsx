import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { XIcon } from '@/shared/components/icons/AppIcons';
import { memo, useState, useEffect } from 'react';
import { usePosUiCustomization } from '@/features/pos/hooks/usePosUiCustomization';
import { createPortal } from 'react-dom';
import { QueryFeedback } from '@/shared/components/query-feedback';
import { Button } from '@/shared/ui/button';
import { PosCartPanel } from '@/features/pos/components/PosCartPanel';
import { PosProductsPanel } from '@/features/pos/components/PosProductsPanel';
import { PosWorkspaceDock } from '@/features/pos/components/pos-workspace/PosWorkspaceDock';
import { PosWorkspaceStartupIssues } from '@/features/pos/components/pos-workspace/PosWorkspaceStatusCards';
import { useSplitter } from '@/shared/hooks/useSplitter';
import { useIsMobile } from '@/shared/hooks/use-is-mobile';
import { useAuthStore } from '@/stores/auth-store';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/lib/format';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import type { PosSaleMode } from '@/features/pos/lib/pos-sale-mode';
import type { PosPriceType } from '@/features/pos/types/pos.types';
import { calcCartLineTotal } from '@/features/pos/lib/pos-modifier-totals';
import type { RefObject } from 'react';

interface PosWorkspaceMainContentProps {
  pos: PosWorkspaceState;
  posMode: PosSaleMode;
  catalogsLoading: boolean;
  catalogsError: unknown;
  allowNegativeStockSales: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  cartQtySummaries: string[];
  cartItemsCount: number;
  onSubmitFirstSearchResult: (rawQuery?: string) => boolean;
  onRequestDiscountAuthorization: () => void;
  onRequestLineDelete: (lineKey: string) => void;
  onItemModifiersClick: (lineKey: string) => void;
  onEditProduct?: (productId: string) => void;
  onRequestSelectedLineDelete: () => void;
  onRequestHeldDelete: (draftId: string) => void;
  onRequestClearHeldDrafts: () => void;
  onRequestClearCart: () => void;
  onRequestCheckout: () => void;
  heldDraftsCount: number;
  onOpenHeldDrafts: () => void;
  onPrintCurrentDraft: () => void;
  onFocusBarcodeEntry: () => void;
  onRequestOpenShift?: () => void;
  onOpenNewProduct?: (params?: { name?: string; barcode?: string }) => void;
  onPriceTypeChange?: (value: PosPriceType) => void;
}

export function PosWorkspaceMainContentComponent({
  pos,
  posMode,
  catalogsLoading,
  catalogsError,
  allowNegativeStockSales,
  searchInputRef,
  cartQtySummaries,
  cartItemsCount,
  onSubmitFirstSearchResult,
  onRequestDiscountAuthorization,
  onRequestLineDelete,
  onItemModifiersClick,
  onEditProduct,
  onRequestSelectedLineDelete,
  onRequestHeldDelete,
  onRequestClearHeldDrafts,
  onRequestClearCart,
  onRequestCheckout,
  heldDraftsCount,
  onOpenHeldDrafts,
  onPrintCurrentDraft,
  onFocusBarcodeEntry,
  onRequestOpenShift,
  onOpenNewProduct,
  onPriceTypeChange,
}: PosWorkspaceMainContentProps) {
  const { t: __t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const { i18n } = useTranslation();
  const isEn = Boolean(i18n.language && i18n.language.startsWith('en'));
  const isRtl = !isEn;

  const { customization } = usePosUiCustomization();

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (customization.autoHideBottomNav && cartItemsCount > 0) {
      document.body.classList.add('pos-cart-has-items');
    } else {
      document.body.classList.remove('pos-cart-has-items');
    }
    return () => {
      document.body.classList.remove('pos-cart-has-items');
    };
  }, [cartItemsCount, customization.autoHideBottomNav]);

  const [mobileActiveTab, setMobileActiveTab] = useState<'products' | 'cart'>('products');
  const isMobile = useIsMobile(900);
  const isCartVisible = !isMobile || mobileActiveTab === 'cart';

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (mobileActiveTab === 'cart') {
      document.body.classList.add('pos-in-cart-view');
      if (cartItemsCount === 0) {
        document.body.classList.add('pos-cart-empty');
      } else {
        document.body.classList.remove('pos-cart-empty');
      }
    } else {
      document.body.classList.remove('pos-in-cart-view');
      document.body.classList.remove('pos-cart-empty');
    }
    return () => {
      document.body.classList.remove('pos-in-cart-view');
      document.body.classList.remove('pos-cart-empty');
    };
  }, [mobileActiveTab, cartItemsCount]);
  const [isFloatingCartExpanded, setIsFloatingCartExpanded] = useState(false);
  const defaultLeft = posMode === 'scanner' ? 70 : 38;
  const { leftRatio, rightRatio, handlePositionPct, startDrag } = useSplitter(
    `pos_split_v2_${posMode}_${user?.id || 'default'}`,
    defaultLeft,
    isRtl
  );

  // In RTL, CSS grid renders Col1 on the RIGHT, Col2 on the LEFT.
  // In LTR, CSS grid renders Col1 on the LEFT, Col2 on the RIGHT.
  // Col1 (Products) width = rightRatio, Col2 (Cart) width = leftRatio.
  const gridStyle = {
    '--pos-grid-cols': `minmax(0, ${rightRatio}fr) minmax(0, ${leftRatio}fr)`,
  } as React.CSSProperties;

  return (
    <QueryFeedback
      isLoading={catalogsLoading}
      isError={Boolean(catalogsError)}
      error={catalogsError}
      loadingText={__t('pos.pos_workspace.pos_workspace_main_content.s0', __t('pos.pos_workspace.pos_workspace_main_content.s0', "جارٍ تحميل بيانات الكاشير..."))}
      errorTitle={__t('pos.pos_workspace.pos_workspace_main_content.s1', __t('pos.pos_workspace.pos_workspace_main_content.s1', "تعذر تحميل بيانات الكاشير"))}
      errorHint={__t('pos.pos_workspace.pos_workspace_main_content.s2', __t('pos.pos_workspace.pos_workspace_main_content.s2', "تحقق من الاتصال ثم أعد المحاولة."))}
      errorAction={<Button variant="secondary" onClick={() => { void pos.refetchCatalogs(); }}>{__t('pos.pos_workspace.pos_workspace_main_content.s3', __t('pos.pos_workspace.pos_workspace_main_content.s3', "إعادة المحاولة"))}</Button>}
    >
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', width: '100%', maxWidth: '100%' }}>
        {/* Mobile Tab Switcher (displayed only on small mobile screens via media query) */}
        <div className="pos-mobile-tab-switcher">
          <button
            type="button"
            className={`pos-mobile-tab-btn ${mobileActiveTab === 'products' ? 'is-active' : ''}`}
            onClick={() => setMobileActiveTab('products')}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8" />
            </svg>
            <span>{__t('pos.pos_workspace.pos_workspace_main_content.s4', __t('pos.pos_workspace.pos_workspace_main_content.s4', "الأصناف ("))}{pos.filteredSaleProducts.length})</span>
          </button>

          <button
            type="button"
            className={`pos-mobile-tab-btn ${mobileActiveTab === 'cart' ? 'is-active' : ''}`}
            onClick={() => setMobileActiveTab('cart')}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="21" r="1"></circle>
              <circle cx="20" cy="21" r="1"></circle>
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
            </svg>
            <span>{__t('pos.pos_workspace.pos_workspace_main_content.s5', __t('pos.pos_workspace.pos_workspace_main_content.s5', "السلة ("))}{cartItemsCount})</span>
            {pos.totals.total > 0 && <span className="pos-mobile-tab-total">{formatCurrency(pos.totals.total)}</span>}
          </button>
        </div>

        <div className={`pos-grid-premium ${mobileActiveTab === 'products' ? 'pos-mobile-show-products' : 'pos-mobile-show-cart'}`} style={gridStyle}>

          {/* Products column: startup issues banner + products panel stacked */}
          <div className={`pos-products-column ${mobileActiveTab === 'products' ? 'is-mobile-active' : 'is-mobile-hidden'}`} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', overflow: 'hidden', flex: 1 }}>
            <PosWorkspaceStartupIssues pos={pos} onRequestOpenShift={onRequestOpenShift} />
            <PosProductsPanel
            search={pos.search}
            onSearchChange={pos.setSearch}
            onSearchSubmitFirstResult={onSubmitFirstSearchResult}
            priceType={pos.priceType}
            onPriceTypeChange={onPriceTypeChange || pos.setPriceType}
            products={pos.filteredSaleProducts}
            recentProducts={pos.recentProducts}
            productFilter={pos.productFilter}
            onProductFilterChange={pos.setProductFilter}
            selectedCategoryId={pos.selectedCategoryId}
            onSelectedCategoryIdChange={pos.setSelectedCategoryId}
            onAddProduct={pos.handleAddProduct}
            searchInputRef={searchInputRef}
            posMode={posMode}
            onOpenNewProduct={onOpenNewProduct}
            restaurantModuleEnabled={Boolean(pos.settingsQuery.data?.restaurantModuleEnabled)}
          />
          </div>

        <div
          className={`pos-checkout-column ${mobileActiveTab === 'cart' ? 'is-mobile-active' : 'is-mobile-hidden'}`}
          style={{
            display: mobileActiveTab === 'cart' ? 'flex' : undefined,
            flexDirection: mobileActiveTab === 'cart' ? 'column' : undefined,
            width: mobileActiveTab === 'cart' ? '100%' : undefined,
            flex: mobileActiveTab === 'cart' ? '1 1 auto' : undefined,
            minHeight: 0,
            paddingBottom: mobileActiveTab === 'cart' ? 'calc(140px + env(safe-area-inset-bottom, 0px))' : undefined,
          }}
        >
          {isCartVisible ? (
            <>
              <PosCartPanel
                cart={pos.cart}
                products={pos.filteredSaleProducts}
                onNavigateToProducts={() => setMobileActiveTab('products')}
                customers={pos.customersQuery.data || []}
                branches={pos.branchesQuery.data || []}
                locations={pos.locationsQuery.data || []}
                customerId={pos.customerId}
                branchId={pos.branchId}
                locationId={pos.locationId}
                paymentType={pos.paymentType}
                paymentChannel={pos.paymentChannel}
                paidAmount={pos.paidAmount}
                cashAmount={pos.cashAmount}
                cardAmount={pos.cardAmount}
                transferAmount={pos.transferAmount}
                discount={pos.discount}
                deliveryFee={pos.deliveryFee}
                note={pos.note}
                tableNumber={pos.tableNumber}
                orderType={pos.orderType}
                submitMessage={pos.submitMessage}
                lastSaleDocNo={pos.lastSale?.docNo || pos.lastSale?.id || ''}
                canShowLastSaleActions={pos.canShowLastSaleActions}
                quickCustomerName={pos.quickCustomerName}
                quickCustomerPhone={pos.quickCustomerPhone}
                quickCustomerAddress={pos.quickCustomerAddress}
                isQuickCustomerPending={pos.quickCustomerMutation.isPending}
                heldDrafts={pos.heldDraftSummaries}
                isError={pos.createSale.isError}
                isPending={pos.createSale.isPending}
                totals={pos.totals}
                changeAmount={pos.changeAmount}
                amountDue={pos.amountDue}
                hasOpenShift={Boolean(pos.ownOpenShift)}
                canApplyDiscount={pos.canApplyDiscount}
                adminDiscountWarning={pos.adminDiscountWarning}
                discountApprovalGranted={pos.discountApprovalGranted}
                isDiscountAuthorizationPending={pos.discountAuthorizationMutation.isPending}
                hasDiscountPermissionViolation={pos.hasDiscountPermissionViolation}
                hasPricePermissionViolation={pos.hasPricePermissionViolation}
                allowNegativeStockSales={allowNegativeStockSales}
                canSubmitSale={pos.canSubmitSale}
                canSubmitHint={pos.canSubmitHint}
                lastAddedLineKey={pos.lastAddedLineKey}
                selectedLineKey={pos.selectedLineKey}
                posMode={posMode}
                preferredPrintPageSize={pos.settingsQuery.data?.paperSize === 'receipt' ? 'receipt' : 'a4'}
                settings={pos.settingsQuery.data}
                onCustomerChange={pos.setCustomerId}
                onTableNumberChange={pos.setTableNumber}
                onOrderTypeChange={pos.setOrderType}
                onQuickCustomerNameChange={pos.setQuickCustomerName}
                onQuickCustomerPhoneChange={pos.setQuickCustomerPhone}
                onQuickCustomerAddressChange={pos.setQuickCustomerAddress}
                onQuickCustomerSubmit={pos.handleQuickCustomerSubmit}
                onPaymentTypeChange={pos.setPaymentType}
                onPaymentPresetChange={pos.setPaymentPreset}
                onCashAmountChange={pos.setCashAmount}
                onCardAmountChange={pos.setCardAmount}
                onTransferAmountChange={pos.setTransferAmount}
                onDiscountChange={pos.setDiscount}
                onDeliveryFeeChange={pos.setDeliveryFee}
                onRequestDiscountAuthorization={onRequestDiscountAuthorization}
                onNoteChange={pos.setNote}
                onQtyChange={pos.setQty}
                onItemNoteChange={pos.setItemNote}
                onLineDiscountChange={pos.setLineDiscount}
                onItemModifiersClick={onItemModifiersClick}
                onItemSeatChange={pos.setItemSeat}
                onEditProduct={onEditProduct}
                onRemoveItem={onRequestLineDelete}
                onAddLineSerial={pos.addLineSerial}
                onRemoveLineSerial={pos.removeLineSerial}
                onSelectLine={pos.selectCartLine}
                onFillPaidAmount={pos.fillPaidAmount}
                onChangeSelectedQty={pos.changeSelectedQty}
                onChangeLineQtyByDelta={pos.changeLineQtyByDelta}
                onEditSelectedQty={pos.editSelectedQty}
                onRemoveSelectedItem={onRequestSelectedLineDelete}
                onHoldDraft={pos.holdDraft}
                onRecallDraft={pos.recallDraft}
                onDeleteDraft={onRequestHeldDelete}
                onClearHeldDrafts={onRequestClearHeldDrafts}
                onResetDraft={onRequestClearCart}
                onPrintPreview={onPrintCurrentDraft}
                onReprintLastSale={pos.reprintLastSale}
                onPrintReceiptNow={pos.printReceiptNow}
                onPrintA4Now={pos.printA4Now}
                onExportPdfNow={pos.exportPdfNow}
                onExportHeldDrafts={pos.exportHeldDrafts}
                showPaymentSection={false}
                showMetaSection={Boolean(pos.settingsQuery.data?.restaurantModuleEnabled && pos.settingsQuery.data?.posShowCartMeta)}
                showHeldDraftsInline={false}
                onSubmit={onRequestCheckout}
              />

              <PosWorkspaceDock
                qtySummaries={cartQtySummaries}
                itemsCount={cartItemsCount}
                total={pos.totals.total}
                canOpenCheckout={pos.canOpenCheckout}
                checkoutDisabledReason={pos.createSale.isPending ? __t('pos.pos_workspace.pos_workspace_main_content.s6', __t('pos.pos_workspace.pos_workspace_main_content.s6', "جاري تنفيذ البيع")) : pos.checkoutDisabledReason}
                isPending={pos.createSale.isPending}
                heldDraftsCount={heldDraftsCount}
                onFocusSearch={onFocusBarcodeEntry}
                onPrintPreview={onPrintCurrentDraft}
                onResetDraft={onRequestClearCart}
                onHoldDraft={() => { void pos.holdDraft(); }}
                onOpenHeldDrafts={onOpenHeldDrafts}
                onSubmit={() => onRequestCheckout()}
                settings={pos.settingsQuery.data}
              />
            </>
          ) : null}
        </div>
        </div>

        {/* Resizer handle — positioned absolutely over the gap between the two columns */}
        <div
          className="pos-resizer-handle"
          onPointerDown={startDrag}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `calc(${handlePositionPct}% - 12px)`,
            width: '24px',
            cursor: 'col-resize',
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title={isEn ? "Drag to resize panels" : __t('pos.pos_workspace.pos_workspace_main_content.s7', __t('pos.pos_workspace.pos_workspace_main_content.s7', "اسحب لتعديل مقاس الشاشة"))}
        >
          <div style={{ width: '4px', height: '40px', background: 'rgba(15, 23, 42, 0.15)', borderRadius: '8px' }} />
        </div>

        {/* Mobile Sticky Floating Cart Bar (visible only on small mobile screens when on products tab and cart has items) */}
        {mobileActiveTab === 'products' && cartItemsCount > 0 && typeof document !== 'undefined' && createPortal(
          <>
            {isFloatingCartExpanded && (
              <div
                className="pos-mobile-floating-cart-backdrop"
                onClick={() => setIsFloatingCartExpanded(false)}
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'rgba(15, 23, 42, 0.4)',
                  backdropFilter: 'blur(2px)',
                  WebkitBackdropFilter: 'blur(2px)',
                  zIndex: 999,
                }}
              />
            )}
            <div className={`pos-mobile-floating-cart-bar ${isFloatingCartExpanded ? 'is-expanded' : ''}`} dir="rtl">
              {/* Header / Drawer Handle with Toggle Button */}
              <div className="pos-mobile-floating-cart-header">
                <button
                  type="button"
                  className="pos-mobile-floating-cart-toggle-btn"
                  onClick={() => setIsFloatingCartExpanded((prev) => !prev)}
                  aria-label={isFloatingCartExpanded ? __t('pos.pos_workspace.pos_workspace_main_content.s8', __t('pos.pos_workspace.pos_workspace_main_content.s8', "تصغير قائمة الأصناف")) : __t('pos.pos_workspace.pos_workspace_main_content.s9', __t('pos.pos_workspace.pos_workspace_main_content.s9', "عرض أصناف السلة"))}
                  title={isFloatingCartExpanded ? __t('pos.pos_workspace.pos_workspace_main_content.s10', __t('pos.pos_workspace.pos_workspace_main_content.s10', "تصغير")) : __t('pos.pos_workspace.pos_workspace_main_content.s11', __t('pos.pos_workspace.pos_workspace_main_content.s11', "عرض الأصناف"))}
                >
                  <div className="pos-mobile-floating-cart-badge">{cartItemsCount}</div>
                  <div className="pos-mobile-floating-cart-text">
                    <div className="pos-mobile-floating-cart-text-row">
                      <strong className="pos-mobile-floating-cart-total">{formatCurrency(pos.totals.total)}</strong>
                      <span className="pos-mobile-floating-cart-unit"><CurrencySymbol /></span>
                    </div>
                    <span className="pos-mobile-floating-cart-sub">
                      {isFloatingCartExpanded ? __t('pos.pos_workspace.pos_workspace_main_content.s12', __t('pos.pos_workspace.pos_workspace_main_content.s12', "أصناف السلة (انقر للإغلاق)")) : `${cartItemsCount} صنف بالسلة • اضغط لمعاينة الأصناف`}
                    </span>
                  </div>
                  <span className="pos-mobile-floating-cart-chevron">
                    <svg
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{
                        transform: isFloatingCartExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.22s ease',
                      }}
                    >
                      <polyline points="18 15 12 9 6 15"></polyline>
                    </svg>
                  </span>
                </button>

                <div className="pos-mobile-floating-cart-actions">
                  <button
                    type="button"
                    className="pos-mobile-floating-checkout-btn"
                    onClick={() => {
                      setIsFloatingCartExpanded(false);
                      if (pos.canOpenCheckout) {
                        onRequestCheckout();
                      } else {
                        setMobileActiveTab('cart');
                      }
                    }}
                  >
                    <span>{__t('pos.pos_workspace.pos_workspace_main_content.s13', __t('pos.pos_workspace.pos_workspace_main_content.s13', "الدفع (F10)"))}</span>
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ transform: 'rotate(180deg)', flexShrink: 0 }}
                    >
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                      <polyline points="12 5 19 12 12 19"></polyline>
                    </svg>
                  </button>
                </div>
              </div>

              {/* Expanded Compact Items Preview */}
              {isFloatingCartExpanded && (
                <div className="pos-mobile-floating-cart-items-drawer">
                  <div className="pos-mobile-floating-cart-items-list">
                    {pos.cart.map((item, idx) => {
                      const lineTotal = calcCartLineTotal(item);
                      return (
                        <div key={item.lineKey || idx} className="pos-mobile-floating-cart-item-row">
                          <div className="pos-mobile-floating-cart-item-name-col">
                            <strong className="pos-mobile-floating-cart-item-name">{item.name}</strong>
                            <span className="pos-mobile-floating-cart-item-price-each">{formatCurrency(item.price)} <CurrencySymbol /> {__t('pos.pos_workspace.pos_workspace_main_content.s14', __t('pos.pos_workspace.pos_workspace_main_content.s14', "/ للوحدة"))}</span>
                          </div>

                          <div className="pos-mobile-floating-cart-item-qty-col">
                            <button
                              type="button"
                              className="pos-mobile-floating-qty-btn"
                              onClick={() => pos.changeLineQtyByDelta(item.lineKey, 1)}
                              aria-label={__t('pos.pos_workspace.pos_workspace_main_content.s15', __t('pos.pos_workspace.pos_workspace_main_content.s15', "زيادة الكمية"))}
                            >
                              +
                            </button>
                            <span className="pos-mobile-floating-qty-val">{item.qty}</span>
                            <button
                              type="button"
                              className="pos-mobile-floating-qty-btn"
                              onClick={() => pos.changeLineQtyByDelta(item.lineKey, -1)}
                              aria-label={__t('pos.pos_workspace.pos_workspace_main_content.s16', __t('pos.pos_workspace.pos_workspace_main_content.s16', "تقليل الكمية"))}
                            >
                              -
                            </button>
                          </div>

                          <div className="pos-mobile-floating-cart-item-total-col">
                            <strong>{formatCurrency(lineTotal)}</strong>
                            <span className="pos-mobile-floating-cart-unit-small"><CurrencySymbol /></span>
                          </div>

                          <button
                            type="button"
                            className="pos-mobile-floating-item-delete-btn"
                            onClick={() => onRequestLineDelete(item.lineKey)}
                            title={__t('pos.pos_workspace.pos_workspace_main_content.s17', __t('pos.pos_workspace.pos_workspace_main_content.s17', "حذف الصنف"))}
                            aria-label={__t('pos.pos_workspace.pos_workspace_main_content.s18', __t('pos.pos_workspace.pos_workspace_main_content.s18', "حذف"))}
                          ><XIcon size={15} /></button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="pos-mobile-floating-cart-drawer-footer">
                    <button
                      type="button"
                      className="pos-mobile-floating-view-full-cart-link"
                      onClick={() => {
                        setIsFloatingCartExpanded(false);
                        setMobileActiveTab('cart');
                      }}
                    >
                      {__t('pos.pos_workspace.pos_workspace_main_content.s19', __t('pos.pos_workspace.pos_workspace_main_content.s19', "عرض صفحة السلة الكاملة والملاحظات ←"))}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>,
          document.body
        )}
      </div>
    </QueryFeedback>
  );
}

/* POS render cost: memo with the default shallow compare. It only skips
 * when every prop is referentially identical — proven by
 * PosWorkspace.memo.spec.tsx with identical props. In production the
 * `pos` prop is still a fresh object on every workspace pass (the whole
 * object is deliberately NOT memoized: its action closures must keep
 * reading current values, and freezing them would serve stale values to
 * money logic), so this takes full effect only once pos identity is
 * stabilized; until then it still skips the (rarer) identical-props
 * re-renders and costs nothing — memo never changes what is rendered. */
export const PosWorkspaceMainContent = memo(PosWorkspaceMainContentComponent);
