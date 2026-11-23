import { toast, systemConfirm } from '@/shared/components/system-alert';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  useShipmentDetailsQuery, 
  useUpdateShipmentCostsMutation, 
  useUpdateShipmentItemMutation,
  useImportProjectItemsMutation,
  useApplyPricesMutation,
  useCreateReceivingInspectionMutation,
  useRecordLateShipmentExpenseMutation,
  useReversePostedReceiptMutation,
  useResolveLegacyReceiptMutation,
} from './api/shipments.api';
import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isCashBankAccount } from '@/features/accounting';
import { suppliersApi } from '@/shared/api/suppliers.api';
import { http } from '@/lib/http';
import { referenceDataApi } from '@/services/reference-data.api';
import { type SelectOption } from '@/shared/ui/custom-select';
import { ShipmentDetailsHeader } from './shipment-details-page/shipment-details-header';
import { ShipmentDetailsCosts } from './shipment-details-page/shipment-details-costs';
import { ShipmentDetailsReceiptItems } from './shipment-details-page/shipment-details-receipt-items';
import { ShipmentDetailsModals } from './shipment-details-page/shipment-details-modals';


export default function ShipmentDetailsPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading } = useShipmentDetailsQuery(id!);
  
  const [shippingCost, setShippingCost] = useState('');
  const [shippingAcc, setShippingAcc] = useState('');
  
  const [customsCost, setCustomsCost] = useState('');
  const [customsAcc, setCustomsAcc] = useState('');

  const [transportCost, setTransportCost] = useState('');
  const [transportAcc, setTransportAcc] = useState('');

  // INV-IMPORT-LANDED-COST-DUTY-VAT: itemized customs tax.
  // Empty means "no change" — the stored rate is shown in the
  // placeholder, like the other cost inputs. Duty is charged on
  // CIF (goods + freight + insurance) and VAT on (CIF + duty),
  // capitalized into landed cost exactly as the feasibility
  // study computes them; the flat "جمارك" fee above stays a
  // clearance fee, never the tax.
  const [dutyRate, setDutyRate] = useState('');
  const [vatRate, setVatRate] = useState('');
  const [insuranceCost, setInsuranceCost] = useState('');

  // Explicit payee per cost component (INV-IMPORT-SUPPLIER-ATTRIBUTION):
  // empty means "no change" — the stored payee is shown in the first
  // option. A nonzero component with no payee and no recorded reason
  // fails the receipt closed, so the operator records the payee (or
  // the unallocable reason) here before marking the shipment Arrived.
  // I1-P3: when a component has no stored payee yet and the shipment
  // has a supplier, the select defaults to that supplier instead of
  // "غير محدد" (see the hydration effect below). The stored payee,
  // when set, always wins over the shipment supplier.
  const [freightSupplier, setFreightSupplier] = useState('');
  const [customsSupplier, setCustomsSupplier] = useState('');
  const [transportSupplier, setTransportSupplier] = useState('');
  const [demurrageSupplier, setDemurrageSupplier] = useState('');
  // I1-P3: payee defaults are applied once per shipment (first data
  // arrival) so a later refetch never clobbers an operator's
  // in-progress pick.
  const payeeDefaultsAppliedFor = useRef<string | null>(null);
  const [unallocableCostReason, setUnallocableCostReason] = useState('');
  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers', 'all'],
    queryFn: () => suppliersApi.listAll(),
  });
  const suppliersList: any[] = suppliersData?.suppliers || [];
  const supplierName = (supplierId: number | null | undefined) => {
    if (!supplierId) return 'غير محدد';
    const found = suppliersList.find((s: any) => Number(s.id) === Number(supplierId));
    return found ? (found.name || found.nameAr || found.name_ar || `#${supplierId}`) : `#${supplierId}`;
  };

  const [exchangeRate, setExchangeRate] = useState('');
  const [pricingExchangeRate, setPricingExchangeRate] = useState('');
  const [status, setStatus] = useState<string>('');
  const [allocationMethod, setAllocationMethod] = useState<'value' | 'weight' | 'cbm' | ''>('');
  const [receiptLocationId, setReceiptLocationId] = useState<string>('');
  
  // Dates
  const [shippedDate, setShippedDate] = useState('');
  const [etaDate, setEtaDate] = useState('');
  const [clearanceDate, setClearanceDate] = useState('');
  const [form4Number, setForm4Number] = useState('');
  const [form4Date, setForm4Date] = useState('');

  // INV-IMPORT-FORM4-CLEARANCE-GATE: how this shipment's goods
  // are funded. Bank-channel funding above USD 2,000 requires a
  // Form 4 before clearance/receipt; cash carried by a traveller
  // is exempt. Defaults to bank_transfer; the operator may change
  // it here before clearance. The stored value is shown on load;
  // a legacy shipment with no value reads as bank_transfer.
  const [fundingType, setFundingType] = useState<'bank_transfer' | 'cash_carried'>('bank_transfer');

  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [isAutopsyOpen, setIsAutopsyOpen] = useState(false);
  const [isPreordersOpen, setIsPreordersOpen] = useState(false);
  const [isGrnOpen, setIsGrnOpen] = useState(false);
  const [isLateExpenseOpen, setIsLateExpenseOpen] = useState(false);

  // GRN state
  const [grnInspectorName, setGrnInspectorName] = useState('');
  const [grnLocationId, setGrnLocationId] = useState('');
  const [grnNotes, setGrnNotes] = useState('');
  const [grnDamagedMap, setGrnDamagedMap] = useState<Record<string, number>>({});

  // Receipt correction state (INV-IMPORT-RECEIPT-REVERSAL): the
  // approval token is minted in the approvals center bound to
  // this shipment and receipt; the token id + reason execute it.
  const [reversalApprovalId, setReversalApprovalId] = useState('');
  const [reversalReason, setReversalReason] = useState('');
  const [resolveApprovalId, setResolveApprovalId] = useState('');
  const [resolveReason, setResolveReason] = useState('');
  const [lateExpenseType, setLateExpenseType] = useState('demurrage');
  const [lateAmountEgp, setLateAmountEgp] = useState('');
  const [lateDescription, setLateDescription] = useState('');
  const [lateExpenseSupplier, setLateExpenseSupplier] = useState('');
  const [lateExpenseUnallocableReason, setLateExpenseUnallocableReason] = useState('');
  
  const [globalRetailMargin, setGlobalRetailMargin] = useState('');
  const [globalWholesaleMargin, setGlobalWholesaleMargin] = useState('');
  
  const updateCostsMutation = useUpdateShipmentCostsMutation(id!);
  const applyPricesMutation = useApplyPricesMutation(id!);
  const reverseReceiptMutation = useReversePostedReceiptMutation(id!);
  const resolveLegacyMutation = useResolveLegacyReceiptMutation(id!);
  const updateItemMutation = useUpdateShipmentItemMutation(id!);
  const importProjectItemsMutation = useImportProjectItemsMutation(id!);
  const createGrnMutation = useCreateReceivingInspectionMutation();
  const recordLateExpenseMutation = useRecordLateShipmentExpenseMutation();

  useEffect(() => {
    if (data) {
      setShippedDate(data.shipped_date ? data.shipped_date.split('T')[0] : '');
      const eta = data.eta_date || data.arrival_date;
      setEtaDate(eta ? eta.split('T')[0] : '');
      setClearanceDate(data.clearance_date ? data.clearance_date.split('T')[0] : '');
      setForm4Number(data.form4_number || '');
      setForm4Date(data.form4_date ? data.form4_date.split('T')[0] : '');
      setFundingType((data as any).funding_type === 'cash_carried' ? 'cash_carried' : 'bank_transfer');
      if (data.exchange_rate_at_arrival != null && Number(data.exchange_rate_at_arrival) > 0) {
        setExchangeRate(String(Number(data.exchange_rate_at_arrival)));
      }
      if (data.pricing_exchange_rate != null && Number(data.pricing_exchange_rate) > 0) {
        setPricingExchangeRate(String(Number(data.pricing_exchange_rate)));
      }
      if (data.shipping_cost_usd != null && Number(data.shipping_cost_usd) > 0) {
        setShippingCost(String(Number(data.shipping_cost_usd)));
      }
      if (data.customs_cost_egp != null && Number(data.customs_cost_egp) > 0) {
        setCustomsCost(String(Number(data.customs_cost_egp)));
      }
      if (data.internal_transport_cost_egp != null && Number(data.internal_transport_cost_egp) > 0) {
        setTransportCost(String(Number(data.internal_transport_cost_egp)));
      }
      if (data.cost_allocation_method) {
        setAllocationMethod(data.cost_allocation_method);
      }
      if (data.status) {
        setStatus(data.status);
      }
      // I1-P3: default each cost-component payee to the shipment's
      // supplier when the component has no stored payee yet. Applied
      // once per shipment so a refetch never overwrites a pick the
      // operator already made; a stored payee always wins.
      if (payeeDefaultsAppliedFor.current !== data.id) {
        payeeDefaultsAppliedFor.current = data.id;
        const shipmentSupplier = data.supplier_id ? String(data.supplier_id) : '';
        if (shipmentSupplier) {
          if (!data.freight_supplier_id) setFreightSupplier(shipmentSupplier);
          if (!data.customs_supplier_id) setCustomsSupplier(shipmentSupplier);
          if (!data.transport_supplier_id) setTransportSupplier(shipmentSupplier);
          if (!data.demurrage_supplier_id) setDemurrageSupplier(shipmentSupplier);
        }
      }
    }
  }, [data]);

  // Fetch accounts for treasury dropdown (assuming generic endpoint, fallback to basic input if fails)
  const { data: accountsData } = useQuery({
    queryKey: ['accounts-list'],
    queryFn: () => http<any>('/api/accounting/accounts').catch(() => ({ accounts: [] })),
  });
  const treasuryAccounts = (accountsData?.accounts || (Array.isArray(accountsData) ? accountsData : []))
    .filter((a: any) => {
      if (a.isParent || a.code === '1100' || a.name === 'الأصول المتداولة' || a.name_ar === 'الأصول المتداولة') return false;
      // INV-IMPORT-ISCASHBANK-SWEEP (I5): the flags arm goes through the
      // shared helper — the old top-level `a.isCashBank` read was always
      // undefined. The code / accountGroup fallback arms are kept
      // unchanged, so the offered set is not narrowed.
      return isCashBankAccount(a) || a.code === '1110' || a.code === '1120' || a.code === '1160' || a.accountGroup === 'cash_bank';
    });
  const { data: warehouseLocations = [] } = useQuery({ queryKey: ['locations'], queryFn: referenceDataApi.locations });

  if (isLoading) {
    return (
      <div className="page-stack page-shell import-sales-page" dir="rtl">
        <main className="document-prototype-column" style={{ paddingBottom: '80px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
          <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>{t('import_sales.shipment_details_page.s3', "جاري التحميل...")}</div>
        </main>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="page-stack page-shell import-sales-page" dir="rtl">
        <main className="document-prototype-column" style={{ paddingBottom: '80px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
          <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>{t('import_sales.shipment_details_page.s4', "الحاوية غير موجودة")}</div>
        </main>
      </div>
    );
  }

  const handleUpdateCosts = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'Arrived' && data.status !== 'Arrived') {
      if (!receiptLocationId) {
        toast.error('يجب تحديد مخزن استلام الحاوية الفعلي قبل الترحيل إلى المخزون');
        return;
      }
      // I1-P5 early payee pre-flight (INV-IMPORT-PAYEE-VALIDATION-EARLY):
      // the payee problem must surface BEFORE the irreversible
      // arrival confirm is shown, never after confirming it. The
      // check mirrors the backend save-time rule on the values
      // already loaded (form state falls back to the stored
      // shipment): every nonzero cost component needs its payee or
      // a recorded unallocable reason. The loaded shipment carries
      // no broker-folded sums, so this uses raw bucket amounts and
      // can ask for a payee on a fully broker-folded component the
      // backend would post without one; assigning one there is
      // harmless (a zero share creates no credit line), and the
      // backend remains the authority on the confirm itself.
      const effectiveCost = (formValue: string, stored: unknown): number => {
        const n = formValue !== '' ? Number(formValue) : Number(stored || 0);
        return Number.isFinite(n) ? n : 0;
      };
      const effectivePayee = (formValue: string, stored: unknown): number => {
        const n = formValue !== '' ? Number(formValue) : Number(stored || 0);
        return Number.isSafeInteger(n) && n > 0 ? n : 0;
      };
      const effectiveReason = (unallocableCostReason !== '' ? unallocableCostReason : String(data.unallocable_cost_reason || '')).trim();
      // INV-IMPORT-LANDED-COST-DUTY-VAT: a nonzero duty/VAT rate
      // needs the customs payee even when the flat customs fee
      // is zero — the rates are the tax, the flat fee is not.
      // The sentinel amount 1 only marks "this component is
      // nonzero"; the backend remains the authority on the
      // derived amounts at the confirm itself.
      const effectiveRate = (formValue: string, stored: unknown): number => {
        const n = formValue !== '' ? Number(formValue) : Number(stored || 0);
        return Number.isFinite(n) ? n : 0;
      };
      const missingPayeeComponents: Array<{ label: string; amount: number; payeeId: number }> = [
        { label: 'شحن بحري', amount: effectiveCost(shippingCost, data.shipping_cost_usd), payeeId: effectivePayee(freightSupplier, data.freight_supplier_id) },
        { label: 'جمارك وتخليص', amount: effectiveCost(customsCost, data.customs_cost_egp), payeeId: effectivePayee(customsSupplier, data.customs_supplier_id) },
        { label: 'ضريبة جمركية وقيمة مضافة', amount: (effectiveRate(dutyRate, (data as any).customs_duty_rate_percent) > 0 || effectiveRate(vatRate, (data as any).vat_rate_percent) > 0) ? 1 : 0, payeeId: effectivePayee(customsSupplier, data.customs_supplier_id) },
        { label: 'نقل داخلي', amount: effectiveCost(transportCost, data.internal_transport_cost_egp), payeeId: effectivePayee(transportSupplier, data.transport_supplier_id) },
        { label: 'غرامات تأخير وأرضيات', amount: effectiveCost('', data.actual_demurrage_fees), payeeId: effectivePayee(demurrageSupplier, data.demurrage_supplier_id) },
      ];
      const unattributed = missingPayeeComponents.find((c) => c.amount > 0 && !c.payeeId && !effectiveReason);
      if (unattributed) {
        toast.error(`لا يمكن ترحيل بند التكلفة (${unattributed.label}) بلا مورد محدد: حدد مورد البند أو سجل سبب عدم قابلية التخصيص قبل تأكيد الوصول. [IMPORT_COMPONENT_PAYEE_REQUIRED]`);
        return;
      }
      const confirmed = await systemConfirm({
        title: 'تأكيد وصول الحاوية وترحيل المخزون واليومية العامة',
        message: 'تنبيه محاسبي ومخزني: تغيير الحالة إلى (تم الوصول Arrived) سيقوم بإدخال الأصناف فوراً إلى رصيد المخزن المحدد، حساب متوسط التكلفة المرجح، إنشاء سند استلام نهائي، وإثبات قيد التكلفة المحملة في اليومية العامة. لا يمكن تعديل الكميات بعد الترحيل إلا بتسوية جردية معتمدة. هل ترغب في المتابعة؟',
        variant: 'danger',
      });
      if (!confirmed) return;
    }
    try {
      // Built as a named value (not an inline literal) so the
      // fundingType field — which the shared costs DTO type gains
      // at merge — passes as an assignable property, not an excess
      // literal property. The backend accepts and persists it now.
      // The duty/VAT/insurance fields below ride the same named
      // value for the same reason (INV-IMPORT-LANDED-COST-DUTY-VAT).
      const costsPayload = {
        shippingCostUsd: shippingCost ? Number(shippingCost) : undefined,
        shippingAccountId: shippingAcc || undefined,
        customsCostEgp: customsCost ? Number(customsCost) : undefined,
        customsAccountId: customsAcc || undefined,
        customsDutyRatePercent: dutyRate ? Number(dutyRate) : undefined,
        vatRatePercent: vatRate ? Number(vatRate) : undefined,
        insuranceCostUsd: insuranceCost ? Number(insuranceCost) : undefined,
        internalTransportCostEgp: transportCost ? Number(transportCost) : undefined,
        transportAccountId: transportAcc || undefined,
        freightSupplierId: freightSupplier ? Number(freightSupplier) : undefined,
        customsSupplierId: customsSupplier ? Number(customsSupplier) : undefined,
        transportSupplierId: transportSupplier ? Number(transportSupplier) : undefined,
        demurrageSupplierId: demurrageSupplier ? Number(demurrageSupplier) : undefined,
        unallocableCostReason: unallocableCostReason || undefined,
        exchangeRateAtArrival: exchangeRate ? Number(exchangeRate) : undefined,
        costAllocationMethod: allocationMethod || undefined,
        pricingExchangeRate: pricingExchangeRate ? Number(pricingExchangeRate) : undefined,
        status: status ? status : undefined,
        receiptLocationId: status === 'Arrived' && receiptLocationId ? Number(receiptLocationId) : undefined,
        shippedDate: shippedDate || undefined,
        etaDate: etaDate || undefined,
        clearanceDate: clearanceDate || undefined,
        form4Number: form4Number || undefined,
        form4Date: form4Date || undefined,
        fundingType,
      };
      await updateCostsMutation.mutateAsync(costsPayload);
      setShippingAcc('');
      setCustomsAcc('');
      setTransportAcc('');
      setDutyRate('');
      setVatRate('');
      setInsuranceCost('');
      setFreightSupplier('');
      setCustomsSupplier('');
      setTransportSupplier('');
      setDemurrageSupplier('');
      setUnallocableCostReason('');
      toast.success('تم حفظ وتحديث تكاليف وبيانات الحاوية بنجاح');
    } catch (err: any) {
      toast.error('حدث خطأ أثناء تحديث التكاليف: ' + (err?.message || 'خطأ غير معروف'));
    }
  };

  const handleReverseReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reversalApprovalId.trim() || !reversalReason.trim()) {
      toast.error('عكس الاستلام يتطلب معرف اعتماد معتمد وسبباً موثقاً');
      return;
    }
    const confirmed = await systemConfirm({
      title: 'تأكيد عكس سند الاستلام المرحل',
      message: 'سيتم استعادة المخزون ومتوسط التكلفة والباتشات، وعكس قيد اليومية الأصلي بقيد عكسي مرتبط، ولا يمكن التراجع عن العكس إلا بسند استلام جديد. هل ترغب في المتابعة؟',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await reverseReceiptMutation.mutateAsync({ approvalRequestId: reversalApprovalId.trim(), reason: reversalReason.trim() });
      setReversalApprovalId('');
      setReversalReason('');
      toast.success('تم عكس سند الاستلام واستعادة المخزون وعكس القيد بنجاح');
    } catch (err: any) {
      toast.error('حدث خطأ أثناء عكس الاستلام: ' + (err?.message || 'خطأ غير معروف'));
    }
  };

  const handleResolveLegacy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolveApprovalId.trim() || !resolveReason.trim()) {
      toast.error('مراجعة الاستلام القديم تتطلب معرف اعتماد معتمد وسبباً موثقاً');
      return;
    }
    try {
      await resolveLegacyMutation.mutateAsync({ approvalRequestId: resolveApprovalId.trim(), reason: resolveReason.trim() });
      setResolveApprovalId('');
      setResolveReason('');
      toast.success('تم اعتماد الاستلام القديم بعد التحقق من دليل الترحيل');
    } catch (err: any) {
      toast.error('حدث خطأ أثناء مراجعة الاستلام: ' + (err?.message || 'خطأ غير معروف'));
    }
  };

  const handleApplyGlobalMargins = async () => {
    if (!data.items || data.items.length === 0) {
      toast.warning('لا توجد أصناف في هذه الحاوية لتطبيق الهامش عليها. يرجى سحب أو إضافة الأصناف أولاً.');
      return;
    }
    if (!globalRetailMargin && !globalWholesaleMargin) {
      toast.warning('يرجى إدخال نسبة هامش الجملة أو القطاعي أولاً.');
      return;
    }
    
    const promises = data.items.map((item: any) => 
      updateItemMutation.mutateAsync({
        itemId: item.id,
        dto: {
          targetRetailMargin: globalRetailMargin ? Number(globalRetailMargin) : undefined,
          targetWholesaleMargin: globalWholesaleMargin ? Number(globalWholesaleMargin) : undefined,
        }
      })
    );
    await Promise.all(promises);
    await queryClient.invalidateQueries({ queryKey: ['import-shipments', id] });
    toast.success('تم تطبيق الهوامش على جميع أصناف الحاوية بنجاح (اضغط "تطبيق واعتماد الأسعار للمخزن" لتثبيتها في كروت الأصناف)');
  };

  const handleImportProjectItems = async () => {
    try {
      const res = await importProjectItemsMutation.mutateAsync();
      toast.success(`تم سحب (${res?.importedCount || 0}) صنف من دراسة جدوى المشروع واحتساب التكلفة الاستيرادية بنجاح!`);
    } catch (err: any) {
      toast.error(err?.message || 'تعذر سحب أصناف المشروع');
    }
  };

  const handleApplyPrices = async () => {
    const confirmed = await systemConfirm({ title: 'اعتماد الأسعار', message: 'هل أنت متأكد من تطبيق الأسعار المقترحة على المنتجات في المخزن؟' }); if (confirmed) {
      const res = await applyPricesMutation.mutateAsync();
      toast.success(`تم تحديث أسعار ${res.updatedCount} صنف بنجاح.`);
    }
  };

  // INV-IMPORT-COMPLIANCE-HS-ACI-DATES: the four payee pickers used to
  // be native selects rendering all 503 suppliers in each — unusable.
  // Searchable CustomSelect (the shared combobox) with the shipment's
  // own supplier pinned first; every supplier stays pickable, because
  // the shipment supplier itself usually has no verified bank details
  // and a verified-only scope would block the normal flow (the trial
  // itself assigned the unverified shipment supplier as payee for all
  // four components). The leading option keeps the old "no change"
  // meaning: an empty pick leaves the stored payee untouched.
  const payeeOptions = (storedId: number | null | undefined): SelectOption[] => {
    const noChange: SelectOption = { value: '', label: `-- بلا تغيير (الحالي: ${supplierName(storedId)}) --` };
    const ordered = [...suppliersList];
    const shipmentSupplierId = data.supplier_id ? Number(data.supplier_id) : null;
    if (shipmentSupplierId) {
      const idx = ordered.findIndex((s: any) => Number(s.id) === shipmentSupplierId);
      if (idx > 0) {
        const [pinned] = ordered.splice(idx, 1);
        ordered.unshift(pinned);
      }
    }
    return [
      noChange,
      ...ordered.map((s: any) => ({
        value: String(s.id),
        label: s.name || s.nameAr || s.name_ar || `#${s.id}`,
      })),
    ];
  };

  return (
    <div className="page-stack page-shell import-sales-page" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '80px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
        <ShipmentDetailsHeader
          data={data}
          t={t}
          setGrnLocationId={setGrnLocationId}
          receiptLocationId={receiptLocationId}
          setIsGrnOpen={setIsGrnOpen}
          setIsLateExpenseOpen={setIsLateExpenseOpen}
          setIsPreordersOpen={setIsPreordersOpen}
          setIsAutopsyOpen={setIsAutopsyOpen}
          navigate={navigate}
        />
        <ShipmentDetailsCosts
          t={t}
          handleUpdateCosts={handleUpdateCosts}
          shippedDate={shippedDate}
          setShippedDate={setShippedDate}
          etaDate={etaDate}
          setEtaDate={setEtaDate}
          clearanceDate={clearanceDate}
          setClearanceDate={setClearanceDate}
          form4Number={form4Number}
          setForm4Number={setForm4Number}
          form4Date={form4Date}
          setForm4Date={setForm4Date}
          fundingType={fundingType}
          setFundingType={setFundingType}
          data={data}
          exchangeRate={exchangeRate}
          setExchangeRate={setExchangeRate}
          pricingExchangeRate={pricingExchangeRate}
          setPricingExchangeRate={setPricingExchangeRate}
          shippingCost={shippingCost}
          setShippingCost={setShippingCost}
          shippingAcc={shippingAcc}
          setShippingAcc={setShippingAcc}
          treasuryAccounts={treasuryAccounts}
          customsCost={customsCost}
          setCustomsCost={setCustomsCost}
          customsAcc={customsAcc}
          setCustomsAcc={setCustomsAcc}
          insuranceCost={insuranceCost}
          setInsuranceCost={setInsuranceCost}
          dutyRate={dutyRate}
          setDutyRate={setDutyRate}
          vatRate={vatRate}
          setVatRate={setVatRate}
          transportCost={transportCost}
          setTransportCost={setTransportCost}
          transportAcc={transportAcc}
          setTransportAcc={setTransportAcc}
          freightSupplier={freightSupplier}
          setFreightSupplier={setFreightSupplier}
          payeeOptions={payeeOptions}
          customsSupplier={customsSupplier}
          setCustomsSupplier={setCustomsSupplier}
          transportSupplier={transportSupplier}
          setTransportSupplier={setTransportSupplier}
          demurrageSupplier={demurrageSupplier}
          setDemurrageSupplier={setDemurrageSupplier}
          unallocableCostReason={unallocableCostReason}
          setUnallocableCostReason={setUnallocableCostReason}
          status={status}
          setStatus={setStatus}
          allocationMethod={allocationMethod}
          setAllocationMethod={setAllocationMethod}
          receiptLocationId={receiptLocationId}
          setReceiptLocationId={setReceiptLocationId}
          warehouseLocations={warehouseLocations}
          updateCostsMutation={updateCostsMutation}
        />

        <ShipmentDetailsReceiptItems
          data={data}
          handleReverseReceipt={handleReverseReceipt}
          reversalApprovalId={reversalApprovalId}
          setReversalApprovalId={setReversalApprovalId}
          reversalReason={reversalReason}
          setReversalReason={setReversalReason}
          reverseReceiptMutation={reverseReceiptMutation}
          handleResolveLegacy={handleResolveLegacy}
          resolveApprovalId={resolveApprovalId}
          setResolveApprovalId={setResolveApprovalId}
          resolveReason={resolveReason}
          setResolveReason={setResolveReason}
          resolveLegacyMutation={resolveLegacyMutation}
          t={t}
          handleImportProjectItems={handleImportProjectItems}
          importProjectItemsMutation={importProjectItemsMutation}
          handleApplyPrices={handleApplyPrices}
          applyPricesMutation={applyPricesMutation}
          setIsAddItemOpen={setIsAddItemOpen}
          globalWholesaleMargin={globalWholesaleMargin}
          setGlobalWholesaleMargin={setGlobalWholesaleMargin}
          globalRetailMargin={globalRetailMargin}
          setGlobalRetailMargin={setGlobalRetailMargin}
          handleApplyGlobalMargins={handleApplyGlobalMargins}
          id={id!}
        />
      </main>

      <ShipmentDetailsModals
        isAutopsyOpen={isAutopsyOpen}
        setIsAutopsyOpen={setIsAutopsyOpen}
        id={id!}
        isPreordersOpen={isPreordersOpen}
        setIsPreordersOpen={setIsPreordersOpen}
        data={data}
        isAddItemOpen={isAddItemOpen}
        setIsAddItemOpen={setIsAddItemOpen}
        isGrnOpen={isGrnOpen}
        setIsGrnOpen={setIsGrnOpen}
        createGrnMutation={createGrnMutation}
        grnDamagedMap={grnDamagedMap}
        grnLocationId={grnLocationId}
        grnInspectorName={grnInspectorName}
        grnNotes={grnNotes}
        setGrnInspectorName={setGrnInspectorName}
        setGrnLocationId={setGrnLocationId}
        setGrnNotes={setGrnNotes}
        setGrnDamagedMap={setGrnDamagedMap}
        warehouseLocations={warehouseLocations}
        isLateExpenseOpen={isLateExpenseOpen}
        setIsLateExpenseOpen={setIsLateExpenseOpen}
        recordLateExpenseMutation={recordLateExpenseMutation}
        lateAmountEgp={lateAmountEgp}
        lateExpenseType={lateExpenseType}
        lateDescription={lateDescription}
        lateExpenseSupplier={lateExpenseSupplier}
        lateExpenseUnallocableReason={lateExpenseUnallocableReason}
        setLateAmountEgp={setLateAmountEgp}
        setLateDescription={setLateDescription}
        setLateExpenseSupplier={setLateExpenseSupplier}
        setLateExpenseUnallocableReason={setLateExpenseUnallocableReason}
        setLateExpenseType={setLateExpenseType}
        suppliersList={suppliersList}
      />
    </div>
  );
}
