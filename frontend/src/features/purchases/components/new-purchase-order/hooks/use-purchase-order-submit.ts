import imageCompression from 'browser-image-compression';
import type { Dispatch, SetStateAction } from 'react';
import { purchasesApi } from '@/features/purchases/api/purchases.api';
import type { useCreatePurchaseMutation } from '@/features/purchases/hooks/useCreatePurchaseMutation';
import type { usePurchaseComposerCatalog } from '@/features/purchases/hooks/usePurchaseComposerCatalog';
import type { useTranslation } from '../../../utils/i18n-purchase-prototype';
import { addDaysLocalDateKey, todayLocalDateKey } from '@/lib/format';
import {
  type AddressOption,
  type ContactOption,
  type CostCenterOption,
  type DocumentStatus,
  type InlineMessageTone,
  type ProductOption,
  type ProjectOption,
  type PrototypeLine,
  type PurchasePrototypeDraft,
  type SupplierOption,
  type ValidationErrors,
  type WarehouseOption,
  PURCHASE_DRAFT_STORAGE_KEY,
} from '../newPurchaseOrder.types';

// S8 — submit sub-hook, moved from useNewPurchaseOrderController (L1080-1269).
// Carries the file's ONLY invariant line (landed-cost allocation, L1162).
// Sanctioned edit (prep §3 + S3 generation): handleSaveDraft calls S3's
// saveDraftToStorage(status, catalog) with the 7-list DraftCatalog argument.
// The two local types below mirror S7's ConfirmFocusTarget and S3's
// DraftCatalog byte-for-byte (S7 does not export its copy); structural
// identity is what matters — the merge may unify them, it is not required
// for type-safety.
type ConfirmFocusTarget =
  | { kind: 'field'; field: 'supplier' | 'date' | 'requiredDate' | 'currency' }
  | { kind: 'line'; lineId: number; field: 'product' | 'qty' | 'price' | 'warehouse' };

type DraftCatalog = Pick<
  PurchasePrototypeDraft,
  'suppliers' | 'contactsList' | 'addressesList' | 'products' | 'warehouses' | 'costCenters' | 'projects'
>;

export interface UsePurchaseOrderSubmitArgs {
  hasLoadedDraftRef: { current: boolean };
  setSupplier: Dispatch<SetStateAction<string>>;
  setDate: Dispatch<SetStateAction<string>>;
  setRequiredDate: Dispatch<SetStateAction<string>>;
  setCurrency: Dispatch<SetStateAction<string>>;
  setCompany: Dispatch<SetStateAction<string>>;
  setContact: Dispatch<SetStateAction<string>>;
  setShippingAddress: Dispatch<SetStateAction<string>>;
  setTaxRate: Dispatch<SetStateAction<number>>;
  setDiscount: Dispatch<SetStateAction<number>>;
  setCostCenter: Dispatch<SetStateAction<string>>;
  setProject: Dispatch<SetStateAction<string>>;
  setTermsTemplate: Dispatch<SetStateAction<string>>;
  setNotes: Dispatch<SetStateAction<string>>;
  setLines: Dispatch<SetStateAction<PrototypeLine[]>>;
  setAttachments: Dispatch<SetStateAction<any[]>>;
  setDocumentStatus: Dispatch<SetStateAction<DocumentStatus>>;
  setInlineMessage: Dispatch<SetStateAction<{ tone: InlineMessageTone; text: string } | null>>;
  computeHasMeaningfulData: () => boolean;
  t: ReturnType<typeof useTranslation>['t'];
  saveDraftToStorage: (status: DocumentStatus, catalog: DraftCatalog) => void;
  setValidationErrors: Dispatch<SetStateAction<ValidationErrors>>;
  validateBeforeConfirm: () => { valid: boolean; errors: ValidationErrors; firstInvalidTarget: ConfirmFocusTarget | null };
  focusFirstInvalidField: (target: ConfirmFocusTarget | null) => void;
  suppliers: SupplierOption[];
  supplier: string;
  contactsList: ContactOption[];
  contact: string;
  addressesList: AddressOption[];
  shippingAddress: string;
  costCenters: CostCenterOption[];
  costCenter: string;
  projects: ProjectOption[];
  project: string;
  products: ProductOption[];
  warehouses: WarehouseOption[];
  paymentType: 'cash' | 'credit';
  discount: number;
  rawBranches: NonNullable<ReturnType<typeof usePurchaseComposerCatalog>['branchesQuery']['data']>;
  rawLocations: NonNullable<ReturnType<typeof usePurchaseComposerCatalog>['locationsQuery']['data']>;
  notes: string;
  requiredDate: string;
  currency: string;
  company: string;
  termsTemplate: string;
  lines: PrototypeLine[];
  setIsPolling: Dispatch<SetStateAction<boolean>>;
  taxRate: number;
  attachments: any[];
  idempotencyKeyRef: { current: string | null };
  currentPayloadRef: { current: string | null };
  createMutation: ReturnType<typeof useCreatePurchaseMutation>;
  setIsUploading: Dispatch<SetStateAction<boolean>>;
}

