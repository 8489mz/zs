import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import imageCompression from 'browser-image-compression';
import { usePurchaseComposerCatalog } from '@/features/purchases/hooks/usePurchaseComposerCatalog';
import { useCreatePurchaseMutation } from '@/features/purchases/hooks/useCreatePurchaseMutation';
import { purchasesApi } from '@/features/purchases/api/purchases.api';
import { useCreateSupplierMutation } from '@/shared/hooks/use-supplier-mutations';
import { sharedProductsApi } from '@/shared/api/products';
import { invalidateCatalogDomain } from '@/app/query-invalidation';
import { useAuthStore } from '@/stores/auth-store';
import { useAppToolbar } from '@/stores/toolbar-store';
import { useTranslation } from '../../utils/i18n-purchase-prototype';
import { resolveSuggestedReceivingLocation } from '../../utils/purchases.utils';
import {
  normalizeSearchText,
  includesNormalized,
  parseLocalizedNumber,
  mapPurchaseProductType,
} from './newPurchaseOrder.helpers';
import type {
  PrototypeLine,
  SupplierOption,
  ContactOption,
  AddressOption,
  ProductOption,
  CategoryOption,
  WarehouseOption,
  CostCenterOption,
  ProjectOption,
  QuickCreateState,
  DocumentStatus,
  PurchasePrototypeDraft,
  ValidationErrors,
  ValidationRowErrors,
  InlineMessageTone,
  QuickCreateResult,
} from './newPurchaseOrder.types';
import { PURCHASE_DRAFT_STORAGE_KEY } from './newPurchaseOrder.types';

