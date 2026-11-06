import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useInventoryActionCatalog } from '@/features/inventory/hooks/useInventoryActionCatalog';
import { useAuthStore } from '@/stores/auth-store';
import { inventoryApi } from '@/features/inventory/api/inventory.api';
import { withIdempotency } from '@/lib/idempotency';
import { referenceDataApi } from '@/services/reference-data.api';
import { queryKeys } from '@/app/query-keys';
import { useFormDraft } from '@/shared/hooks/use-form-draft';
import { toast } from '@/shared/components/system-alert';
import {
  buildIssueOrderPayloadIdentity,
  buildTransferDestinationOptions,
  resolveTransferDestination,
  type IssueOrderDestinationKind,
  type IssueOrderDestinationOption,
} from './issue-order-destination.helpers';
import { LineItem } from './types';

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

  const availableProductIds = useMemo(() => {
    const ids = new Set<string>();
    if (fromLocationId === 'all') {
      for (const s of stocks) {
        if (s.qty > 0) ids.add(String(s.productId));
      }
    } else {
      for (const s of stocks) {
        if (String(s.locationId) === String(fromLocationId) && s.qty > 0) {
          ids.add(String(s.productId));
        }
      }
    }
    return ids;
  }, [stocks, fromLocationId]);

  const selectedProductIds = useMemo(() => {
    return new Set(lines.map(l => String(l.productId || '')).filter(Boolean));
  }, [lines]);

  const productOptions = useMemo(() => {
    return products
      .filter(p => availableProductIds.has(String(p.id)) && !selectedProductIds.has(String(p.id)))
      .map(p => ({
        id: String(p.id),
        name: p.name,
        code: p.barcode || '',
        searchTerms: [p.name, p.barcode || ''].filter(Boolean).join(' ').toLowerCase(),
      }));
  }, [products, availableProductIds, selectedProductIds]);

  const fetchProductOptions = async (query: string) => {
    try {
      const results = await inventoryApi.searchProducts(query);
      return results
        .filter(p => availableProductIds.has(String(p.id)) && !selectedProductIds.has(String(p.id)))
        .map(p => ({
          id: String(p.id),
          name: p.name,
          code: p.barcode || '',
          searchTerms: [p.name, p.barcode].filter(Boolean).join(' ').toLowerCase(),
        }));
    } catch (e) {
      console.error(e);
      return [];
    }
  };

  const locationOptions = [
    { id: 'all', name: 'كل المخازن', searchTerms: 'كل المخازن all' },
    ...locations.filter((l: any) => l.locationType !== 'in_transit').map((l) => ({
      id: String(l.id),
      name: l.name,
      searchTerms: l.name.toLowerCase(),
    })),
  ];

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

  const handleSelectProduct = (lineId: number, productOption: { id: string; name: string }) => {
    const existingLine = lines.find(l => l.id !== lineId && String(l.productId) === String(productOption.id));
    if (existingLine) {
      toast.warning(`الصنف "${productOption.name}" تم اختياره مسبقاً في الإذن.`);
      setLines(prevLines => prevLines.map(l => l.id === lineId && !l.productId ? { ...l, productName: '' } : l));
      setPendingFocusQtyLineId(existingLine.id);
      return;
    }

    setLines(prevLines => {
      const lineToUpdate = prevLines.find(l => l.id === lineId);
      let newLines = prevLines.map(l => l.id === lineId ? { ...l, productId: productOption.id, productName: productOption.name } : l);

      const stocksList = Array.isArray(locationStocksQuery.data) ? locationStocksQuery.data : [];
      const productStocks = stocksList.filter(s => String(s.productId) === String(productOption.id) && s.qty > 0);

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
        newLines = newLines.map(l => l.id === lineId ? { ...l, fromLocationId: newLocationId, fromLocationName: newLocationName, qty: newQty } : l);
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
          const locStock = stocks.find(s => String(s.productId) === String(lineToUpdate.productId) && String(s.locationId) === String(locId));
          if (locStock) maxQty = locStock.qty;
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

      let newLines = prevLines.map(l => l.id === id ? { ...l, [field]: actualValue } : l);

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
          if (newLocationId !== 'all') {
            const locStock = stocks.find(s => String(s.productId) === String(lineToUpdate?.productId) && String(s.locationId) === newLocationId);
            if (locStock) maxQty = locStock.qty;
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

      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['stock-transfers'] });
      queryClient.invalidateQueries({ queryKey: ['manager-actions'] });

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
