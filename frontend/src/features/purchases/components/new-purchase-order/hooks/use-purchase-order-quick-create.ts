import type { Dispatch, SetStateAction } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { useCreateSupplierMutation } from '@/shared/hooks/use-supplier-mutations';
import { sharedProductsApi } from '@/shared/api/products';
import { invalidateCatalogDomain } from '@/app/query-invalidation';
import { mapPurchaseProductType } from '../newPurchaseOrder.helpers';
import type {
  AddressOption,
  ContactOption,
  CostCenterOption,
  InlineMessageTone,
  ProductOption,
  ProjectOption,
  QuickCreateResult,
  QuickCreateState,
  SupplierOption,
  WarehouseOption,
} from '../newPurchaseOrder.types';

// S6 — quick-create sub-hook, moved from useNewPurchaseOrderController (L713-889).
// Hook args are a single object param; every arg is owned by an earlier slice
// in the forced facade order S1 -> S3 -> S2 -> S4 -> S5 -> S6 (prep §3).
// NOTE: handleWarehouseSelect is NOT an arg — it occurs nowhere in this span
// (grep-proven: only L484 definition + L1541 return object in the whole file).

/** Hook args: S5 line helpers + S2 catalog lists/setters + S1 form state + S3 dirty flag. */
export interface UsePurchaseOrderQuickCreateArgs {
  markDocumentDirty: () => void;
  createEntityId: (prefix: string) => string;
  handleSupplierSelect: (option: SupplierOption) => void;
  handleContactSelect: (option: ContactOption) => void;
  handleAddressSelect: (option: AddressOption) => void;
  handleCostCenterSelect: (option: CostCenterOption) => void;
  handleProjectSelect: (option: ProjectOption) => void;
  handleProductSelect: (lineId: number, option: ProductOption) => void;
  addProductAsLine: (option: ProductOption) => void;
  incrementProductByBarcode: (barcode: string) => Promise<void>;
  suppliers: SupplierOption[];
  setSuppliers: Dispatch<SetStateAction<SupplierOption[]>>;
  products: ProductOption[];
  setProducts: Dispatch<SetStateAction<ProductOption[]>>;
  warehouses: WarehouseOption[];
  setWarehouses: Dispatch<SetStateAction<WarehouseOption[]>>;
  costCenters: CostCenterOption[];
  setCostCenters: Dispatch<SetStateAction<CostCenterOption[]>>;
  projects: ProjectOption[];
  setProjects: Dispatch<SetStateAction<ProjectOption[]>>;
  setContactsList: Dispatch<SetStateAction<ContactOption[]>>;
  setAddressesList: Dispatch<SetStateAction<AddressOption[]>>;
  company: string;
  setContact: Dispatch<SetStateAction<string>>;
  setInlineMessage: Dispatch<SetStateAction<{ tone: InlineMessageTone; text: string } | null>>;
  queryClient: QueryClient;
  quickCreateState: QuickCreateState;
  setProductCreateModalState: Dispatch<
    SetStateAction<{ isOpen: boolean; query: string; barcode: string; lineId: number | null }>
  >;
  setQuickCreateState: Dispatch<SetStateAction<QuickCreateState>>;
  setBarcodeScanOpen: Dispatch<SetStateAction<boolean>>;
  productCreateModalState: { isOpen: boolean; query: string; barcode: string; lineId: number | null };
}

