import { useTranslation } from 'react-i18next';
import { useState, useEffect, useRef, useMemo } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { contractingApi } from '../api/contracting.api';
import { MasterBoqItem, MasterBoqTrade, ContractingBoqItem } from '../contracting.types';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { AppIcons } from '@/shared/components/icons/AppIcons';

export const UNIT_OPTIONS = [
  { value: 'm2', label: 'متر مسطح (m²)' },
  { value: 'm3', label: 'متر مكعب (m³)' },
  { value: 'm', label: 'متر طولي (m)' },
  { value: 'point', label: 'نقطة (point)' },
  { value: 'set', label: 'طقم / لوحة (set)' },
  { value: 'item', label: 'عدد (item)' },
  { value: 'ton', label: 'طن (ton)' },
  { value: 'kg', label: 'كيلوجرام (kg)' },
  { value: 'ls', label: 'مقطوعية (ls)' },
];

const EMPTY_ITEMS: any[] = [];

/**
 * دالة تنظيف وتوحيد المدخلات الرقمية:
 * تحوّل الأرقام العربية الشرقية (٠-٩) والفارسية تلقائياً إلى أرقام قياسية (0-9)
 * وتسمح فقط بالأرقام وعلامة عشرية واحدة، وتدعم الفاصلة العربية (،) كنقطة عشرية.
 */
export function cleanNumberInput(val: string): string {
  if (!val) return '';
  const normalized = val
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[،,]/g, '.');
  const cleaned = normalized.replace(/[^0-9.]/g, '');
  const parts = cleaned.split('.');
  if (parts.length > 2) {
    return parts[0] + '.' + parts.slice(1).join('');
  }
  return cleaned;
}

export const TRADE_PREFIXES: Record<string, string> = {
  civil_concrete: 'CIV',
  masonry_insulation: 'MAS',
  finishing_decor: 'FIN',
  finishes: 'FIN',
  doors_windows_aluminum: 'ALU',
  doors_windows_facades: 'ALU',
  steel_structure: 'STL',
  steel_structures: 'STL',
  electrical_lighting: 'ELE',
  electrical: 'ELE',
  smart_elv_systems: 'ELV',
  smart_systems_elv: 'ELV',
  plumbing_sanitary: 'SAN',
  plumbing: 'SAN',
  hvac_mechanical: 'HVAC',
  hvac_firefighting: 'HVAC',
  fire_fighting: 'FF',
  fire_fighting_mep: 'FF',
  site_infrastructure: 'INF',
  site_mobilization: 'MOB',
  site_landscape: 'LAN',
  landscape_infrastructure: 'INF',
};

export const DEFAULT_TRADE_MARGINS: Record<string, number> = {
  civil_concrete: 25,
  masonry_insulation: 30,
  finishing_decor: 30,
  finishes: 30,
  doors_windows_aluminum: 30,
  doors_windows_facades: 30,
  steel_structure: 25,
  steel_structures: 25,
  electrical_lighting: 33,
  electrical: 33,
  smart_elv_systems: 32,
  smart_systems_elv: 32,
  plumbing_sanitary: 30,
  plumbing: 30,
  hvac_mechanical: 30,
  hvac_firefighting: 30,
  fire_fighting: 32,
  fire_fighting_mep: 32,
  site_infrastructure: 28,
  site_mobilization: 25,
  site_landscape: 30,
  landscape_infrastructure: 30,
};

