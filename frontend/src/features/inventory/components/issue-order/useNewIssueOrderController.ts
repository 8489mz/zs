import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useInventoryActionCatalog } from '@/features/inventory/hooks/useInventoryActionCatalog';
import { useAuthStore } from '@/stores/auth-store';
import { inventoryApi } from '@/features/inventory/api/inventory.api';
import { withIdempotency } from '@/lib/idempotency';
import { referenceDataApi } from '@/services/reference-data.api';
import { queryKeys } from '@/app/query-keys';
import { invalidateInventoryDomain } from '@/app/query-invalidation';
import { normalizeArabicSearchKey } from '@/lib/arabic-normalization';
import { useFormDraft } from '@/shared/hooks/use-form-draft';
import { toast } from '@/shared/components/system-alert';
import {
  buildIssueOrderPayloadIdentity,
  buildTransferDestinationOptions,
  resolveTransferDestination,
  type IssueOrderDestinationKind,
  type IssueOrderDestinationOption,
} from './issue-order-destination.helpers';
import { LineItem, IssueOrderProductOption } from './types';

function getEffectiveStockQty(stockRow: { qty: number; availableQty?: number }): number {
  const val = typeof stockRow.availableQty === 'number' ? stockRow.availableQty : Number(stockRow.qty || 0);
  return Math.max(0, Number(val.toFixed(3)));
}

function scoreClientProductIdentity(rawQuery: string, product: Record<string, any>): number {
  const rawLower = rawQuery.trim().toLowerCase();
  const q = normalizeArabicSearchKey(rawQuery);
  if (!q) return 1;
  const tokens = q.split(/\s+/).filter(Boolean);

  const normName = normalizeArabicSearchKey(product.name);
  const normNameEn = normalizeArabicSearchKey(product.nameEn || product.name_en);
  const rawCodes = [product.barcode, product.sku, product.styleCode]
    .map((v) => String(v ?? '').trim().toLowerCase())
    .filter(Boolean);

  if ((rawLower && rawCodes.includes(rawLower)) || normName === q || normNameEn === q) return 1000;
  if ((normName && normName.startsWith(`${q} `)) || (normNameEn && normNameEn.startsWith(`${q} `))) return 900;
  if ((normName && ` ${normName} `.includes(` ${q} `)) || (normNameEn && ` ${normNameEn} `.includes(` ${q} `))) return 800;
  if ((normName && normName.startsWith(q)) || (normNameEn && normNameEn.startsWith(q))) return 720;
  if ((normName && ` ${normName}`.includes(` ${q}`)) || (normNameEn && ` ${normNameEn}`.includes(` ${q}`))) return 650;

  const combinedNames = [normName, normNameEn].filter(Boolean).join(' ');
  if (tokens.length > 1 && combinedNames && tokens.every((t) => ` ${combinedNames}`.includes(` ${t}`))) return 550;
  if (rawLower && rawCodes.some((c) => c.startsWith(rawLower))) return 500;
  if (rawLower && rawCodes.some((c) => c.includes(rawLower))) return 450;
  if (combinedNames && tokens.every((t) => combinedNames.includes(t))) return 350;

  const normIdentity = normalizeArabicSearchKey(
    [product.name, product.nameEn, product.barcode, product.sku, product.styleCode, product.color, product.size]
      .filter(Boolean)
      .join(' '),
  );
  if (normIdentity && tokens.every((t) => normIdentity.includes(t))) return 250;

  return 0;
}

