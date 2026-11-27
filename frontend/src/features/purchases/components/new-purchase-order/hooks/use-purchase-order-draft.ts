import {useRef, useState, type Dispatch, type SetStateAction} from 'react';
import {
  type DocumentStatus,
  type InlineMessageTone,
  type PrototypeLine,
  type PurchasePrototypeDraft,
  type ValidationErrors,
  type ValidationRowErrors,
  PURCHASE_DRAFT_STORAGE_KEY,
} from '../newPurchaseOrder.types';

// S3 — draft sub-hook, moved from useNewPurchaseOrderController (L260-397).
// The facade calls S3 before S2, so the S2 catalog lists and setters are NOT
// hook args: they are call-time params of buildDraftPayload, saveDraftToStorage
// and restoreDraftFromStorage (prep §3 crossing #2). Call sites: S9 effects
// (buildDraftPayload / restoreDraftFromStorage / computeHasMeaningfulData) and
// S8 handleSaveDraft (saveDraftToStorage) — both have S2's return in scope.

/** Form values + setters owned by the S1 form-state slice. */
export interface UsePurchaseOrderDraftForm {
  lines: PrototypeLine[];
  supplier: string;
  date: string;
  requiredDate: string;
  currency: string;
  company: string;
  contact: string;
  shippingAddress: string;
  taxRate: number;
  discount: number;
  discountMode: 'percent' | 'value';
  customTaxRate: string;
  costCenter: string;
  project: string;
  termsTemplate: string;
  notes: string;
  isDarkMode: boolean;
  setSupplier: Dispatch<SetStateAction<string>>;
  setDate: Dispatch<SetStateAction<string>>;
  setRequiredDate: Dispatch<SetStateAction<string>>;
  setCurrency: Dispatch<SetStateAction<string>>;
  setCompany: Dispatch<SetStateAction<string>>;
  setContact: Dispatch<SetStateAction<string>>;
  setShippingAddress: Dispatch<SetStateAction<string>>;
  setTaxRate: Dispatch<SetStateAction<number>>;
  setDiscount: Dispatch<SetStateAction<number>>;
  setDiscountMode: Dispatch<SetStateAction<'percent' | 'value'>>;
  setCustomTaxRate: Dispatch<SetStateAction<string>>;
  setCostCenter: Dispatch<SetStateAction<string>>;
  setProject: Dispatch<SetStateAction<string>>;
  setTermsTemplate: Dispatch<SetStateAction<string>>;
  setNotes: Dispatch<SetStateAction<string>>;
  setLines: Dispatch<SetStateAction<PrototypeLine[]>>;
}

/** Catalog lists owned by the S2 catalog-data slice (call-time param). */
export type DraftCatalog = Pick<
  PurchasePrototypeDraft,
  'suppliers' | 'contactsList' | 'addressesList' | 'products' | 'warehouses' | 'costCenters' | 'projects'
>;

/** Catalog setters owned by the S2 catalog-data slice (call-time param). */
export interface DraftCatalogSetters {
  setSuppliers: Dispatch<SetStateAction<PurchasePrototypeDraft['suppliers']>>;
  setContactsList: Dispatch<SetStateAction<PurchasePrototypeDraft['contactsList']>>;
  setAddressesList: Dispatch<SetStateAction<PurchasePrototypeDraft['addressesList']>>;
  setProducts: Dispatch<SetStateAction<PurchasePrototypeDraft['products']>>;
  setWarehouses: Dispatch<SetStateAction<PurchasePrototypeDraft['warehouses']>>;
  setCostCenters: Dispatch<SetStateAction<PurchasePrototypeDraft['costCenters']>>;
  setProjects: Dispatch<SetStateAction<PurchasePrototypeDraft['projects']>>;
}

