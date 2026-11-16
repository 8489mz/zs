// POS-customization section (Section 9) — pure move from SalesInventorySettingsTab.tsx (slice S4).
// The facade keeps the gate wrapper ({showPosSettings && (...)}) and passes form, disabled, settings and showPosSettings as props.
// settings is carried in the props interface for uniformity; the moved text never reads it as code (all word hits are i18n-key string literals).
// showPosSettings is NOT a code identifier in the moved text — it lives only in the facade-kept gate opener.
// Shared styles come from the shared slice via `@/` (shared merges first).
// CustomSelect is a real dep (3 uses) — prep §3's dep column missed it (grep-proven).

import { useTranslation } from 'react-i18next';
import { FormSection } from '@/shared/components/form-section';
import { CustomSelect } from '@/shared/ui/custom-select';
import { SlidersIcon } from '@/shared/components/icons/AppIcons';
import { premiumCardStyle, iconBadgeStyle, premiumCardTextStyle, premiumCheckboxInputStyle } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-shared';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { AppSettings } from '@/types/domain';

export interface SalesInventoryPosCustomProps {
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  disabled: boolean;
  settings?: AppSettings;
  showPosSettings: boolean;
}

export function SalesInventoryPosCustom({ form, disabled }: SalesInventoryPosCustomProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* ===== تخصيص واجهة الكاشير والشاشات المتنقلة ===== */}
        <FormSection
          title={t('settings.forms.tabs.sales_inventory_settings_tab.pos_customization_section_title', "تخصيص واجهة الكاشير والشاشات المتنقلة")}
          description={t('settings.forms.tabs.sales_inventory_settings_tab.pos_customization_section_desc', "التحكم في إظهار أو إخفاء عناصر واجهة الكاشير (شريط البحث، مبدل السعر، شريط الأقسام، الفلاتر السريعة) وتخصيص نمط وشبكة العرض لأجهزة الكاشير المحمولة والموبايل.")}
        >
          <div className="settings-two-col-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
            {/* Card 1: Default POS Product Card Layout */}
            <div style={{ ...premiumCardStyle, cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                <div style={iconBadgeStyle}>
                  <SlidersIcon size={20} />
                </div>
                <div style={{ ...premiumCardTextStyle, minWidth: 0, flex: 1 }}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.pos_card_layout_title', "النمط الافتراضي لكروت المنتجات بالكاشير")}
                  </strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b', lineHeight: 1.4 }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.pos_card_layout_desc', "اختيار شكل عرض كروت الأصناف في نقطة البيع (موسعة / معرض صور / مضغوطة)")}
                  </small>
                </div>
              </div>
              <div style={{ width: '210px', minWidth: '180px', flexShrink: 0 }}>
                <CustomSelect
                  value={form.watch('posProductCardLayout') || 'comfortable'}
                  onChange={(val) => form.setValue('posProductCardLayout', val as any, { shouldDirty: true, shouldValidate: true })}
                  options={[
                    { value: 'comfortable', label: t('settings.forms.tabs.sales_inventory_settings_tab.pos_layout_comfortable', "كروت موسعة (افتراضي)") },
                    { value: 'gallery', label: t('settings.forms.tabs.sales_inventory_settings_tab.pos_layout_gallery', "معرض صور فوتوغرافية") },
                    { value: 'compact', label: t('settings.forms.tabs.sales_inventory_settings_tab.pos_layout_compact', "كروت مضغوطة مدمجة") },
                  ]}
                  disabled={disabled}
                />
              </div>
            </div>

            {/* Card 2: POS Show Search Bar */}
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                <div style={iconBadgeStyle}>
                  <SlidersIcon size={20} />
                </div>
                <div style={{ ...premiumCardTextStyle, minWidth: 0, flex: 1 }}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.pos_show_search_bar_title', "إظهار شريط البحث في شاشة الكاشير")}
                  </strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.pos_show_search_bar_desc', "يمكن إخفاؤه لتوفير أكبر مساحة لعرض المنتجات في نقاط البيع المعتمدة على اللمس والباركود")}
                  </small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('posShowSearchBar')} disabled={disabled} />
            </label>

            {/* Card 3: POS Show Price Tier Toggle */}
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                <div style={iconBadgeStyle}>
                  <SlidersIcon size={20} />
                </div>
                <div style={{ ...premiumCardTextStyle, minWidth: 0, flex: 1 }}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.pos_show_price_toggle_title', "إظهار مبدل السعر (قطاعي / جملة)")}
                  </strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.pos_show_price_toggle_desc', "إتاحة التبديل السريع بين سعر التجزئة والجملة، أو إخفاؤه للالتزام بنوع السعر الافتراضي")}
                  </small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('posShowPriceTierToggle')} disabled={disabled} />
            </label>

            {/* Card 4: POS Default Price Type */}
            <div style={{ ...premiumCardStyle, cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                <div style={iconBadgeStyle}>
                  <SlidersIcon size={20} />
                </div>
                <div style={{ ...premiumCardTextStyle, minWidth: 0, flex: 1 }}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.pos_default_price_type_title', "سعر البيع الافتراضي بنقطة البيع")}
                  </strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b', lineHeight: 1.4 }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.pos_default_price_type_desc', "تحديد السعر المعتمد تلقائياً (قطاعي أو جملة) حتى في حال إخفاء زر التبديل")}
                  </small>
                </div>
              </div>
              <div style={{ width: '210px', minWidth: '180px', flexShrink: 0 }}>
                <CustomSelect
                  value={form.watch('posDefaultPriceType') || 'retail'}
                  onChange={(val) => form.setValue('posDefaultPriceType', val as any, { shouldDirty: true, shouldValidate: true })}
                  options={[
                    { value: 'retail', label: t('settings.forms.tabs.sales_inventory_settings_tab.pos_price_retail', "سعر التجزئة / قطاعي (افتراضي)") },
                    { value: 'wholesale', label: t('settings.forms.tabs.sales_inventory_settings_tab.pos_price_wholesale', "سعر الجملة") },
                  ]}
                  disabled={disabled}
                />
              </div>
            </div>

            {/* Card 5: POS Show Categories */}
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                <div style={iconBadgeStyle}>
                  <SlidersIcon size={20} />
                </div>
                <div style={{ ...premiumCardTextStyle, minWidth: 0, flex: 1 }}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.pos_show_categories_title', "إظهار شريط الأقسام والتصنيفات")}
                  </strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.pos_show_categories_desc', "إظهار كبسولات التصنيفات الأفقية أعلى المنتجات أو إخفاؤها لتوسيع مساحة العرض")}
                  </small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('posShowCategories')} disabled={disabled} />
            </label>

            {/* Card 6: POS Show Quick Filters */}
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                <div style={iconBadgeStyle}>
                  <SlidersIcon size={20} />
                </div>
                <div style={{ ...premiumCardTextStyle, minWidth: 0, flex: 1 }}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.pos_show_quick_filters_title', "إظهار شريط الفلاتر السريعة (المفضلة / العروض)")}
                  </strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.pos_show_quick_filters_desc', "أزرار فلترة الأصناف حسب المفضلة، العروض الخاصة، والخدمات")}
                  </small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('posShowQuickFilters')} disabled={disabled} />
            </label>

            {/* Card 7: POS Mobile Grid Columns */}
            <div style={{ ...premiumCardStyle, cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                <div style={iconBadgeStyle}>
                  <SlidersIcon size={20} />
                </div>
                <div style={{ ...premiumCardTextStyle, minWidth: 0, flex: 1 }}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.pos_mobile_cols_title', "عدد أعمدة الأصناف في شاشات الموبايل والمتنقلة")}
                  </strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b', lineHeight: 1.4 }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.pos_mobile_cols_desc', "تخصيص شبكة العرض لأجهزة الكاشير المحمولة (iMin / Sunmi): 3 أعمدة لعرض عدد أكبر من الأصناف")}
                  </small>
                </div>
              </div>
              <div style={{ width: '210px', minWidth: '180px', flexShrink: 0 }}>
                <CustomSelect
                  value={form.watch('posMobileGridColumns') || 'auto'}
                  onChange={(val) => form.setValue('posMobileGridColumns', val as any, { shouldDirty: true, shouldValidate: true })}
                  options={[
                    { value: 'auto', label: t('settings.forms.tabs.sales_inventory_settings_tab.pos_cols_auto', "تلقائي بحسب الشاشة") },
                    { value: '2', label: t('settings.forms.tabs.sales_inventory_settings_tab.pos_cols_2', "عمودين (افتراضي)") },
                    { value: '3', label: t('settings.forms.tabs.sales_inventory_settings_tab.pos_cols_3', "3 أعمدة (أجهزة كاشير محمولة iMin/Sunmi)") },
                  ]}
                  disabled={disabled}
                />
              </div>
            </div>

            {/* Card 8: POS Auto-Hide Bottom Nav */}
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                <div style={iconBadgeStyle}>
                  <SlidersIcon size={20} />
                </div>
                <div style={{ ...premiumCardTextStyle, minWidth: 0, flex: 1 }}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.pos_auto_hide_nav_title', "الإخفاء التلقائي للشريط السفلي في شاشات الموبايل")}
                  </strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                    {t('settings.forms.tabs.sales_inventory_settings_tab.pos_auto_hide_nav_desc', "إخفاء شريط التنقل الرئيسي عند التمرير أو عند إضافة أصناف للسلة لمنح أقصى مساحة عرض للمنتجات")}
                  </small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('posAutoHideBottomNav')} disabled={disabled} />
            </label>
          </div>
        </FormSection>
    </>
  );
}
