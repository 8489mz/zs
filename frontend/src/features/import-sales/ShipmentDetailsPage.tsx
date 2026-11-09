import { toast, systemConfirm } from '@/shared/components/system-alert';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/shared/components/page-header';
import { FormSection } from '@/shared/components/form-section';
import { Button } from '@/shared/ui/button';
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
  lateExpenseAllocationSummary,
  type ShipmentItem 
} from './api/shipments.api';
import { formatCurrency } from '@/lib/format';
import { formatFreightAllocationHint } from './utils/import-display-formatters';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { useState, useEffect, useRef } from 'react';
import { AddShipmentItemDialog } from './AddShipmentItemDialog';
import { ContainerAutopsyModal } from './ContainerAutopsyModal';
import { ContainerPreordersModal } from './ContainerPreordersModal';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { suppliersApi } from '@/shared/api/suppliers.api';
import { http } from '@/lib/http';
import { referenceDataApi } from '@/services/reference-data.api';
import { DownloadIcon, PackageIcon, PlusCircleIcon } from '@/shared/components/icons/AppIcons';

function ItemRowInputs({ item, shipmentId, arrivalRate, pricingRate, isArrived }: { item: ShipmentItem, shipmentId: string, arrivalRate: number, pricingRate: number, isArrived?: boolean }) {
  const updateMutation = useUpdateShipmentItemMutation(shipmentId);
  const [receivedQty, setReceivedQty] = useState(item.received_quantity || '');
  const [retailMargin, setRetailMargin] = useState(item.target_retail_margin || '');
  const [wholesaleMargin, setWholesaleMargin] = useState(item.target_wholesale_margin || '');

  useEffect(() => {
    setReceivedQty(item.received_quantity || '');
    setRetailMargin(item.target_retail_margin || '');
    setWholesaleMargin(item.target_wholesale_margin || '');
  }, [item.received_quantity, item.target_retail_margin, item.target_wholesale_margin]);

  const handleBlur = (field: 'receivedQuantity' | 'targetRetailMargin' | 'targetWholesaleMargin' | 'shortageHandlingMethod', value: string) => {
    updateMutation.mutate({ 
      itemId: item.id, 
      dto: { [field]: field === 'shortageHandlingMethod' ? value : (value ? Number(value) : undefined) } 
    });
  };

  const unitUsd = Number(item.factory_unit_price_usd) || 0;
  const landedCost = Number(item.landed_cost_egp) || 0;
  const pricingCostEgp = landedCost + (unitUsd * (pricingRate - arrivalRate));
  
  // INV-FE2-FRONTEND-BOOK-DIGITS: the margin-suggested prices are
  // EGP-denominated (pricingCostEgp) previews shown to the merchant —
  // they round at EGP digits (2), the denomination of the amount.
  const suggestedWholesale = roundMoneyValue(pricingCostEgp * (1 + (Number(wholesaleMargin) || 0) / 100), currencyMoneyDigits('EGP'));
  const suggestedRetail = roundMoneyValue(pricingCostEgp * (1 + (Number(retailMargin) || 0) / 100), currencyMoneyDigits('EGP'));
  
  return (
    <>
      <td style={{ padding: '6px 4px', textAlign: 'center', verticalAlign: 'middle' }}>
        <input 
          type="number" 
          className="input no-spin-arrows" 
          style={{ width: '100%', maxWidth: '68px', height: '28px', padding: '2px 4px', textAlign: 'center', fontSize: '12px', fontWeight: 700, margin: '0 auto', display: 'block', MozAppearance: 'textfield' }} 
          value={receivedQty}
          placeholder={String(item.quantity)}
          disabled={isArrived}
          title={isArrived ? 'تم استلام الحاوية وترحيل المخزون نهائياً - مقفلة' : ''}
          onChange={e => setReceivedQty(e.target.value)}
          onBlur={e => handleBlur('receivedQuantity', e.target.value)}
        />
        {Number(receivedQty) > 0 && Number(receivedQty) < item.quantity && (
          <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
            <div style={{ fontSize: '9.5px', fontWeight: 700, color: '#dc2626', lineHeight: 1 }}>
              عجز: {item.quantity - Number(receivedQty)}
            </div>
            <div 
              style={{ 
                display: 'inline-flex', 
                borderRadius: '5px', 
                padding: '2px', 
                background: '#e2e8f0', 
                gap: '2px' 
              }}
            >
              <button
                type="button"
                disabled={isArrived}
                onClick={() => handleBlur('shortageHandlingMethod', 'capitalize')}
                title="رسملة النواقص: توزيع تكلفة القطع الناقصة على باقي القطع السليمة المتبقية لرفع تكلفتها تلقائياً، فلا تُسجل كخسارة منفصلة في قائمة الدخل"
                style={{
                  border: 'none',
                  cursor: isArrived ? 'not-allowed' : 'pointer',
                  padding: '2px 6px',
                  fontSize: '10px',
                  fontWeight: 700,
                  borderRadius: '4px',
                  background: (item.shortage_handling_method || 'capitalize') === 'capitalize' ? '#170e5e' : 'transparent',
                  color: (item.shortage_handling_method || 'capitalize') === 'capitalize' ? '#ffffff' : '#475569',
                }}
              >
                رسملة
              </button>
              <button
                type="button"
                disabled={isArrived}
                onClick={() => handleBlur('shortageHandlingMethod', 'expense')}
                title="إثبات كخسارة: تسجيل قيمة القطع الناقصة كبند خسائر عجز بضاعة مستقل في قائمة الدخل مع إبقاء تكلفة القطع المستلمة عند سعرها الأصلي"
                style={{
                  border: 'none',
                  cursor: isArrived ? 'not-allowed' : 'pointer',
                  padding: '2px 6px',
                  fontSize: '10px',
                  fontWeight: 700,
                  borderRadius: '4px',
                  background: item.shortage_handling_method === 'expense' ? '#dc2626' : 'transparent',
                  color: item.shortage_handling_method === 'expense' ? '#ffffff' : '#475569',
                }}
              >
                خسارة
              </button>
            </div>
          </div>
        )}
      </td>
      <td style={{ padding: '6px 4px', textAlign: 'center', verticalAlign: 'middle' }}>
        <input 
          type="number" 
          className="input no-spin-arrows" 
          style={{ width: '100%', maxWidth: '58px', height: '28px', padding: '2px 4px', textAlign: 'center', fontSize: '12px', fontWeight: 600, margin: '0 auto', display: 'block', MozAppearance: 'textfield' }}
          value={wholesaleMargin}
          placeholder="%"
          onChange={e => setWholesaleMargin(e.target.value)}
          onBlur={e => handleBlur('targetWholesaleMargin', e.target.value)}
        />
      </td>
      <td style={{ padding: '6px 4px', textAlign: 'center', verticalAlign: 'middle' }}>
        <input 
          type="number" 
          className="input no-spin-arrows" 
          style={{ width: '100%', maxWidth: '58px', height: '28px', padding: '2px 4px', textAlign: 'center', fontSize: '12px', fontWeight: 600, margin: '0 auto', display: 'block', MozAppearance: 'textfield' }}
          value={retailMargin}
          placeholder="%"
          onChange={e => setRetailMargin(e.target.value)}
          onBlur={e => handleBlur('targetRetailMargin', e.target.value)}
        />
      </td>
      <td style={{ padding: '6px 4px', textAlign: 'center', verticalAlign: 'middle' }}>
        <div style={{ fontWeight: 800, fontSize: '12px', color: '#1e3a8a' }}>
          {suggestedWholesale > 0 ? suggestedWholesale.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
        </div>
        <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 500 }}>ج.م</div>
      </td>
      <td style={{ padding: '6px 4px', textAlign: 'center', verticalAlign: 'middle' }}>
        <div style={{ fontWeight: 800, fontSize: '12px', color: '#15803d' }}>
          {suggestedRetail > 0 ? suggestedRetail.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
        </div>
        <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 500 }}>ج.م</div>
      </td>
    </>
  );
}

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
      return a.isCashBank || a.code === '1110' || a.code === '1120' || a.code === '1160' || a.accountGroup === 'cash_bank';
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

  return (
    <div className="page-stack page-shell import-sales-page" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '80px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
        <PageHeader 
          title={`حاوية رقم: ${data.container_number}`} 
          description={
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              <span>{t('import_sales.shipment_details_page.s5', "الحالة:")} <strong>{data.status}</strong></span>
              <span>{t('import_sales.shipment_details_page.s6', "المصنع:")} <strong>{data.supplier_name || t('import_sales.shipment_details_page.s7', "غير محدد")}</strong></span>
              <span>{t('import_sales.shipment_details_page.s8', "بوليصة الشحن (B/L):")} <strong>{data.bill_of_lading || t('import_sales.shipment_details_page.s9', "غير محدد")}</strong></span>
              {(data as any).project_title && (
                <span>مشروع الاستيراد: <strong>{(data as any).project_no} - {(data as any).project_title}</strong></span>
              )}
              {(data as any).freight_type && (
                <span>الشحن: <strong>{(data as any).freight_type} ({(data as any).container_size || '40HQ'})</strong></span>
              )}
              {(data as any).port_of_loading && (
                <span>المسار: <strong>{(data as any).port_of_loading} &larr; {(data as any).port_of_discharge || 'Alexandria'}</strong></span>
              )}
              {data.inventory_receipt && (
                <span style={{ backgroundColor: data.inventory_receipt.state === 'posted' ? '#dcfce7' : '#fef3c7', color: data.inventory_receipt.state === 'posted' ? '#15803d' : '#92400e', padding: '2px 8px', borderRadius: 4, fontWeight: 700, border: '1px solid #bbf7d0', fontSize: '0.78rem' }}>
                  سند استلام مخزني: #{data.inventory_receipt.id} ({data.inventory_receipt.state === 'posted' ? 'مرحل' : 'مجمد بانتظار المراجعة'})
                </span>
              )}
              {data.inventory_receipt?.journal_entry_id && (
                <span style={{ backgroundColor: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: 4, fontWeight: 700, border: '1px solid #c7d2fe', fontSize: '0.78rem' }}>
                  قيد اليومية العامة: #JE-{data.inventory_receipt.journal_entry_id}
                </span>
              )}
            </div>
          }
          actions={
            <div className="actions compact-actions">
              <Button variant="secondary" onClick={() => { setGrnLocationId(receiptLocationId || ''); setIsGrnOpen(true); }} style={{ borderColor: '#15803d', color: '#15803d', fontWeight: 600 }}>محضر فحص واستلام (GRN)</Button>
              {data.status === 'Arrived' && (
                <Button variant="secondary" onClick={() => setIsLateExpenseOpen(true)} style={{ borderColor: '#b45309', color: '#b45309', fontWeight: 600 }}>مصروف متأخر بعد الوصول</Button>
              )}
              <Button variant="secondary" onClick={() => setIsPreordersOpen(true)} style={{ borderColor: '#0284c7', color: '#0369a1', fontWeight: 600 }}>حجوزات البضاعة العايمة</Button>
              <Button variant="secondary" onClick={() => setIsAutopsyOpen(true)} style={{ borderColor: '#170e5e', color: '#170e5e', fontWeight: 700 }}>تشريح أرباح الحاوية (P&L)</Button>
              <Button variant="secondary" onClick={() => navigate('/import-sales/shipments')}>{t('import_sales.shipment_details_page.s10', "عودة للقائمة")}</Button>
            </div>
          } 
        />

        {(data as any).demurrageRisk?.isOverdue && (
          <div style={{ backgroundColor: '#fee2e2', border: '1px solid #fca5a5', padding: '10px 16px', borderRadius: 10, color: '#b91c1c', fontWeight: 700, fontSize: '12.5px', marginBottom: 14 }}>
            تحذير تشغيلي: تجاوزت الحاوية فترة السماح للأرضيات بـ {(data as any).demurrageRisk.overdueDays} يوم! غرامات تأخير تقديرية: {(data as any).demurrageRisk.estimatedFeesEgp?.toLocaleString()} ج.م
            {(data as any).demurrageRisk.assumptions && ((data as any).demurrageRisk.assumptions.exchangeRateAssumed || (data as any).demurrageRisk.assumptions.dailyRateAssumed || (data as any).demurrageRisk.assumptions.freeDaysAssumed) && (
              <> (بافتراض: سعر صرف {(data as any).demurrageRisk.assumptions.exchangeRate}، رسم يومي {(data as any).demurrageRisk.assumptions.dailyRateUsd}$، سماح {(data as any).demurrageRisk.assumptions.freeDays} يوم — سجل القيم الفعلية على الشحنة لعرض تقدير دقيق)</>
            )}
          </div>
        )}
        {!(data as any).demurrageRisk?.isOverdue && (data as any).demurrageRisk?.daysRemaining !== null && (
          <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', padding: '10px 16px', borderRadius: 10, color: '#166534', fontWeight: 600, fontSize: '12.5px', marginBottom: 14 }}>
            فترة سماح الأرضيات: متبقي {(data as any).demurrageRisk.daysRemaining} يوم قبل بدء احتساب غرامات التأخير اليومية
          </div>
        )}
        <FormSection title={t('import_sales.shipment_details_page.s11', "تفاصيل وتكاليف الحاوية (مؤثرة على سعر المنتج)")}>
          <form onSubmit={handleUpdateCosts} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', padding: '1rem' }}>
            
            {/* Timeline */}
            <div className="form-group">
              <label>{t('import_sales.shipment_details_page.s12', "تاريخ الشحن (من المصنع)")}</label>
              <input type="date" className="input" value={shippedDate} onChange={e => setShippedDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label>{t('import_sales.shipment_details_page.s13', "تاريخ الوصول المتوقع للميناء (ETA)")}</label>
              <input type="date" className="input" value={etaDate} onChange={e => setEtaDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label>{t('import_sales.shipment_details_page.s14', "تاريخ التخليص الجمركي")}</label>
              <input type="date" className="input" value={clearanceDate} onChange={e => setClearanceDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label>رقم نموذج 4 (مطلوب قبل التخليص للشحنات الممولة بنكيًا فوق 2000 دولار)</label>
              <input type="text" className="input" value={form4Number} onChange={e => setForm4Number(e.target.value)} />
            </div>
            <div className="form-group">
              <label>تاريخ نموذج 4</label>
              <input type="date" className="input" value={form4Date} onChange={e => setForm4Date(e.target.value)} />
            </div>
            <div className="form-group">
              <label>طريقة تمويل الشحنة</label>
              <select className="input" value={fundingType} onChange={e => setFundingType(e.target.value as 'bank_transfer' | 'cash_carried')}>
                <option value="bank_transfer">تحويل بنكي</option>
                <option value="cash_carried">نقد محمول مع مسافر (معفى من نموذج 4)</option>
              </select>
              <small style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '3px' }}>
                التمويل البنكي فوق 2000 دولار يتطلب رقم نموذج 4 قبل التخليص أو الوصول.
              </small>
            </div>
            <div className="form-group">
              <label>سعر صرف الدولار الجمركي / الفعلي (التكلفة الدفترية)</label>
              <input type="number" step="0.01" className="input" placeholder={`الحالي: ${data.exchange_rate_at_arrival || ''}`} value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} />
              <small style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '3px' }}>
                السعر الحقيقي الفعلي للدولار عند وصول الشحنة والمثبت محاسبياً.
              </small>
            </div>
            
            <div className="form-group">
              <label>سعر دولار التسعير بالسوق (سعر الإحلال والتحوط)</label>
              <input type="number" step="0.01" className="input" placeholder={`الحالي: ${data.pricing_exchange_rate || data.exchange_rate_at_arrival || ''}`} value={pricingExchangeRate} onChange={e => setPricingExchangeRate(e.target.value)} />
              <small style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '3px' }}>
                سعر السوق الحالي لاقتراح أسعار البيع لحماية رأس المال (اجعله نفس الفعلي إذا كنت تبيع بسعر الشراء).
              </small>
            </div>

            <hr style={{ gridColumn: 'span 2' }} />

            {/* Costs */}
            <div className="form-group">
              <label>{t('import_sales.shipment_details_page.s17', "تكلفة الشحن البحري (بالدولار)")}</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input type="number" step="0.01" className="input" placeholder={`الحالي: $${data.shipping_cost_usd}`} value={shippingCost} onChange={e => setShippingCost(e.target.value)} />
                <select className="input" value={shippingAcc} onChange={e => setShippingAcc(e.target.value)}>
                  <option value="">-- بدون خصم نقدي (تسجيل تكلفة فقط) --</option>
                  {treasuryAccounts.map((a: any) => <option key={a.id} value={a.id}>سداد من: {a.nameAr || a.name_ar || a.name}</option>)}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>{t('import_sales.shipment_details_page.s19', "الجمارك ومصاريف التخليص (بالجنيه)")}</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input type="number" step="0.01" className="input" placeholder={`الحالي: ${data.customs_cost_egp} ج`} value={customsCost} onChange={e => setCustomsCost(e.target.value)} />
                <select className="input" value={customsAcc} onChange={e => setCustomsAcc(e.target.value)}>
                  <option value="">-- بدون خصم نقدي (تسجيل تكلفة فقط) --</option>
                  {treasuryAccounts.map((a: any) => <option key={a.id} value={a.id}>سداد من: {a.nameAr || a.name_ar || a.name}</option>)}
                </select>
              </div>
              <small style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '3px' }}>
                رسم تخليص ثابت — ليس الضريبة؛ نسبة الرسوم الجمركية وضريبة القيمة المضافة في الحقلين التاليين.
              </small>
            </div>

            {/* INV-IMPORT-LANDED-COST-DUTY-VAT: itemized customs
                tax, carried from the feasibility study. Duty is
                charged on CIF (goods + freight + insurance) and
                VAT on (CIF + duty), capitalized into landed cost
                exactly as the study computes them. */}
            <div className="form-group">
              <label>تكلفة التأمين (بالدولار)</label>
              <input type="number" step="0.01" className="input" placeholder={`الحالي: $${(data as any).insurance_cost_usd || 0}`} value={insuranceCost} onChange={e => setInsuranceCost(e.target.value)} />
              <small style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '3px' }}>
                يدخل في أساس CIF لحساب الرسوم الجمركية والضريبة.
              </small>
            </div>

            <div className="form-group">
              <label>نسبة الرسوم الجمركية (%)</label>
              <input type="number" step="0.01" className="input" placeholder={`الحالي: ${(data as any).customs_duty_rate_percent || 0}%`} value={dutyRate} onChange={e => setDutyRate(e.target.value)} />
              <small style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '3px' }}>
                تُحسب على قيمة CIF (بضاعة + شحن + تأمين) وتُرحَّل ضمن التكلفة المحملة.
              </small>
            </div>

            <div className="form-group">
              <label>نسبة ضريبة القيمة المضافة (%)</label>
              <input type="number" step="0.01" className="input" placeholder={`الحالي: ${(data as any).vat_rate_percent || 0}%`} value={vatRate} onChange={e => setVatRate(e.target.value)} />
              <small style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '3px' }}>
                تُحسب على (CIF + الرسوم الجمركية) وتُرسمل ضمن التكلفة المحملة مثل دراسة الجدوى.
              </small>
            </div>

            <div className="form-group">
              <label>{t('import_sales.shipment_details_page.s21', "نقل داخلي ونثريات (بالجنيه)")}</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input type="number" step="0.01" className="input" placeholder={`الحالي: ${data.internal_transport_cost_egp} ج`} value={transportCost} onChange={e => setTransportCost(e.target.value)} />
                <select className="input" value={transportAcc} onChange={e => setTransportAcc(e.target.value)}>
                  <option value="">-- بدون خصم نقدي (تسجيل تكلفة فقط) --</option>
                  {treasuryAccounts.map((a: any) => <option key={a.id} value={a.id}>سداد من: {a.nameAr || a.name_ar || a.name}</option>)}
                </select>
              </div>
            </div>

            {/* Explicit payee per cost component (INV-IMPORT-SUPPLIER-ATTRIBUTION).
                Each nonzero component must name the supplier it is owed to
                before the receipt posts; a component with no payee needs a
                recorded unallocable reason instead (clearing path). */}
            <div className="form-group">
              <label>مورد الشحن البحري (مستحق الشحن)</label>
              <select className="input" value={freightSupplier} onChange={e => setFreightSupplier(e.target.value)}>
                <option value="">-- بلا تغيير (الحالي: {supplierName(data.freight_supplier_id)}) --</option>
                {suppliersList.map((s: any) => <option key={s.id} value={s.id}>{s.name || s.nameAr || s.name_ar || `#${s.id}`}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label>مورد الجمارك والتخليص (مستحق الجمارك)</label>
              <select className="input" value={customsSupplier} onChange={e => setCustomsSupplier(e.target.value)}>
                <option value="">-- بلا تغيير (الحالي: {supplierName(data.customs_supplier_id)}) --</option>
                {suppliersList.map((s: any) => <option key={s.id} value={s.id}>{s.name || s.nameAr || s.name_ar || `#${s.id}`}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label>مورد النقل الداخلي (مستحق النقل)</label>
              <select className="input" value={transportSupplier} onChange={e => setTransportSupplier(e.target.value)}>
                <option value="">-- بلا تغيير (الحالي: {supplierName(data.transport_supplier_id)}) --</option>
                {suppliersList.map((s: any) => <option key={s.id} value={s.id}>{s.name || s.nameAr || s.name_ar || `#${s.id}`}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label>مورد غرامات التأخير والأرضيات (الحالي: {data.actual_demurrage_fees || 0} ج)</label>
              <select className="input" value={demurrageSupplier} onChange={e => setDemurrageSupplier(e.target.value)}>
                <option value="">-- بلا تغيير (الحالي: {supplierName(data.demurrage_supplier_id)}) --</option>
                {suppliersList.map((s: any) => <option key={s.id} value={s.id}>{s.name || s.nameAr || s.name_ar || `#${s.id}`}</option>)}
              </select>
            </div>

            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <label>سبب عدم قابلية التخصيص (لبند بلا مورد — يقيد على حساب التسوية)</label>
              <input className="input" value={unallocableCostReason} onChange={e => setUnallocableCostReason(e.target.value)} placeholder={data.unallocable_cost_reason ? `الحالي: ${data.unallocable_cost_reason}` : 'يترك فارغاً إلا إذا كان بند بلا مورد محدد فعلاً'} />
            </div>

            <div className="form-group">
              <label>{t('import_sales.shipment_details_page.s23', "تغيير حالة الحاوية")}</label>
              <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
                <option value="">{t('import_sales.shipment_details_page.s24', "لا تغيير (الحالية:")} {data.status})</option>
                <option value="Pending">{t('import_sales.shipment_details_page.s25', "في البحر (Pending)")}</option>
                <option value="In Customs">{t('import_sales.shipment_details_page.s26', "في الجمارك (In Customs)")}</option>
                <option value="Arrived">{t('import_sales.shipment_details_page.s27', "تم الوصول (Arrived) - سيتم إضافة الكميات للمخزون")}</option>
              </select>
            </div>

            {data.status !== 'Arrived' && (
              <div className="form-group">
                <label>طريقة توزيع نولون الشحن والجمارك على الأصناف</label>
                <select className="input" value={allocationMethod} onChange={e => setAllocationMethod(e.target.value as typeof allocationMethod)}>
                  <option value="">
                    الحالية: {data.cost_allocation_method === 'weight' ? 'الوزن (كجم)' : data.cost_allocation_method === 'cbm' ? 'الحجم (CBM)' : 'قيمة الصنف بالدولار (موصى به)'}
                  </option>
                  <option value="value">قيمة الصنف بالدولار (Value %) - الخيار الشائع والموصى به</option>
                  <option value="weight">الوزن الإجمالي بالكيلوجرام (Gross Weight)</option>
                  <option value="cbm">الحجم والمساحة بالمتر المكعب (CBM Volume)</option>
                </select>
                <small style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '3px' }}>
                  {formatFreightAllocationHint(shippingCost !== '' ? Number(shippingCost) : Number(data.shipping_cost_usd || 0))}
                </small>
              </div>
            )}
            {status === 'Arrived' && data.status !== 'Arrived' && (
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label>مخزن استلام الحاوية (إلزامي عند الوصول)</label>
                <select className="input" required value={receiptLocationId} onChange={e => setReceiptLocationId(e.target.value)}>
                  <option value="">اختر مخزنًا فعليًا مسجلًا للشركة</option>
                  {warehouseLocations.map((loc: any) => (
                    <option key={loc.id} value={loc.id}>{loc.name || loc.nameAr || `مخزن ${loc.id}`}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="actions" style={{ gridColumn: 'span 2' }}>
              <Button type="submit" variant="primary" disabled={updateCostsMutation.isPending}>{t('import_sales.shipment_details_page.s28', "تحديث البيانات والتكاليف وإعادة الحساب")}</Button>
            </div>
          </form>
        </FormSection>

        {data.inventory_receipt && (
        <FormSection
          title="تصحيح سند الاستلام المعتمد"
          description="عكس سند مرحل أو اعتماد سند قديم مجمد — كلاهما يتطلب موافقة Maker-Checker مربوطة بهذه الشحنة وسندها، ولا يتم أي تعديل صامت."
        >
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '0.84rem', color: '#334155' }}>
              سند الاستلام #{data.inventory_receipt.id} — الحالة: <strong>{data.inventory_receipt.state === 'posted' ? 'مرحل' : 'مجمد بانتظار المراجعة'}</strong>
              {data.inventory_receipt.review_reason && <> — سبب التجميد: {data.inventory_receipt.review_reason}</>}
              {' — '}أنشئ طلب الاعتماد من مركز الموافقات بنوع عكس/مراجعة الاستلام ومرجع الشحنة الحالي، ثم نفذه هنا بمعرف الاعتماد.
            </div>
            {data.inventory_receipt.state === 'posted' ? (
              <form onSubmit={handleReverseReceipt} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label>معرف طلب الاعتماد المعتمد</label>
                  <input type="text" className="input" value={reversalApprovalId} onChange={e => setReversalApprovalId(e.target.value)} placeholder="معرف الاعتماد المربوط بهذا السند" />
                </div>
                <div className="form-group">
                  <label>سبب العكس (10 أحرف على الأقل)</label>
                  <input type="text" className="input" value={reversalReason} onChange={e => setReversalReason(e.target.value)} placeholder="مثال: تم الاستلام في المخزن الخطأ" />
                </div>
                <div style={{ gridColumn: 'span 2', display: 'flex', justifyContent: 'flex-end' }}>
                  <Button type="submit" variant="secondary" disabled={reverseReceiptMutation.isPending} style={{ borderColor: '#b91c1c', color: '#b91c1c', fontWeight: 700 }}>
                    {reverseReceiptMutation.isPending ? 'جاري عكس الاستلام...' : 'عكس سند الاستلام المرحل'}
                  </Button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleResolveLegacy} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label>معرف طلب الاعتماد المعتمد</label>
                  <input type="text" className="input" value={resolveApprovalId} onChange={e => setResolveApprovalId(e.target.value)} placeholder="معرف الاعتماد المربوط بهذا السند" />
                </div>
                <div className="form-group">
                  <label>سبب المراجعة (10 أحرف على الأقل)</label>
                  <input type="text" className="input" value={resolveReason} onChange={e => setResolveReason(e.target.value)} placeholder="مثال: تم التحقق من القيد والحركة المخزنية" />
                </div>
                <div style={{ gridColumn: 'span 2', display: 'flex', justifyContent: 'flex-end' }}>
                  <Button type="submit" variant="secondary" disabled={resolveLegacyMutation.isPending} style={{ borderColor: '#92400e', color: '#92400e', fontWeight: 700 }}>
                    {resolveLegacyMutation.isPending ? 'جاري مراجعة الاستلام...' : 'اعتماد الاستلام القديم بعد التحقق'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </FormSection>
        )}

        <FormSection 
          title={t('import_sales.shipment_details_page.s29', "أصناف الحاوية وتحديد أسعار البيع")} 
          description={t('import_sales.shipment_details_page.s30', "جميع المنتجات التي تم استلامها داخل هذه الحاوية. يمكنك تعديل الكمية المستلمة فعلياً وهامش الربح.")}
          actions={
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {data.project_id && data.items.length === 0 && (
                <Button 
                  variant="primary" 
                  onClick={handleImportProjectItems} 
                  disabled={importProjectItemsMutation.isPending || data.status === 'Arrived'}
                  style={{
                    backgroundColor: '#15803d',
                    borderColor: '#166534',
                    color: '#ffffff',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <DownloadIcon size={15} />
                  <span>{importProjectItemsMutation.isPending ? 'جاري سحب الأصناف...' : 'سحب أصناف المشروع تلقائياً'}</span>
                </Button>
              )}
              <Button variant="secondary" onClick={handleApplyPrices} disabled={applyPricesMutation.isPending || data.items.length === 0}>
                {t('import_sales.shipment_details_page.s31', "تطبيق واعتماد الأسعار للمخزن")}
              </Button>
              <Button variant="secondary" onClick={() => setIsAddItemOpen(true)} disabled={data.status === 'Arrived'}>{t('import_sales.shipment_details_page.s32', "إضافة صنف +")}</Button>
            </div>
          }
        >
          <div style={{ padding: '0.75rem 1rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('import_sales.shipment_details_page.s33', "هامش الجملة الموحد %")}</label>
              <input type="number" className="input no-spin-arrows" style={{ width: '100px', height: '32px', fontSize: '12px', MozAppearance: 'textfield' }} value={globalWholesaleMargin} onChange={e => setGlobalWholesaleMargin(e.target.value)} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('import_sales.shipment_details_page.s34', "هامش القطاعي الموحد %")}</label>
              <input type="number" className="input no-spin-arrows" style={{ width: '100px', height: '32px', fontSize: '12px', MozAppearance: 'textfield' }} value={globalRetailMargin} onChange={e => setGlobalRetailMargin(e.target.value)} />
            </div>
            <Button variant="secondary" onClick={handleApplyGlobalMargins} style={{ height: '32px', fontSize: '12px' }}>{t('import_sales.shipment_details_page.s35', "تطبيق على كل الأصناف")}</Button>
          </div>

          <div style={{ width: '100%', overflowX: 'hidden' }}>
            <table 
              className="table" 
              style={{ 
                width: '100%', 
                tableLayout: 'fixed', 
                borderCollapse: 'collapse', 
                fontSize: '12px' 
              }}
            >
              <colgroup>
                <col style={{ width: '24%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '12%' }} />
              </colgroup>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                  <th style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 700, fontSize: '11.5px', color: '#334155' }}>الصنف</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 700, fontSize: '11.5px', color: '#334155' }}>كمية الشحن</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 700, fontSize: '11.5px', color: '#334155' }}>سعر المصنع</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 700, fontSize: '11.5px', color: '#334155' }}>تكلفة الواصل</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 700, fontSize: '11.5px', color: '#334155' }}>المستلم</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 700, fontSize: '11.5px', color: '#334155' }}>هامش جملة</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 700, fontSize: '11.5px', color: '#334155' }}>هامش قطاعي</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 700, fontSize: '11.5px', color: '#1e3a8a' }}>سعر الجملة</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 700, fontSize: '11.5px', color: '#15803d' }}>سعر القطاعي</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map(item => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px 8px', textAlign: 'right', verticalAlign: 'middle' }}>
                      <div style={{ fontWeight: 700, fontSize: '11.5px', color: '#0f172a', lineHeight: 1.35, wordBreak: 'break-word', whiteSpace: 'normal' }}>
                        {item.product_name || item.product_id}
                      </div>
                    </td>
                    <td style={{ padding: '8px 4px', textAlign: 'center', verticalAlign: 'middle', fontWeight: 700, fontSize: '12px', color: '#334155' }}>
                      {item.quantity}
                    </td>
                    <td style={{ padding: '8px 4px', textAlign: 'center', verticalAlign: 'middle', fontWeight: 600, fontSize: '11.5px', color: '#475569' }}>
                      ${Number(item.factory_unit_price_usd).toFixed(2)}
                    </td>
                    <td style={{ padding: '8px 4px', textAlign: 'center', verticalAlign: 'middle' }}>
                      <div style={{ fontWeight: 800, fontSize: '11.5px', color: '#047857' }}>
                        {Number(item.landed_cost_egp).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 500 }}>ج.م</div>
                    </td>
                    <ItemRowInputs 
                      item={item} 
                      shipmentId={id!} 
                      arrivalRate={Number(data.exchange_rate_at_arrival) || 1} 
                      pricingRate={Number(data.pricing_exchange_rate) || Number(data.exchange_rate_at_arrival) || 1} 
                      isArrived={data.status === 'Arrived'}
                    />
                  </tr>
                ))}
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
                      <div style={{ maxWidth: '520px', margin: '0 auto', textAlign: 'center' }}>
                        <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px auto', color: '#64748b' }}>
                          <PackageIcon size={24} />
                        </div>
                        <h4 style={{ margin: '0 0 6px 0', fontSize: '0.94rem', fontWeight: 800, color: '#1e293b' }}>
                          لا توجد أصناف مسجلة في هذه الحاوية بعد
                        </h4>
                        <p style={{ margin: '0 0 16px 0', fontSize: '0.8rem', color: '#64748b', lineHeight: 1.6 }}>
                          {data.project_id 
                            ? 'هذه الحاوية مربوطة بمشروع استيراد معتمد. يمكنك سحب كافة الأصناف بأسعار المصنع وكمياتها بضغطة زر واحدة، أو تسجيل أصناف فردية يدوياً.'
                            : 'قم بإضافة الأصناف المشحونة داخل الحاوية لاحتساب تكلفتها الاستيرادية وتحديد أسعار البيع.'}
                        </p>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                          {data.project_id && (
                            <Button 
                              variant="primary" 
                              onClick={handleImportProjectItems} 
                              disabled={importProjectItemsMutation.isPending || data.status === 'Arrived'}
                              style={{ backgroundColor: '#15803d', borderColor: '#166534', color: '#ffffff', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                            >
                              <DownloadIcon size={15} />
                              <span>{importProjectItemsMutation.isPending ? 'جاري سحب الأصناف...' : 'سحب أصناف المشروع تلقائياً'}</span>
                            </Button>
                          )}
                          <Button variant="secondary" onClick={() => setIsAddItemOpen(true)} disabled={data.status === 'Arrived'} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <PlusCircleIcon size={15} />
                            <span>إضافة صنف يدوياً +</span>
                          </Button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </FormSection>
      </main>

      {isAutopsyOpen && (
        <ContainerAutopsyModal isOpen={isAutopsyOpen} onClose={() => setIsAutopsyOpen(false)} shipmentId={id!} />
      )}
      {isPreordersOpen && (
        <ContainerPreordersModal isOpen={isPreordersOpen} onClose={() => setIsPreordersOpen(false)} shipment={data} />
      )}
      {isAddItemOpen && (
        <AddShipmentItemDialog 
          open={isAddItemOpen} 
          onClose={() => setIsAddItemOpen(false)} 
          shipmentId={id!} 
        />
      )}

      {isGrnOpen && (
        <StandardDialog
          isOpen={isGrnOpen}
          onClose={() => setIsGrnOpen(false)}
          title="محضر فحص واستلام مخزني (GRN / Receiving Inspection)"
          subtitle={`فحص كميات وجودة أصناف الحاوية ${data.container_number} وإثبات التوالف والنواقص`}
          width="min(880px, 95vw)"
          compact
          footer={
            <>
              <Button variant="secondary" onClick={() => setIsGrnOpen(false)}>إلغاء</Button>
              <Button
                variant="primary"
                disabled={createGrnMutation.isPending}
                onClick={() => {
                  const itemsPayload = data.items.map((item: any) => {
                    const expectedQty = Number(item.quantity || 0);
                    const receivedQty = Number(item.received_quantity || item.quantity || 0);
                    const damagedQty = Number(grnDamagedMap[item.id] || 0);
                    const acceptedQty = Math.max(0, receivedQty - damagedQty);
                    return {
                      shipmentItemId: item.id,
                      productId: item.product_id,
                      expectedQty,
                      receivedQty,
                      acceptedQty,
                      damagedQty,
                      shortageQty: Math.max(0, expectedQty - receivedQty),
                    };
                  });
                  createGrnMutation.mutate(
                    {
                      shipmentId: id!,
                      projectId: (data as any).project_id || undefined,
                      warehouseLocationId: grnLocationId ? Number(grnLocationId) : undefined,
                      inspectorName: grnInspectorName || undefined,
                      overallStatus: 'approved',
                      notes: grnNotes || undefined,
                      items: itemsPayload,
                    },
                    {
                      onSuccess: (res: any) => {
                        toast.success(`تم اعتماد محضر الفحص والاستلام رقم ${res?.grn_number || ''} بنجاح`);
                        setIsGrnOpen(false);
                      },
                      onError: (err: any) => toast.error(err?.message || 'تعذر حفظ محضر الفحص والاستلام'),
                    },
                  );
                }}
              >
                {createGrnMutation.isPending ? 'جاري الاعتماد...' : 'اعتماد محضر الفحص والاستلام'}
              </Button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, marginBottom: '4px' }}>اسم مسؤول الفحص / أمين المخزن</label>
                <input className="input" style={{ width: '100%' }} value={grnInspectorName} onChange={e => setGrnInspectorName(e.target.value)} placeholder="مثال: م. أحمد محمود" />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, marginBottom: '4px' }}>مخزن الاستلام</label>
                <select className="input" style={{ width: '100%' }} value={grnLocationId} onChange={e => setGrnLocationId(e.target.value)}>
                  <option value="">-- اختر المخزن --</option>
                  {warehouseLocations.map((loc: any) => (
                    <option key={loc.id} value={loc.id}>{loc.name || loc.nameAr || `مخزن ${loc.id}`}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, marginBottom: '4px' }}>ملاحظات عامة على حالة الحاوية والأختام</label>
                <input className="input" style={{ width: '100%' }} value={grnNotes} onChange={e => setGrnNotes(e.target.value)} placeholder="حالة الرصاص الجمركي والتغليف..." />
              </div>
            </div>

            <div style={{ maxHeight: '260px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
              <table className="table" style={{ width: '100%', textAlign: 'right', fontSize: '12.5px', borderCollapse: 'collapse' }}>
                <thead style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
                  <tr>
                    <th style={{ padding: '8px 10px' }}>الصنف</th>
                    <th style={{ padding: '8px 10px' }}>كمية البوليصة</th>
                    <th style={{ padding: '8px 10px' }}>المستلم الفعلي</th>
                    <th style={{ padding: '8px 10px' }}>العجز (Shortage)</th>
                    <th style={{ padding: '8px 10px' }}>التالف (Damaged)</th>
                    <th style={{ padding: '8px 10px' }}>الصالح المقبول</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item: any) => {
                    const expected = Number(item.quantity || 0);
                    const received = Number(item.received_quantity || item.quantity || 0);
                    const shortage = Math.max(0, expected - received);
                    const damaged = Number(grnDamagedMap[item.id] || 0);
                    const accepted = Math.max(0, received - damaged);
                    return (
                      <tr key={item.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 10px', fontWeight: 700 }}>{item.product_name || item.product_id}</td>
                        <td style={{ padding: '8px 10px' }}>{expected}</td>
                        <td style={{ padding: '8px 10px', fontWeight: 700, color: '#0369a1' }}>{received}</td>
                        <td style={{ padding: '8px 10px', color: shortage > 0 ? '#dc2626' : '#64748b', fontWeight: 700 }}>{shortage}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <input
                            type="number"
                            min={0}
                            max={received}
                            className="input"
                            style={{ width: '80px', height: '30px', padding: '0 6px' }}
                            value={grnDamagedMap[item.id] ?? 0}
                            onChange={e => setGrnDamagedMap(prev => ({ ...prev, [item.id]: Math.max(0, Number(e.target.value) || 0) }))}
                          />
                        </td>
                        <td style={{ padding: '8px 10px', fontWeight: 800, color: '#15803d' }}>{accepted}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </StandardDialog>
      )}

      {isLateExpenseOpen && (
        <StandardDialog
          isOpen={isLateExpenseOpen}
          onClose={() => setIsLateExpenseOpen(false)}
          title="تسجيل مصروف متأخر بعد الوصول (Post-Arrival Late Expense)"
          subtitle="توزيع ذكي للمصروفات المتأخرة بين الرصيد المتبقي بالمخزن (Lot WAC) والبضاعة المباعة (COGS)"
          width="min(620px, 95vw)"
          compact
          footer={
            <>
              <Button variant="secondary" onClick={() => setIsLateExpenseOpen(false)}>إلغاء</Button>
              <Button
                variant="primary"
                disabled={recordLateExpenseMutation.isPending}
                onClick={() => {
                  const amt = Number(lateAmountEgp);
                  if (!amt || amt <= 0) {
                    toast.error('يرجى إدخال قيمة المصروف بالجنيه');
                    return;
                  }
                  recordLateExpenseMutation.mutate(
                    {
                      shipmentId: id!,
                      dto: {
                        expenseType: lateExpenseType,
                        amountEgp: amt,
                        description: lateDescription || undefined,
                        supplierId: lateExpenseSupplier ? Number(lateExpenseSupplier) : undefined,
                        unallocableReason: lateExpenseUnallocableReason || undefined,
                      },
                    },
                    {
                      onSuccess: (res: any) => {
                        const summary = lateExpenseAllocationSummary(res);
                        toast.success(`تم تسجيل المصروف المتأخر بنجاح (مُرسمل للمخزون: ${formatCurrency(summary.capitalizedToInventoryEgp)} | محمل على COGS: ${formatCurrency(summary.expensedToCogsEgp)})`);
                        setIsLateExpenseOpen(false);
                        setLateAmountEgp('');
                        setLateDescription('');
                        setLateExpenseSupplier('');
                        setLateExpenseUnallocableReason('');
                      },
                      onError: (err: any) => toast.error(err?.message || 'تعذر تسجيل المصروف المتأخر'),
                    },
                  );
                }}
              >
                {recordLateExpenseMutation.isPending ? 'جاري الترحيل...' : 'تسجيل وترحيل القيد المحاسبي'}
              </Button>
            </>
          }
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, marginBottom: '4px' }}>نوع المصروف المتأخر</label>
              <select className="input" style={{ width: '100%' }} value={lateExpenseType} onChange={e => setLateExpenseType(e.target.value)}>
                <option value="demurrage">غرامات تأخير وأرضيات (Demurrage)</option>
                <option value="customs_diff">فروق تسوية جمركية لاحقة</option>
                <option value="transport">نقل ومشال إضافي</option>
                <option value="other">مصروفات استيراد أخرى</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, marginBottom: '4px' }}>المبلغ (ج.م) *</label>
              <input type="number" step="0.01" className="input" style={{ width: '100%' }} value={lateAmountEgp} onChange={e => setLateAmountEgp(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, marginBottom: '4px' }}>المورد المستحق (مورد المصروف) *</label>
              <select className="input" style={{ width: '100%' }} value={lateExpenseSupplier} onChange={e => setLateExpenseSupplier(e.target.value)}>
                <option value="">-- اختر المورد المستحق --</option>
                {suppliersList.map((s: any) => <option key={s.id} value={s.id}>{s.name || s.nameAr || s.name_ar || `#${s.id}`}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, marginBottom: '4px' }}>سبب عدم قابلية التخصيص (بديل المورد — يقيد على حساب التسوية)</label>
              <input className="input" style={{ width: '100%' }} value={lateExpenseUnallocableReason} onChange={e => setLateExpenseUnallocableReason(e.target.value)} placeholder="يترك فارغاً إذا تم اختيار المورد" />
            </div>
            <div style={{ gridColumn: '1 / -1', fontSize: '12.5px', color: '#475569' }}>
              يوزع المصروف دائما تناسبيا بين البضاعة المباعة (COGS) والمتبقي بالمخزون، حسب الكميات المباعة والمتبقية وقت التسجيل. يسجل القيد استحقاقا على المورد المحدد أعلاه، أو على حساب التسوية إذا سجل سبب عدم قابلية التخصيص — ولا ينسب أبدا لمورد البضاعة تلقائيا.
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, marginBottom: '4px' }}>البيان والتفاصيل</label>
              <input className="input" style={{ width: '100%' }} value={lateDescription} onChange={e => setLateDescription(e.target.value)} placeholder="رقم الإيصال أو سبب المصروف المتأخر..." />
            </div>
          </div>
        </StandardDialog>
      )}
    </div>
  );
}
