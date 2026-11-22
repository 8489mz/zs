import { useTranslation } from 'react-i18next';
import React, { type Dispatch, type SetStateAction } from 'react';
import type { FmcgPromotion } from '../../api/van-sales.api';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { XIcon } from '@/shared/components/icons/AppIcons';

export interface PromotionsUpsertModalProps {
  isDialogOpen: boolean;
  setIsDialogOpen: Dispatch<SetStateAction<boolean>>;
  editingPromo: FmcgPromotion | null;
  handleSubmit: (e: React.FormEvent) => void;
  formName: string;
  setFormName: Dispatch<SetStateAction<string>>;
  formCode: string;
  setFormCode: Dispatch<SetStateAction<string>>;
  formPromoType: 'mix_and_match' | 'tiered_qty' | 'invoice_threshold';
  setFormPromoType: Dispatch<SetStateAction<'mix_and_match' | 'tiered_qty' | 'invoice_threshold'>>;
  formApplyType: 'free_bonus' | 'discount_percent' | 'discount_amount';
  setFormApplyType: Dispatch<SetStateAction<'free_bonus' | 'discount_percent' | 'discount_amount'>>;
  thresholdAmount: string;
  setThresholdAmount: Dispatch<SetStateAction<string>>;
  conditionItems: { productId: number; productName: string; minQty: number }[];
  handleRemoveConditionItem: (pId: number) => void;
  selectedProdForCondition: number | null;
  setSelectedProdForCondition: Dispatch<SetStateAction<number | null>>;
  availableProducts: Array<{ id: number; name: string; barcode: string; price: number }>;
  selectedProdQty: string;
  setSelectedProdQty: Dispatch<SetStateAction<string>>;
  handleAddConditionItem: () => void;
  rewardBonusProductId: number | null;
  setRewardBonusProductId: Dispatch<SetStateAction<number | null>>;
  setRewardBonusProductName: Dispatch<SetStateAction<string>>;
  rewardBonusQty: string;
  setRewardBonusQty: Dispatch<SetStateAction<string>>;
  rewardDiscountPercent: string;
  setRewardDiscountPercent: Dispatch<SetStateAction<string>>;
  rewardDiscountAmount: string;
  setRewardDiscountAmount: Dispatch<SetStateAction<string>>;
  formStartDate: string;
  setFormStartDate: Dispatch<SetStateAction<string>>;
  formEndDate: string;
  setFormEndDate: Dispatch<SetStateAction<string>>;
  formMaxApps: string;
  setFormMaxApps: Dispatch<SetStateAction<string>>;
  createMutation: { isPending: boolean };
  updateMutation: { isPending: boolean };
}

