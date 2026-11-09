/* R4-C I52: sides/drinks are REAL catalog products, never hardcoded
 * names with invented EGP deltas. The old modal emitted modifiers
 * carrying only {name, price: delta} — no productId/optionId/qty/
 * costPrice — so the backend skipped their stock loop and costed them
 * at 0 while the revenue included the deltas. Now each side/drink is
 * a product from the products prop: the modifier carries its real
 * productId, its real retail price and qty 1 with isComboComponent,
 * so the existing stock loop and resolveSaleModifierCosts deduct stock
 * and cost them, and the I47 pre-pass verifies the price against the
 * products table. Combo price = main + side + drink (sum of
 * components; no combo-discount rule exists). State fully resets on
 * open and the main is preselected in an effect, never during render.
 * Open point: no product-type filter exists on the products prop, so
 * mains/sides/drinks are all picked from the same catalog; a real
 * combo-definition system exists elsewhere (ProductOfferComboCreatorTab,
 * ComboComponentsEditor) and whether this modal should consume it is a
 * follow-up. */
import { useTranslation } from 'react-i18next';
import { useState, useMemo, useEffect } from 'react';
import { RestaurantOperationsDialog } from './RestaurantOperationsDialog';
import { Button } from '@/shared/ui/button';
import { formatCurrency } from '@/lib/format';
import {
  LayersIcon,
  CheckCircleIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
  UtensilsIcon,
  SearchIcon,
} from '@/shared/components/icons/AppIcons';

export interface ComboModifier {
  productId: number;
  name: string;
  price: number;
  qty: number;
  isComboComponent: boolean;
}

interface PosComboMealModalProps {
  open: boolean;
  onClose: () => void;
  onBack?: () => void;
  products: any[];
  onAddComboToCart: (comboItem: {
    productId: number;
    productName: string;
    price: number;
    modifiers: ComboModifier[];
    notes?: string;
  }) => void;
}

function productPrice(p: any): number {
  return Number(p?.price || p?.retail_price || 0);
}

