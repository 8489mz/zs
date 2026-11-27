import {useEffect, type Dispatch, type SetStateAction} from 'react';
import { useAppToolbar } from '@/stores/toolbar-store';
import type { useTranslation } from '../../../utils/i18n-purchase-prototype';
import {
  type DocumentStatus,
  type InlineMessageTone,
  type PrototypeLine,
  type PurchasePrototypeDraft,
  PURCHASE_DRAFT_STORAGE_KEY,
} from '../newPurchaseOrder.types';
import type { DraftCatalog, DraftCatalogSetters } from './use-purchase-order-draft';
import type { PurchaseOrderDraftUi } from './use-purchase-order-form-state';

// S9 — effects-toolbar sub-hook, moved from useNewPurchaseOrderController
// (L1271-1453). The S2 catalog lists + setters are hook args here (S9 is
// called after S2) and are forwarded as call-time params to the S3 draft
// functions (prep §3 crossing #2): buildDraftPayload(documentStatus,
// catalog) and restoreDraftFromStorage(payload, catalogSetters). The
// resetFormFields call takes its call-time draftUi (prep §3 crossing #1).

/** Hook args for the S9 effects-toolbar slice. */
export interface UsePurchaseOrderEffectsArgs {
  // S3 draft
  hasLoadedDraftRef: { current: boolean };
  restoreDraftFromStorage: (payload: PurchasePrototypeDraft, catalogSetters: DraftCatalogSetters) => void;
  computeHasMeaningfulData: () => boolean;
  lastSavedSnapshotRef: { current: string | null };
  buildDraftPayload: (status: DocumentStatus, catalog: DraftCatalog) => PurchasePrototypeDraft;
  documentStatus: DocumentStatus;
  inlineMessage: { tone: InlineMessageTone; text: string } | null;
  setInlineMessage: Dispatch<SetStateAction<{ tone: InlineMessageTone; text: string } | null>>;
  // S1 form-state
  supplier: string;
  date: string;
  requiredDate: string;
  currency: string;
  company: string;
  contact: string;
  shippingAddress: string;
  discount: number;
  customTaxRate: string;
  costCenter: string;
  project: string;
  termsTemplate: string;
  notes: string;
  lines: PrototypeLine[];
  taxRate: number;
  discountMode: 'percent' | 'value';
  pendingFocusLineId: number | null;
  setPendingFocusLineId: Dispatch<SetStateAction<number | null>>;
  pendingFocusQtyLineId: number | null;
  setPendingFocusQtyLineId: Dispatch<SetStateAction<number | null>>;
  t: ReturnType<typeof useTranslation>['t'];
  setCreatedPurchase: Dispatch<SetStateAction<any>>;
  resetFormFields: (draftUi: PurchaseOrderDraftUi) => void;
  draftUi: PurchaseOrderDraftUi;
  // S2 catalog lists (forwarded to buildDraftPayload as the call-time catalog)
  suppliers: DraftCatalog['suppliers'];
  contactsList: DraftCatalog['contactsList'];
  addressesList: DraftCatalog['addressesList'];
  products: DraftCatalog['products'];
  warehouses: DraftCatalog['warehouses'];
  costCenters: DraftCatalog['costCenters'];
  projects: DraftCatalog['projects'];
  // S2 catalog setters (forwarded to restoreDraftFromStorage as the call-time setters)
  setSuppliers: DraftCatalogSetters['setSuppliers'];
  setContactsList: DraftCatalogSetters['setContactsList'];
  setAddressesList: DraftCatalogSetters['setAddressesList'];
  setProducts: DraftCatalogSetters['setProducts'];
  setWarehouses: DraftCatalogSetters['setWarehouses'];
  setCostCenters: DraftCatalogSetters['setCostCenters'];
  setProjects: DraftCatalogSetters['setProjects'];
}

