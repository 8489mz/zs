// Marketplace tools tabs (calculator + studio + orders) —
// pure move from SettingsMarketplacesSection.tsx (slice S3). The hook owns
// the calculator/studio/simulate state + mutations + handleCopy + the
// initial-calculation effect; the three tab components render the tab JSX.
// The facade calls useMarketplaceTools() once (with mappingsQuery, for the
// simulate-order refetch) and passes hook values as props. `t` is local —
// each tab calls useTranslation() itself. The GTIN/photo modal setters
// (setGtinForm, setShowGtinModal, setShowPhotoOptimizerModal) are props
// from S10; availableProducts is a prop from the facade kernel.
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/components/system-alert';
import {
  marketplaceSyncApi,
  SupportedMarketplace,
  MarketplaceFeeCalculationInput,
  MarketplaceFeeCalculationResult,
  ListingStudioResult,
} from '@/features/storefront/api/marketplace-sync.api';
import type { Product } from '@/types/domain';
import {
  PackageIcon,
  ShoppingCartIcon,
  PlusIcon,
  CopyIcon,
  CameraIcon,
} from '@/shared/components/icons/AppIcons';

export interface UseMarketplaceToolsParams {
  mappingsQuery: { refetch: () => Promise<unknown> };
}

export function useMarketplaceTools({ mappingsQuery }: UseMarketplaceToolsParams) {
  const [simulatedOrderInfo, setSimulatedOrderInfo] = useState<string | null>(null);

  // Calculator Form State (حاسبة وهوامش الأرباح والرسوم)
  const [calcInput, setCalcInput] = useState<MarketplaceFeeCalculationInput>({
    marketplace: 'amazon',
    region: 'eg',
    category: 'electronics',
    fulfillmentType: 'fba',
    weightTier: 'standard',
    sellingPrice: 350,
    itemCost: 200,
    inboundShippingCost: 10,
    packagingCost: 5,
  });
  const [calcResult, setCalcResult] = useState<MarketplaceFeeCalculationResult | null>(null);

  // Listing Studio Form State ("ستوديو / ليو")
  const [studioProductId, setStudioProductId] = useState<number>(0);
  const [studioResult, setStudioResult] = useState<ListingStudioResult | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Initial calculation on mount
  useEffect(() => {
    marketplaceSyncApi.calculateFees(calcInput).then((res) => setCalcResult(res)).catch(() => {});
  }, []);

  // Stock sync is handled directly via mappings table actions

  const simulateOrderMutation = useMutation({
    mutationFn: (marketplace: 'amazon' | 'noon') => marketplaceSyncApi.simulateIncomingOrder(marketplace),
    onSuccess: (res: any) => {
      setSimulatedOrderInfo(`تم استلام وحجز طلب ${res.marketplace.toUpperCase()} برقم ${res.marketplaceOrderId} للعميل ${res.customerName}! الرصيد المحجوز: ${res.quantity} قطعة.`);
      mappingsQuery.refetch();
      toast.success('تمت محاكاة سحب الطلب وحجز الرصيد من المخزن بنجاح');
    },
    onError: (err: any) => toast.error(err?.message || 'فشلت محاكاة الطلب'),
  });

  const calcMutation = useMutation({
    mutationFn: (input: MarketplaceFeeCalculationInput) => marketplaceSyncApi.calculateFees(input),
    onSuccess: (res) => setCalcResult(res),
    onError: (err: any) => toast.error(err?.message || 'فشل حساب الرسوم'),
  });

  const studioMutation = useMutation({
    mutationFn: (pId: number) => marketplaceSyncApi.getListingStudio(pId),
    onSuccess: (res) => {
      setStudioResult(res);
      toast.success('تم توليد محتوى وسيو القوائم للمنصة بنجاح');
    },
    onError: (err: any) => toast.error(err?.message || 'فشل توليد المحتوى'),
  });

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast.success('تم النسخ إلى الحافظة');
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return {
    calcInput,
    setCalcInput,
    calcResult,
    setCalcResult,
    studioProductId,
    setStudioProductId,
    studioResult,
    setStudioResult,
    copiedKey,
    setCopiedKey,
    simulatedOrderInfo,
    setSimulatedOrderInfo,
    simulateOrderMutation,
    calcMutation,
    studioMutation,
    handleCopy,
  };
}

