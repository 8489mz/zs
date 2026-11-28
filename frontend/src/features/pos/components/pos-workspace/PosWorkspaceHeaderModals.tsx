import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/shared/ui/button';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { applyComboToCart, isNegativeStockSalesAllowed } from '@/features/pos/lib/pos.domain';
import { transferTableOrder } from '@/features/pos/lib/pos-table-transfer';
import { PosOnlineOrdersModal } from './PosOnlineOrdersModal';
import { PosTablesFloorPlanDialog } from './PosTablesFloorPlanDialog';
import { PosOnlineOrderFloatingAlert } from './PosOnlineOrderFloatingAlert';
import { PosOfflineQueueModal } from './PosOfflineQueueModal';
import { PosInstantExchangeDialog } from './PosInstantExchangeDialog';
import { PosDeliveryAggregatorsModal } from './PosDeliveryAggregatorsModal';
import { PosFoodWasteModal } from './PosFoodWasteModal';
import { RestaurantDeliveryDispatcherModal } from './RestaurantDeliveryDispatcherModal';
import { Pos86ItemsModal } from './Pos86ItemsModal';
import { PosTipPoolModal } from './PosTipPoolModal';
import { KitchenDailyPrepSheetModal } from './KitchenDailyPrepSheetModal';
import { PosPlateCostRadarModal } from './PosPlateCostRadarModal';
import { PosCustomerPunchCardModal } from './PosCustomerPunchCardModal';
import { PosDriveThruModal } from './PosDriveThruModal';
import { PosSmartUpsellModal } from './PosSmartUpsellModal';
import { PosRestaurantOperationsModal } from './PosRestaurantOperationsModal';
import { PosDisplaysModal } from './PosDisplaysModal';
import { PosManagerCompModal } from './PosManagerCompModal';
import { PosComboMealModal } from './PosComboMealModal';
import { PosCustomizationDialog } from './PosCustomizationDialog';
import { restaurantAdvancedFnbApi } from '@/features/pos/api/restaurant-advanced-fnb.api';
import { toast } from '@/shared/components/system-alert';
import { currencyMoneyDigits } from '@/shared/utils/money';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';

export interface PosWorkspaceHeaderModalsProps {
  pos: PosWorkspaceState;
  settings: any;
  isRestaurantActive: boolean;
  isPhoneOrdersActive: boolean;
  isStorefrontActive: boolean;
  isManager: boolean;
  count86: number;
  offlineQueue: any[];
  isSyncing: boolean;
  syncOfflineSales: () => void;
  pendingCount: number;
  showFloatingAlert: boolean;
  setShowFloatingAlert: Dispatch<SetStateAction<boolean>>;
  noSaleReason: string;
  setNoSaleReason: Dispatch<SetStateAction<string>>;
  noSaleManagerPin?: string;
  setNoSaleManagerPin?: Dispatch<SetStateAction<string>>;
  requiresNoSalePin?: boolean;
  isNoSalePending: boolean;
  handleNoSaleDrawerKick: () => Promise<void>;
  upsellRules: any[];
  setUpsellRules: Dispatch<SetStateAction<any[]>>;
  onOpenTables?: () => void;
  onOpenComboModal?: () => void;
  onPrintCupLabels?: () => void;
  onOpenManagerComp?: () => void;
  isOnlineOrdersOpen: boolean;
  setIsOnlineOrdersOpen: Dispatch<SetStateAction<boolean>>;
  isTablesOpen: boolean;
  setIsTablesOpen: Dispatch<SetStateAction<boolean>>;
  isOfflineQueueModalOpen: boolean;
  setIsOfflineQueueModalOpen: Dispatch<SetStateAction<boolean>>;
  isNoSaleOpen: boolean;
  setIsNoSaleOpen: Dispatch<SetStateAction<boolean>>;
  isExchangeOpen: boolean;
  setIsExchangeOpen: Dispatch<SetStateAction<boolean>>;
  isAggregatorsOpen: boolean;
  setIsAggregatorsOpen: Dispatch<SetStateAction<boolean>>;
  isDriverDispatchOpen: boolean;
  setIsDriverDispatchOpen: Dispatch<SetStateAction<boolean>>;
  isFoodWasteOpen: boolean;
  setIsFoodWasteOpen: Dispatch<SetStateAction<boolean>>;
  is86ModalOpen: boolean;
  setIs86ModalOpen: Dispatch<SetStateAction<boolean>>;
  isTipPoolOpen: boolean;
  setIsTipPoolOpen: Dispatch<SetStateAction<boolean>>;
  isPrepSheetOpen: boolean;
  setIsPrepSheetOpen: Dispatch<SetStateAction<boolean>>;
  isPlateRadarOpen: boolean;
  setIsPlateRadarOpen: Dispatch<SetStateAction<boolean>>;
  isStampCardOpen: boolean;
  setIsStampCardOpen: Dispatch<SetStateAction<boolean>>;
  isDriveThruOpen: boolean;
  setIsDriveThruOpen: Dispatch<SetStateAction<boolean>>;
  isUpsellModalOpen: boolean;
  setIsUpsellModalOpen: Dispatch<SetStateAction<boolean>>;
  isOpsModalOpen: boolean;
  setIsOpsModalOpen: Dispatch<SetStateAction<boolean>>;
  isDisplaysModalOpen: boolean;
  setIsDisplaysModalOpen: Dispatch<SetStateAction<boolean>>;
  isManagerCompOpen: boolean;
  setIsManagerCompOpen: Dispatch<SetStateAction<boolean>>;
  isComboMealModalOpen: boolean;
  setIsComboMealModalOpen: Dispatch<SetStateAction<boolean>>;
  isCustomizationOpen: boolean;
  setIsCustomizationOpen: Dispatch<SetStateAction<boolean>>;
}

