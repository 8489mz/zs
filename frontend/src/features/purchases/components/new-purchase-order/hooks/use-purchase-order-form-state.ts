import {useRef, useState, type Dispatch, type SetStateAction} from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { usePurchaseComposerCatalog } from '@/features/purchases/hooks/usePurchaseComposerCatalog';
import { useAuthStore } from '@/stores/auth-store';
import { useTranslation } from '../../../utils/i18n-purchase-prototype';
import {
  type DocumentStatus,
  type InlineMessageTone,
  type PrototypeLine,
  type QuickCreateState,
  type ValidationErrors,
  PURCHASE_DRAFT_STORAGE_KEY,
} from '../newPurchaseOrder.types';
import { addDaysLocalDateKey, todayLocalDateKey } from '@/lib/format';

export interface PurchaseOrderDraftUi {
  hasLoadedDraftRef: { current: boolean };
  setValidationErrors: Dispatch<SetStateAction<ValidationErrors>>;
  setInlineMessage: Dispatch<SetStateAction<{ tone: InlineMessageTone; text: string } | null>>;
  setDocumentStatus: Dispatch<SetStateAction<DocumentStatus>>;
}

export function usePurchaseOrderFormState() {
  const queryClient = useQueryClient();
  const { t, language } = useTranslation();
  // @ts-expect-error unused variable
  const { theme, updateSessionMeta } = useAuthStore();
  const isDarkMode = theme === 'dark';
  const [activeQuickAction, setActiveQuickAction] = useState<'tax' | 'discount' | null>(null);
  const [discountMode, setDiscountMode] = useState<'percent' | 'value'>('value');
  const [customTaxRate, setCustomTaxRate] = useState('14');
  const [pendingFocusLineId, setPendingFocusLineId] = useState<number | null>(null);
  const [lines, setLines] = useState<PrototypeLine[]>([{ id: Date.now(), productId: null, itemName: '', qty: 1, unitPrice: 0, warehouse: '' }]);
  const [supplier, setSupplier] = useState('');
  const [paymentType, setPaymentType] = useState<'cash' | 'credit'>('credit');
  const [date, setDate] = useState(todayLocalDateKey());
  const [requiredDate, setRequiredDate] = useState(addDaysLocalDateKey(5));
  const [currency, setCurrency] = useState('');
  const [company, setCompany] = useState('');
  const [contact, setContact] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [taxRate, setTaxRate] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [costCenter, setCostCenter] = useState('');
  const [project, setProject] = useState('');
  const [termsTemplate, setTermsTemplate] = useState('');
  const [notes, setNotes] = useState('');
  const [attachments, setAttachments] = useState<any[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingFocusQtyLineId, setPendingFocusQtyLineId] = useState<number | null>(null);

  const [quickCreateState, setQuickCreateState] = useState<QuickCreateState>(null);
  const [productCreateModalState, setProductCreateModalState] = useState<{isOpen: boolean, query: string, barcode: string, lineId: number | null}>({ isOpen: false, query: '', barcode: '', lineId: null });
  const [barcodeScanOpen, setBarcodeScanOpen] = useState(false);
  const [barcodeScanQuery, setBarcodeScanQuery] = useState('');
  const [createdPurchase, setCreatedPurchase] = useState<any>(null);
  const [isPolling, setIsPolling] = useState(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  const currentPayloadRef = useRef<string | null>(null);
  const navigate = useNavigate();
  const catalog = usePurchaseComposerCatalog();
  const resetFormFields = (draftUi: PurchaseOrderDraftUi) => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(PURCHASE_DRAFT_STORAGE_KEY);
    }
    draftUi.hasLoadedDraftRef.current = false;
    setLines([{ id: Date.now(), productId: null, itemName: '', qty: 1, unitPrice: 0, warehouse: '' }]);
    setSupplier('');
    setPaymentType('credit');
    setDate(todayLocalDateKey());
    setRequiredDate(addDaysLocalDateKey(5));
    setCurrency('EGP');
    setCompany('');
    setContact('');
    setShippingAddress('');
    setTaxRate(0);
    setDiscount(0);
    setCostCenter('');
    setProject('');
    setTermsTemplate('');
    setNotes('');
    setAttachments([]);
    draftUi.setValidationErrors({ rows: {} });
    draftUi.setInlineMessage(null);
    draftUi.setDocumentStatus('draft');
  };
  return {
    queryClient,
    t,
    language,
    theme,
    isDarkMode,
    activeQuickAction,
    setActiveQuickAction,
    discountMode,
    setDiscountMode,
    customTaxRate,
    setCustomTaxRate,
    pendingFocusLineId,
    setPendingFocusLineId,
    lines,
    setLines,
    supplier,
    setSupplier,
    paymentType,
    setPaymentType,
    date,
    setDate,
    requiredDate,
    setRequiredDate,
    currency,
    setCurrency,
    company,
    setCompany,
    contact,
    setContact,
    shippingAddress,
    setShippingAddress,
    taxRate,
    setTaxRate,
    discount,
    setDiscount,
    costCenter,
    setCostCenter,
    project,
    setProject,
    termsTemplate,
    setTermsTemplate,
    notes,
    setNotes,
    attachments,
    setAttachments,
    isUploading,
    setIsUploading,
    pendingFocusQtyLineId,
    setPendingFocusQtyLineId,
    quickCreateState,
    setQuickCreateState,
    productCreateModalState,
    setProductCreateModalState,
    barcodeScanOpen,
    setBarcodeScanOpen,
    barcodeScanQuery,
    setBarcodeScanQuery,
    createdPurchase,
    setCreatedPurchase,
    isPolling,
    setIsPolling,
    idempotencyKeyRef,
    currentPayloadRef,
    navigate,
    catalog,
    resetFormFields,
  };
}
