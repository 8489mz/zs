import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { usePurchaseComposerCatalog } from '@/features/purchases/hooks/usePurchaseComposerCatalog';
import { purchasesApi } from '@/features/purchases/api/purchases.api';
import { resolveSuggestedReceivingLocation } from '../../../utils/purchases.utils';
import {
  includesNormalized,
  mapPurchaseProductType,
  normalizeSearchText,
} from '../newPurchaseOrder.helpers';
import type {
  AddressOption,
  CategoryOption,
  ContactOption,
  CostCenterOption,
  ProductOption,
  ProjectOption,
  PrototypeLine,
  QuickCreateState,
  SupplierOption,
  ValidationErrors,
  ValidationRowErrors,
  WarehouseOption,
} from '../newPurchaseOrder.types';

export type OpenQuickCreateFn = (
  kind: Exclude<QuickCreateState, null>['kind'],
  query: string,
  lineId?: number | null,
) => void;

export interface UsePurchaseOrderLinesArgs {
  markDocumentDirty: () => void;
  clearLineErrors: (lineId: number) => void;
  clearDocumentFieldError: (field: keyof Omit<ValidationErrors, 'rows'>) => void;
  setLineError: (lineId: number, key: keyof ValidationRowErrors, message: string | undefined) => void;
  contactInputRef: RefObject<HTMLInputElement | null>;
  setLines: Dispatch<SetStateAction<PrototypeLine[]>>;
  setPendingFocusLineId: Dispatch<SetStateAction<number | null>>;
  setBarcodeScanQuery: Dispatch<SetStateAction<string>>;
  setBarcodeScanOpen: Dispatch<SetStateAction<boolean>>;
  setSupplier: Dispatch<SetStateAction<string>>;
  setCompany: Dispatch<SetStateAction<string>>;
  setContact: Dispatch<SetStateAction<string>>;
  setShippingAddress: Dispatch<SetStateAction<string>>;
  setCostCenter: Dispatch<SetStateAction<string>>;
  setProject: Dispatch<SetStateAction<string>>;
  setPendingFocusQtyLineId: Dispatch<SetStateAction<number | null>>;
  rawCategories: NonNullable<ReturnType<typeof usePurchaseComposerCatalog>['categoriesQuery']['data']>;
  rawLocations: NonNullable<ReturnType<typeof usePurchaseComposerCatalog>['locationsQuery']['data']>;
  setProducts: Dispatch<SetStateAction<ProductOption[]>>;
  rawSettings: ReturnType<typeof usePurchaseComposerCatalog>['settingsQuery']['data'];
  products: ProductOption[];
  catalog: ReturnType<typeof usePurchaseComposerCatalog>;
}