export function usePurchaseOrderSubmit({
  hasLoadedDraftRef,
  setSupplier,
  setDate,
  setRequiredDate,
  setCurrency,
  setCompany,
  setContact,
  setShippingAddress,
  setTaxRate,
  setDiscount,
  setCostCenter,
  setProject,
  setTermsTemplate,
  setNotes,
  setLines,
  setAttachments,
  setDocumentStatus,
  setInlineMessage,
  computeHasMeaningfulData,
  t,
  saveDraftToStorage,
  setValidationErrors,
  validateBeforeConfirm,
  focusFirstInvalidField,
  suppliers,
  supplier,
  contactsList,
  contact,
  addressesList,
  shippingAddress,
  costCenters,
  costCenter,
  projects,
  project,
  products,
  warehouses,
  paymentType,
  discount,
  rawBranches,
  rawLocations,
  notes,
  requiredDate,
  currency,
  company,
  termsTemplate,
  lines,
  setIsPolling,
  taxRate,
  attachments,
  idempotencyKeyRef,
  currentPayloadRef,
  createMutation,
  setIsUploading,
}: UsePurchaseOrderSubmitArgs) {
  const handleResetDraft = () => {
    window.localStorage.removeItem(PURCHASE_DRAFT_STORAGE_KEY);
    hasLoadedDraftRef.current = false;
    setSupplier('');
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
    setLines([]);
    setAttachments([]);
    setDocumentStatus('draft');
    setInlineMessage({ tone: 'success', text: 'تم إفراغ الصفحة ومسح المسودة القديمة' });
  };

  const handleSaveDraft = () => {
    if (!computeHasMeaningfulData()) {
      setInlineMessage({ tone: 'error', text: t('no_data_to_save') });
      return;
    }

    saveDraftToStorage('draft', {
      suppliers,
      contactsList,
      addressesList,
      products,
      warehouses,
      costCenters,
      projects,
    });
    setValidationErrors({ rows: {} });
    setInlineMessage({ tone: 'success', text: t('draft_saved') });
  };

  const handleConfirmInvoice = async () => {
    const validation = validateBeforeConfirm();
    if (!validation.valid) {
      setValidationErrors(validation.errors);
      setDocumentStatus('draft');
      
      let errorMsg = t('please_complete_data');
      if (validation.errors.supplier) {
        errorMsg = validation.errors.supplier;
      } else {
        for (const rowId in validation.errors.rows) {
          const rowErr = validation.errors.rows[rowId];
          if (rowErr?.product) {
            errorMsg = rowErr.product;
            break;
          } else if (rowErr?.qty) {
            errorMsg = rowErr.qty;
            break;
          } else if (rowErr?.price) {
            errorMsg = rowErr.price;
            break;
          } else if (rowErr?.warehouse) {
            errorMsg = rowErr.warehouse;
            break;
          }
        }
      }

      setInlineMessage({ tone: 'error', text: errorMsg });
      focusFirstInvalidField(validation.firstInvalidTarget ?? null);
      return;
    }

    const selectedSupplierObj = suppliers.find(s => s.name === supplier);
    const supplierId = selectedSupplierObj?.id || '';
    if (!supplierId) {
      setInlineMessage({ tone: 'error', text: 'يرجى اختيار مورد صالح من القائمة.' });
      return;
    }

    const selectedContactObj = contactsList.find(c => c.name === contact || c.phone === contact);
    const selectedAddressObj = addressesList.find(a => a.label === shippingAddress || a.id === shippingAddress);
    const selectedCostCenterObj = costCenters.find(c => c.name === costCenter || c.code === costCenter);
    const selectedProjectObj = projects.find(p => p.name === project || p.code === project);

    const values = {
      supplierId,
      paymentType,
      discount: discount || 0,
      // INV-LANDED-COST-ALLOCATION: this screen has no freight input, so
      // freight is 0 and no landedCosts key is sent (see buildPurchasePayload).
      freight: 0,
      branchId: rawBranches[0]?.id?.toString() || '',
      locationId: rawLocations[0]?.id?.toString() || '',
      note: notes,
      requiredDate,
      currency,
      companyName: company,
      contactId: selectedContactObj?.id ? String(selectedContactObj.id) : undefined,
      shippingAddressId: selectedAddressObj?.id ? String(selectedAddressObj.id) : undefined,
      costCenterId: selectedCostCenterObj?.id ? String(selectedCostCenterObj.id) : undefined,
      projectId: selectedProjectObj?.id ? String(selectedProjectObj.id) : undefined,
      termsTemplate,
    };

    const items = lines.filter(line => line.productId).map(line => {
      const lineCost = Number.isFinite(Number(line.unitPrice)) && Number(line.unitPrice) >= 0 ? Number(line.unitPrice) : 0;
      const lineQty = Number.isFinite(Number(line.qty)) && Number(line.qty) > 0 ? Number(line.qty) : 1;
      return {
        productId: line.productId as string,
        name: line.itemName,
        qty: lineQty,
        cost: lineCost,
        total: lineQty * lineCost,
        unitName: 'Piece',
        unitMultiplier: 1,
        locationId: line.warehouseId,
        categoryId: line.categoryId,
        serials: line.serials && line.serials.length > 0 ? line.serials : undefined,
      };
    });

    try {
      setIsPolling(true);
      const payloadString = JSON.stringify({ values, items, taxRate, attachments: attachments.length });
      if (!idempotencyKeyRef.current || currentPayloadRef.current !== payloadString) {
        idempotencyKeyRef.current = crypto.randomUUID();
        currentPayloadRef.current = payloadString;
      }
      await createMutation.mutateAsync({
        values,
        items,
        taxRate: taxRate,
        pricesIncludeTax: false,
        attachments,
        idempotencyKey: idempotencyKeyRef.current
      });
      // After committed success, invalidate the key so a new invoice gets a fresh one.
      idempotencyKeyRef.current = null;
      currentPayloadRef.current = null;

    } catch (e: any) {
      const isNetworkOrTimeout = e.message?.includes('network') || e.message?.includes('timeout') || e.message?.includes('Network') || e.name === 'TypeError';
      const is5xx = e.response?.status >= 500 && e.response?.status < 600;
      const isRecovery = e.message?.includes('Recovery polling');
      
      if (isNetworkOrTimeout || is5xx || isRecovery) {
         setInlineMessage({ tone: 'error', text: 'تعذر تأكيد نتيجة العملية، يرجى مراجعة صفحة المشتريات للتأكد.' });
      } else {
         setInlineMessage({ tone: 'error', text: e?.message || 'Error saving invoice' });
         idempotencyKeyRef.current = null;
         currentPayloadRef.current = null;
      }
    } finally {
      setIsPolling(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    try {
      const newAttachments: any[] = [];
      for (let i = 0; i < files.length; i++) {
        let file = files[i];
        if (file.type.startsWith('image/')) {
          const options = {
            maxSizeMB: 0.3, // Compress down to 300KB
            maxWidthOrHeight: 1600, // Enough resolution to read text without pixelation
            useWebWorker: true,
            initialQuality: 0.8,
          };
          try {
            const compressedBlob = await imageCompression(file, options);
            file = new File([compressedBlob], file.name, { type: compressedBlob.type });
          } catch (e) {
            console.error('Image compression failed', e);
          }
        }
        
        const uploaded = await purchasesApi.uploadAttachment(file);
        newAttachments.push(uploaded);
      }
      setAttachments(prev => [...prev, ...newAttachments]);
    } catch (e) {
      setInlineMessage({ tone: 'error', text: 'Error uploading attachment' });
    } finally {
      setIsUploading(false);
      event.target.value = ''; // clear input
    }
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };
  return {
    handleResetDraft,
    handleSaveDraft,
    handleConfirmInvoice,
    handleFileUpload,
    handleRemoveAttachment,
  };
}