export function PosWorkspaceHeaderModals(props: PosWorkspaceHeaderModalsProps) {
  const { t } = useTranslation();
  const {
    pos, settings, isRestaurantActive, isPhoneOrdersActive, isStorefrontActive, isManager, count86,
    offlineQueue, isSyncing, syncOfflineSales, pendingCount, showFloatingAlert, setShowFloatingAlert,
    noSaleReason, setNoSaleReason, noSaleManagerPin, setNoSaleManagerPin, requiresNoSalePin, isNoSalePending, handleNoSaleDrawerKick, upsellRules, setUpsellRules,
    onOpenTables, onOpenComboModal, onPrintCupLabels, onOpenManagerComp,
    isOnlineOrdersOpen, setIsOnlineOrdersOpen, isTablesOpen, setIsTablesOpen,
    isOfflineQueueModalOpen, setIsOfflineQueueModalOpen, isNoSaleOpen, setIsNoSaleOpen,
    isExchangeOpen, setIsExchangeOpen, isAggregatorsOpen, setIsAggregatorsOpen,
    isDriverDispatchOpen, setIsDriverDispatchOpen, isFoodWasteOpen, setIsFoodWasteOpen,
    is86ModalOpen, setIs86ModalOpen, isTipPoolOpen, setIsTipPoolOpen,
    isPrepSheetOpen, setIsPrepSheetOpen, isPlateRadarOpen, setIsPlateRadarOpen,
    isStampCardOpen, setIsStampCardOpen, isDriveThruOpen, setIsDriveThruOpen,
    isUpsellModalOpen, setIsUpsellModalOpen, isOpsModalOpen, setIsOpsModalOpen,
    isDisplaysModalOpen, setIsDisplaysModalOpen, isManagerCompOpen, setIsManagerCompOpen,
    isComboMealModalOpen, setIsComboMealModalOpen, isCustomizationOpen, setIsCustomizationOpen,
  } = props;
  return (
    <>
    {isOnlineOrdersOpen && (
      <PosOnlineOrdersModal
        isOpen={isOnlineOrdersOpen}
        onClose={() => setIsOnlineOrdersOpen(false)}
      />
    )}
    {!onOpenTables && isTablesOpen && (
      <PosTablesFloorPlanDialog
        open={isTablesOpen}
        onClose={() => setIsTablesOpen(false)}
        currentTableNumber={pos.tableNumber}
        currentCartItemsCount={pos.cart.length}
        currentCartTotal={Number(pos.totals?.total || 0)}
        heldDrafts={pos.heldDraftSummaries || []}
        onSelectTable={async (tableNum) => {
          if (pos.cart.length > 0) {
            await pos.holdDraft();
          }
          pos.setOrderType('dine_in');
          pos.setTableNumber(tableNum);
          pos.setCustomerId('');
          pos.setQuickCustomerName('');
          pos.setQuickCustomerPhone('');
          pos.setQuickCustomerAddress('');
        }}
        onRecallDraft={async (draftId) => {
          if (pos.cart.length > 0) {
            await pos.holdDraft();
          }
          await pos.recallDraft(draftId);
        }}
        onTransferTable={async (from, to) => {
          // INV-REST-FLOOR-TRANSFER-TRUTH (T10-E, F6): one shared
          // handler — see PosWorkspace; the old inline copy persisted
          // via raw API calls without invalidating the held-drafts
          // query, and its fall-through toasted success while
          // persisting nothing.
          const outcome = await transferTableOrder({
            from,
            to,
            heldDrafts: pos.heldDrafts,
            tableNumber: pos.tableNumber,
            cart: pos.cart,
            customerId: pos.customerId,
            paymentType: pos.paymentType,
            discount: pos.discount,
            deliveryFee: pos.deliveryFee,
            note: pos.note,
            search: pos.search,
            priceType: pos.priceType,
            branchId: pos.branchId,
            locationId: pos.locationId,
            cashAmount: pos.cashAmount,
            cardAmount: pos.cardAmount,
            transferAmount: pos.transferAmount,
            paymentChannel: pos.paymentChannel,
            orderType: pos.orderType,
            saveHeldDraft: (payload) => pos.saveHeldDraftMutation.mutateAsync(payload),
          });
          if (outcome.status === 'error') {
            toast.error(outcome.message);
            return;
          }
          if (outcome.status === 'held-saved') {
            pos.setCart([]);
          }
          pos.setTableNumber(to);
          toast.success(`تم نقل الطلب بنجاح من طاولة ${from} إلى طاولة ${to}`);
        }}
      />
    )}
    {showFloatingAlert && (
      <PosOnlineOrderFloatingAlert
        orderCount={pendingCount}
        onOpenOrders={() => {
          setShowFloatingAlert(false);
          setIsOnlineOrdersOpen(true);
        }}
        onDismiss={() => setShowFloatingAlert(false)}
      />
    )}
    {isOfflineQueueModalOpen && (
      <PosOfflineQueueModal
        open={isOfflineQueueModalOpen}
        onClose={() => setIsOfflineQueueModalOpen(false)}
        offlineQueue={offlineQueue}
        isSyncing={isSyncing}
        onRetrySync={syncOfflineSales}
      />
    )}
    {isNoSaleOpen && (
      <StandardDialog
        open={isNoSaleOpen}
        onClose={() => { if (!isNoSalePending) setIsNoSaleOpen(false); }}
        title={t('pos.pos_workspace.pos_workspace_header.s53', "فتح الدرج بدون بيع")}
        subtitle={t('pos.pos_workspace.pos_workspace_header.s54', "سيُحفظ اسم المستخدم والوردية والسبب في سجل التدقيق قبل إرسال أمر فتح الدرج.")}
        width="min(520px, 95vw)"
        compact
        closeOnBackdrop={!isNoSalePending}
        footerActions={(
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsNoSaleOpen(false)}
              disabled={isNoSalePending}
            >
              إلغاء
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => { void handleNoSaleDrawerKick(); }}
              disabled={isNoSalePending || !noSaleReason.trim() || (Boolean(requiresNoSalePin) && !String(noSaleManagerPin || '').trim())}
            >
              {isNoSalePending
                ? t('pos.pos_workspace.pos_workspace_header.s57', "جاري فتح الدرج...")
                : t('pos.pos_workspace.pos_workspace_header.s58', "فتح الدرج")}
            </Button>
          </>
        )}
      >
        <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label
            htmlFor="pos-no-sale-reason"
            style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', margin: 0 }}
          >
            {t('pos.pos_workspace.pos_workspace_header.s55', "سبب فتح الدرج")}
          </label>
          <textarea
            id="pos-no-sale-reason"
            value={noSaleReason}
            onChange={(event) => setNoSaleReason(event.target.value)}
            maxLength={500}
            rows={3}
            placeholder="اكتب سبب فتح الدرج يدوياً (مثل: فكة نقدية، مراجعة عهدة)..."
            disabled={isNoSalePending}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '0.84rem',
              fontWeight: 600,
              color: '#0f172a',
              background: '#ffffff',
              resize: 'vertical',
              outline: 'none',
            }}
          />
          {requiresNoSalePin && setNoSaleManagerPin && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
              <label
                htmlFor="pos-no-sale-manager-pin"
                style={{ fontSize: '0.8rem', fontWeight: 700, color: '#b91c1c', margin: 0 }}
              >
                رمز أو كلمة مرور المدير (إلزامي لفتح الدرج بدون بيع)
              </label>
              <input
                id="pos-no-sale-manager-pin"
                type="password"
                autoComplete="new-password"
                className="secure-password-field"
                value={noSaleManagerPin || ''}
                onChange={(event) => setNoSaleManagerPin(event.target.value)}
                placeholder="أدخل رمز المدير أو كلمة مروره..."
                disabled={isNoSalePending}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid #fca5a5',
                  fontSize: '0.84rem',
                  fontWeight: 600,
                  color: '#0f172a',
                  background: '#fffafa',
                  outline: 'none',
                }}
              />
            </div>
          )}
        </div>
      </StandardDialog>
    )}
    {isExchangeOpen && (
      <PosInstantExchangeDialog open={isExchangeOpen} onClose={() => setIsExchangeOpen(false)} pos={pos} />
    )}
    {isAggregatorsOpen && (
      <PosDeliveryAggregatorsModal
        open={isAggregatorsOpen}
        onClose={() => setIsAggregatorsOpen(false)}
        onBack={() => { setIsAggregatorsOpen(false); setIsOpsModalOpen(true); }}
      />
    )}
    {isDriverDispatchOpen && (
      <RestaurantDeliveryDispatcherModal
        open={isDriverDispatchOpen}
        onClose={() => setIsDriverDispatchOpen(false)}
        onBack={() => { setIsDriverDispatchOpen(false); setIsOpsModalOpen(true); }}
      />
    )}
    {isFoodWasteOpen && (
      <PosFoodWasteModal
        open={isFoodWasteOpen}
        onClose={() => setIsFoodWasteOpen(false)}
        branchId={Number(pos.branchId) || 1}
        onBack={() => { setIsFoodWasteOpen(false); setIsOpsModalOpen(true); }}
      />
    )}
    {is86ModalOpen && (
      <Pos86ItemsModal
        open={is86ModalOpen}
        onClose={() => setIs86ModalOpen(false)}
        products={(pos as any).productsQuery?.data || []}
        branchId={Number(pos.branchId) || undefined}
        onBack={() => { setIs86ModalOpen(false); setIsOpsModalOpen(true); }}
      />
    )}
    {isTipPoolOpen && (
      <PosTipPoolModal
        open={isTipPoolOpen}
        onClose={() => setIsTipPoolOpen(false)}
        branchId={Number(pos.branchId) || undefined}
        currency={(pos as any).currency || t('pos.pos_workspace.pos_workspace_header.s59', "ج.م")}
        onBack={() => { setIsTipPoolOpen(false); setIsOpsModalOpen(true); }}
      />
    )}
    {isPrepSheetOpen && (
      <KitchenDailyPrepSheetModal
        open={isPrepSheetOpen}
        onClose={() => setIsPrepSheetOpen(false)}
        branchId={Number(pos.branchId) || undefined}
        onBack={() => { setIsPrepSheetOpen(false); setIsOpsModalOpen(true); }}
      />
    )}
    {isPlateRadarOpen && (
      <PosPlateCostRadarModal
        open={isPlateRadarOpen}
        onClose={() => setIsPlateRadarOpen(false)}
        currency={(pos as any).currency || t('pos.pos_workspace.pos_workspace_header.s60', "ج.م")}
        onBack={() => { setIsPlateRadarOpen(false); setIsOpsModalOpen(true); }}
      />
    )}
    {isStampCardOpen && (
      <PosCustomerPunchCardModal
        open={isStampCardOpen}
        onClose={() => setIsStampCardOpen(false)}
        customerId={Number(pos.customerId) || 1}
        customerName={(pos as any).customerName || t('pos.pos_workspace.pos_workspace_header.s61', "العميل الحالي")}
        onBack={() => { setIsStampCardOpen(false); setIsOpsModalOpen(true); }}
      />
    )}
    {isDriveThruOpen && (
      <PosDriveThruModal
        open={isDriveThruOpen}
        onClose={() => setIsDriveThruOpen(false)}
        branchId={Number(pos.branchId) || undefined}
        onBack={() => { setIsDriveThruOpen(false); setIsOpsModalOpen(true); }}
      />
    )}
    {isUpsellModalOpen && (
      <PosSmartUpsellModal
        open={isUpsellModalOpen}
        onClose={() => setIsUpsellModalOpen(false)}
        recommendations={upsellRules}
        onBack={() => { setIsUpsellModalOpen(false); setIsOpsModalOpen(true); }}
        onAcceptUpsell={(product: any) => {
          if ((pos as any).addProduct) {
            (pos as any).addProduct(product);
          }
        }}
      />
    )}
    {isOpsModalOpen && (
      <PosRestaurantOperationsModal
        open={isOpsModalOpen}
        onClose={() => setIsOpsModalOpen(false)}
        isManager={isManager}
        count86={count86}
        cartLength={pos.cart.length}
        isPhoneOrdersActive={Boolean(isPhoneOrdersActive)}
        isRestaurantActive={Boolean(isRestaurantActive)}
        isStorefrontActive={Boolean(isStorefrontActive)}
        onOpenCombo={onOpenComboModal || (() => setIsComboMealModalOpen(true))}
        onOpenCupLabels={onPrintCupLabels}
        onOpenStampCard={() => setIsStampCardOpen(true)}
        onOpenDriveThru={() => setIsDriveThruOpen(true)}
        onOpenUpsell={async () => {
          try {
            const firstProductId = Number(pos.cart[0]?.productId) || undefined;
            const rules = await restaurantAdvancedFnbApi.getUpsellRecommendations(firstProductId);
            setUpsellRules(rules || []);
            setIsUpsellModalOpen(true);
          } catch {
            setIsUpsellModalOpen(true);
          }
        }}
        onOpen86={() => setIs86ModalOpen(true)}
        onOpenManagerComp={onOpenManagerComp || (() => setIsManagerCompOpen(true))}
        onOpenPlateRadar={() => setIsPlateRadarOpen(true)}
        onOpenPrepSheet={() => setIsPrepSheetOpen(true)}
        onOpenFoodWaste={() => setIsFoodWasteOpen(true)}
        onOpenTipPool={() => setIsTipPoolOpen(true)}
        onOpenAggregators={() => setIsAggregatorsOpen(true)}
        onOpenDriverDispatch={() => setIsDriverDispatchOpen(true)}
      />
    )}
    {isDisplaysModalOpen && (
      <PosDisplaysModal
        open={isDisplaysModalOpen}
        onClose={() => setIsDisplaysModalOpen(false)}
        isRestaurantActive={Boolean(isRestaurantActive)}
      />
    )}
    {isManagerCompOpen && (
      <PosManagerCompModal
        open={isManagerCompOpen}
        onClose={() => setIsManagerCompOpen(false)}
        onBack={() => {
          setIsManagerCompOpen(false);
          setIsOpsModalOpen(true);
        }}
        currentCartTotal={Number(pos.totals?.total || 0)}
        currentTableNumber={pos.tableNumber || undefined}
        cartSummary={pos.cart.map((i) => `${i.qty}× ${i.name}`).join(t('pos.pos_workspace.pos_workspace_header.s62', "، "))}
        onApplyComp={async (comp) => {
          pos.setDiscount(comp.amount);
          pos.setNote(`ضيافة إدارة [${comp.compType}] - معتمد: ${comp.managerName}${comp.notes ? ` - ${comp.notes}` : ''}`);
          setIsManagerCompOpen(false);
        }}
      />
    )}
    {isComboMealModalOpen && (
      <PosComboMealModal
        open={isComboMealModalOpen}
        onClose={() => setIsComboMealModalOpen(false)}
        onBack={() => {
          setIsComboMealModalOpen(false);
          setIsOpsModalOpen(true);
        }}
        products={(pos as any).productsQuery?.data || []}
        onAddComboToCart={(combo) => {
          const product = ((pos as any).productsQuery?.data || []).find((p: any) => p.id === combo.productId);
          // R8-C path 1: the main vanished from the catalog between modal
          // open and confirm. Was a silent no-op; now a named toast + false
          // so the modal stays open instead of closing on a lost combo.
          if (!product) {
            toast.error('تعذّر إضافة الوجبة: الصنف الرئيسي غير موجود في الكتالوج.');
            return false;
          }
          const comboLineId = `combo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          const comboOptions = {
            priceType: pos.priceType,
            digits: currencyMoneyDigits(settings?.currency || getGlobalSystemCurrency()),
            allowNegativeStockSales: isNegativeStockSalesAllowed(settings) || Boolean((product as any).hasBom),
            comboLineId,
          };
          // R8-C: ONE apply, on the current cart — its result IS the cart
          // setCart installs, so the returned boolean is exact. The old
          // double-apply (pre-flight + setCart updater with a silent
          // `catch { return prevCart; }`) could swallow a failure that only
          // appears with the freshest cart AFTER the modal had closed
          // (path 3). The handler is synchronous, so no other cart write
          // can interleave between the apply and setCart.
          let nextCart: { cart: any[]; lineKey: string };
          try {
            nextCart = applyComboToCart(pos.cart, product, combo, comboOptions);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'تعذّر إضافة الوجبة إلى السلة.');
            return false;
          }
          pos.setCart(nextCart.cart);
          pos.setSelectedLineKey(nextCart.lineKey);
          pos.setLastAddedLineKey(nextCart.lineKey);
          toast.success(`تمت إضافة ${combo.productName} إلى السلة بنجاح`);
          return true;
        }}
      />
    )}
    {isCustomizationOpen && (
      <PosCustomizationDialog
        isOpen={isCustomizationOpen}
        onClose={() => setIsCustomizationOpen(false)}
      />
    )}
    </>
  );
}