export function PromotionsUpsertModal({
  isDialogOpen,
  setIsDialogOpen,
  editingPromo,
  handleSubmit,
  formName,
  setFormName,
  formCode,
  setFormCode,
  formPromoType,
  setFormPromoType,
  formApplyType,
  setFormApplyType,
  thresholdAmount,
  setThresholdAmount,
  conditionItems,
  handleRemoveConditionItem,
  selectedProdForCondition,
  setSelectedProdForCondition,
  availableProducts,
  selectedProdQty,
  setSelectedProdQty,
  handleAddConditionItem,
  rewardBonusProductId,
  setRewardBonusProductId,
  setRewardBonusProductName,
  rewardBonusQty,
  setRewardBonusQty,
  rewardDiscountPercent,
  setRewardDiscountPercent,
  rewardDiscountAmount,
  setRewardDiscountAmount,
  formStartDate,
  setFormStartDate,
  formEndDate,
  setFormEndDate,
  formMaxApps,
  setFormMaxApps,
  createMutation,
  updateMutation,
}: PromotionsUpsertModalProps) {
  const { t } = useTranslation();
  return (
    <StandardDialog
      open={isDialogOpen}
      onClose={() => setIsDialogOpen(false)}
      title={editingPromo ? t('delivery_reps.van_promotions_admin_tab.s39', "تعديل العرض الترويجي") : t('delivery_reps.van_promotions_admin_tab.s40', "برمجة عرض ترويجي جديد")}
      subtitle={t('delivery_reps.van_promotions_admin_tab.s41', "تحديد باقات الخلطات (Mix & Match) والشرائح الكمية والبونص العيني التلقائي")}
      width="780px"
      minHeight="540px"
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Basic Info */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
              {t('delivery_reps.van_promotions_admin_tab.s42', "اسم العرض الترويجي *")}
            </label>
            <input
              type="text"
              required
              placeholder={t('delivery_reps.van_promotions_admin_tab.s43', "مثال: باقة عصير 5+2 = 1 مجاناً")}
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              style={{
                width: '100%',
                height: '36px',
                padding: '0 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
              {t('delivery_reps.van_promotions_admin_tab.s44', "كود العرض (اختياري)")}
            </label>
            <input
              type="text"
              placeholder={t('delivery_reps.van_promotions_admin_tab.s45', "مثال: PROMO-JUICE-01")}
              value={formCode}
              onChange={(e) => setFormCode(e.target.value)}
              style={{
                width: '100%',
                height: '36px',
                padding: '0 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                fontFamily: 'monospace',
              }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
              {t('delivery_reps.van_promotions_admin_tab.s46', "نوع العرض الترويجي *")}
            </label>
            <CustomSelect
              value={formPromoType}
              onChange={(val: any) => setFormPromoType(val)}
              options={[
                { value: 'mix_and_match', label: t('delivery_reps.van_promotions_admin_tab.s47', "خلطات وباقات (Mix & Match)") },
                { value: 'tiered_qty', label: t('delivery_reps.van_promotions_admin_tab.s48', "شرائح كميات الصنف") },
                { value: 'invoice_threshold', label: t('delivery_reps.van_promotions_admin_tab.s49', "سقف قيمة الفاتورة") },
              ]}
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
              {t('delivery_reps.van_promotions_admin_tab.s50', "نوع المكافأة الممنوحة *")}
            </label>
            <CustomSelect
              value={formApplyType}
              onChange={(val: any) => setFormApplyType(val)}
              options={[
                { value: 'free_bonus', label: t('delivery_reps.van_promotions_admin_tab.s51', "بونص عيني مجاني (0.00 ج.م)") },
                { value: 'discount_percent', label: t('delivery_reps.van_promotions_admin_tab.s52', "خصم نسبة مئوية (%)") },
                { value: 'discount_amount', label: t('delivery_reps.van_promotions_admin_tab.s53', "خصم نقدي مقطوع (ج.م)") },
              ]}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        {/* Conditions Builder */}
        <div
          style={{
            backgroundColor: '#f8fafc',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
            padding: '14px',
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#1e293b', marginBottom: '8px' }}>
            {t('delivery_reps.van_promotions_admin_tab.s54', "شروط الشراء والتفعيل")}
          </div>

          {formPromoType === 'invoice_threshold' ? (
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>
                {t('delivery_reps.van_promotions_admin_tab.s55', "الحد الأدنى لقيمة الفاتورة (ج.م) *")}
              </label>
              <input
                type="number"
                min="1"
                value={thresholdAmount}
                onChange={(e) => setThresholdAmount(e.target.value)}
                style={{
                  width: '220px',
                  height: '36px',
                  padding: '0 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                }}
              />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* Selected items list */}
              {conditionItems.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {conditionItems.map((c) => (
                    <div
                      key={c.productId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        backgroundColor: '#ffffff',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                      }}
                    >
                      <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#0f172a' }}>
                        {c.productName}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '12px', color: '#64748b' }}>
                          {t('delivery_reps.van_promotions_admin_tab.s56', "الكمية المطلوبة:")} <b>{c.minQty}</b>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveConditionItem(c.productId)}
                          style={{ border: 'none', background: 'none', color: '#ef4444', cursor: 'pointer' }}
                        >
                          <XIcon size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Product picker */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <CustomSelect
                    value={selectedProdForCondition ? String(selectedProdForCondition) : ''}
                    onChange={(val) => setSelectedProdForCondition(Number(val))}
                    options={[
                      { value: '', label: t('delivery_reps.van_promotions_admin_tab.s57', "اختر الصنف المطلوب...") },
                      ...availableProducts.map((p) => ({
                        value: String(p.id),
                        label: `${p.name} (${p.price} ج.م)`,
                      })),
                    ]}
                    style={{ width: '100%' }}
                  />
                </div>
                <input
                  type="number"
                  min="1"
                  placeholder={t('delivery_reps.van_promotions_admin_tab.s58', "الكمية")}
                  value={selectedProdQty}
                  onChange={(e) => setSelectedProdQty(e.target.value)}
                  style={{
                    width: '80px',
                    height: '36px',
                    padding: '0 8px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    textAlign: 'center',
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleAddConditionItem}
                  style={{ height: '36px', fontSize: '12px' }}
                >
                  {t('delivery_reps.van_promotions_admin_tab.s59', "+ إضافة صنف")}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Reward Builder */}
        <div
          style={{
            backgroundColor: '#f8fafc',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
            padding: '14px',
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#1e293b', marginBottom: '8px' }}>
            {t('delivery_reps.van_promotions_admin_tab.s60', "المكافأة الممنوحة عند التفعيل")}
          </div>

          {formApplyType === 'free_bonus' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '10px', alignItems: 'center' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11.5px', color: '#64748b', marginBottom: '4px' }}>
                  {t('delivery_reps.van_promotions_admin_tab.s61', "صنف الهدية / البونص المجاني *")}
                </label>
                <CustomSelect
                  value={rewardBonusProductId ? String(rewardBonusProductId) : ''}
                  onChange={(val) => {
                    const pid = Number(val);
                    setRewardBonusProductId(pid);
                    const p = availableProducts.find((x) => x.id === pid);
                    setRewardBonusProductName(p ? p.name : '');
                  }}
                  options={[
                    { value: '', label: t('delivery_reps.van_promotions_admin_tab.s62', "اختر صنف البونص المجاني...") },
                    ...availableProducts.map((p) => ({
                      value: String(p.id),
                      label: p.name,
                    })),
                  ]}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11.5px', color: '#64748b', marginBottom: '4px' }}>
                  {t('delivery_reps.van_promotions_admin_tab.s63', "كمية البونص *")}
                </label>
                <input
                  type="number"
                  min="1"
                  value={rewardBonusQty}
                  onChange={(e) => setRewardBonusQty(e.target.value)}
                  style={{
                    width: '100%',
                    height: '36px',
                    padding: '0 8px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    textAlign: 'center',
                  }}
                />
              </div>
            </div>
          ) : formApplyType === 'discount_percent' ? (
            <div>
              <label style={{ display: 'block', fontSize: '11.5px', color: '#64748b', marginBottom: '4px' }}>
                {t('delivery_reps.van_promotions_admin_tab.s64', "نسبة الخصم المئوية (%) *")}
              </label>
              <input
                type="number"
                min="1"
                max="100"
                value={rewardDiscountPercent}
                onChange={(e) => setRewardDiscountPercent(e.target.value)}
                style={{
                  width: '140px',
                  height: '36px',
                  padding: '0 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  textAlign: 'center',
                }}
              />
            </div>
          ) : (
            <div>
              <label style={{ display: 'block', fontSize: '11.5px', color: '#64748b', marginBottom: '4px' }}>
                {t('delivery_reps.van_promotions_admin_tab.s65', "مبلغ الخصم النقدي (ج.م) *")}
              </label>
              <input
                type="number"
                min="1"
                value={rewardDiscountAmount}
                onChange={(e) => setRewardDiscountAmount(e.target.value)}
                style={{
                  width: '160px',
                  height: '36px',
                  padding: '0 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                }}
              />
            </div>
          )}
        </div>

        {/* Dates & Limits */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11.5px', color: '#64748b', marginBottom: '4px' }}>
              {t('delivery_reps.van_promotions_admin_tab.s66', "تاريخ البداية (اختياري)")}
            </label>
            <input
              type="date"
              value={formStartDate}
              onChange={(e) => setFormStartDate(e.target.value)}
              style={{
                width: '100%',
                height: '34px',
                padding: '0 8px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '12.5px',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11.5px', color: '#64748b', marginBottom: '4px' }}>
              {t('delivery_reps.van_promotions_admin_tab.s67', "تاريخ الانتهاء (اختياري)")}
            </label>
            <input
              type="date"
              value={formEndDate}
              onChange={(e) => setFormEndDate(e.target.value)}
              style={{
                width: '100%',
                height: '34px',
                padding: '0 8px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '12.5px',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11.5px', color: '#64748b', marginBottom: '4px' }}>
              {t('delivery_reps.van_promotions_admin_tab.s68', "تكرار الباقة بالفاتورة")}
            </label>
            <input
              type="number"
              min="1"
              value={formMaxApps}
              onChange={(e) => setFormMaxApps(e.target.value)}
              style={{
                width: '100%',
                height: '34px',
                padding: '0 8px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '12.5px',
                textAlign: 'center',
              }}
            />
          </div>
        </div>

        <StandardDialogFooter>
          <Button type="button" variant="secondary" onClick={() => setIsDialogOpen(false)}>
            {t('delivery_reps.van_promotions_admin_tab.s69', "إلغاء")}
          </Button>
          <Button
            type="submit"
            disabled={createMutation.isPending || updateMutation.isPending}
            style={{
              backgroundColor: '#170e5e',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '13px',
            }}
          >
            {editingPromo ? t('delivery_reps.van_promotions_admin_tab.s70', "حفظ التعديلات") : t('delivery_reps.van_promotions_admin_tab.s71', "إنشاء وتفعيل العرض")}
          </Button>
        </StandardDialogFooter>
      </form>
    </StandardDialog>
  );
}