export function useNewPurchaseOrderController() {
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
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [requiredDate, setRequiredDate] = useState(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
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
  const resetFormFields = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(PURCHASE_DRAFT_STORAGE_KEY);
    }
    hasLoadedDraftRef.current = false;
    setLines([{ id: Date.now(), productId: null, itemName: '', qty: 1, unitPrice: 0, warehouse: '' }]);
    setSupplier('');
    setPaymentType('credit');
    setDate(new Date().toISOString().split('T')[0]);
    setRequiredDate(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
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
    setValidationErrors({ rows: {} });
    setInlineMessage(null);
    setDocumentStatus('draft');
  };

  const createMutation = useCreatePurchaseMutation((result) => {
    setCreatedPurchase(result.purchase);
    resetFormFields();
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

  const buildDraftPayload = (status: DocumentStatus): PurchasePrototypeDraft => ({
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

  const saveDraftToStorage = (status: DocumentStatus) => {
    const payload = buildDraftPayload(status);
    window.localStorage.setItem(PURCHASE_DRAFT_STORAGE_KEY, JSON.stringify(payload));
    lastSavedSnapshotRef.current = JSON.stringify(payload);
    setDocumentStatus(status);
  };

  const restoreDraftFromStorage = (payload: PurchasePrototypeDraft) => {
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

  const subtotal = useMemo(() => lines.reduce((acc, line) => acc + line.qty * line.unitPrice, 0), [lines]);
  const discountAmount = discountMode === 'percent' ? (subtotal * discount) / 100 : discount;
  const taxableBase = Math.max(subtotal - discountAmount, 0);
  const tax = useMemo(() => (taxableBase * taxRate) / 100, [taxableBase, taxRate]);
  const total = taxableBase + tax;



  const addLine = () => {
    const newLineId = Date.now();
    markDocumentDirty();
    setLines((current) => [...current, { id: newLineId, productId: null, itemName: '', qty: 1, unitPrice: 0, warehouse: '' }]);
    setPendingFocusLineId(newLineId);
  };

  const addProductLine = () => {
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

  const applyTaxPreset = (rate: number) => {
    markDocumentDirty();
    setTaxRate(rate);
    setCustomTaxRate(String(rate));
    setActiveQuickAction(null);
  };

  const applyCustomTaxRate = () => {
    markDocumentDirty();
    const normalized = parseLocalizedNumber(customTaxRate);
    setTaxRate(Number.isFinite(normalized) ? normalized : 0);
    setActiveQuickAction(null);
  };

  const applyDiscount = () => {
    markDocumentDirty();
    setActiveQuickAction(null);
  };

  const focusFieldBySelector = (selector: string) => {
    window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(selector);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      (target as HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement | null)?.focus?.();
    });
  };

  type ConfirmFocusTarget =
    | { kind: 'field'; field: 'supplier' | 'date' | 'requiredDate' | 'currency' }
    | { kind: 'line'; lineId: number; field: 'product' | 'qty' | 'price' | 'warehouse' };

  const focusFirstInvalidField = (target: ConfirmFocusTarget | null) => {
    if (!target) {
      return;
    }

    if (target.kind === 'field') {
      if (target.field === 'supplier') {
        supplierInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        supplierInputRef.current?.focus();
        return;
      }

      if (target.field === 'date') {
        dateInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        dateInputRef.current?.focus();
        return;
      }

      if (target.field === 'requiredDate') {
        requiredDateInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        requiredDateInputRef.current?.focus();
        return;
      }

      if (target.field === 'currency') {
        currencyInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        currencyInputRef.current?.focus();
      }
      return;
    }

    const selectorMap: Record<typeof target.field, string> = {
      product: `#product-input-${target.lineId}`,
      qty: `#quantity-input-${target.lineId}`,
      price: `.document-line-items-table tr[data-line-id="${target.lineId}"] .purchase-prototype-table-cell-price input`,
      warehouse: `#warehouse-input-${target.lineId}`
    };

    focusFieldBySelector(selectorMap[target.field]);
  };

  const validateBeforeConfirm = () => {
    const nextErrors: ValidationErrors = { rows: {} };
    let firstInvalidTarget: ConfirmFocusTarget | null = null;
    const addFirstTarget = (target: ConfirmFocusTarget) => {
      if (!firstInvalidTarget) {
        firstInvalidTarget = target;
      }
    };

    const selectedSupplierObj = suppliers.find(s => s.name === supplier);
    if (!supplier.trim() || !selectedSupplierObj) {
      nextErrors.supplier = t('select_supplier_error');
      addFirstTarget({ kind: 'field', field: 'supplier' });
    }

    if (!date.trim()) {
      nextErrors.date = t('select_date_error');
      addFirstTarget({ kind: 'field', field: 'date' });
    }

    if (!requiredDate.trim()) {
      nextErrors.requiredDate = t('select_required_date_error');
      addFirstTarget({ kind: 'field', field: 'requiredDate' });
    }

    if (!currency.trim()) {
      nextErrors.currency = t('select_currency_error');
      addFirstTarget({ kind: 'field', field: 'currency' });
    }

    const checkIsBlankRow = (line: PrototypeLine) => {
      const hasProduct = Boolean(line.productId || line.itemName.trim());
      const hasQty = Number.isFinite(line.qty) && line.qty > 0 && line.qty !== 1;
      const hasPrice = Number.isFinite(line.unitPrice) && line.unitPrice > 0;
      const hasWarehouse = Boolean(line.warehouse && line.warehouse.trim());
      return !hasProduct && !hasQty && !hasPrice && !hasWarehouse;
    };

    const validRows = lines.filter((line) => !checkIsBlankRow(line));

    if (!validRows.length) {
      if (!firstInvalidTarget) {
        firstInvalidTarget = { kind: 'line', lineId: lines[0]?.id ?? Date.now(), field: 'product' };
      }
      if (lines[0]) {
        nextErrors.rows[lines[0].id] = { product: t('add_one_item_error') };
      }
      return { valid: false, errors: nextErrors, firstInvalidTarget };
    }

    const seenProducts = new Map<string, string>();
    lines.forEach((line) => {
      if (checkIsBlankRow(line)) {
        return;
      }

      const rowErrors: ValidationRowErrors = {};

      if (!line.productId) {
        rowErrors.product = t('select_item_error');
        addFirstTarget({ kind: 'line', lineId: line.id, field: 'product' });
      } else {
        if (seenProducts.has(line.productId)) {
          rowErrors.product = `الصنف "${line.itemName}" مكرر. يرجى دمجه أو حذفه.`;
          addFirstTarget({ kind: 'line', lineId: line.id, field: 'product' });
        } else {
          seenProducts.set(line.productId, String(line.id));
        }
      }

      const qtyValue = Number.isFinite(line.qty) ? line.qty : parseLocalizedNumber(String(line.qty));
      if (!Number.isFinite(qtyValue) || qtyValue <= 0) {
        rowErrors.qty = t('qty_greater_than_zero_error');
        addFirstTarget({ kind: 'line', lineId: line.id, field: 'qty' });
      }

      const rawPrice = line.unitPrice;
      const parsedPrice = typeof rawPrice === 'number' && Number.isFinite(rawPrice)
        ? rawPrice
        : parseLocalizedNumber(String(rawPrice ?? ''));
      const priceValue = Number.isFinite(parsedPrice) ? parsedPrice : 0;
      if (priceValue < 0) {
        rowErrors.price = t('price_not_negative_error');
        addFirstTarget({ kind: 'line', lineId: line.id, field: 'price' });
      }

      const product = line.productId ? products.find((item) => item.id === line.productId) : undefined;
      const requiresWarehouse = product ? product.type === 'stock' : !line.isService;
      if (requiresWarehouse && (!line.warehouse.trim() || !line.warehouseId || line.warehouseId === 'undefined' || line.warehouseId === 'null')) {
        rowErrors.warehouse = `اختر مكان المخزون للصنف "${line.itemName}" من القائمة.`;
        addFirstTarget({ kind: 'line', lineId: line.id, field: 'warehouse' });
      }

      if (Object.keys(rowErrors).length) {
        nextErrors.rows[line.id] = rowErrors;
      }
    });

    const hasAnyValidLine = lines.some((line) => {
      if (checkIsBlankRow(line) || !line.productId) {
        return false;
      }
      return true;
    });

    if (!hasAnyValidLine) {
      const fallbackTarget: ConfirmFocusTarget = firstInvalidTarget ?? { kind: 'line', lineId: lines[0]?.id ?? Date.now(), field: 'product' };
      return { valid: false, errors: nextErrors, firstInvalidTarget: fallbackTarget };
    }

    return {
      valid: !nextErrors.supplier && !nextErrors.date && !nextErrors.requiredDate && !nextErrors.currency && Object.keys(nextErrors.rows).length === 0,
      errors: nextErrors,
      firstInvalidTarget
    };
  };

  const handleResetDraft = () => {
    window.localStorage.removeItem(PURCHASE_DRAFT_STORAGE_KEY);
    hasLoadedDraftRef.current = false;
    setSupplier('');
    setDate(new Date().toISOString().split('T')[0]);
    setRequiredDate(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
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

    saveDraftToStorage('draft');
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
        const payload = buildDraftPayload(documentStatus);
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
          const payload = buildDraftPayload(documentStatus);
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
    resetFormFields();
  };


  return {
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
    isUploading,
    quickCreateState,
    setQuickCreateState,
    productCreateModalState,
    setProductCreateModalState,
    barcodeScanOpen,
    setBarcodeScanOpen,
    barcodeScanQuery,
    createdPurchase,
    isPolling,
    navigate,
    createMutation,
    rawSettings,
    suppliers,
    products,
    warehouses,
    categories,
    contactsList,
    addressesList,
    costCenters,
    projects,
    validationErrors,
    documentStatus,
    inlineMessage,
    subtotal,
    tax,
    total,
    deliveryDestinations,
    supplierInputRef,
    dateInputRef,
    requiredDateInputRef,
    currencyInputRef,
    contactInputRef,
    shippingInputRef,
    costCenterInputRef,
    projectInputRef,
    purchaseDropdownClassName,
    markDocumentDirty,
    clearDocumentFieldError,
    handleSupplierSelect,
    handleContactSelect,
    handleAddressSelect,
    handleCategorySelect,
    handleWarehouseSelect,
    handleCostCenterSelect,
    handleProjectSelect,
    handleProductSelect,
    addProductAsLine,
    updateLine,
    addLine,
    addServiceLine,
    addProductLine,
    removeLine,
    setLineError,
    fetchProductOptions,
    searchCategory,
    handleBarcodeScanAction,
    handleBarcodeScanSubmit,
    openQuickCreate,
    openProductQuickCreateFromBarcode,
    handleProductCreateSuccess,
    closeProductCreateModal,
    closeQuickCreate,
    handleQuickCreateSubmit,
    applyTaxPreset,
    applyCustomTaxRate,
    applyDiscount,
    handleFileUpload,
    handleRemoveAttachment,
    handleSaveDraft,
    handleResetDraft,
    handleConfirmInvoice,
    handleNewPurchaseOrder,
    setCreatedPurchase,
  };
}