export function useNewIssueOrderController() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlFromLocationId = searchParams.get('fromLocationId');
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { productsQuery, locationsQuery, branchesQuery, locationStocksQuery } = useInventoryActionCatalog();

  const [fromLocationId, setFromLocationId] = useState('all');
  const [fromLocationQuery, setFromLocationQuery] = useState('كل المخازن');
  const [toLocationId, setToLocationId] = useState('');
  const [toLocationQuery, setToLocationQuery] = useState('');
  // INV-TRANSFER-WAREHOUSE-DESTINATION: the destination may be a branch
  // (sent as toBranchId) or a warehouse (sent as toLocationId). The kind
  // travels with the chosen id so submit can build the right payload.
  const [toDestinationKind, setToDestinationKind] = useState<IssueOrderDestinationKind>('branch');
  const [recipientName, setRecipientName] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<LineItem[]>([{ id: Date.now(), productId: '', qty: 1, fromLocationId: '' }]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [pendingFocusQtyLineId, setPendingFocusQtyLineId] = useState<number | null>(null);
  const [pendingFocusProductLineId, setPendingFocusProductLineId] = useState<number | null>(null);
  const [cameraScanLineId, setCameraScanLineId] = useState<number | null>(null);
  const [createdTransfers, setCreatedTransfers] = useState<any[]>([]);

  const idempotencyKeyRef = useRef<string | null>(null);
  const currentPayloadRef = useRef<string | null>(null);

  const [issueMode, setIssueMode] = useState<'final_issue' | 'transfer_to_branch_stock'>('final_issue');

  const draftData = useMemo(() => ({
    fromLocationId,
    fromLocationQuery,
    toLocationId,
    toLocationQuery,
    toDestinationKind,
    recipientName,
    note,
    issueMode,
    lines,
  }), [fromLocationId, fromLocationQuery, toLocationId, toLocationQuery, toDestinationKind, recipientName, note, issueMode, lines]);

  const { clearDraft, isDraftRestored, dismissRestoredNotice } = useFormDraft({
    key: 'z_draft_inventory_issue_order',
    data: draftData,
    isEmpty: (d) => {
      const hasHeader = Boolean(d.recipientName?.trim() || d.note?.trim() || (d.toLocationId && d.toLocationId !== ''));
      const hasLines = Array.isArray(d.lines) && d.lines.some(l => Boolean(l.productId || l.productName?.trim()));
      return !hasHeader && !hasLines;
    },
    onRestore: (saved) => {
      if (saved.fromLocationId) setFromLocationId(saved.fromLocationId);
      if (saved.fromLocationQuery) setFromLocationQuery(saved.fromLocationQuery);
      if (saved.toLocationId) setToLocationId(saved.toLocationId);
      if (saved.toLocationQuery) setToLocationQuery(saved.toLocationQuery);
      if (saved.toDestinationKind === 'warehouse' || saved.toDestinationKind === 'branch') setToDestinationKind(saved.toDestinationKind);
      if (saved.recipientName) setRecipientName(saved.recipientName);
      if (saved.note) setNote(saved.note);
      if (saved.issueMode) setIssueMode(saved.issueMode);
      if (Array.isArray(saved.lines) && saved.lines.length > 0) {
        setLines(saved.lines);
      }
    },
  });

  const handleClearDraft = () => {
    clearDraft();
    setLines([{ id: Date.now(), productId: '', qty: 1, fromLocationId: '' }]);
    setToLocationId('');
    setToLocationQuery('');
    setToDestinationKind('branch');
    setRecipientName('');
    setNote('');
  };

  const products = Array.isArray(productsQuery.data) ? productsQuery.data : [];
  const locations = Array.isArray(locationsQuery.data) ? locationsQuery.data : [];
  const branches = Array.isArray(branchesQuery.data) ? branchesQuery.data : [];
  const stocks = Array.isArray(locationStocksQuery.data) ? locationStocksQuery.data : [];
  const settingsQuery = useQuery({ queryKey: queryKeys.settings, queryFn: referenceDataApi.settings });

  useEffect(() => {
    if (settingsQuery.data?.defaultBranchIssueMode) {
      setIssueMode(settingsQuery.data.defaultBranchIssueMode as any);
    }
  }, [settingsQuery.data?.defaultBranchIssueMode]);

  useEffect(() => {
    if (urlFromLocationId && locations.length > 0) {
      const loc = locations.find((l: any) => String(l.id) === String(urlFromLocationId));
      if (loc) {
        setFromLocationId(String(loc.id));
        setFromLocationQuery(loc.name);
      }
    }
  }, [urlFromLocationId, locations]);

  useEffect(() => {
    if (pendingFocusQtyLineId === null) return;
    const timer = window.setTimeout(() => {
      const input = document.getElementById(`quantity-input-${pendingFocusQtyLineId}`) as HTMLInputElement | null;
      if (input) {
        input.focus();
        input.select();
      }
      setPendingFocusQtyLineId(null);
    }, 40);
    return () => window.clearTimeout(timer);
  }, [pendingFocusQtyLineId, lines]);

  useEffect(() => {
    if (pendingFocusProductLineId === null) return;
    const timer = window.setTimeout(() => {
      const input = document.getElementById(`product-input-${pendingFocusProductLineId}`) as HTMLInputElement | null;
      if (input) {
        input.focus();
        input.select();
      }
      setPendingFocusProductLineId(null);
    }, 40);
    return () => window.clearTimeout(timer);
  }, [pendingFocusProductLineId, lines]);

  useEffect(() => {
    if (lines.length > 0 && lines[0]?.id) {
      setPendingFocusProductLineId(lines[0].id);
    }
  }, []);

  const operationalLocations = useMemo(
    () => locations.filter((l: any) => l.locationType !== 'in_transit'),
    [locations],
  );

  const locationNamesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const loc of operationalLocations) {
      map.set(String(loc.id), loc.name);
    }
    return map;
  }, [operationalLocations]);

  // Single O(N) pass over stocks (PERF-2 compliant — never scan stocks inside a product loop)
  const stockSummaryByProduct = useMemo(() => {
    const map = new Map<
      string,
      {
        totalAvailable: number;
        byLocation: Map<string, number>;
        bestLocationId: string;
        bestLocationQty: number;
        positiveLocationCount: number;
      }
    >();
    const restrictToKnownLocations = locationNamesById.size > 0;

    for (const s of stocks) {
      const locId = String(s.locationId || '');
      if (!locId) continue;
      if (restrictToKnownLocations && !locationNamesById.has(locId)) continue;

      const avail = getEffectiveStockQty(s);
      const pKey = String(s.productId);
      let entry = map.get(pKey);
      if (!entry) {
        entry = {
          totalAvailable: 0,
          byLocation: new Map<string, number>(),
          bestLocationId: '',
          bestLocationQty: 0,
          positiveLocationCount: 0,
        };
        map.set(pKey, entry);
      }

      const prevLocAvail = entry.byLocation.get(locId) || 0;
      const nextLocAvail = Number((prevLocAvail + avail).toFixed(3));
      entry.byLocation.set(locId, nextLocAvail);
      entry.totalAvailable = Number((entry.totalAvailable + avail).toFixed(3));

      if (prevLocAvail <= 0 && nextLocAvail > 0) {
        entry.positiveLocationCount += 1;
      }
      if (nextLocAvail > entry.bestLocationQty) {
        entry.bestLocationQty = nextLocAvail;
        entry.bestLocationId = locId;
      }
    }
    return map;
  }, [stocks, locationNamesById]);

  const stocksLoaded = locationStocksQuery.isFetched;

  const buildProductOption = useCallback(
    (p: any): IssueOrderProductOption => {
      const id = String(p.id);
      const summaryEntry = stockSummaryByProduct.get(id);
      const totalAvailable = Number((summaryEntry?.totalAvailable || 0).toFixed(3));
      const availableInScope =
        fromLocationId === 'all'
          ? totalAvailable
          : Number((summaryEntry?.byLocation.get(String(fromLocationId)) || 0).toFixed(3));
      const otherLocationsAvailable = Math.max(0, Number((totalAvailable - availableInScope).toFixed(3)));
      const globalStock = Number(p.stock ?? 0);
      const isOutOfStock = stocksLoaded && availableInScope <= 0;

      const codePart = p.barcode || p.sku || '';
      let stockPart = '';
      if (availableInScope > 0) {
        if (fromLocationId === 'all') {
          if (summaryEntry?.positiveLocationCount === 1 && summaryEntry.bestLocationId) {
            const locName = locationNamesById.get(summaryEntry.bestLocationId) || '';
            stockPart = locName ? `المتاح: ${availableInScope} · ${locName}` : `المتاح: ${availableInScope}`;
          } else {
            stockPart = `المتاح: ${availableInScope} (${summaryEntry?.positiveLocationCount || 1} مخازن)`;
          }
        } else {
          stockPart = `المتاح: ${availableInScope}`;
        }
      } else if (stocksLoaded) {
        if (otherLocationsAvailable > 0) {
          stockPart = `الرصيد هنا: 0 (متاح بمخازن أخرى: ${otherLocationsAvailable})`;
        } else if (globalStock > 0) {
          stockPart = `رصيد غير مسند لمخزن (${globalStock})`;
        } else {
          stockPart = 'الرصيد بالمخازن: 0';
        }
      }

      const meta = [codePart, stockPart].filter(Boolean).join(' · ') || undefined;

      return {
        id,
        name: p.name,
        code: p.barcode || '',
        searchTerms: [p.name, p.nameEn, p.barcode || '', p.sku || '', p.styleCode || '']
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
        meta,
        availableInScope,
        otherLocationsAvailable,
        globalStock,
        isOutOfStock,
      };
    },
    [fromLocationId, locationNamesById, stockSummaryByProduct, stocksLoaded],
  );

  const selectedProductIds = useMemo(() => {
    return new Set(lines.map(l => String(l.productId || '')).filter(Boolean));
  }, [lines]);

  const productOptions = useMemo(() => {
    return products
      .filter((p) => {
        if (selectedProductIds.has(String(p.id))) return false;
        if (!stocksLoaded) return true;
        const summaryEntry = stockSummaryByProduct.get(String(p.id));
        const avail =
          fromLocationId === 'all'
            ? (summaryEntry?.totalAvailable || 0)
            : (summaryEntry?.byLocation.get(String(fromLocationId)) || 0);
        return avail > 0;
      })
      .map(buildProductOption);
  }, [products, selectedProductIds, stocksLoaded, stockSummaryByProduct, fromLocationId, buildProductOption]);

  const searchCacheRef = useRef<Map<string, any[]>>(new Map());
  useEffect(() => {
    searchCacheRef.current.clear();
  }, [productsQuery.dataUpdatedAt]);

  const productSearchRefreshKey = useMemo(() => {
    const selectedSignature = Array.from(selectedProductIds).sort().join(',');
    return `${fromLocationId}:${stocksLoaded ? '1' : '0'}:${locationStocksQuery.dataUpdatedAt}:${stocks.length}:${products.length}:${selectedSignature}`;
  }, [fromLocationId, stocksLoaded, locationStocksQuery.dataUpdatedAt, stocks.length, products.length, selectedProductIds]);

  const fetchProductOptions = async (query: string): Promise<IssueOrderProductOption[]> => {
    const trimmed = query.trim();
    if (!trimmed) {
      return productOptions;
    }

    const cacheKey = normalizeArabicSearchKey(trimmed) || trimmed.toLowerCase();
    let serverResults = searchCacheRef.current.get(cacheKey);
    if (!serverResults) {
      try {
        serverResults = await inventoryApi.searchProducts(trimmed, {
          pageSize: 200,
          identityOnly: true,
          preferInStock: true,
          brief: true,
        });
        searchCacheRef.current.set(cacheKey, serverResults);
      } catch (e) {
        console.error(e);
        serverResults = [];
      }
    }

    // Merge server matches with in-memory catalog matches so results are complete even on slow connections
    const mergedById = new Map<string, any>();
    for (const p of serverResults) {
      mergedById.set(String(p.id), p);
    }
    for (const p of products) {
      const pId = String(p.id);
      if (!mergedById.has(pId) && scoreClientProductIdentity(trimmed, p) > 0) {
        mergedById.set(pId, p);
      }
    }

    const ranked: Array<{ option: IssueOrderProductOption; score: number }> = [];
    for (const p of mergedById.values()) {
      const pId = String(p.id);
      if (selectedProductIds.has(pId)) continue;
      const score = scoreClientProductIdentity(trimmed, p) || 250;
      ranked.push({ option: buildProductOption(p), score });
    }

    ranked.sort((a, b) => {
      const aStrong = a.score >= 450 ? 1 : 0;
      const bStrong = b.score >= 450 ? 1 : 0;
      if (aStrong !== bStrong) return bStrong - aStrong;

      const aInStock = a.option.availableInScope > 0 ? 1 : 0;
      const bInStock = b.option.availableInScope > 0 ? 1 : 0;
      if (aInStock !== bInStock) return bInStock - aInStock;

      if (a.score !== b.score) return b.score - a.score;
      return Number(b.option.id) - Number(a.option.id);
    });

    return ranked.map((entry) => entry.option);
  };

  // Reconcile any line selected before location-stocks finished initial load
  useEffect(() => {
    if (!stocksLoaded || fromLocationId !== 'all') return;
    setLines((prevLines) => {
      let changed = false;
      const next = prevLines.map((line) => {
        if (!line.productId || line.fromLocationId) return line;
        const summaryEntry = stockSummaryByProduct.get(String(line.productId));
        if (!summaryEntry || !summaryEntry.bestLocationId) return line;
        changed = true;
        const locName = locationNamesById.get(summaryEntry.bestLocationId) || '';
        const clampedQty = Math.min(Number(line.qty || 1), Math.max(1, summaryEntry.bestLocationQty));
        return {
          ...line,
          fromLocationId: summaryEntry.bestLocationId,
          fromLocationName: locName,
          qty: clampedQty,
        };
      });
      return changed ? next : prevLines;
    });
  }, [stocksLoaded, fromLocationId, stockSummaryByProduct, locationNamesById]);

  const locationOptions = useMemo(
    () => [
      { id: 'all', name: 'كل المخازن', searchTerms: 'كل المخازن all' },
      ...operationalLocations.map((l: any) => ({
        id: String(l.id),
        name: l.name,
        searchTerms: l.name.toLowerCase(),
      })),
    ],
    [operationalLocations],
  );

  const branchOptions = branches.map((b) => ({
    id: String(b.id),
    name: b.name,
    searchTerms: b.name.toLowerCase(),
  }));

  // INV-TRANSFER-WAREHOUSE-DESTINATION: the destination list holds branches
  // AND warehouses, so a warehouse can be chosen as the destination.
  const destinationOptions = useMemo(
    () => buildTransferDestinationOptions(branches, locations),
    [branches, locations],
  );

  const handleSelectDestination = (option: IssueOrderDestinationOption) => {
    setToLocationId(option.id);
    setToDestinationKind(option.kind);
  };

  const handleClearDestination = () => {
    setToLocationId('');
    setToDestinationKind('branch');
  };

  const addLine = () => {
    const newLineId = Date.now();
    setLines(prev => [...prev, { id: newLineId, productId: '', qty: 1, fromLocationId: '' }]);
    setPendingFocusProductLineId(newLineId);
  };

  const removeLine = (id: number) => {
    if (lines.length === 1) return;
    setLines(lines.filter(l => l.id !== id));
  };

  const handleSelectProduct = (
    lineId: number,
    productOption: {
      id: string;
      name: string;
      availableInScope?: number;
      otherLocationsAvailable?: number;
      globalStock?: number;
      isOutOfStock?: boolean;
    },
  ) => {
    const existingLine = lines.find(l => l.id !== lineId && String(l.productId) === String(productOption.id));
    if (existingLine) {
      toast.warning(`الصنف "${productOption.name}" تم اختياره مسبقاً في الإذن.`);
      setLines(prevLines => prevLines.map(l => l.id === lineId && !l.productId ? { ...l, productName: '' } : l));
      setPendingFocusQtyLineId(existingLine.id);
      return;
    }

    const summaryEntry = stockSummaryByProduct.get(String(productOption.id));
    const computedAvail =
      productOption.availableInScope ??
      (fromLocationId === 'all'
        ? (summaryEntry?.totalAvailable || 0)
        : (summaryEntry?.byLocation.get(String(fromLocationId)) || 0));
    const computedOtherAvail =
      productOption.otherLocationsAvailable ??
      Math.max(0, Number(((summaryEntry?.totalAvailable || 0) - computedAvail).toFixed(3)));

    if (stocksLoaded && computedAvail <= 0) {
      if (fromLocationId !== 'all' && computedOtherAvail > 0) {
        toast.warning(
          `الصنف "${productOption.name}" رصيده صفر في هذا المخزن (متاح في مخازن أخرى: ${computedOtherAvail}). اختر مخزناً آخر أو "كل المخازن".`,
        );
      } else if (Number(productOption.globalStock || 0) > 0) {
        toast.warning(
          `الصنف "${productOption.name}" له رصيد عام (${productOption.globalStock}) غير مسند لمخزن محدد بعد. يرجى إسناده لمخزن عبر تسوية المخزون أولاً.`,
        );
      } else {
        toast.warning(`الصنف "${productOption.name}" رصيده المتاح بالمخازن صفر حالياً — لا يمكن صرفه قبل التوريد.`);
      }
      setLines(prevLines => prevLines.map(l => l.id === lineId && !l.productId ? { ...l, productName: '' } : l));
      setPendingFocusProductLineId(lineId);
      return;
    }

    setLines(prevLines => {
      const lineToUpdate = prevLines.find(l => l.id === lineId);
      let newLines = prevLines.map(l => l.id === lineId ? { ...l, productId: productOption.id, productName: productOption.name } : l);

      let newLocationId = '';
      let newLocationName = '';
      let maxAvailable = computedAvail > 0 ? computedAvail : 1;

      if (fromLocationId === 'all' && summaryEntry?.bestLocationId) {
        newLocationId = summaryEntry.bestLocationId;
        newLocationName = locationNamesById.get(newLocationId) || '';
        maxAvailable = summaryEntry.bestLocationQty > 0 ? summaryEntry.bestLocationQty : 1;
      }

      if (newLocationId) {
        const currentQty = lineToUpdate ? Number(lineToUpdate.qty || 1) : 1;
        const newQty = Math.min(currentQty, maxAvailable);
        newLines = newLines.map(l => l.id === lineId ? { ...l, fromLocationId: newLocationId, fromLocationName: newLocationName, qty: newQty } : l);
      } else if (fromLocationId !== 'all' && computedAvail > 0) {
        const currentQty = lineToUpdate ? Number(lineToUpdate.qty || 1) : 1;
        const newQty = Math.min(currentQty, computedAvail);
        newLines = newLines.map(l => l.id === lineId ? { ...l, qty: newQty } : l);
      }

      const isLast = newLines[newLines.length - 1].id === lineId;
      if (isLast) {
        newLines.push({ id: Date.now(), productId: '', qty: 1, fromLocationId: '' });
      }

      return newLines;
    });

    setPendingFocusQtyLineId(lineId);
  };

  const handleQtyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, lineId: number) => {
    if ((e.key === 'Tab' && !e.shiftKey) || e.key === 'Enter') {
      e.preventDefault();
      const currentIndex = lines.findIndex(l => l.id === lineId);
      if (currentIndex !== -1) {
        if (currentIndex + 1 < lines.length) {
          const nextLine = lines[currentIndex + 1];
          setPendingFocusProductLineId(nextLine.id);
        } else {
          const newLineId = Date.now();
          setLines(prev => [...prev, { id: newLineId, productId: '', qty: 1, fromLocationId: '' }]);
          setPendingFocusProductLineId(newLineId);
        }
      }
    }
  };

  const updateLine = (id: number, field: keyof LineItem, value: any) => {
    setLines(prevLines => {
      const lineToUpdate = prevLines.find(l => l.id === id);
      let actualValue = value;

      if (field === 'qty' && lineToUpdate && lineToUpdate.productId) {
        const val = Number(value);
        let maxQty = 0;
        const locId = lineToUpdate.fromLocationId && lineToUpdate.fromLocationId !== 'all'
          ? lineToUpdate.fromLocationId
          : (fromLocationId !== 'all' ? fromLocationId : null);

        if (locId && locId !== 'all') {
          maxQty = stockSummaryByProduct.get(String(lineToUpdate.productId))?.byLocation.get(String(locId)) ?? 0;
        } else {
          maxQty = 0;
        }

        if (val > maxQty && locId && locId !== 'all') {
          setErrorMsg(`مخزون غير كافي. أقصى كمية متاحة للصرف هي ${maxQty}`);
          actualValue = maxQty;
        } else {
          setErrorMsg('');
        }
      }

      let newLines = prevLines.map(l => {
        if (l.id !== id) return l;
        if (field === 'productName' && l.productId && actualValue !== l.productName) {
          return { ...l, productName: actualValue, productId: '' };
        }
        return { ...l, [field]: actualValue };
      });

      if (field === 'productId' && value) {
        const existingLine = prevLines.find(l => l.id !== id && String(l.productId) === String(value));
        if (existingLine) {
          toast.warning('الصنف مضاف مسبقاً في الإذن.');
          return prevLines.map(l => l.id === id && !l.productId ? { ...l, productName: '' } : l);
        }

        const product = products.find(p => String(p.id) === String(value));
        if (product) {
          newLines = newLines.map(l => l.id === id ? { ...l, productName: product.name } : l);
        }

        const stocksList = Array.isArray(locationStocksQuery.data) ? locationStocksQuery.data : [];
        const productStocks = stocksList.filter(s => String(s.productId) === String(value) && s.qty > 0);

        let newLocationId = '';
        let newLocationName = '';

        if (fromLocationId === 'all') {
          const bestStock = productStocks.sort((a, b) => b.qty - a.qty)[0];
          if (bestStock) {
            newLocationId = String(bestStock.locationId);
            const loc = locationOptions.find(l => String(l.id) === newLocationId);
            if (loc) newLocationName = loc.name;
          }
        }

        if (newLocationId) {
          const bestStock = productStocks.sort((a, b) => b.qty - a.qty)[0];
          const maxAvailable = bestStock ? bestStock.qty : 1;
          const currentQty = lineToUpdate ? Number(lineToUpdate.qty || 1) : 1;
          const newQty = Math.min(currentQty, maxAvailable);
          newLines = newLines.map(l => l.id === id ? { ...l, fromLocationId: newLocationId, fromLocationName: newLocationName, qty: newQty } : l);
        }

        const isLast = newLines[newLines.length - 1].id === id;
        if (isLast) {
          newLines.push({ id: Date.now(), productId: '', qty: 1, fromLocationId: '' });
        }

        setPendingFocusQtyLineId(id);
      }

      if (field === 'fromLocationId' && value) {
        const loc = locationOptions.find(l => String(l.id) === String(value));
        if (loc) {
          const newLocationId = String(value);
          let maxQty = 0;
          if (newLocationId !== 'all' && lineToUpdate?.productId) {
            maxQty = stockSummaryByProduct.get(String(lineToUpdate.productId))?.byLocation.get(newLocationId) ?? 0;
          }

          const currentQty = Number(lineToUpdate?.qty || 1);
          let newQty = currentQty;

          if (lineToUpdate?.productId && currentQty > maxQty) {
            setErrorMsg(`مخزون غير كافي في هذا المخزن. أقصى كمية متاحة هي ${maxQty}`);
            newQty = maxQty;
          } else {
            setErrorMsg('');
          }

          newLines = newLines.map(l => l.id === id ? { ...l, fromLocationName: loc.name, qty: newQty } : l);
        }
      }

      return newLines;
    });
  };

  const handleSubmit = async () => {
    setErrorMsg('');
    if (!fromLocationId || !toLocationId) {
      setErrorMsg('يرجى تحديد مخزن الصرف والوجهة (فرع أو مخزن)');
      return;
    }
    const validLines = lines.filter(l => {
      const pId = Number(l.productId);
      const q = Number(l.qty);
      return Number.isSafeInteger(pId) && pId > 0 && Number.isFinite(q) && q > 0;
    });
    if (validLines.length === 0) {
      setErrorMsg('يرجى إضافة صنف واحد على الأقل وتحديد كميته');
      return;
    }

    // INV-TRANSFER-WAREHOUSE-DESTINATION: resolve the destination into
    // the payload legs. A branch keeps the old toBranchId path (with its
    // branch_stock requirement in transfer mode); a warehouse is sent as
    // toLocationId and the backend receives the transfer into that exact
    // location.
    const destination = resolveTransferDestination({
      kind: toDestinationKind,
      destinationId: toLocationId,
      locations,
      issueMode,
    });
    if (!destination.ok) {
      setErrorMsg(destination.error);
      return;
    }

    const seenProducts = new Map<string, string>();
    for (const line of validLines) {
      if (seenProducts.has(line.productId!)) {
        setErrorMsg(`الصنف "${line.productName}" مكرر. يرجى دمجه في سطر واحد أو حذف المكرر.`);
        return;
      }
      seenProducts.set(line.productId!, String(line.id));
    }

    if (fromLocationId === 'all') {
      const missingLocations = validLines.some(l => !l.fromLocationId || l.fromLocationId === 'all' || !Number(l.fromLocationId));
      if (missingLocations) {
        setErrorMsg('يرجى تحديد مخزن الصرف لكل الأصناف المضافة');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      // INV-TRANSFER-WAREHOUSE-DESTINATION: the kind is part of the
      // payload identity — the same numeric id can be both a branch and
      // a warehouse, and reusing the key across kinds would replay the
      // wrong destination's committed response.
      const payloadString = buildIssueOrderPayloadIdentity({
        fromLocationId,
        toLocationId,
        toDestinationKind,
        recipientName,
        note,
        issueMode,
        lines: validLines.map(l => ({ productId: l.productId, qty: l.qty, locId: l.fromLocationId })),
      });
      if (!idempotencyKeyRef.current || currentPayloadRef.current !== payloadString) {
        idempotencyKeyRef.current = crypto.randomUUID();
        currentPayloadRef.current = payloadString;
      }

      const groupedLines = validLines.reduce((acc, line) => {
        const rawLoc = fromLocationId === 'all' ? line.fromLocationId : fromLocationId;
        const locNum = Number(rawLoc);
        if (!Number.isSafeInteger(locNum) || locNum <= 0) return acc;
        const key = String(locNum);
        if (!acc[key]) acc[key] = [];
        acc[key].push(line);
        return acc;
      }, {} as Record<string, LineItem[]>);

      if (Object.keys(groupedLines).length === 0) {
        setErrorMsg('يرجى تحديد مخزن الصرف بشكل صحيح');
        setIsSubmitting(false);
        return;
      }

      const successfulTransfers: any[] = [];
      const errors: string[] = [];

      const results = await Promise.allSettled(
        Object.entries(groupedLines).map(async ([locId, items], _idx) => {
          const idemKey = _idx === 0 ? idempotencyKeyRef.current! : `${idempotencyKeyRef.current!}-${_idx}`;

          return withIdempotency(
            (headers) => inventoryApi.createStockTransfer({
              fromLocationId: Number(locId),
              ...(destination.toBranchId != null ? { toBranchId: destination.toBranchId } : {}),
              ...(destination.toLocationId != null ? { toLocationId: destination.toLocationId } : {}),
              recipientName,
              note,
              issueMode,
              items: items.map(l => ({
                productId: Number(l.productId),
                qty: Number(l.qty),
              })),
            }, headers),
            'createStockTransfer',
            idemKey,
            setIsPolling,
          );
        })
      );

      results.forEach((r) => {
        if (r.status === 'fulfilled') {
          const res = r.value as any;
          if (res && res.ok && res.transferId) {
            const transfers = res.stockTransfers || [];
            const transfer = transfers.find((t: any) => String(t.id) === String(res.transferId));
            if (transfer) {
              successfulTransfers.push(transfer);
            } else {
              successfulTransfers.push({ id: res.transferId, docNo: `TR-${res.transferId}` });
            }
          }
        } else {
          const serverMsg = (r.reason as any)?.response?.data?.message || r.reason?.message || 'حدث خطأ أثناء اعتماد إذن الصرف';
          errors.push(serverMsg);
        }
      });

      await invalidateInventoryDomain(queryClient, { includeProducts: true, includeDashboard: true });

      if (errors.length > 0) {
        const uniqueErrors = Array.from(new Set(errors));
        setErrorMsg(uniqueErrors.join(' - '));
        idempotencyKeyRef.current = null;
        currentPayloadRef.current = null;
        if (successfulTransfers.length === 0) {
          setIsSubmitting(false);
          return;
        }
      }

      if (successfulTransfers.length > 0) {
        clearDraft();
        idempotencyKeyRef.current = null;
        currentPayloadRef.current = null;
        setLines([{ id: Date.now(), productId: '', qty: 1, fromLocationId: '' }]);
        setToLocationId('');
        setToLocationQuery('');
        setRecipientName('');
        setNote('');
        setCreatedTransfers(successfulTransfers);
      } else {
        clearDraft();
        idempotencyKeyRef.current = null;
        currentPayloadRef.current = null;
        setLines([{ id: Date.now(), productId: '', qty: 1, fromLocationId: '' }]);
        setToLocationId('');
        setToLocationQuery('');
        setRecipientName('');
        setNote('');
        navigate('/inventory');
      }
    } catch (error: any) {
      console.error(error);
      const isNetworkOrTimeout = error.message?.includes('network') || error.message?.includes('timeout') || error.message?.includes('Network') || error.name === 'TypeError';
      const is5xx = error.response?.status >= 500 && error.response?.status < 600;
      const isRecovery = error.message?.includes('Recovery polling');

      const msg = error?.message || 'تعذر تأكيد نتيجة العملية، يرجى مراجعة سجل العمليات.';
      setErrorMsg(msg);

      if (!isNetworkOrTimeout && !is5xx && !isRecovery) {
        idempotencyKeyRef.current = null;
        currentPayloadRef.current = null;
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrintA4 = () => {
    if (createdTransfers.length) {
      import('@/lib/inventory-printing').then(({ printMultipleTransfers }) => {
        printMultipleTransfers(createdTransfers, { pageSize: 'a4' });
      });
    }
  };

  const handlePrintReceipt = () => {
    if (createdTransfers.length) {
      import('@/lib/inventory-printing').then(({ printMultipleTransfers }) => {
        printMultipleTransfers(createdTransfers, { pageSize: 'receipt' });
      });
    }
  };

  const handleCameraScanForLine = async (scannedCode: string) => {
    if (cameraScanLineId !== null) {
      const opts = await fetchProductOptions(scannedCode);
      if (opts.length > 0) {
        handleSelectProduct(cameraScanLineId, opts[0]);
      } else {
        updateLine(cameraScanLineId, 'productName', scannedCode);
      }
    }
    setCameraScanLineId(null);
  };

  const resetForm = () => {
    clearDraft();
    setCreatedTransfers([]);
    setLines([{ id: Date.now(), productId: '', qty: 1, fromLocationId: '' }]);
    setToLocationId('');
    setToLocationQuery('');
    setToDestinationKind('branch');
    setRecipientName('');
    setNote('');
  };

  const summary = useMemo(() => {
    const validLines = lines.filter(l => Boolean(l.productId && Number(l.qty) > 0));
    const itemsCount = validLines.length;
    const totalPieces = validLines.reduce((acc, l) => acc + (Number(l.qty) || 0), 0);
    return {
      itemsCount,
      totalPieces: Number(totalPieces.toFixed(3)),
    };
  }, [lines]);

  return {
    navigate,
    user,
    fromLocationId,
    setFromLocationId,
    fromLocationQuery,
    setFromLocationQuery,
    toLocationId,
    setToLocationId,
    toLocationQuery,
    setToLocationQuery,
    recipientName,
    setRecipientName,
    note,
    setNote,
    lines,
    summary,
    isSubmitting,
    isPolling,
    errorMsg,
    cameraScanLineId,
    setCameraScanLineId,
    createdTransfers,
    setCreatedTransfers,
    issueMode,
    setIssueMode,
    isDraftRestored,
    clearDraft,
    handleClearDraft,
    dismissRestoredNotice,
    products,
    locationOptions,
    branchOptions,
    destinationOptions,
    handleSelectDestination,
    handleClearDestination,
    stocks,
    productOptions,
    productSearchRefreshKey,
    fetchProductOptions,
    addLine,
    removeLine,
    handleSelectProduct,
    handleQtyKeyDown,
    updateLine,
    handleSubmit,
    handlePrintA4,
    handlePrintReceipt,
    handleCameraScanForLine,
    resetForm,
  };
}
