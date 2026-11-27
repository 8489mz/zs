import {type Dispatch, type SetStateAction, useEffect, useMemo, useState} from 'react';
import type { usePurchaseComposerCatalog } from '@/features/purchases/hooks/usePurchaseComposerCatalog';
import { useCreatePurchaseMutation } from '@/features/purchases/hooks/useCreatePurchaseMutation';
import { mapPurchaseProductType } from '../newPurchaseOrder.helpers';
import type {
  AddressOption,
  CategoryOption,
  ContactOption,
  CostCenterOption,
  DocumentStatus,
  InlineMessageTone,
  ProductOption,
  ProjectOption,
  SupplierOption,
  ValidationErrors,
  WarehouseOption,
} from '../newPurchaseOrder.types';

export interface PurchaseOrderDraftUi {
  hasLoadedDraftRef: { current: boolean };
  setValidationErrors: Dispatch<SetStateAction<ValidationErrors>>;
  setInlineMessage: Dispatch<SetStateAction<{ tone: InlineMessageTone; text: string } | null>>;
  setDocumentStatus: Dispatch<SetStateAction<DocumentStatus>>;
}

export interface UsePurchaseOrderCatalogArgs {
  catalog: ReturnType<typeof usePurchaseComposerCatalog>;
  resetFormFields: (draftUi: PurchaseOrderDraftUi) => void;
  setCreatedPurchase: Dispatch<SetStateAction<any>>;
  supplier: string;
  shippingAddress: string;
  setShippingAddress: Dispatch<SetStateAction<string>>;
  currency: string;
  setCurrency: Dispatch<SetStateAction<string>>;
  draftUi: PurchaseOrderDraftUi;
}

export function usePurchaseOrderCatalog({
  catalog,
  resetFormFields,
  setCreatedPurchase,
  supplier,
  shippingAddress,
  setShippingAddress,
  currency,
  setCurrency,
  draftUi,
}: UsePurchaseOrderCatalogArgs) {
  const createMutation = useCreatePurchaseMutation((result) => {
    setCreatedPurchase(result.purchase);
    resetFormFields(draftUi);
  });

  const rawSettings = catalog.settingsQuery.data;
  const rawSuppliers = catalog.suppliersQuery.data || [];
  const rawProducts = catalog.productsQuery.data || [];
  const rawLocations = catalog.locationsQuery.data || [];
  const rawBranches = catalog.branchesQuery.data || [];
  const rawCategories = catalog.categoriesQuery.data || [];

  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);

  useEffect(() => {
    if (rawSuppliers.length) {
      setSuppliers(rawSuppliers.map((s: any) => ({
        id: s.id.toString(),
        name: s.name,
        code: s.code || '',
        phone: s.phone || '',
        taxNumber: s.taxNumber || '',
        contactName: s.primaryContactName || '',
        balance: s.balance || 0
      })));
    }
  }, [rawSuppliers]);

  useEffect(() => {
    if (rawProducts.length) {
      setProducts(rawProducts.map((p: any) => {
        const cat = rawCategories.find((c: any) => c.id.toString() === String(p.categoryId));
        const loc = rawLocations.find((l: any) => l.id.toString() === String(p.defaultLocationId));
        return {
          id: String(p.id),
          name: p.name,
          englishName: p.englishName || p.name,
          code: p.styleCode || '',
          barcode: p.barcode || '',
          price: p.costPrice || 0,
          warehouse: loc ? loc.name : (p.defaultLocationName || ''),
          warehouseId: p.defaultLocationId ? String(p.defaultLocationId) : undefined,
          category: cat ? cat.name : '',
          categoryId: p.categoryId ? String(p.categoryId) : undefined,
          type: mapPurchaseProductType(p),
          defaultLocationId: p.defaultLocationId ? String(p.defaultLocationId) : undefined,
          defaultLocationName: p.defaultLocationName || loc?.name,
          activeLocationIds: Array.isArray(p.activeLocationIds) ? p.activeLocationIds.map(String) : [],
          costPrice: p.costPrice
        };
      }));
    }
  }, [rawProducts, rawCategories, rawLocations]);

  useEffect(() => {
    if (rawCategories.length) {
      setCategories(rawCategories.map((c: any) => ({
        id: c.id.toString(),
        name: c.name,
        code: c.code || ''
      })));
    }
  }, [rawCategories]);

  useEffect(() => {
    if (rawLocations.length) {
      setWarehouses(rawLocations.map((l: any) => ({
        id: l.id.toString(),
        name: l.name,
        code: l.code || ''
      })));
    }
  }, [rawLocations]);



  const deliveryDestinations = useMemo(() => {
    const destinations: WarehouseOption[] = [];
    if (rawBranches.length) {
      destinations.push(...rawBranches.map((b: any) => ({
        id: `branch_${b.id}`,
        name: `[فرع] ${b.name}`,
        code: b.code || ''
      })));
    }
    if (rawLocations.length) {
      destinations.push(...rawLocations.map((l: any) => ({
        id: `wh_${l.id}`,
        name: `[مخزن] ${l.name}`,
        code: l.code || ''
      })));
    }
    return destinations;
  }, [rawBranches, rawLocations]);

  useEffect(() => {
    if (!shippingAddress && deliveryDestinations.length > 0) {
      setShippingAddress(deliveryDestinations[0].name);
    }
  }, [shippingAddress, deliveryDestinations]);

  // Load default currency from system settings
  useEffect(() => {
    if (rawSettings?.currency && !currency) {
      setCurrency(rawSettings.currency);
    }
  }, [rawSettings?.currency, currency]);

  const [costCenters, setCostCenters] = useState<CostCenterOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [contactsList, setContactsList] = useState<ContactOption[]>([]);
  const [addressesList, setAddressesList] = useState<AddressOption[]>([]);

  useEffect(() => {
    if (catalog.costCentersQuery.data && costCenters.length === 0) {
      setCostCenters(catalog.costCentersQuery.data.map((cc: any) => ({ id: String(cc.id), name: cc.name, code: cc.code })));
    }
  }, [catalog.costCentersQuery.data, costCenters.length]);

  useEffect(() => {
    if (catalog.projectsQuery.data && projects.length === 0) {
      setProjects(catalog.projectsQuery.data.map((p: any) => ({ id: String(p.id), name: p.name, code: p.code })));
    }
  }, [catalog.projectsQuery.data, projects.length]);

  useEffect(() => {
    if (!supplier) {
      setContactsList([]);
      setAddressesList([]);
      return;
    }
    const supplierObj = suppliers.find(s => s.name === supplier || s.id === supplier);
    const supplierId = supplierObj?.id || supplier;
    if (!supplierId || !/^\d+$/.test(String(supplierId).trim())) {
      setContactsList([]);
      setAddressesList([]);
      return;
    }
    const load = async () => {
      try {
        const { accountsApi } = await import('@/features/accounts/api/accounts.api');
        const contacts = await accountsApi.partnerContacts('supplier', String(supplierId));
        setContactsList(contacts.map((c: any) => ({ id: String(c.id), name: c.name, phone: c.phone || '' })));
      } catch (err) {
        console.error('Failed to load supplier contacts', err);
      }
    };
    load();
  }, [supplier, suppliers]);
  return {
    createMutation,
    rawSettings,
    rawLocations,
    rawBranches,
    rawCategories,
    suppliers,
    setSuppliers,
    products,
    setProducts,
    warehouses,
    setWarehouses,
    categories,
    deliveryDestinations,
    costCenters,
    setCostCenters,
    projects,
    setProjects,
    contactsList,
    setContactsList,
    addressesList,
    setAddressesList,
  };
}