export const TRADE_LABELS: Record<string, string> = {
  civil_concrete: 'الأعمال المدنية والخرسانات',
  masonry_insulation: 'المباني والعزل والفواصل',
  finishing_decor: 'التشطيبات المعمارية والديكور',
  doors_windows_aluminum: 'الأبواب والشبابيك والواجهات',
  steel_structure: 'المنشآت المعدنية والجمالونات',
  electrical_lighting: 'الأعمال الكهربائية والإنارة',
  smart_elv_systems: 'التيار الخفيف والأنظمة الذكية (ELV)',
  plumbing_sanitary: 'الأعمال الصحية وتغذية وصرف المياه',
  hvac_mechanical: 'التكييف والتهوية الميكانيكية',
  fire_fighting: 'شبكات مكافحة وإطفاء الحريق',
  site_infrastructure: 'تجهيزات الموقع والبنية التحتية واللاندسكيب',
  // Aliases for compatibility
  finishes: 'أعمال التشطيبات والديكور',
  doors_windows_facades: 'الأبواب والشبابيك والواجهات',
  steel_structures: 'المنشآت المعدنية والجمالونات',
  electrical: 'الأعمال الكهربائية والإنارة',
  smart_systems_elv: 'التيار الخفيف والأنظمة الذكية (ELV)',
  plumbing: 'الأعمال الصحية وتغذية وصرف المياه',
  hvac_firefighting: 'التكييف والتهوية الميكانيكية',
  site_mobilization: 'تجهيزات الموقع والأعمال التمهيدية',
  site_landscape: 'الموقع العام واللاندسكيب',
  landscape_infrastructure: 'تجهيزات الموقع والبنية التحتية واللاندسكيب',
  earthworks: 'أعمال الحفر والردم',
  concrete: 'الخرسانات المسلحة',
  masonry: 'أعمال المباني',
  mep: 'الكهروميكانيك',
  other: 'أعمال عامة',
};

// INV-FE3-FRONTEND-BOOK-DIGITS: the selling price is money, so it rounds
// at the tenant's book digits — passed in as a REQUIRED third param (no
// silent 2dp default, U4 W2 lesson). Every caller passes the component's
// bookDigits; CreateMasterBoqItemModal only re-exports this function and
// makes no calls, so no other call site exists (repo-wide grep verified).
export function calculatePriceFromMargin(costNum: number, marginPercent: number, bookDigits: number): number {
  if (costNum <= 0) return 0;
  if (marginPercent <= 0) return roundMoneyValue(costNum, bookDigits);
  if (marginPercent >= 99) return roundMoneyValue(costNum * 100, bookDigits);
  return roundMoneyValue(costNum / (1 - marginPercent / 100), bookDigits);
}

export function calculateMarginFromPrice(costNum: number, priceNum: number): number {
  if (priceNum <= 0 || costNum <= 0) return 0;
  return Math.round(((priceNum - costNum) / priceNum) * 100);
}

export function getNextItemCode(tradeCategory: string, existingItems: any[] = []): string {
  const prefix = TRADE_PREFIXES[tradeCategory] || tradeCategory.slice(0, 3).toUpperCase();
  
  const tradeItems = existingItems.filter(
    (item) => (item.tradeCategory === tradeCategory || item.category === tradeCategory || (item.itemCode && item.itemCode.toUpperCase().startsWith(prefix)))
  );

  let maxNum = 0;
  for (const it of tradeItems) {
    const code = it.itemCode || it.item_code || '';
    const match = code.match(/-(\d+)$/);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }

  const nextNum = maxNum + 1;
  return `${prefix}-${String(nextNum).padStart(3, '0')}`;
}

export interface UniversalBoqItemModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  onCreated?: () => void;
  mode?: 'master' | 'project';
  projectId?: string;
  projectName?: string;
  initialItem?: MasterBoqItem | ContractingBoqItem | any | null;
  trades?: MasterBoqTrade[];
  existingItems?: any[];
  initialTradeCategory?: string;
}