export function usePurchaseOrderQuickCreate(args: UsePurchaseOrderQuickCreateArgs) {
  const {
    markDocumentDirty,
    createEntityId,
    handleSupplierSelect,
    handleContactSelect,
    handleAddressSelect,
    handleCostCenterSelect,
    handleProjectSelect,
    handleProductSelect,
    addProductAsLine,
    incrementProductByBarcode,
    suppliers,
    setSuppliers,
    products,
    setProducts,
    warehouses,
    setWarehouses,
    costCenters,
    setCostCenters,
    projects,
    setProjects,
    setContactsList,
    setAddressesList,
    company,
    setContact,
    setInlineMessage,
    queryClient,
    quickCreateState,
    setProductCreateModalState,
    setQuickCreateState,
    setBarcodeScanOpen,
    productCreateModalState,
  } = args;

  const createSupplierMutation = useCreateSupplierMutation();
  // sharedProductsApi is used directly

  const handleQuickCreateSubmit = async (result: QuickCreateResult) => {
    markDocumentDirty();
    if (result.kind === 'supplier') {
      try {
        const payload: any = await createSupplierMutation.mutateAsync({
          name: result.name,
          phone: result.phone ?? '',
          address: '',
          balance: 0,
          notes: result.notes ?? '',
        });
        const createdObj = payload.suppliers?.find((s: any) => s.name === result.name) || payload.suppliers?.[payload.suppliers?.length - 1] || {};
        const newId = createdObj.id?.toString() || createEntityId('sup');
        const createdSupplier: SupplierOption = {
          id: newId,
          name: result.name,
          code: createdObj.code || `SUP-${suppliers.length + 1}`,
          phone: createdObj.phone || result.phone || '',
          taxNumber: createdObj.taxNumber || result.taxNumber || '',
          contactName: createdObj.primaryContactName || result.contactName || '',
          shippingAddress: '',
          company: company
        };
        setSuppliers((items) => [...items, createdSupplier]);
        handleSupplierSelect(createdSupplier);
        if (result.phone) {
          setContact(result.phone);
        }
      } catch (err) {
        setInlineMessage({ tone: 'error', text: 'فشل في إنشاء المورد' });
      }
    }

    if (result.kind === 'contact') {
      const createdContact: ContactOption = {
        id: createEntityId('con'),
        name: result.name,
        phone: result.phone ?? ''
      };
      setContactsList((items) => [...items, createdContact]);
      handleContactSelect(createdContact);
    }

    if (result.kind === 'address') {
      const createdAddress: AddressOption = {
        id: createEntityId('addr'),
        label: result.label,
        city: result.city ?? ''
      };
      setAddressesList((items) => [...items, createdAddress]);
      handleAddressSelect(createdAddress);
    }

    if (result.kind === 'warehouse') {
      const createdWarehouse: WarehouseOption = {
        id: createEntityId('wh'),
        name: result.name,
        code: result.code ?? `WH-${warehouses.length + 1}`
      };
      setWarehouses((items) => [...items, createdWarehouse]);
    }

    if (result.kind === 'costCenter') {
      const createdCostCenter: CostCenterOption = {
        id: createEntityId('cc'),
        name: result.name,
        code: result.code ?? `CC-${costCenters.length + 1}`
      };
      setCostCenters((items) => [...items, createdCostCenter]);
      handleCostCenterSelect(createdCostCenter);
    }

    if (result.kind === 'project') {
      const createdProject: ProjectOption = {
        id: createEntityId('prj'),
        name: result.name,
        code: result.code ?? `PRJ-${projects.length + 1}`
      };
      setProjects((items) => [...items, createdProject]);
      handleProjectSelect(createdProject);
    }

    if (result.kind === 'product') {
      try {
        const payload: any = await sharedProductsApi.create({
          name: result.name.trim(),
          itemType: 'product',
          itemKind: 'standard',
          costPrice: Number(result.price ?? 0),
          retailPrice: Number(result.price ?? 0),
          wholesalePrice: Number(result.price ?? 0),
          stock: 0,
          minStock: 0,
          units: [{ name: 'قطعة', multiplier: 1, barcode: '', isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }]
        });
        await invalidateCatalogDomain(queryClient, { includeProducts: true });

        const createdObj = payload.products?.find((p: any) => p.name === result.name) || payload.products?.[payload.products?.length - 1] || {};
        const newId = createdObj.id?.toString() || createEntityId('prod');

        const createdProduct: ProductOption = {
          id: newId,
          name: result.name,
          price: result.price ?? 0,
          type: result.productType === 'service' ? 'service' : 'stock',
          warehouse: result.warehouse ?? '',
          sku: `PRD-${products.length + 1}`,
          code: `PRD-${products.length + 1}`
        };
        setProducts((items) => [...items, createdProduct]);
        if (quickCreateState?.kind === 'product' && quickCreateState.lineId !== null) {
          handleProductSelect(quickCreateState.lineId, createdProduct);
        } else {
          addProductAsLine(createdProduct);
        }
      } catch (err) {
        setInlineMessage({ tone: 'error', text: 'فشل في إنشاء المنتج' });
      }
    }

    closeQuickCreate();
  };

  const openQuickCreate = (kind: Exclude<QuickCreateState, null>['kind'], query: string, lineId: number | null = null) => {
    if (kind === 'product') {
      setProductCreateModalState({ isOpen: true, query, barcode: '', lineId });
      return;
    }
    setQuickCreateState({ kind, query, lineId } as QuickCreateState);
  };

  const openProductQuickCreateFromBarcode = (barcode: string) => {
    setBarcodeScanOpen(false);
    setProductCreateModalState({ isOpen: true, query: '', barcode, lineId: null });
  };

  const handleProductCreateSuccess = (product: any) => {
    setProductCreateModalState(prev => ({ ...prev, isOpen: false }));
    if (product.itemKind === 'fashion' && product.styleCode) {
      setInlineMessage({ tone: 'success', text: 'تم إضافة موديل الملابس. اختر المقاس واللون المطلوبين من بحث الأصناف قبل إضافتهما للفاتورة.' });
      return;
    }
    const rawPrice = product.price ?? product.costPrice ?? product.purchasePrice ?? product.retailPrice ?? 0;
    const priceNum = Number(rawPrice);
    const safePrice = Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : 0;
    const mappedOption: ProductOption = {
      ...product,
      id: String(product.id),
      name: product.name,
      price: safePrice,
      code: product.styleCode || product.sku || product.barcode || `PRD-${product.id}`,
      type: mapPurchaseProductType(product),
      costPrice: product.costPrice
    };
    if (productCreateModalState.lineId !== null) {
      handleProductSelect(productCreateModalState.lineId, mappedOption);
    } else {
      addProductAsLine(mappedOption);
    }
  };

  const closeProductCreateModal = () => {
    setProductCreateModalState(prev => ({ ...prev, isOpen: false }));
  };

  const handleBarcodeScanSubmit = (barcode: string) => {
    incrementProductByBarcode(barcode);
  };

  const closeQuickCreate = () => {
    setQuickCreateState(null);
  };

  return {
    handleQuickCreateSubmit,
    openQuickCreate,
    openProductQuickCreateFromBarcode,
    handleProductCreateSuccess,
    closeProductCreateModal,
    handleBarcodeScanSubmit,
    closeQuickCreate,
  };
}