export function usePurchaseOrderDraft(form: UsePurchaseOrderDraftForm) {
  const {
    lines,
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
    isDarkMode,
    setSupplier,
    setDate,
    setRequiredDate,
    setCurrency,
    setCompany,
    setContact,
    setShippingAddress,
    setTaxRate,
    setDiscount,
    setDiscountMode,
    setCustomTaxRate,
    setCostCenter,
    setProject,
    setTermsTemplate,
    setNotes,
    setLines,
  } = form;

  const supplierInputRef = useRef<HTMLInputElement | null>(null);
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const requiredDateInputRef = useRef<HTMLInputElement | null>(null);
  const currencyInputRef = useRef<HTMLInputElement | null>(null);
  const contactInputRef = useRef<HTMLInputElement | null>(null);
  const shippingInputRef = useRef<HTMLInputElement | null>(null);
  const costCenterInputRef = useRef<HTMLInputElement | null>(null);
  const projectInputRef = useRef<HTMLInputElement | null>(null);
  const lastSavedSnapshotRef = useRef<string | null>(null);
  const hasLoadedDraftRef = useRef(false);
  const [documentStatus, setDocumentStatus] = useState<DocumentStatus>('draft');
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({ rows: {} });
  const [inlineMessage, setInlineMessage] = useState<{ tone: InlineMessageTone; text: string } | null>(null);
  const [_globalSearchOpen, _setGlobalSearchOpen] = useState(false);
  const purchaseDropdownClassName = isDarkMode
    ? 'purchase-new-prototype-dropdown purchase-new-prototype-dropdown-dark'
    : 'purchase-new-prototype-dropdown';

  const setLineError = (lineId: number, key: keyof ValidationRowErrors, message: string | undefined) => {
    setValidationErrors((prev) => {
      const nextRows = { ...prev.rows };
      const row = { ...(nextRows[lineId] || {}) };
      if (message) {
        (row as any)[key] = message;
      } else {
        delete (row as any)[key];
      }
      nextRows[lineId] = row;
      return { ...prev, rows: nextRows };
    });
  };

  const clearLineErrors = (lineId: number) => {
    setValidationErrors((current) => {
      if (!current.rows[lineId]) {
        return current;
      }

      const nextRows = { ...current.rows };
      delete nextRows[lineId];
      return { ...current, rows: nextRows };
    });
  };

  const clearDocumentFieldError = (field: keyof Omit<ValidationErrors, 'rows'>) => {
    setValidationErrors((current) => {
      if (!current[field]) {
        return current;
      }

      return { ...current, [field]: undefined };
    });
  };

  const markDocumentDirty = () => {
    if (documentStatus === 'confirmed') {
      setDocumentStatus('draft');
    }
    setInlineMessage(null);
  };

  const buildDraftPayload = (
    status: DocumentStatus,
    { suppliers, contactsList, addressesList, products, warehouses, costCenters, projects }: DraftCatalog,
  ): PurchasePrototypeDraft => ({
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
    suppliers,
    contactsList,
    addressesList,
    products,
    warehouses,
    costCenters,
    projects,
    status
  });

  const saveDraftToStorage = (status: DocumentStatus, catalog: DraftCatalog) => {
    const payload = buildDraftPayload(status, catalog);
    window.localStorage.setItem(PURCHASE_DRAFT_STORAGE_KEY, JSON.stringify(payload));
    lastSavedSnapshotRef.current = JSON.stringify(payload);
    setDocumentStatus(status);
  };

  const restoreDraftFromStorage = (
    payload: PurchasePrototypeDraft,
    { setSuppliers, setContactsList, setAddressesList, setProducts, setWarehouses, setCostCenters, setProjects }: DraftCatalogSetters,
  ) => {
    setSupplier(payload.supplier);
    setDate(payload.date);
    setRequiredDate(payload.requiredDate);
    setCurrency(payload.currency);
    setCompany(payload.company);
    setContact(payload.contact);
    setShippingAddress(payload.shippingAddress);
    setTaxRate(payload.taxRate);
    setDiscount(payload.discount);
    setDiscountMode(payload.discountMode);
    setCustomTaxRate(payload.customTaxRate);
    setCostCenter(payload.costCenter);
    setProject(payload.project);
    setTermsTemplate(payload.termsTemplate);
    setNotes(payload.notes);
    setLines(payload.lines);
    setSuppliers(payload.suppliers);
    setContactsList(payload.contactsList);
    setAddressesList(payload.addressesList);
    setProducts(payload.products);
    setWarehouses(payload.warehouses);
    setCostCenters(payload.costCenters);
    setProjects(payload.projects);
    setDocumentStatus(payload.status);
    lastSavedSnapshotRef.current = JSON.stringify(payload);
  };

  const computeHasMeaningfulData = () =>
    Boolean(
      supplier.trim() ||
        date.trim() ||
        requiredDate.trim() ||
        currency.trim() ||
        company.trim() ||
        contact.trim() ||
        shippingAddress.trim() ||
        costCenter.trim() ||
        project.trim() ||
        termsTemplate.trim() ||
        notes.trim() ||
        lines.some((line) => Boolean(line.productId || line.itemName.trim() || line.qty !== 1 || line.unitPrice !== 0 || line.warehouse.trim()))
    );

  return {
    supplierInputRef,
    dateInputRef,
    requiredDateInputRef,
    currencyInputRef,
    contactInputRef,
    shippingInputRef,
    costCenterInputRef,
    projectInputRef,
    lastSavedSnapshotRef,
    hasLoadedDraftRef,
    documentStatus,
    setDocumentStatus,
    validationErrors,
    setValidationErrors,
    inlineMessage,
    setInlineMessage,
    purchaseDropdownClassName,
    setLineError,
    clearLineErrors,
    clearDocumentFieldError,
    markDocumentDirty,
    buildDraftPayload,
    saveDraftToStorage,
    restoreDraftFromStorage,
    computeHasMeaningfulData,
  };
}