// GTIN form shape — inlined verbatim from the pristine gtinForm state
// declaration (L1018-1029). S10 owns the state and defines the same shape;
// a direct slice import would be a hard fail, so the shape is duplicated
// by necessity. The two copies must stay identical.
export interface MarketplaceGtinFormState {
  productId?: number;
  brandName: string;
  category: string;
  marketplace: SupportedMarketplace;
  reason: 'unbranded' | 'private_label' | 'custom_manufacturing' | 'parts_accessories';
}

export interface MarketplaceCalculatorTabProps {
  tools: ReturnType<typeof useMarketplaceTools>;
  availableProducts: Product[];
}

export const MarketplaceCalculatorTab: React.FC<MarketplaceCalculatorTabProps> = ({ tools, availableProducts }) => {
  const { t } = useTranslation();
  const {
    calcInput,
    setCalcInput,
    calcResult,
    calcMutation,
  } = tools;
  return (
    <>
      {/* ========================================================================= */}
      {/* TAB 1: PROFIT & FEE CALCULATOR (محرك حساب هوامش الأرباح ورسوم المنصات) */}
      {/* ========================================================================= */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div style={{ marginBottom: '18px' }}>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s91', "محرك حساب هوامش الأرباح ورسوم المنصات (Profit & Fee Engine)")}
              </h4>
              <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s92', "احسب صافي أرباحك وعمولات أمازون، نون، وجوميا، ومصاريف الشحن والتجهيز والضريبة ونقطة التعادل بدقة من واقع تكلفة الصنف بالـ ERP.")}
              </p>
            </div>

            {/* Product Quick-Picker */}
            <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0', marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s93', "اختيار صنف مسجل في الـ ERP لجلب تكلفته وسعر بيعه تلقائياً:")}
              </label>
              <select
                onChange={(e) => {
                  const id = parseInt(e.target.value, 10);
                  const p = availableProducts.find((item) => Number(item.id) === id);
                  if (p) {
                    const updated = {
                      ...calcInput,
                      itemCost: Number((p as any).cost_price ?? (p as any).costPrice ?? 0),
                      sellingPrice: Number((p as any).retail_price ?? (p as any).retailPrice ?? 0),
                    };
                    setCalcInput(updated);
                    calcMutation.mutate(updated);
                  }
                }}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#ffffff' }}
              >
                <option value="">{t('settings.workspace_sections.settings_marketplaces_section.s94', "-- اضغط لاختيار صنف من المخزن --")}</option>
                {availableProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {t('settings.workspace_sections.settings_marketplaces_section.s95', "(التكلفة:")} {(p as any).costPrice ?? (p as any).cost_price ?? 0} {t('settings.workspace_sections.settings_marketplaces_section.s96', "ج.م | سعر البيع:")} {(p as any).retailPrice ?? (p as any).retail_price ?? 0} {t('settings.workspace_sections.settings_marketplaces_section.s97', "ج.م)")}
                  </option>
                ))}
              </select>
            </div>

            {/* Inputs Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s98', "منصة البيع")}
                </label>
                <select
                  value={calcInput.marketplace}
                  onChange={(e) => {
                    const updated = { ...calcInput, marketplace: e.target.value as any };
                    setCalcInput(updated);
                    calcMutation.mutate(updated);
                  }}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#ffffff' }}
                >
                  <option value="amazon">{t('settings.workspace_sections.settings_marketplaces_section.s99', "أمازون (Amazon SP-API)")}</option>
                  <option value="noon">{t('settings.workspace_sections.settings_marketplaces_section.s100', "نون (Noon Marketplace)")}</option>
                  <option value="jumia">{t('settings.workspace_sections.settings_marketplaces_section.s101', "جوميا (Jumia Seller Center)")}</option>
                  <option value="trendyol">{t('settings.workspace_sections.settings_marketplaces_section.s102', "ترينديول (Trendyol)")}</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s103', "دولة وسوق البيع")}
                </label>
                <select
                  value={calcInput.region}
                  onChange={(e) => {
                    const updated = { ...calcInput, region: e.target.value as any };
                    setCalcInput(updated);
                    calcMutation.mutate(updated);
                  }}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#ffffff' }}
                >
                  <option value="eg">{t('settings.workspace_sections.settings_marketplaces_section.s104', "مصر (EGP - ج.م)")}</option>
                  <option value="sa">{t('settings.workspace_sections.settings_marketplaces_section.s105', "السعودية (SAR - ر.س)")}</option>
                  <option value="ae">{t('settings.workspace_sections.settings_marketplaces_section.s106', "الإمارات (AED - د.إ)")}</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s107', "فئة وتصنيف المنتج")}
                </label>
                <select
                  value={calcInput.category}
                  onChange={(e) => {
                    const updated = { ...calcInput, category: e.target.value };
                    setCalcInput(updated);
                    calcMutation.mutate(updated);
                  }}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#ffffff' }}
                >
                  <option value="electronics">{t('settings.workspace_sections.settings_marketplaces_section.s108', "إلكترونيات وكمبيوتر (عمولة ~7-8%)")}</option>
                  <option value="mobile_accessories">{t('settings.workspace_sections.settings_marketplaces_section.s109', "إكسسوارات موبايل (عمولة ~12-14%)")}</option>
                  <option value="apparel">{t('settings.workspace_sections.settings_marketplaces_section.s110', "ملابس وأزياء وأحذية (عمولة ~15%)")}</option>
                  <option value="home_kitchen">{t('settings.workspace_sections.settings_marketplaces_section.s111', "أدوات منزلية ومطبخ (عمولة ~11-12%)")}</option>
                  <option value="beauty_health">{t('settings.workspace_sections.settings_marketplaces_section.s112', "عطور وصحة وتجميل (عمولة ~12%)")}</option>
                  <option value="grocery">{t('settings.workspace_sections.settings_marketplaces_section.s113', "سوبرماركت وأغذية (عمولة ~9%)")}</option>
                  <option value="baby_toys">{t('settings.workspace_sections.settings_marketplaces_section.s114', "ألعاب ومستلزمات أطفال (عمولة ~12%)")}</option>
                  <option value="sports_outdoors">{t('settings.workspace_sections.settings_marketplaces_section.s115', "رياضة ولياقة بدنية (عمولة ~13%)")}</option>
                  <option value="general">{t('settings.workspace_sections.settings_marketplaces_section.s116', "فئات عامة وأخرى (عمولة ~12%)")}</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s117', "نمط الشحن والتجهيز")}
                </label>
                <select
                  value={calcInput.fulfillmentType}
                  onChange={(e) => {
                    const updated = { ...calcInput, fulfillmentType: e.target.value };
                    setCalcInput(updated);
                    calcMutation.mutate(updated);
                  }}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#ffffff' }}
                >
                  <option value="fba">{t('settings.workspace_sections.settings_marketplaces_section.s118', "FBA / FBN / Express (مستودعات المنصة الرسمية)")}</option>
                  <option value="fbm">{t('settings.workspace_sections.settings_marketplaces_section.s119', "FBM / Direct (شحن مباشر من مستودعك الخاص)")}</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s120', "وزن وحجم الطرد")}
                </label>
                <select
                  value={calcInput.weightTier}
                  onChange={(e) => {
                    const updated = { ...calcInput, weightTier: e.target.value as any };
                    setCalcInput(updated);
                    calcMutation.mutate(updated);
                  }}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#ffffff' }}
                >
                  <option value="small">{t('settings.workspace_sections.settings_marketplaces_section.s121', "طرد صغير وخفيف (أقل من 250 جرام)")}</option>
                  <option value="standard">{t('settings.workspace_sections.settings_marketplaces_section.s122', "طرد قياسي (250 جرام إلى 1 كجم)")}</option>
                  <option value="medium">{t('settings.workspace_sections.settings_marketplaces_section.s123', "طرد متوسط (1 كجم إلى 2 كجم)")}</option>
                  <option value="large">{t('settings.workspace_sections.settings_marketplaces_section.s124', "طرد كبير (2 كجم إلى 5 كجم)")}</option>
                  <option value="heavy">{t('settings.workspace_sections.settings_marketplaces_section.s125', "طرد ثقيل (أكثر من 5 كجم)")}</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s126', "سعر البيع المستهدف للمستهلك *")}
                </label>
                <input
                  type="number"
                  value={calcInput.sellingPrice || ''}
                  onChange={(e) => {
                    const updated = { ...calcInput, sellingPrice: parseFloat(e.target.value) || 0 };
                    setCalcInput(updated);
                    calcMutation.mutate(updated);
                  }}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', fontWeight: 700, color: '#170e5e' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s127', "تكلفة شراء الصنف (ERP Cost) *")}
                </label>
                <input
                  type="number"
                  value={calcInput.itemCost || ''}
                  onChange={(e) => {
                    const updated = { ...calcInput, itemCost: parseFloat(e.target.value) || 0 };
                    setCalcInput(updated);
                    calcMutation.mutate(updated);
                  }}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s128', "شحن لمستودع المنصة + تغليف")}
                </label>
                <input
                  type="number"
                  value={(calcInput.inboundShippingCost || 0) + (calcInput.packagingCost || 0)}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    const updated = { ...calcInput, inboundShippingCost: val, packagingCost: 0 };
                    setCalcInput(updated);
                    calcMutation.mutate(updated);
                  }}
                  placeholder="0"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>
            </div>

            {/* Real-time Results Dashboard */}
            {calcResult ? (
              <div style={{ marginTop: '24px', borderTop: '1px solid #e2e8f0', paddingTop: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                  <span style={{ fontSize: '14.5px', fontWeight: 800, color: '#0f172a' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s129', "تقرير الربحية الصافية والتحليل المالي للقطعة:")}
                  </span>
                  <span
                    style={{
                      padding: '4px 12px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: 800,
                      background:
                        calcResult.ratingStatus === 'exceptional'
                          ? '#f0fdf4'
                          : calcResult.ratingStatus === 'healthy'
                          ? '#eff6ff'
                          : calcResult.ratingStatus === 'tight'
                          ? '#fefce8'
                          : '#fef2f2',
                      color:
                        calcResult.ratingStatus === 'exceptional'
                          ? '#15803d'
                          : calcResult.ratingStatus === 'healthy'
                          ? '#1d4ed8'
                          : calcResult.ratingStatus === 'tight'
                          ? '#a16207'
                          : '#b91c1c',
                      border: `1px solid ${
                        calcResult.ratingStatus === 'exceptional'
                          ? '#bbf7d0'
                          : calcResult.ratingStatus === 'healthy'
                          ? '#bfdbfe'
                          : calcResult.ratingStatus === 'tight'
                          ? '#fef08a'
                          : '#fecaca'
                      }`,
                    }}
                  >
                    {calcResult.ratingStatus === 'exceptional'
                      ? t('settings.workspace_sections.settings_marketplaces_section.s130', "ربحية استثنائية (25%+)")
                      : calcResult.ratingStatus === 'healthy'
                      ? t('settings.workspace_sections.settings_marketplaces_section.s131', "ربحية صحية وممتازة (12% - 24%)")
                      : calcResult.ratingStatus === 'tight'
                      ? t('settings.workspace_sections.settings_marketplaces_section.s132', "هامش ربح ضيق (أقل من 12%)")
                      : t('settings.workspace_sections.settings_marketplaces_section.s133', "خسارة محققة على المنصة!")}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                  <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s134', "سعر البيع للمستهلك")}</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                      {calcResult.sellingPrice} {calcResult.currency}
                    </div>
                  </div>

                  <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '11.5px', color: '#dc2626', fontWeight: 600 }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s135', "عمولة البيع (")}{calcResult.referralRatePercent}%)
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#dc2626', marginTop: '4px' }}>
                      -{calcResult.referralFee} {calcResult.currency}
                    </div>
                  </div>

                  <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '11.5px', color: '#dc2626', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s136', "الشحن والتجهيز + الإغلاق")}</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#dc2626', marginTop: '4px' }}>
                      -{(calcResult.fulfillmentFee + calcResult.closingFee).toFixed(1)} {calcResult.currency}
                    </div>
                  </div>

                  <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '11.5px', color: '#dc2626', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s137', "ضريبة القيمة المضافة (")}{calcResult.vatRatePercent}%)</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#dc2626', marginTop: '4px' }}>
                      -{calcResult.vatOnFees} {calcResult.currency}
                    </div>
                  </div>

                  <div style={{ background: '#f0f9ff', padding: '14px', borderRadius: '10px', border: '1px solid #bae6fd' }}>
                    <div style={{ fontSize: '11.5px', color: '#0369a1', fontWeight: 700 }}>{t('settings.workspace_sections.settings_marketplaces_section.s138', "صافي المحول لحساب البنك")}</div>
                    <div style={{ fontSize: '22px', fontWeight: 900, color: '#0369a1', marginTop: '4px' }}>
                      {calcResult.netPayoutToMerchant} {calcResult.currency}
                    </div>
                  </div>

                  <div
                    style={{
                      background: calcResult.netProfit >= 0 ? '#f0fdf4' : '#fef2f2',
                      padding: '14px',
                      borderRadius: '10px',
                      border: `1px solid ${calcResult.netProfit >= 0 ? '#bbf7d0' : '#fecaca'}`,
                    }}
                  >
                    <div style={{ fontSize: '11.5px', color: calcResult.netProfit >= 0 ? '#15803d' : '#b91c1c', fontWeight: 700 }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s139', "صافي الربح الحقيقي")}
                    </div>
                    <div style={{ fontSize: '22px', fontWeight: 900, color: calcResult.netProfit >= 0 ? '#15803d' : '#b91c1c', marginTop: '4px' }}>
                      {calcResult.netProfit} {calcResult.currency}
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s140', "هامش الربح:")} <strong style={{ color: calcResult.netProfit >= 0 ? '#15803d' : '#b91c1c' }}>{calcResult.netMarginPercent}%</strong>
                    </div>
                  </div>

                  <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '11.5px', color: '#475569', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s141', "أدنى سعر للتعادل (Break-Even)")}</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#170e5e', marginTop: '4px' }}>
                      {calcResult.breakEvenPrice} {calcResult.currency}
                    </div>
                    <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: '2px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s142', "أقل من هذا السعر يسبب خسارة")}</div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
    </>
  );
};