export function usePurchaseOrderLines({
  markDocumentDirty,
  clearLineErrors,
  clearDocumentFieldError,
  setLineError,
  contactInputRef,
  setLines,
  setPendingFocusLineId,
  setBarcodeScanQuery,
  setBarcodeScanOpen,
  setSupplier,
  setCompany,
  setContact,
  setShippingAddress,
  setCostCenter,
  setProject,
  setPendingFocusQtyLineId,
  rawCategories,
  rawLocations,
  setProducts,
  rawSettings,
  products,
  catalog,
}: UsePurchaseOrderLinesArgs) {
  const addLine = () => {
    const newLineId = Date.now();
    markDocumentDirty();
    setLines((current) => [...current, { id: newLineId, productId: null, itemName: '', qty: 1, unitPrice: 0, warehouse: '' }]);
    setPendingFocusLineId(newLineId);
  };

  const addProductLine = (openQuickCreate: OpenQuickCreateFn) => {
    markDocumentDirty();
    openQuickCreate('product', '');
  };

  const handleBarcodeScanAction = () => {
    setBarcodeScanQuery('');
    setBarcodeScanOpen(true);
  };

  const addServiceLine = () => {
    markDocumentDirty();
    setLines((current) => [
      ...current,
      {
        id: Date.now() + 2,
        productId: null,
        itemName: 'Additional Service',
        qty: 1,
        unitPrice: 0,
        warehouse: 'لا يؤثر على المخزون',
        isService: true
      }
    ]);
  };

  const removeLine = (id: number) => {
    markDocumentDirty();
    setLines((current) => current.filter((line) => line.id !== id));
    clearLineErrors(id);
  };

  const updateLine = (id: number, key: keyof PrototypeLine, value: string | number) => {
    markDocumentDirty();
    setLines((current) => current.map((line) => (line.id === id ? { ...line, [key]: value } : line)));
  };
  const createEntityId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;

  const handleSupplierSelect = (option: SupplierOption) => {
    markDocumentDirty();
    clearDocumentFieldError('supplier');
    setSupplier(option.name);
    if (option.company) {
      setCompany(option.company);
    }
    if (option.phone) {
      setContact(option.phone);
    }
    if (option.shippingAddress) {
      setShippingAddress(option.shippingAddress);
    }
    window.requestAnimationFrame(() => contactInputRef.current?.focus());
  };

  const handleContactSelect = (option: ContactOption) => {
    markDocumentDirty();
    setContact(option.name);
    if (option.supplierName) {
      setSupplier(option.supplierName);
    }
  };

  const handleAddressSelect = (option: AddressOption) => {
    markDocumentDirty();
    setShippingAddress(option.label);
    if (option.supplierName) {
      setSupplier(option.supplierName);
    }
  };

  const handleWarehouseSelect = (lineId: number, option: WarehouseOption) => {
    markDocumentDirty();
    setLineError(lineId, 'warehouse', undefined);
    updateLine(lineId, 'warehouse', option.name);
    updateLine(lineId, 'warehouseId', option.id);
  };

  const handleCategorySelect = (lineId: number, option: CategoryOption) => {
    markDocumentDirty();
    setLineError(lineId, 'category', undefined);
    updateLine(lineId, 'category', option.name);
    updateLine(lineId, 'categoryId', option.id);
  };

  const searchCategory = (category: any, query: string) => {
    if (!normalizeSearchText(query)) {
      return true;
    }
    return [category.name, category.code].some((value) => includesNormalized(value || '', query));
  };

  const handleCostCenterSelect = (option: CostCenterOption) => {
    markDocumentDirty();
    setCostCenter(option.name);
  };

  const handleProjectSelect = (option: ProjectOption) => {
    markDocumentDirty();
    setProject(option.name);
  };

  const fetchProductOptions = async (query: string) => {
    try {
      const results = await purchasesApi.searchProducts(query);
      const newOptions = results.map((p: any) => {
        const cat = rawCategories.find((c: any) => c.id.toString() === String(p.categoryId));
        const loc = rawLocations.find((l: any) => l.id.toString() === String(p.defaultLocationId));
        return {
          id: p.id.toString(),
          name: p.name,
          englishName: p.englishName,
          categoryId: p.categoryId?.toString(),
          category: cat?.name || '',
          type: mapPurchaseProductType(p),
          price: p.purchasePrice ?? p.costPrice ?? 0,
          warehouseId: p.defaultLocationId?.toString(),
          warehouse: loc?.name || p.defaultLocationName || '',
          sku: p.sku || '',
          barcode: p.barcode || '',
          code: p.sku || p.barcode || `PRD-${p.id}`,
          defaultLocationId: p.defaultLocationId?.toString(),
          defaultLocationName: p.defaultLocationName || loc?.name,
          activeLocationIds: Array.isArray(p.activeLocationIds) ? p.activeLocationIds.map(String) : [],
          costPrice: p.costPrice,
          trackSerials: Boolean(p.trackSerials)
        };
      }) as ProductOption[];

      setProducts(current => {
        const map = new Map(current.map(c => [c.id, c]));
        newOptions.forEach(n => map.set(n.id, n));
        return Array.from(map.values());
      });

      return newOptions;
    } catch (e) {
      console.error(e);
      return [];
    }
  };

  const handleProductSelect = (lineId: number, option: ProductOption) => {
    markDocumentDirty();
    setLineError(lineId, 'product', undefined);

    let category = option.category || '';
    if (!category && option.categoryId) {
      const cat = catalog.categoriesQuery.data?.find(c => c.id === String(option.categoryId));
      if (cat) category = cat.name;
    }

    const suggestedLocation = resolveSuggestedReceivingLocation(
      { 
        id: option.id, 
        defaultLocationId: option.defaultLocationId || option.warehouseId, 
        type: option.type,
        activeLocationIds: option.activeLocationIds 
      },
      catalog.locationsQuery.data || [],
      rawSettings?.currentLocationId
    );

    setLines((current) =>
      current.map((line) => {
        if (line.id !== lineId) {
          return line;
        }

        const priceCandidate = Number(option.price ?? (option as any).costPrice ?? 0);
        const validUnitPrice = Number.isFinite(priceCandidate) && priceCandidate >= 0 ? priceCandidate : 0;

        const newLine = {
          ...line,
          productId: option.id,
          itemName: option.name,
          qty: line.qty > 0 ? line.qty : 1,
          unitPrice: validUnitPrice,
          warehouse: suggestedLocation.warehouse,
          warehouseId: suggestedLocation.warehouseId,
          category,
          categoryId: option.categoryId,
          isService: option.type === 'service',
          trackSerials: Boolean(option.trackSerials),
          serials: line.serials || [],
        };
        return newLine;
      })
    );
    setPendingFocusQtyLineId(lineId);
  };

  const addProductAsLine = (option: ProductOption) => {
    const newLineId = Date.now();
    markDocumentDirty();

    let category = option.category || '';
    if (!category && option.categoryId) {
      const cat = catalog.categoriesQuery.data?.find(c => c.id === String(option.categoryId));
      if (cat) category = cat.name;
    }

    const suggestedLocation = resolveSuggestedReceivingLocation(
      { 
        id: option.id, 
        defaultLocationId: option.defaultLocationId || option.warehouseId, 
        type: option.type,
        activeLocationIds: option.activeLocationIds 
      },
      catalog.locationsQuery.data || [],
      rawSettings?.currentLocationId
    );

    const priceCandidate = Number(option.price ?? (option as any).costPrice ?? 0);
    const validUnitPrice = Number.isFinite(priceCandidate) && priceCandidate >= 0 ? priceCandidate : 0;

    const newLine: PrototypeLine = {
      id: newLineId,
      productId: option.id,
      itemName: option.name,
      qty: 1,
      unitPrice: validUnitPrice,
      warehouse: suggestedLocation.warehouse,
      warehouseId: suggestedLocation.warehouseId,
      category,
      categoryId: option.categoryId,
      isService: option.type === 'service',
      trackSerials: Boolean(option.trackSerials),
      serials: [],
    };

    setLines((current) => [...current, newLine]);
    setPendingFocusQtyLineId(newLineId);
  };

  const incrementProductByBarcode = async (barcode: string) => {
    const normalized = String(barcode || '').trim();
    if (!normalized) {
      return;
    }

    let matched = products.find((product) => product.barcode === normalized);
    if (!matched) {
      const fetched = await fetchProductOptions(normalized);
      matched = fetched.find((product) => product.barcode === normalized);
    }

    if (!matched) {
      setBarcodeScanQuery(normalized);
      setBarcodeScanOpen(true);
      return;
    }

    markDocumentDirty();
    const matchedProduct = matched;

    let category = matchedProduct.category || '';
    if (!category && matchedProduct.categoryId) {
      const cat = catalog.categoriesQuery.data?.find(c => c.id === String(matchedProduct.categoryId));
      if (cat) category = cat.name;
    }

    const suggestedLocation = resolveSuggestedReceivingLocation(
      { 
        id: matchedProduct.id, 
        defaultLocationId: matchedProduct.defaultLocationId || matchedProduct.warehouseId, 
        type: matchedProduct.type,
        activeLocationIds: matchedProduct.activeLocationIds 
      },
      catalog.locationsQuery.data || [],
      rawSettings?.currentLocationId
    );
    
    setLines((current) => {
      const existing = current.find((line) => line.productId === matchedProduct.id);
      if (existing) {
        return current.map((line) => (line.id === existing.id ? { ...line, qty: line.qty + 1 } : line));
      }
      const priceCandidate = Number(matchedProduct.price ?? (matchedProduct as any).costPrice ?? 0);
      const validUnitPrice = Number.isFinite(priceCandidate) && priceCandidate >= 0 ? priceCandidate : 0;

      return [
        ...current,
        {
          id: Date.now(),
          productId: matchedProduct.id,
          itemName: matchedProduct.name,
          qty: 1,
          unitPrice: validUnitPrice,
          warehouseId: suggestedLocation.warehouseId,
          warehouse: suggestedLocation.warehouse,
          categoryId: matchedProduct.categoryId,
          category: category,
          isService: matchedProduct.type === 'service'
        }
      ];
    });
    setBarcodeScanOpen(false);
  };
  return {
    addLine,
    addProductLine,
    handleBarcodeScanAction,
    addServiceLine,
    removeLine,
    updateLine,
    createEntityId,
    handleSupplierSelect,
    handleContactSelect,
    handleAddressSelect,
    handleWarehouseSelect,
    handleCategorySelect,
    searchCategory,
    handleCostCenterSelect,
    handleProjectSelect,
    fetchProductOptions,
    handleProductSelect,
    addProductAsLine,
    incrementProductByBarcode,
  };
}