export function usePurchaseOrderEffects(args: UsePurchaseOrderEffectsArgs) {
  const {
    hasLoadedDraftRef,
    restoreDraftFromStorage,
    computeHasMeaningfulData,
    lastSavedSnapshotRef,
    buildDraftPayload,
    documentStatus,
    inlineMessage,
    setInlineMessage,
    supplier,
    date,
    requiredDate,
    currency,
    company,
    contact,
    shippingAddress,
    discount,
    customTaxRate,
    costCenter,
    project,
    termsTemplate,
    notes,
    lines,
    taxRate,
    discountMode,
    pendingFocusLineId,
    setPendingFocusLineId,
    pendingFocusQtyLineId,
    setPendingFocusQtyLineId,
    t,
    setCreatedPurchase,
    resetFormFields,
    draftUi,
    suppliers,
    contactsList,
    addressesList,
    products,
    warehouses,
    costCenters,
    projects,
    setSuppliers,
    setContactsList,
    setAddressesList,
    setProducts,
    setWarehouses,
    setCostCenters,
    setProjects,
  } = args;

  useEffect(() => {
    if (hasLoadedDraftRef.current || typeof window === 'undefined') {
      return;
    }

    hasLoadedDraftRef.current = true;
    const raw = window.localStorage.getItem(PURCHASE_DRAFT_STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<PurchasePrototypeDraft>;
      if (!parsed || typeof parsed !== 'object') {
        return;
      }

      restoreDraftFromStorage({
        supplier: parsed.supplier ?? supplier,
        date: parsed.date ?? date,
        requiredDate: parsed.requiredDate ?? requiredDate,
        currency: parsed.currency ?? currency,
        company: parsed.company ?? company,
        contact: parsed.contact ?? contact,
        shippingAddress: parsed.shippingAddress ?? shippingAddress,
        taxRate: typeof parsed.taxRate === 'number' ? parsed.taxRate : 0,
        discount: typeof parsed.discount === 'number' ? parsed.discount : discount,
        discountMode: parsed.discountMode === 'percent' ? 'percent' : 'value',
        customTaxRate: parsed.customTaxRate ?? customTaxRate,
        costCenter: parsed.costCenter ?? costCenter,
        project: parsed.project ?? project,
        termsTemplate: parsed.termsTemplate ?? termsTemplate,
        notes: parsed.notes ?? notes,
        lines: Array.isArray(parsed.lines) ? parsed.lines : lines,
        suppliers: Array.isArray(parsed.suppliers) ? parsed.suppliers : suppliers,
        contactsList: Array.isArray(parsed.contactsList) ? parsed.contactsList : contactsList,
        addressesList: Array.isArray(parsed.addressesList) ? parsed.addressesList : addressesList,
        products: Array.isArray(parsed.products) ? parsed.products : products,
        warehouses: Array.isArray(parsed.warehouses) ? parsed.warehouses : warehouses,
        costCenters: Array.isArray(parsed.costCenters) ? parsed.costCenters : costCenters,
        projects: Array.isArray(parsed.projects) ? parsed.projects : projects,
        status: parsed.status === 'confirmed' ? 'confirmed' : 'draft'
      }, {
        setSuppliers,
        setContactsList,
        setAddressesList,
        setProducts,
        setWarehouses,
        setCostCenters,
        setProjects,
      });
    } catch {
      window.localStorage.removeItem(PURCHASE_DRAFT_STORAGE_KEY);
    }
  }, []);

  // Debounced auto-save to localStorage on form changes
  useEffect(() => {
    if (!hasLoadedDraftRef.current || typeof window === 'undefined') {
      return;
    }

    if (!computeHasMeaningfulData()) {
      if (lastSavedSnapshotRef.current) {
        window.localStorage.removeItem(PURCHASE_DRAFT_STORAGE_KEY);
        lastSavedSnapshotRef.current = '';
      }
      return;
    }

    const timer = window.setTimeout(() => {
      try {
        const payload = buildDraftPayload(documentStatus, {
          suppliers,
          contactsList,
          addressesList,
          products,
          warehouses,
          costCenters,
          projects,
        });
        const snapshot = JSON.stringify(payload);
        if (snapshot !== lastSavedSnapshotRef.current) {
          window.localStorage.setItem(PURCHASE_DRAFT_STORAGE_KEY, snapshot);
          lastSavedSnapshotRef.current = snapshot;
        }
      } catch {
        // quota exceeded or blocked
      }
    }, 400);

    return () => window.clearTimeout(timer);
  }, [
    supplier,
    date,
    requiredDate,
    currency,
    company,
    contact,
    shippingAddress,
    taxRate,
    discount,
    discountMode,
    customTaxRate,
    costCenter,
    project,
    termsTemplate,
    notes,
    lines,
    documentStatus,
  ]);

  // Flush dirty state on beforeunload or unmount
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (hasLoadedDraftRef.current && computeHasMeaningfulData() && typeof window !== 'undefined') {
        try {
          const payload = buildDraftPayload(documentStatus, {
          suppliers,
          contactsList,
          addressesList,
          products,
          warehouses,
          costCenters,
          projects,
        });
          window.localStorage.setItem(PURCHASE_DRAFT_STORAGE_KEY, JSON.stringify(payload));
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      handleBeforeUnload();
    };
  }, [
    supplier,
    date,
    requiredDate,
    currency,
    company,
    contact,
    shippingAddress,
    taxRate,
    discount,
    discountMode,
    customTaxRate,
    costCenter,
    project,
    termsTemplate,
    notes,
    lines,
    documentStatus,
  ]);

  useEffect(() => {
    if (!inlineMessage) {
      return;
    }

    const timer = window.setTimeout(() => setInlineMessage(null), 3000);
    return () => window.clearTimeout(timer);
  }, [inlineMessage]);



  useEffect(() => {
    if (pendingFocusLineId === null) {
      return;
    }

    const timer = window.setTimeout(() => {
      const input = document.getElementById(`product-input-${pendingFocusLineId}`) as HTMLInputElement | null;
      input?.focus();
      input?.select();
      setPendingFocusLineId(null);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [pendingFocusLineId, lines]);

  useEffect(() => {
    if (pendingFocusQtyLineId === null) {
      return;
    }

    const timer = window.setTimeout(() => {
      const input = document.getElementById(`quantity-input-${pendingFocusQtyLineId}`) as HTMLInputElement | null;
      input?.focus();
      input?.select();
      setPendingFocusQtyLineId(null);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [pendingFocusQtyLineId, lines]);
  useAppToolbar([
    { label: t('purchases'), to: '/purchases' },
    { label: t('purchase_orders'), to: '/purchases' },
    { label: t('new_purchase_order') }
  ]);

  const handleNewPurchaseOrder = () => {
    setCreatedPurchase(null);
    resetFormFields(draftUi);
  };

  return {
    handleNewPurchaseOrder,
  };
}