export interface MarketplaceStudioTabProps {
  tools: ReturnType<typeof useMarketplaceTools>;
  availableProducts: Product[];
  setGtinForm: React.Dispatch<React.SetStateAction<MarketplaceGtinFormState>>;
  setShowGtinModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowPhotoOptimizerModal: React.Dispatch<React.SetStateAction<boolean>>;
}

export const MarketplaceStudioTab: React.FC<MarketplaceStudioTabProps> = ({ tools, availableProducts, setGtinForm, setShowGtinModal, setShowPhotoOptimizerModal }) => {
  const { t } = useTranslation();
  const {
    studioProductId,
    setStudioProductId,
    studioResult,
    copiedKey,
    studioMutation,
    handleCopy,
  } = tools;
  return (
    <>
      {/* ========================================================================= */}
      {/* TAB 2: LISTING STUDIO ("ستوديو / ليو") */}
      {/* ========================================================================= */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s143', "استوديو تجهيز المنتجات وسيو المنصات (Content & Listing Studio)")}
              </h4>
              <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s144', "توليد عناوين احترافية متوافقة مع خوارزميات أمازون ونون، و5 نقاط بيعية رئيسية (Bullet Points)، والكلمات المفتاحية الخلفية (Backend Keywords).")}
              </p>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '16px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '260px' }}>
                <select
                  value={studioProductId}
                  onChange={(e) => setStudioProductId(parseInt(e.target.value, 10) || 0)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#ffffff' }}
                >
                  <option value={0}>{t('settings.workspace_sections.settings_marketplaces_section.s145', "-- اختر صنفاً لتوليد صفحات البيع والسيو له --")}</option>
                  {availableProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.barcode ? `(${p.barcode})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <Button
                variant="primary"
                onClick={() => {
                  if (!studioProductId) {
                    toast.error(t('settings.workspace_sections.settings_marketplaces_section.s146', "يرجى اختيار صنف أولاً"));
                    return;
                  }
                  studioMutation.mutate(studioProductId);
                }}
                disabled={studioMutation.isPending || !studioProductId}
                style={{ background: '#170e5e', color: '#ffffff', minWidth: '150px' }}
              >
                {studioMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s147', "جاري التوليد والتحليل...") : t('settings.workspace_sections.settings_marketplaces_section.s148', "توليد محتوى وسيو القائمة")}
              </Button>

              <Button
                variant="secondary"
                onClick={() => {
                  if (studioProductId) {
                    setGtinForm({
                      productId: studioProductId,
                      brandName: '',
                      category: t('settings.workspace_sections.settings_marketplaces_section.s149', "Home & Kitchen / الأدوات المنزلية"),
                      marketplace: 'amazon',
                      reason: 'unbranded',
                    });
                  }
                  setShowGtinModal(true);
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                <PlusIcon size={14} />
                <span>{t('settings.workspace_sections.settings_marketplaces_section.s150', "طلب إعفاء الباركود (GTIN)")}</span>
              </Button>

              <Button
                variant="secondary"
                onClick={() => setShowPhotoOptimizerModal(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                <CameraIcon size={14} />
                <span>{t('settings.workspace_sections.settings_marketplaces_section.s151', "فاحص ومحسن صور المنصات")}</span>
              </Button>
            </div>

            {studioResult ? (
              <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '16px', borderTop: '1px solid #e2e8f0', paddingTop: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s152', "تم تجهيز محتوى الإدراج والسيو بنجاح للصنف:")} {studioResult.productName}
                  </span>
                  <Button
                    variant="primary"
                    onClick={() => {
                      const fullListing = `[العنوان العربي]\n${studioResult.optimizedTitleAr}\n\n[English Title]\n${studioResult.optimizedTitleEn}\n\n[النقاط البيعية الـ 5]\n• ${studioResult.bulletPointsAr.join('\n• ')}\n\n[Backend Keywords]\n${studioResult.backendKeywordsAr}`;
                      handleCopy(fullListing, 'fullListing');
                    }}
                    style={{ background: '#170e5e', color: '#ffffff', fontSize: '11.5px', padding: '4px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <CopyIcon size={13} />
                    <span>{copiedKey === 'fullListing' ? t('settings.workspace_sections.settings_marketplaces_section.s153', "تم نسخ كامل المحتوى!") : t('settings.workspace_sections.settings_marketplaces_section.s154', "نسخ كامل محتوى القائمة")}</span>
                  </Button>
                </div>

                {/* Titles Card */}
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 800, fontSize: '13.5px', color: '#0f172a' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s155', "عنوان المنتج المحسّن لمحركات بحث أمازون ونون (Arabic Title):")}
                    </span>
                    <Button
                      variant="secondary"
                      onClick={() => handleCopy(studioResult.optimizedTitleAr, 'titleAr')}
                      style={{ fontSize: '11.5px', padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      <CopyIcon size={12} />
                      <span>{copiedKey === 'titleAr' ? t('settings.workspace_sections.settings_marketplaces_section.s156', "تم النسخ!") : t('settings.workspace_sections.settings_marketplaces_section.s157', "نسخ العنوان")}</span>
                    </Button>
                  </div>
                  <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '10px 12px', fontSize: '13px', color: '#0f172a', fontWeight: 600 }}>
                    {studioResult.optimizedTitleAr}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 800, fontSize: '13.5px', color: '#0f172a' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s158', "عنوان المنتج بالإنجليزية (English Title):")}
                    </span>
                    <Button
                      variant="secondary"
                      onClick={() => handleCopy(studioResult.optimizedTitleEn, 'titleEn')}
                      style={{ fontSize: '11.5px', padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      <CopyIcon size={12} />
                      <span>{copiedKey === 'titleEn' ? t('settings.workspace_sections.settings_marketplaces_section.s159', "تم النسخ!") : 'Copy English'}</span>
                    </Button>
                  </div>
                  <div dir="ltr" style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '10px 12px', fontSize: '13px', color: '#0f172a', fontWeight: 600, textAlign: 'left' }}>
                    {studioResult.optimizedTitleEn}
                  </div>
                </div>

                {/* 5 Bullet Points */}
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span style={{ fontWeight: 800, fontSize: '13.5px', color: '#0f172a' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s160', "النقاط البيعية الـ 5 الرئيسية (5 Key Product Features / Bullets):")}
                    </span>
                    <Button
                      variant="secondary"
                      onClick={() => handleCopy(studioResult.bulletPointsAr.join('\n• '), 'bulletsAr')}
                      style={{ fontSize: '11.5px', padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      <CopyIcon size={12} />
                      <span>{copiedKey === 'bulletsAr' ? t('settings.workspace_sections.settings_marketplaces_section.s161', "تم النسخ!") : t('settings.workspace_sections.settings_marketplaces_section.s162', "نسخ كافة النقاط")}</span>
                    </Button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {studioResult.bulletPointsAr.map((bp, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', background: '#ffffff', padding: '8px 12px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '12.5px' }}>
                        <span style={{ background: '#170e5e', color: '#ffffff', width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, flexShrink: 0 }}>
                          {idx + 1}
                        </span>
                        <span style={{ color: '#334155', lineHeight: 1.5 }}>{bp}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Backend Keywords */}
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 800, fontSize: '13.5px', color: '#0f172a' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s163', "الكلمات المفتاحية الخلفية (Amazon Backend Search Terms):")}
                    </span>
                    <Button
                      variant="secondary"
                      onClick={() => handleCopy(studioResult.backendKeywordsAr, 'keywordsAr')}
                      style={{ fontSize: '11.5px', padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      <CopyIcon size={12} />
                      <span>{copiedKey === 'keywordsAr' ? t('settings.workspace_sections.settings_marketplaces_section.s164', "تم النسخ!") : t('settings.workspace_sections.settings_marketplaces_section.s165', "نسخ الكلمات")}</span>
                    </Button>
                  </div>
                  <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '8px 12px', fontSize: '12.5px', color: '#475569', fontFamily: 'monospace' }}>
                    {studioResult.backendKeywordsAr}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {studioProductId > 0 ? (
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                    {(() => {
                      const p = availableProducts.find((item) => Number(item.id) === studioProductId);
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div style={{ fontWeight: 800, fontSize: '14px', color: '#0f172a' }}>
                            {t('settings.workspace_sections.settings_marketplaces_section.s166', "الصنف المختار:")} {p?.name || '—'}
                          </div>
                          <div style={{ fontSize: '12px', color: '#64748b' }}>
                            {t('settings.workspace_sections.settings_marketplaces_section.s167', "الباركود:")} <strong style={{ color: '#0f172a' }}>{p?.barcode || t('settings.workspace_sections.settings_marketplaces_section.s168', "غير مسجل")}</strong> {t('settings.workspace_sections.settings_marketplaces_section.s169', "| سعر البيع:")} <strong style={{ color: '#15803d' }}>{(p as any)?.retailPrice ?? (p as any)?.retail_price ?? 0} {t('settings.workspace_sections.settings_marketplaces_section.s170', "ج.م")}</strong> {t('settings.workspace_sections.settings_marketplaces_section.s171', "| تكلفة الشراء:")} <strong style={{ color: '#0369a1' }}>{(p as any)?.costPrice ?? (p as any)?.cost_price ?? 0} {t('settings.workspace_sections.settings_marketplaces_section.s172', "ج.م")}</strong>
                          </div>
                        </div>
                      );
                    })()}
                    <Button
                      variant="primary"
                      onClick={() => studioMutation.mutate(studioProductId)}
                      disabled={studioMutation.isPending}
                      style={{ background: '#170e5e', color: '#ffffff', minWidth: '160px' }}
                    >
                      {studioMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s173', "جاري التوليد والتحليل...") : t('settings.workspace_sections.settings_marketplaces_section.s174', "بدء التوليد الذكي للقائمة")}
                    </Button>
                  </div>
                ) : null}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#170e5e', marginBottom: '4px' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s175', "صياغة العناوين التنافسية (SEO Titles)")}
                    </div>
                    <p style={{ margin: 0, fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s176', "توليد عناوين عربية وإنجليزية تجمع اسم الماركة، الموديل، اللون، والحجم لرفع نسبة النقر (CTR) مع الالتزام بحد الـ 200 حرف.")}
                    </p>
                  </div>

                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#15803d', marginBottom: '4px' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s177', "النقاط البيعية الـ 5 المقنعة (Bullet Points)")}
                    </div>
                    <p style={{ margin: 0, fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s178', "صياغة 5 مميزات تفصيلية تركز على جودة الخامات وسهولة الاستخدام لحث المشتري على إتمام الطلب وزيادة التحويل.")}
                    </p>
                  </div>

                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#0369a1', marginBottom: '4px' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s179', "الكلمات المفتاحية الخلفية (Backend Keywords)")}
                    </div>
                    <p style={{ margin: 0, fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s180', "استخراج الكلمات البحثية الأكثر صلة دون تكرار أو علامات ترقيم لتغذية خوارزمية محرك البحث A9 في أمازون ونون.")}
                    </p>
                  </div>
                </div>

                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '14px 18px' }}>
                  <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#1e40af', marginBottom: '4px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s181', "شروط وقواعد إدراج المنتجات الرسمية لتفادي حظر القوائم (Listing Guidelines):")}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '8px', fontSize: '11.5px', color: '#1e3a8a', lineHeight: 1.5 }}>
                    <div>• <strong>{t('settings.workspace_sections.settings_marketplaces_section.s182', "العناوين:")}</strong> {t('settings.workspace_sections.settings_marketplaces_section.s183', "يُمنع كتابة عبارات تسويقية مثل (Best Seller أو 100% Free Shipping أو تخفيض).")}</div>
                    <div>• <strong>{t('settings.workspace_sections.settings_marketplaces_section.s184', "الصور الأساسية:")}</strong> {t('settings.workspace_sections.settings_marketplaces_section.s185', "خلفية بيضاء نقية تماماً (RGB: 255, 255, 255) بنسبة تغطية للمنتج لا تقل عن 85%.")}</div>
                    <div>• <strong>{t('settings.workspace_sections.settings_marketplaces_section.s186', "أبعاد الصورة:")}</strong> {t('settings.workspace_sections.settings_marketplaces_section.s187', "دقة لا تقل عن 1000 × 1000 بكسل لتفعيل خاصية التكبير التفاعلي (Zoom-in).")}</div>
                    <div>• <strong>{t('settings.workspace_sections.settings_marketplaces_section.s188', "الكلمات الخلفية:")}</strong> {t('settings.workspace_sections.settings_marketplaces_section.s189', "لا تكرر الكلمات الموجودة في العنوان، ولا تستخدم علامات ترقيم أو فواصل.")}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
    </>
  );
};

export interface MarketplaceOrdersTabProps {
  tools: ReturnType<typeof useMarketplaceTools>;
}

export const MarketplaceOrdersTab: React.FC<MarketplaceOrdersTabProps> = ({ tools }) => {
  const { t } = useTranslation();
  const {
    simulatedOrderInfo,
    setSimulatedOrderInfo,
    simulateOrderMutation,
  } = tools;
  return (
    <>
      {/* ========================================================================= */}
      {/* TAB 4: ORDERS PULL & SIMULATOR */}
      {/* ========================================================================= */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div>
            <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s341', "سحب ومحاكاة الطلبات الخارجية وحماية المخزون (Stock Shield & Notifications)")}
            </h4>
            <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: '#64748b' }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s342', "عند ورود طلب من أمازون أو نون، يقوم النظام تلقائياً بخصم وحجز الكمية من المخزن المحلي لمنع بيعها محلياً، وإرسال تنبيه فوري بالواتساب.")}
            </p>
          </div>

          {simulatedOrderInfo ? (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '14px 18px', color: '#15803d', fontSize: '13.5px', fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>{simulatedOrderInfo}</div>
              <Button variant="secondary" onClick={() => setSimulatedOrderInfo(null)} style={{ fontSize: '11px', padding: '2px 8px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s343', "إغلاق")}
              </Button>
            </div>
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '18px', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <PackageIcon size={20} color="#170e5e" />
                <span style={{ fontWeight: 800, fontSize: '14.5px', color: '#0f172a' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s344', "اختبار سحب طلب من أمازون (Amazon Order Simulation)")}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s345', "محاكاة وصول طلب جديد من سوق أمازون؛ ينشئ طلباً إلكترونياً، ويحجز الصنف، ويخصم رصيد المخزن فورياً عبر ledger.")}
              </p>
              <div style={{ marginTop: 'auto', paddingTop: '10px' }}>
                <Button
                  variant="primary"
                  onClick={() => simulateOrderMutation.mutate('amazon')}
                  disabled={simulateOrderMutation.isPending}
                  style={{ background: '#170e5e', color: '#ffffff', width: '100%' }}
                >
                  {simulateOrderMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s346', "جاري المحاكاة والحجز...") : t('settings.workspace_sections.settings_marketplaces_section.s347', "اختبار سحب طلب أمازون")}
                </Button>
              </div>
            </div>

            <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '18px', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShoppingCartIcon size={20} color="#b45309" />
                <span style={{ fontWeight: 800, fontSize: '14.5px', color: '#0f172a' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s348', "اختبار سحب طلب من نون (Noon Order Simulation)")}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s349', "محاكاة استلام طلب من منصة نون ديركت؛ يسحب بيانات العميل، ويثبت الدفع المسبق، ويطلق إشعاراً لمالك المتجر على الواتساب.")}
              </p>
              <div style={{ marginTop: 'auto', paddingTop: '10px' }}>
                <Button
                  variant="primary"
                  onClick={() => simulateOrderMutation.mutate('noon')}
                  disabled={simulateOrderMutation.isPending}
                  style={{ background: '#170e5e', color: '#ffffff', width: '100%' }}
                >
                  {simulateOrderMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s350', "جاري المحاكاة والحجز...") : t('settings.workspace_sections.settings_marketplaces_section.s351', "اختبار سحب طلب نون")}
                </Button>
              </div>
            </div>
          </div>
        </div>
    </>
  );
};