export function UniversalBoqItemModal({
  open,
  onClose,
  onSaved,
  onCreated,
  mode = 'master',
  projectId,
  projectName,
  initialItem,
  trades: passedTrades,
  existingItems = EMPTY_ITEMS,
  initialTradeCategory,
}: UniversalBoqItemModalProps) {
  const { t: __t } = useTranslation();
  const { currencySymbol, currencyCode } = useSystemCurrency();
  const bookDigits = currencyMoneyDigits(currencyCode);
  const [internalTrades, setInternalTrades] = useState<MasterBoqTrade[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const trades = passedTrades && passedTrades.length > 0 ? passedTrades : internalTrades;
  const hasInitializedRef = useRef(false);

  // Load trades if not passed
  useEffect(() => {
    if (!open) return;
    if (!passedTrades || passedTrades.length === 0) {
      contractingApi.getMasterBoqTrades()
        .then((data) => setInternalTrades(data || []))
        .catch(() => { /* fallback */ });
    }
  }, [open, passedTrades]);

  // Form State
  const [formData, setFormData] = useState({
    tradeCategory: 'civil_concrete',
    itemCode: '',
    name: '',
    description: '',
    unit: 'm2',
    contractQty: '',
    standardCost: '',
    standardPrice: '',
    notes: '',
  });

  const [marginPercent, setMarginPercent] = useState<string>('30');

  useEffect(() => {
    if (!open) {
      hasInitializedRef.current = false;
      return;
    }

    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    if (initialItem) {
      const cat = initialItem.tradeCategory || initialItem.category || 'civil_concrete';
      const code = initialItem.itemCode || initialItem.item_code || '';
      const name = initialItem.name || initialItem.description || '';
      const desc = initialItem.description || '';
      const unit = initialItem.unit || 'm2';
      const cost = Number(initialItem.standardCost ?? initialItem.estimatedUnitCost ?? 0);
      const price = Number(initialItem.standardPrice ?? initialItem.unitPrice ?? 0);
      const rawQty = initialItem.contractQty ?? initialItem.revisedQty ?? 0;
      const qtyNum = Number(rawQty);
      // إذا كانت الكمية صفرية أو غير محددة، نترك الخانة فارغة لتمكين المستخدم من الكتابة فوراً بدون الحاجة لمسح الصفر
      const qty = qtyNum > 0 ? String(qtyNum) : '';
      const notes = initialItem.notes || '';

      const computedMargin = price > 0 && cost > 0
        ? calculateMarginFromPrice(cost, price)
        : (DEFAULT_TRADE_MARGINS[cat] ?? 30);

      setFormData({
        tradeCategory: cat,
        itemCode: code,
        name,
        description: desc,
        unit,
        contractQty: qty,
        standardCost: cost > 0 ? String(cost) : '',
        standardPrice: price > 0 ? String(price) : '',
        notes,
      });
      setMarginPercent(String(computedMargin));
    } else {
      const initialCat = initialTradeCategory || (trades[0]?.tradeCategory || 'civil_concrete');
      const autoCode = getNextItemCode(initialCat, existingItems);
      const defaultMargin = DEFAULT_TRADE_MARGINS[initialCat] ?? 30;

      setFormData({
        tradeCategory: initialCat,
        itemCode: autoCode,
        name: '',
        description: '',
        unit: 'm2',
        contractQty: '',
        standardCost: '',
        standardPrice: '',
        notes: '',
      });
      setMarginPercent(String(defaultMargin));
    }
    setErrorMsg(null);
  }, [open, initialItem]);

  const handleTradeCategoryChange = (newCat: string) => {
    const nextCode = !initialItem ? getNextItemCode(newCat, existingItems) : formData.itemCode;
    const suggestedMargin = DEFAULT_TRADE_MARGINS[newCat] ?? 30;

    if (!initialItem) {
      setMarginPercent(String(suggestedMargin));
      const costNum = Number(formData.standardCost);
      let newPrice = formData.standardPrice;
      if (!isNaN(costNum) && costNum > 0) {
        newPrice = String(calculatePriceFromMargin(costNum, suggestedMargin, bookDigits));
      }
      setFormData((prev) => ({
        ...prev,
        tradeCategory: newCat,
        itemCode: nextCode,
        standardPrice: newPrice,
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        tradeCategory: newCat,
        itemCode: nextCode,
      }));
    }
  };

  const handleCostChange = (val: string) => {
    const cleaned = cleanNumberInput(val);
    const costNum = Number(cleaned);
    const marginNum = Number(marginPercent);
    let newPrice = formData.standardPrice;

    if (!isNaN(costNum) && costNum > 0 && !isNaN(marginNum) && marginNum >= 0 && marginNum < 100) {
      newPrice = String(calculatePriceFromMargin(costNum, marginNum, bookDigits));
    } else if (!cleaned || costNum === 0) {
      newPrice = '';
    }

    setFormData((prev) => ({
      ...prev,
      standardCost: cleaned,
      standardPrice: newPrice,
    }));
  };

  const handleMarginChange = (val: string) => {
    const cleaned = cleanNumberInput(val);
    setMarginPercent(cleaned);
    const marginNum = Number(cleaned);
    const costNum = Number(formData.standardCost);

    if (!isNaN(costNum) && costNum > 0 && !isNaN(marginNum) && marginNum >= 0 && marginNum < 100) {
      const calculated = calculatePriceFromMargin(costNum, marginNum, bookDigits);
      setFormData((prev) => ({
        ...prev,
        standardPrice: String(calculated),
      }));
    }
  };

  const handlePriceChange = (val: string) => {
    const cleaned = cleanNumberInput(val);
    const priceNum = Number(cleaned);
    const costNum = Number(formData.standardCost);

    if (!isNaN(costNum) && costNum > 0 && !isNaN(priceNum) && priceNum > 0) {
      const computedMargin = calculateMarginFromPrice(costNum, priceNum);
      setMarginPercent(String(computedMargin));
    }

    setFormData((prev) => ({
      ...prev,
      standardPrice: cleaned,
    }));
  };

  const cost = Number(formData.standardCost || 0);
  const price = Number(formData.standardPrice || 0);
  const contractQty = Number(formData.contractQty || 0);
  const totalContractVal = contractQty * price;
  const totalCostVal = contractQty * cost;
  const totalProfitVal = totalContractVal - totalCostVal;
  const effectiveMargin = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;
  const currentSuggestedMargin = DEFAULT_TRADE_MARGINS[formData.tradeCategory] ?? 30;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!formData.itemCode.trim() || !formData.name.trim()) {
      setErrorMsg('كود البند ومسمى البند مطلوبان');
      return;
    }
    if (mode === 'project' && contractQty <= 0) {
      setErrorMsg('يرجى تحديد كمية تعاقدية صالحة أكبر من الصفر');
      return;
    }
    if (price <= 0) {
      setErrorMsg('يرجى إدخال سعر فئة / بيع صالح أكبر من الصفر');
      return;
    }

    const tradeObj = trades.find((t) => t.tradeCategory === formData.tradeCategory);
    const tradeNameAr = tradeObj ? tradeObj.tradeNameAr : (TRADE_LABELS[formData.tradeCategory] || formData.tradeCategory);

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      if (mode === 'project') {
        if (!projectId) {
          throw new Error('معرف المشروع غير محدد');
        }
        if (initialItem) {
          await contractingApi.updateBoqItem(initialItem.id, {
            description: formData.name.trim() + (formData.description.trim() ? ` - ${formData.description.trim()}` : ''),
            category: formData.tradeCategory,
            unit: formData.unit.trim(),
            contractQty,
            unitPrice: price,
            estimatedUnitCost: cost,
            notes: formData.notes.trim() || undefined,
          });
        } else {
          await contractingApi.createBoqItem(projectId, {
            itemCode: formData.itemCode.trim(),
            description: formData.name.trim() + (formData.description.trim() ? ` - ${formData.description.trim()}` : ''),
            category: formData.tradeCategory,
            unit: formData.unit.trim(),
            contractQty,
            unitPrice: price,
            estimatedUnitCost: cost,
            notes: formData.notes.trim() || undefined,
          });
        }
      } else {
        // Master BOQ mode
        if (initialItem) {
          await contractingApi.updateMasterBoqItem(initialItem.id, {
            tradeCategory: formData.tradeCategory,
            tradeNameAr,
            name: formData.name.trim(),
            description: formData.description.trim() || formData.name.trim(),
            unit: formData.unit.trim(),
            standardCost: cost,
            standardPrice: price,
          });
        } else {
          await contractingApi.createMasterBoqItem({
            tradeCategory: formData.tradeCategory,
            tradeNameAr,
            itemCode: formData.itemCode.trim(),
            name: formData.name.trim(),
            description: formData.description.trim() || formData.name.trim(),
            unit: formData.unit.trim(),
            standardCost: cost,
            standardPrice: price,
          });
        }
      }

      onSaved?.();
      onCreated?.();
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'فشل في حفظ بند المقايسة');
    } finally {
      setIsSubmitting(false);
    }
  };

  const dialogTitle = mode === 'project'
    ? (initialItem ? 'تعديل بند في مقايسة المشروع' : 'إضافة بند جديد لجدول الكميات والمقايسة (BOQ)')
    : (initialItem ? 'تعديل بند مرجعي' : 'إضافة بند مرجعي جديد لبنك البنود');

  const dialogSubtitle = mode === 'project'
    ? (projectName ? `المشروع: ${projectName}` : 'تحديد مواصفات البند والكميات التعاقدية وسعر الفئة والتكلفة التقديرية')
    : 'حفظ البند في مكتبة البنود العامة لشركتك لاستيراده بضغطة زر في أي مشروع قادم';

  const tradeOptions = useMemo(() => {
    if (trades.length > 0) {
      const seen = new Set<string>();
      const opts: { value: string; label: string }[] = [];
      for (const t of trades) {
        if (!seen.has(t.tradeCategory)) {
          seen.add(t.tradeCategory);
          opts.push({
            value: t.tradeCategory,
            label: t.tradeNameAr,
          });
        }
      }
      return opts;
    }
    const standardKeys = [
      'site_mobilization',
      'civil_concrete',
      'masonry_insulation',
      'steel_structure',
      'finishing_decor',
      'doors_windows_aluminum',
      'electrical_lighting',
      'smart_elv_systems',
      'plumbing_sanitary',
      'hvac_mechanical',
      'fire_fighting',
      'site_infrastructure',
    ];
    return standardKeys.map((key) => ({
      value: key,
      label: TRADE_LABELS[key] || key,
    }));
  }, [trades]);

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={dialogTitle}
      subtitle={dialogSubtitle}
      width="min(940px, 96vw)"
      minHeight="auto"
      footer={
        <StandardDialogFooter
          onCancel={onClose}
          onSubmit={handleSubmit}
          submitText={initialItem ? __t('contracting.universal_boq_item_modal.s0', "حفظ التعديلات") : mode === 'project' ? __t('contracting.universal_boq_item_modal.s1', "إضافة البند للمقايسة") : __t('contracting.universal_boq_item_modal.s2', "إضافة إلى بنك البنود")}
          isSubmitting={isSubmitting}
        />
      }
    >
      <style>{`
        .boq-premium-modal .field {
          margin-bottom: 0 !important;
          gap: 3px !important;
        }
        .boq-premium-modal .field span {
          font-size: 0.74rem !important;
          font-weight: 600 !important;
          color: #334155 !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
        }
        .boq-premium-modal input,
        .boq-premium-modal textarea {
          height: 33px !important;
          font-size: 0.8125rem !important;
          border-radius: 6px !important;
          padding: 0 10px !important;
          border: 1px solid #cbd5e1 !important;
          background: #ffffff !important;
          box-sizing: border-box !important;
          outline: none !important;
          width: 100% !important;
          transition: border-color 0.15s, box-shadow 0.15s !important;
        }
        .boq-premium-modal textarea {
          height: auto !important;
          min-height: 48px !important;
          padding: 6px 10px !important;
          resize: vertical !important;
          line-height: 1.4 !important;
          font-family: inherit !important;
        }
        .boq-premium-modal input:focus,
        .boq-premium-modal textarea:focus {
          border-color: #170e5e !important;
          box-shadow: 0 0 0 2px rgba(23, 14, 94, 0.1) !important;
        }
        .boq-premium-modal .custom-select-trigger {
          min-height: 33px !important;
          height: 33px !important;
          font-size: 0.8125rem !important;
          border-radius: 6px !important;
          border: 1px solid #cbd5e1 !important;
          padding: 0 10px !important;
        }
      `}</style>
      <form onSubmit={handleSubmit} className="boq-premium-modal" style={{ display: 'flex', flexDirection: 'column', gap: '9px' }} dir="rtl">
        {errorMsg && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              background: '#fef2f2',
              color: '#b91c1c',
              border: '1px solid #fecaca',
              fontSize: '0.8rem',
              fontWeight: 600,
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* 1. التخصص الإنشائي وكود البند */}
        <div style={{ background: '#f8fafc', padding: '9px 13px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
            <AppIcons.Layers size={15} />
            <span>{__t('contracting.universal_boq_item_modal.s3', "1. التخصص الإنشائي وكود البند (Trade & Item Coding)")}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '10px', alignItems: 'start' }}>
            <Field label={__t('contracting.universal_boq_item_modal.s4', "التخصص الإنشائي / التصنيف *")}>
              <CustomSelect
                value={formData.tradeCategory}
                options={tradeOptions}
                onChange={(val) => handleTradeCategoryChange(val)}
              />
            </Field>

            <Field label={!initialItem ? __t('contracting.universal_boq_item_modal.s5', "كود البند (توليد تلقائي)") : __t('contracting.universal_boq_item_modal.s6', "كود البند")}>
              <input
                type="text"
                value={formData.itemCode}
                disabled={Boolean(initialItem)}
                onChange={(e) => setFormData({ ...formData, itemCode: e.target.value.toUpperCase() })}
                placeholder={__t('contracting.universal_boq_item_modal.s7', "مثال: MAS-007")}
                dir="ltr"
                style={{
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  color: '#170e5e',
                  background: initialItem ? '#f8fafc' : '#f0f9ff',
                }}
              />
            </Field>
          </div>
        </div>

        {/* 2. توصيف ومواصفات البند والكمية */}
        <div style={{ background: '#f8fafc', padding: '9px 13px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
            <AppIcons.FileText size={15} />
            <span>{__t('contracting.universal_boq_item_modal.s8', "2. توصيف الأعمال والمواصفة التعاقدية (Scope & Technical Specs)")}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: mode === 'project' ? '2.2fr 1fr 1fr' : '2.5fr 1fr', gap: '10px', alignItems: 'start' }}>
              <Field label={__t('contracting.universal_boq_item_modal.s9', "مسمى البند والمواصفة الفنية التعاقدية *")}>
                <input
                  dir="auto"
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={__t('contracting.universal_boq_item_modal.s10', "مثال: مباني من الطوب الأسمنتي المصمت سمك 25 سم لقصية الردم")}
                />
              </Field>

              <Field label={__t('contracting.universal_boq_item_modal.s11', "وحدة القياس *")}>
                <CustomSelect
                  value={formData.unit}
                  options={UNIT_OPTIONS}
                  onChange={(val) => setFormData({ ...formData, unit: val })}
                />
              </Field>

              {mode === 'project' && (
                <Field label={__t('contracting.universal_boq_item_modal.s12', "الكمية التعاقدية *")}>
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    dir="ltr"
                    autoFocus={Boolean(initialItem && (!initialItem.contractQty || Number(initialItem.contractQty) === 0))}
                    value={formData.contractQty}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const cleaned = cleanNumberInput(e.target.value);
                      setFormData((prev) => ({ ...prev, contractQty: cleaned }));
                    }}
                    placeholder="0.00"
                    style={{
                      fontWeight: 700,
                      color: '#0f172a',
                    }}
                  />
                </Field>
              )}
            </div>

            <Field label={__t('contracting.universal_boq_item_modal.s13', "بيان الأعمال والشروط والمواصفات المعتمدة (اختياري)")}>
              <textarea
                dir="auto"
                rows={2}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder={__t('contracting.universal_boq_item_modal.s14', "بيان تفصيلي بالأعمال والاشتراطات والمواد المستعملة وطريقة التنفيذ والاختبار...")}
              />
            </Field>
          </div>
        </div>

        {/* 3. كارت التسعير وهامش الربح الذكي */}
        <div style={{ background: '#f0fdf4', padding: '10px 14px', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#15803d', fontWeight: 700, fontSize: '0.84rem' }}>
              <AppIcons.Calculator size={15} />
              <span>{__t('contracting.universal_boq_item_modal.s15', "3. التسعير وهامش الربح للوحدة (Pricing & Margin Engine)")}</span>
            </div>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: '#15803d',
                background: '#dcfce7',
                padding: '2px 8px',
                borderRadius: '6px',
                border: '1px solid #86efac',
              }}
            >
              {__t('contracting.universal_boq_item_modal.s16', "احتساب فوري ديناميكي")}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.15fr', gap: '10px', alignItems: 'start' }}>
            <Field label={`التكلفة التقديرية للوحدة (${currencySymbol})`}>
              <input
                type="text"
                inputMode="decimal"
                dir="ltr"
                value={formData.standardCost}
                onFocus={(e) => e.target.select()}
                onChange={(e) => handleCostChange(e.target.value)}
                placeholder="0.00"
                style={{ fontWeight: 600 }}
              />
            </Field>

            <Field label={`هامش الربح (%) [المقترح: ${currentSuggestedMargin}%]`}>
              <input
                type="text"
                inputMode="decimal"
                dir="ltr"
                value={marginPercent}
                onFocus={(e) => e.target.select()}
                onChange={(e) => handleMarginChange(e.target.value)}
                placeholder={String(currentSuggestedMargin)}
                style={{
                  fontWeight: 700,
                  color: '#0f172a',
                }}
              />
            </Field>

            <Field label={mode === 'project' ? `سعر الفئة للعميل (${currencySymbol}) *` : `سعر البيع المقترح (${currencySymbol}) *`}>
              <input
                type="text"
                inputMode="decimal"
                dir="ltr"
                value={formData.standardPrice}
                onFocus={(e) => e.target.select()}
                onChange={(e) => handlePriceChange(e.target.value)}
                placeholder="0.00"
                style={{
                  fontWeight: 800,
                  color: '#170e5e',
                  border: '2px solid #170e5e',
                  background: '#ffffff',
                }}
              />
            </Field>
          </div>

          {/* شريط المؤشرات المالية اللحظية */}
          {price > 0 && cost > 0 && (
            <div
              style={{
                marginTop: '8px',
                padding: '7px 12px',
                borderRadius: '6px',
                background: '#ffffff',
                border: '1px solid #dcfce7',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                fontSize: '0.74rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                <span style={{ color: '#475569' }}>
                  {__t('contracting.universal_boq_item_modal.s17', "صافي ربح الوحدة:")} <strong style={{ color: '#170e5e', fontSize: '0.82rem' }}>{(price - cost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> {currencySymbol} / {formData.unit}
                </span>
                <span
                  style={{
                    fontWeight: 700,
                    color: effectiveMargin >= 25 ? '#15803d' : effectiveMargin > 0 ? '#b45309' : '#b91c1c',
                    background: effectiveMargin >= 25 ? '#dcfce7' : effectiveMargin > 0 ? '#fef3c7' : '#fee2e2',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '0.72rem',
                  }}
                >
                  {__t('contracting.universal_boq_item_modal.s18', "الهامش الفعلي:")} {effectiveMargin}%
                </span>
              </div>

              {mode === 'project' && contractQty > 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderTop: '1px dashed #dcfce7',
                    paddingTop: '4px',
                    marginTop: '2px',
                    flexWrap: 'wrap',
                    gap: '6px',
                  }}
                >
                  <span style={{ color: '#475569' }}>
                    {__t('contracting.universal_boq_item_modal.s19', "إجمالي قيمة البند للمشروع:")} <strong style={{ color: '#170e5e', fontSize: '0.82rem' }}>{totalContractVal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong> {currencySymbol}
                  </span>
                  <span style={{ color: '#059669', fontWeight: 700, fontSize: '0.82rem' }}>
                    {__t('contracting.universal_boq_item_modal.s20', "إجمالي أرباح البند: +")}{totalProfitVal.toLocaleString('en-US', { minimumFractionDigits: 2 })} {currencySymbol}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 4. ملاحظات واشتراطات خاصة */}
        {mode === 'project' && (
          <div style={{ background: '#f8fafc', padding: '9px 13px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
              <AppIcons.Tag size={14} />
              <span>{__t('contracting.universal_boq_item_modal.s21', "4. الملاحظات والاشتراطات الخاصة (Terms & Notes)")}</span>
            </div>
            <Field label={__t('contracting.universal_boq_item_modal.s22', "ملاحظات وشروط إضافية (اختياري)")}>
              <input
                type="text"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder={__t('contracting.universal_boq_item_modal.s23', "أي اشتراطات خاصة بالاستلام أو الدفعات...")}
              />
            </Field>
          </div>
        )}
      </form>
    </StandardDialog>
  );
}