export function PosComboMealModal({
  open,
  onClose,
  onBack,
  products,
  onAddComboToCart,
}: PosComboMealModalProps) {
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [mainSearch, setMainSearch] = useState('');
  const [sideSearch, setSideSearch] = useState('');
  const [drinkSearch, setDrinkSearch] = useState('');

  // Step 1: Main Entree Selection
  const [selectedMain, setSelectedMain] = useState<any>(null);

  // Step 2: Side Item Selection — a real catalog product, or none.
  const [selectedSide, setSelectedSide] = useState<any>(null);

  // Step 3: Drink Selection — a real catalog product, or none.
  const [selectedDrink, setSelectedDrink] = useState<any>(null);

  const [comboNotes, setComboNotes] = useState('');

  // Full reset on open (and preselect the first main here, never
  // during render). A previous build must not leak into the next one.
  useEffect(() => {
    if (!open) return;
    setCurrentStep(1);
    setMainSearch('');
    setSideSearch('');
    setDrinkSearch('');
    setSelectedMain(products.length > 0 ? products[0] : null);
    setSelectedSide(null);
    setSelectedDrink(null);
    setComboNotes('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const filterProducts = (query: string) => {
    if (!products.length) return [];
    if (!query.trim()) return products.slice(0, 36);
    const q = query.toLowerCase().trim();
    return products.filter((p: any) => String(p?.name || '').toLowerCase().includes(q)).slice(0, 36);
  };

  // Available Main Entrees
  const mainEntrees = useMemo(() => filterProducts(mainSearch), [products, mainSearch]); // eslint-disable-line react-hooks/exhaustive-deps
  const sideOptions = useMemo(() => filterProducts(sideSearch), [products, sideSearch]); // eslint-disable-line react-hooks/exhaustive-deps
  const drinkOptions = useMemo(() => filterProducts(drinkSearch), [products, drinkSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const basePrice = productPrice(selectedMain);
  const totalComboPrice = basePrice + productPrice(selectedSide) + productPrice(selectedDrink);

  const handleConfirmCombo = () => {
    if (!selectedMain) return;

    const modifiers: ComboModifier[] = [];
    if (selectedSide) {
      modifiers.push({
        productId: Number(selectedSide.id),
        name: `طبق جانبي: ${selectedSide.name}`,
        price: productPrice(selectedSide),
        qty: 1,
        isComboComponent: true,
      });
    }
    if (selectedDrink) {
      modifiers.push({
        productId: Number(selectedDrink.id),
        name: `مشروب: ${selectedDrink.name}`,
        price: productPrice(selectedDrink),
        qty: 1,
        isComboComponent: true,
      });
    }

    onAddComboToCart({
      productId: selectedMain.id,
      productName: `وجبة كومبو (${selectedMain.name})`,
      price: basePrice,
      modifiers,
      notes: comboNotes.trim() || undefined,
    });

    onClose();
  };

  return (
    <RestaurantOperationsDialog
      open={open}
      onClose={onClose}
      onBack={onBack}
      title={t('pos.pos_workspace.pos_combo_meal_modal.s0', "معالج وجبات الكومبو السريعة (Combo Meal Builder)")}
      subtitle={t('pos.pos_workspace.pos_combo_meal_modal.s1', "بناء وجبة متكاملة خطوة بخطوة: الصنف الرئيسي ➔ الطبق الجانبي ➔ المشروب")}
      icon={<LayersIcon size={18} color="#170e5e" />}
      footerNote={t('pos.pos_workspace.pos_combo_meal_modal.s2', "تُجمع بنود الوجبة في صنف واحد موحد بالسلة مع تفاصيل المكونات والإضافات للطلب والمطبخ")}
      scrollableBody={false}
      bodyStyle={{
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        height: '100%',
        boxSizing: 'border-box',
      }}
      footerActions={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '10px' }}>
          <div>
            {currentStep > 1 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCurrentStep((s) => (s - 1) as any)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  height: '34px',
                  minHeight: '34px',
                  padding: '0 14px',
                  fontSize: '12px',
                }}
              >
                <ArrowRightIcon size={14} />
                <span>{t('pos.pos_workspace.pos_combo_meal_modal.s3', "الخطوة السابقة")}</span>
              </Button>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              style={{ height: '34px', minHeight: '34px', padding: '0 14px', fontSize: '12px' }}
            >
              {t('pos.pos_workspace.pos_combo_meal_modal.s4', "إلغاء")}
            </Button>
            {currentStep < 3 ? (
              <Button
                type="button"
                variant="primary"
                onClick={() => setCurrentStep((s) => (s + 1) as any)}
                disabled={!selectedMain}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  height: '34px',
                  minHeight: '34px',
                  padding: '0 18px',
                  fontSize: '12px',
                  fontWeight: 800,
                  backgroundColor: '#170e5e',
                }}
              >
                <span>{t('pos.pos_workspace.pos_combo_meal_modal.s5', "الخطوة التالية")}</span>
                <ArrowLeftIcon size={14} />
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                onClick={handleConfirmCombo}
                disabled={!selectedMain}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  height: '34px',
                  minHeight: '34px',
                  padding: '0 20px',
                  fontSize: '12px',
                  fontWeight: 800,
                  backgroundColor: '#16a34a',
                }}
              >
                <CheckCircleIcon size={14} color="#ffffff" />
                <span>{t('pos.pos_workspace.pos_combo_meal_modal.s6', "إضافة وجبة الكومبو بالسلة (")}{formatCurrency(totalComboPrice)})</span>
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', boxSizing: 'border-box' }}>
        {/* Step Progress Indicators */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', flexShrink: 0 }}>
          {[
            { step: 1, title: t('pos.pos_workspace.pos_combo_meal_modal.s7', "1. الصنف الرئيسي (البرجر/الساندوتش)"), desc: selectedMain ? selectedMain.name : t('pos.pos_workspace.pos_combo_meal_modal.s8', "اختر الصنف") },
            { step: 2, title: t('pos.pos_workspace.pos_combo_meal_modal.s9', "2. الصنف الجانبي (البطاطس والمقبلات)"), desc: selectedSide ? selectedSide.name : t('pos.pos_workspace.pos_combo_meal_modal.s22', "بدون طبق جانبي") },
            { step: 3, title: t('pos.pos_workspace.pos_combo_meal_modal.s10', "3. المشروب والملاحظات"), desc: selectedDrink ? selectedDrink.name : t('pos.pos_workspace.pos_combo_meal_modal.s23', "بدون مشروب") },
          ].map((s) => {
            const isActive = currentStep === s.step;
            const isCompleted = currentStep > s.step;
            return (
              <button
                key={s.step}
                type="button"
                onClick={() => setCurrentStep(s.step as any)}
                style={{
                  background: isActive ? '#170e5e' : isCompleted ? '#eef2ff' : '#f8fafc',
                  color: isActive ? '#ffffff' : isCompleted ? '#170e5e' : '#64748b',
                  border: isActive ? '1.5px solid #170e5e' : isCompleted ? '1px solid #c7d2fe' : '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '8px 12px',
                  fontSize: '12px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  textAlign: 'right',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  transition: 'all 0.15s ease',
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{s.title}</span>
                  {isCompleted && <CheckCircleIcon size={13} color="#170e5e" />}
                </div>
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 500,
                    color: isActive ? '#cbd5e1' : '#64748b',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {s.desc}
                </span>
              </button>
            );
          })}
        </div>

        {/* STEP 1: MAIN ENTREE */}
        {currentStep === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
              <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>
                {t('pos.pos_workspace.pos_combo_meal_modal.s11', "اختر الصنف الرئيسي للوجبة (")}{mainEntrees.length} {t('pos.pos_workspace.pos_combo_meal_modal.s12', "صنف متاح):")}
              </div>
              <div style={{ position: 'relative', width: '220px' }}>
                <input
                  type="text"
                  placeholder={t('pos.pos_workspace.pos_combo_meal_modal.s13', "بحث في الأصناف...")}
                  value={mainSearch}
                  onChange={(e) => setMainSearch(e.target.value)}
                  style={{
                    width: '100%',
                    height: '30px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    padding: '0 26px 0 8px',
                    fontSize: '11.5px',
                    boxSizing: 'border-box',
                  }}
                />
                <SearchIcon size={13} color="#94a3b8" style={{ position: 'absolute', right: '8px', top: '9px' }} />
              </div>
            </div>

            <div
              className="thin-scrollbar"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: '8px',
                maxHeight: '235px',
                height: '235px',
                overflowY: 'auto',
                padding: '2px',
                boxSizing: 'border-box',
              }}
            >
              {mainEntrees.map((prod) => {
                const isSelected = selectedMain?.id === prod.id;
                return (
                  <button
                    key={prod.id}
                    type="button"
                    onClick={() => setSelectedMain(prod)}
                    style={{
                      background: isSelected ? '#eef2ff' : '#ffffff',
                      border: isSelected ? '2px solid #170e5e' : '1px solid #e2e8f0',
                      borderRadius: '10px',
                      padding: '10px 12px',
                      textAlign: 'right',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      minHeight: '70px',
                      boxSizing: 'border-box',
                      transition: 'all 0.15s ease',
                      boxShadow: isSelected ? '0 2px 8px rgba(23, 14, 94, 0.08)' : '0 1px 2px rgba(0, 0, 0, 0.02)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {prod.name}
                      </span>
                      {isSelected && <CheckCircleIcon size={14} color="#170e5e" />}
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 900, color: '#170e5e', marginTop: '4px' }}>
                      {formatCurrency(productPrice(prod))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 2: SIDE DISH — real catalog products */}
        {currentStep === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
              <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>
                {t('pos.pos_workspace.pos_combo_meal_modal.s14', "اختر الصنف الجانبي (بطاطس ومقبلات):")}
              </div>
              <div style={{ position: 'relative', width: '220px' }}>
                <input
                  type="text"
                  placeholder={t('pos.pos_workspace.pos_combo_meal_modal.s13', "بحث في الأصناف...")}
                  value={sideSearch}
                  onChange={(e) => setSideSearch(e.target.value)}
                  style={{
                    width: '100%',
                    height: '30px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    padding: '0 26px 0 8px',
                    fontSize: '11.5px',
                    boxSizing: 'border-box',
                  }}
                />
                <SearchIcon size={13} color="#94a3b8" style={{ position: 'absolute', right: '8px', top: '9px' }} />
              </div>
            </div>
            <div
              className="thin-scrollbar"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
                gap: '10px',
                maxHeight: '235px',
                height: '235px',
                overflowY: 'auto',
                padding: '2px',
                boxSizing: 'border-box',
              }}
            >
              {sideOptions.map((prod) => {
                const isSelected = selectedSide?.id === prod.id;
                return (
                  <button
                    key={prod.id}
                    type="button"
                    onClick={() => setSelectedSide(prod)}
                    style={{
                      background: isSelected ? '#eef2ff' : '#ffffff',
                      border: isSelected ? '2px solid #170e5e' : '1px solid #e2e8f0',
                      borderRadius: '10px',
                      padding: '12px 14px',
                      textAlign: 'right',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      minHeight: '75px',
                      boxSizing: 'border-box',
                      transition: 'all 0.15s ease',
                      boxShadow: isSelected ? '0 2px 8px rgba(23, 14, 94, 0.08)' : '0 1px 2px rgba(0, 0, 0, 0.02)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                      <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>{prod.name}</span>
                      {isSelected && <CheckCircleIcon size={14} color="#170e5e" />}
                    </div>
                    <div style={{ fontSize: '12px', fontWeight: 800, color: '#15803d', marginTop: '4px' }}>
                      {formatCurrency(productPrice(prod))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 3: DRINK & NOTES — real catalog products */}
        {currentStep === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
              <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>
                {t('pos.pos_workspace.pos_combo_meal_modal.s16', "اختر المشروب المنعش وتفضيلات التحضير:")}
              </div>
              <div style={{ position: 'relative', width: '220px' }}>
                <input
                  type="text"
                  placeholder={t('pos.pos_workspace.pos_combo_meal_modal.s13', "بحث في الأصناف...")}
                  value={drinkSearch}
                  onChange={(e) => setDrinkSearch(e.target.value)}
                  style={{
                    width: '100%',
                    height: '30px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    padding: '0 26px 0 8px',
                    fontSize: '11.5px',
                    boxSizing: 'border-box',
                  }}
                />
                <SearchIcon size={13} color="#94a3b8" style={{ position: 'absolute', right: '8px', top: '9px' }} />
              </div>
            </div>
            <div
              className="thin-scrollbar"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
                gap: '8px',
                maxHeight: '170px',
                height: '170px',
                overflowY: 'auto',
                padding: '2px',
                boxSizing: 'border-box',
              }}
            >
              {drinkOptions.map((prod) => {
                const isSelected = selectedDrink?.id === prod.id;
                return (
                  <button
                    key={prod.id}
                    type="button"
                    onClick={() => setSelectedDrink(prod)}
                    style={{
                      background: isSelected ? '#eef2ff' : '#ffffff',
                      border: isSelected ? '2px solid #170e5e' : '1px solid #e2e8f0',
                      borderRadius: '10px',
                      padding: '10px 12px',
                      textAlign: 'right',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      minHeight: '65px',
                      boxSizing: 'border-box',
                      transition: 'all 0.15s ease',
                      boxShadow: isSelected ? '0 2px 8px rgba(23, 14, 94, 0.08)' : '0 1px 2px rgba(0, 0, 0, 0.02)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>{prod.name}</span>
                      {isSelected && <CheckCircleIcon size={14} color="#170e5e" />}
                    </div>
                    <div style={{ fontSize: '11.5px', fontWeight: 800, color: '#15803d', marginTop: '3px' }}>
                      {formatCurrency(productPrice(prod))}
                    </div>
                  </button>
                );
              })}
            </div>

            <div style={{ marginTop: '2px' }}>
              <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
                {t('pos.pos_workspace.pos_combo_meal_modal.s18', "ملاحظات وتخصيص الوجبة للمطبخ (اختياري):")}
              </label>
              <input
                type="text"
                placeholder={t('pos.pos_workspace.pos_combo_meal_modal.s19', "مثال: بدون بصل / صوص باربيكيو جانبي / بدون ثلج في المشروب")}
                value={comboNotes}
                onChange={(e) => setComboNotes(e.target.value)}
                style={{
                  width: '100%',
                  height: '32px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  padding: '0 10px',
                  fontSize: '12px',
                  boxSizing: 'border-box',
                  background: '#ffffff',
                }}
              />
            </div>
          </div>
        )}

        {/* Live Summary Card */}
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <UtensilsIcon size={16} color="#170e5e" />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '10.5px', color: '#64748b', fontWeight: 600 }}>{t('pos.pos_workspace.pos_combo_meal_modal.s20', "مكونات الوجبة المختارة:")}</div>
              <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {selectedMain?.name || '—'} + {selectedSide?.name || t('pos.pos_workspace.pos_combo_meal_modal.s22', "بدون طبق جانبي")} + {selectedDrink?.name || t('pos.pos_workspace.pos_combo_meal_modal.s23', "بدون مشروب")}
              </div>
            </div>
          </div>

          <div style={{ textAlign: 'left', flexShrink: 0 }}>
            <div style={{ fontSize: '10.5px', color: '#64748b', fontWeight: 600 }}>{t('pos.pos_workspace.pos_combo_meal_modal.s21', "إجمالي سعر الوجبة:")}</div>
            <div style={{ fontSize: '17px', fontWeight: 900, color: '#170e5e' }}>
              {formatCurrency(totalComboPrice)}
            </div>
          </div>
        </div>
      </div>
    </RestaurantOperationsDialog>
  );
}
