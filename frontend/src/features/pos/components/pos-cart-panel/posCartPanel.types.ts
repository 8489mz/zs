import type { FormEvent } from 'react';
import type { Branch, Customer, Location, Product } from '@/types/domain';
import type { PosSaleMode } from '@/features/pos/lib/pos-sale-mode';
import type { PosItem } from '@/features/pos/types/pos.types';

export type PaymentType = 'cash' | 'credit';
export type PaymentChannel = 'cash' | 'card' | 'wallet' | 'instapay' | 'credit' | 'mixed';

export interface HeldPosDraftSummary {
  id: string;
  label: string;
  total: number;
  itemsCount: number;
  tableNumber?: string;
  orderType?: 'dine_in' | 'takeaway' | 'delivery';
  guestCount?: number;
  guestCheckPrintedAt?: string | null;
}

export interface PosCartPanelProps {
  products?: Product[];
  onNavigateToProducts?: () => void;
  cart: PosItem[];
  customers: Customer[];
  branches: Branch[];
  locations: Location[];
  customerId: string;
  branchId: string;
  locationId: string;
  tableNumber: string;
  orderType: string;
  paymentType: PaymentType;
  paymentChannel: PaymentChannel;
  paidAmount: number;
  cashAmount: number;
  cardAmount: number;
  transferAmount: number;
  discount: number;
  deliveryFee: number;
  note: string;
  submitMessage: string;
  lastSaleDocNo?: string;
  canShowLastSaleActions?: boolean;
  quickCustomerName: string;
  quickCustomerPhone: string;
  quickCustomerAddress: string;
  isQuickCustomerPending: boolean;
  heldDrafts: HeldPosDraftSummary[];
  isError: boolean;
  isPending: boolean;
  totals: { subTotal: number; discountValue: number; lineDiscountTotal?: number; deliveryFee: number; taxAmount: number; total: number };
  changeAmount: number;
  amountDue: number;
  hasOpenShift: boolean;
  canApplyDiscount: boolean;
  discountApprovalGranted?: boolean;
  isDiscountAuthorizationPending?: boolean;
  hasDiscountPermissionViolation?: boolean;
  adminDiscountWarning?: string;
  hasPricePermissionViolation?: boolean;
  allowNegativeStockSales?: boolean;
  canSubmitSale: boolean;
  canSubmitHint: string;
  lastAddedLineKey?: string;
  selectedLineKey?: string;
  posMode: PosSaleMode;
  preferredPrintPageSize?: 'a4' | 'receipt';
  settings?: any;
  onCustomerChange: (value: string) => void;
  onTableNumberChange: (value: string) => void;
  onOrderTypeChange: (value: string) => void;
  onQuickCustomerNameChange: (value: string) => void;
  onQuickCustomerPhoneChange: (value: string) => void;
  onQuickCustomerAddressChange: (value: string) => void;
  onQuickCustomerSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPaymentTypeChange: (value: PaymentType) => void;
  onPaymentPresetChange: (value: 'cash' | 'card' | 'wallet' | 'instapay' | 'credit') => void;
  onCashAmountChange: (value: number) => void;
  onCardAmountChange: (value: number) => void;
  onTransferAmountChange: (value: number) => void;
  onDiscountChange: (value: number) => void;
  onDeliveryFeeChange: (value: number) => void;
  onRequestDiscountAuthorization: () => void;
  onNoteChange: (value: string) => void;
  onQtyChange: (lineKey: string, qty: number) => void;
  /* INV-POS-LINE-DISCOUNT: per-line TOTAL discount (amount) for one
   * cart line. Optional like onItemModifiersClick: panels that do not
   * render the line-discount input leave it unset and the input stays
   * hidden; the POS cart panel always passes it. */
  onLineDiscountChange?: (lineKey: string, discount: number) => void;
  onItemNoteChange: (lineKey: string, notes: string) => void;
  onItemModifiersClick?: (lineKey: string) => void;
  onAddLineSerial?: (lineKey: string, serial: string) => void;
  onRemoveLineSerial?: (lineKey: string, serial: string) => void;
  onItemSeatChange?: (lineKey: string, seatNumber?: number) => void;
  onEditProduct?: (productId: string) => void;
  onRemoveItem: (lineKey: string) => void;
  onSelectLine: (lineKey: string) => void;
  onFillPaidAmount: () => void;
  onChangeLineQtyByDelta?: (lineKey: string, delta: number) => void;
  onChangeSelectedQty: (delta: number) => void;
  onEditSelectedQty: () => void;
  onRemoveSelectedItem: () => void;
  onHoldDraft: () => void;
  onRecallDraft: (draftId: string) => void;
  onDeleteDraft: (draftId: string) => void;
  onClearHeldDrafts: () => void;
  onResetDraft: () => void;
  onPrintPreview: () => void;
  onReprintLastSale: () => void;
  onPrintReceiptNow: () => void;
  onPrintA4Now: () => void;
  onExportPdfNow: () => void;
  onExportHeldDrafts: () => void;
  onSubmit: () => void;
  showPaymentSection?: boolean;
  showMetaSection?: boolean;
  showHeldDraftsInline?: boolean;
}
