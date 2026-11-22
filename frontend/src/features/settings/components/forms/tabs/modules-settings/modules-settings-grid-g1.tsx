import { useTranslation } from 'react-i18next';
import { FactoryIcon, ComboPackageIcon, LockIcon, premiumCardTextStyle, premiumCheckboxInputStyle } from './modules-settings-icons';
import { MonitorIcon, PackageIcon, ReceiptIcon, UsersIcon } from '@/shared/components/icons/AppIcons';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { CSSProperties } from 'react';

interface ModulesSettingsGridG1Props {
  isContractingVertical: boolean;
  isMaritimeVertical: boolean;
  getCardStyle: (isActive: boolean, hasFeature: boolean) => CSSProperties;
  getIconBadgeStyle: (isActive: boolean) => CSSProperties;
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  disabled: boolean;
  isSuperAdmin: boolean;
  hasInventoryFeature: boolean;
  handleLockedCardClick: (title: string, planName: string, description: string) => void;
  hasPurchasesFeature: boolean;
  hasHrFeature: boolean;
  hasManufacturingFeature: boolean;
  isPosActive: boolean;
  isManufacturingVertical: boolean;
  isWholesaleVanVertical: boolean;
  isWarehousingVertical: boolean;
  isInventoryActive: boolean;
  isPurchasesActive: boolean;
  isHrActive: boolean;
  isManufacturingActive: boolean;
  isComboActive: boolean;
  isRestaurantVertical: boolean;
}

export function ModulesSettingsGridG1({ isContractingVertical, isMaritimeVertical, getCardStyle, getIconBadgeStyle, form, disabled, isSuperAdmin, hasInventoryFeature, handleLockedCardClick, hasPurchasesFeature, hasHrFeature, hasManufacturingFeature, isPosActive, isManufacturingVertical, isWholesaleVanVertical, isWarehousingVertical, isInventoryActive, isPurchasesActive, isHrActive, isManufacturingActive, isComboActive, isRestaurantVertical }: ModulesSettingsGridG1Props) {
  const { t } = useTranslation();
  return (<>
      {/* نقاط البيع السريعة والكاشير */}
      {(!isContractingVertical && !isMaritimeVertical) || isSuperAdmin ? (
        <label style={getCardStyle(Boolean(isPosActive), !isContractingVertical && !isMaritimeVertical && !isManufacturingVertical && !isWholesaleVanVertical && !isWarehousingVertical)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={getIconBadgeStyle(Boolean(isPosActive))}>
              <MonitorIcon size={20} />
            </div>
            <div style={premiumCardTextStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s25', "نقاط البيع السريعة والكاشير (POS)")}</strong>
                {isContractingVertical ? (
                  <span style={{ fontSize: '0.7rem', background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                    {t('settings.forms.tabs.modules_settings_tab.s26', "معطل تلقائياً (غير مخصص للمقاولات)")}
                  </span>
                ) : isMaritimeVertical ? (
                  <span style={{ fontSize: '0.7rem', background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                    {t('settings.forms.tabs.modules_settings_tab.s27', "معطل تلقائياً (غير مخصص للشحن)")}
                  </span>
                ) : isWarehousingVertical ? (
                  <span style={{ fontSize: '0.7rem', background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                    {t('settings.forms.tabs.modules_settings_tab.s188', "معطل تلقائياً (غير مخصص للمخازن)")}
                  </span>
                ) : isWholesaleVanVertical ? (
                  <span style={{ fontSize: '0.7rem', background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                    {t('settings.forms.tabs.modules_settings_tab.s189', "معطل تلقائياً (غير مخصص للجملة والتوزيع)")}
                  </span>
                ) : isManufacturingVertical ? (
                  <span style={{ fontSize: '0.7rem', background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                    {t('settings.forms.tabs.modules_settings_tab.s190', "معطل تلقائياً (غير مخصص للتصنيع)")}
                  </span>
                ) : null}
              </div>
              <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s28', "شاشات البيع السريع بالباركود والورديات (يمكن إيقافها لشركات الجملة والخدمات والمشاريع)")}</small>
            </div>
          </div>
          <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('posModuleEnabled')} checked={Boolean(isPosActive)} disabled={disabled || isContractingVertical || isMaritimeVertical || isManufacturingVertical || isWholesaleVanVertical || isWarehousingVertical} />
        </label>
      ) : null}

      {/* المخازن والمستودعات المتقدمة */}
      {!isMaritimeVertical || isSuperAdmin ? (
        <label
          style={getCardStyle(Boolean(isInventoryActive), hasInventoryFeature || isContractingVertical)}
          onClick={(e) => {
            if (isContractingVertical || isMaritimeVertical) return;
            if (!hasInventoryFeature) {
              e.preventDefault();
              handleLockedCardClick(
                t('settings.forms.tabs.modules_settings_tab.s29', "المخازن والمستودعات المتقدمة"),
                t('settings.forms.tabs.modules_settings_tab.s30', "باقة النمو (الاحترافية)"),
                t('settings.forms.tabs.modules_settings_tab.s31', "يتيح لك هذا الموديول إدارة المستودعات المتعددة، التحويلات المخزنية، أذون الإضافة والصرف، ومحاضر الجرد الدوري.")
              );
            }
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={getIconBadgeStyle(Boolean(isInventoryActive))}>
              <PackageIcon size={20} />
            </div>
            <div style={premiumCardTextStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s32', "المخازن والمستودعات المتقدمة")}</strong>
                {isContractingVertical ? (
                  <span style={{ fontSize: '0.7rem', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                    {t('settings.forms.tabs.modules_settings_tab.s33', "مفعل تلقائياً لمستودعات ومخازن المواقع")}
                  </span>
                ) : isMaritimeVertical ? (
                  <span style={{ fontSize: '0.7rem', background: '#f8fafc', color: '#64748b', border: '1px solid #e2e8f0', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                    {t('settings.forms.tabs.modules_settings_tab.s34', "غير مخصص للشحن (يعتمد على الحاويات)")}
                  </span>
                ) : !hasInventoryFeature ? (
                  <span style={{ fontSize: '0.7rem', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                    <LockIcon size={11} /> {t('settings.forms.tabs.modules_settings_tab.s35', "باقة النمو")}
                  </span>
                ) : null}
              </div>
              <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s36', "التحويلات بين المخازن، أذون الصرف، والجرد (يمكن إيقافه للأنشطة الخدمية)")}</small>
            </div>
          </div>
          <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('inventoryModuleEnabled')} checked={Boolean(isInventoryActive)} disabled={disabled || isContractingVertical || isMaritimeVertical || !hasInventoryFeature} />
        </label>
      ) : null}

      {/* المشتريات وإدارة الموردين */}
      <label
        style={getCardStyle(Boolean(isPurchasesActive), hasPurchasesFeature || isContractingVertical || isMaritimeVertical)}
        onClick={(e) => {
          if (isContractingVertical || isMaritimeVertical) return;
          if (!hasPurchasesFeature) {
            e.preventDefault();
            handleLockedCardClick(
              t('settings.forms.tabs.modules_settings_tab.s37', "المشتريات وإدارة الموردين"),
              t('settings.forms.tabs.modules_settings_tab.s38', "باقة النمو (الاحترافية)"),
              t('settings.forms.tabs.modules_settings_tab.s39', "يتيح لك هذا الموديول إصدار أوامر وفواتير الشراء، إدارة حسابات ومستحقات الموردين، ومتابعة سندات الصرف.")
            );
          }
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={getIconBadgeStyle(Boolean(isPurchasesActive))}>
            <ReceiptIcon size={20} />
          </div>
          <div style={premiumCardTextStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s40', "المشتريات وإدارة الموردين")}</strong>
              {isContractingVertical ? (
                <span style={{ fontSize: '0.7rem', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                  {t('settings.forms.tabs.modules_settings_tab.s41', "مفعل تلقائياً لمشتريات ومقاولي الباطن")}
                </span>
              ) : isMaritimeVertical ? (
                <span style={{ fontSize: '0.7rem', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                  {t('settings.forms.tabs.modules_settings_tab.s42', "مفعل تلقائياً للخطوط الملاحية ومصاريف الشحن")}
                </span>
              ) : !hasPurchasesFeature ? (
                <span style={{ fontSize: '0.7rem', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                  <LockIcon size={11} /> {t('settings.forms.tabs.modules_settings_tab.s43', "باقة النمو")}
                </span>
              ) : null}
            </div>
            <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s44', "فواتير الشراء، مرتجعات المشتريات، وحسابات الموردين وسندات الصرف")}</small>
          </div>
        </div>
        <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('purchasesModuleEnabled')} checked={Boolean(isPurchasesActive)} disabled={disabled || isContractingVertical || isMaritimeVertical || !hasPurchasesFeature} />
      </label>

      {/* الموارد البشرية والرواتب */}
      <label
        style={getCardStyle(Boolean(isHrActive), hasHrFeature || isContractingVertical || isMaritimeVertical)}
        onClick={(e) => {
          if (isContractingVertical || isMaritimeVertical) return;
          if (!hasHrFeature) {
            e.preventDefault();
            handleLockedCardClick(
              t('settings.forms.tabs.modules_settings_tab.s45', "الموارد البشرية والرواتب (HR)"),
              t('settings.forms.tabs.modules_settings_tab.s46', "الباقة المتكاملة (Ultimate ERP)"),
              t('settings.forms.tabs.modules_settings_tab.s47', "يتيح لك هذا الموديول إدارة شؤون الموظفين، مسير الرواتب الآلي، تسجيل الحضور والانصراف، السلف، ونهاية الخدمة.")
            );
          }
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={getIconBadgeStyle(Boolean(isHrActive))}>
            <UsersIcon size={20} />
          </div>
          <div style={premiumCardTextStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s48', "الموارد البشرية والرواتب (HR)")}</strong>
              {isContractingVertical ? (
                <span style={{ fontSize: '0.7rem', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                  {t('settings.forms.tabs.modules_settings_tab.s49', "مفعل تلقائياً لعمالة ومهندسي المشاريع")}
                </span>
              ) : isMaritimeVertical ? (
                <span style={{ fontSize: '0.7rem', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                  {t('settings.forms.tabs.modules_settings_tab.s50', "مفعل تلقائياً لموظفي وعمليات الشحن")}
                </span>
              ) : !hasHrFeature ? (
                <span style={{ fontSize: '0.7rem', background: '#f5f3ff', color: '#6d28d9', border: '1px solid #ddd6fe', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                  <LockIcon size={11} /> {t('settings.forms.tabs.modules_settings_tab.s51', "الباقة المتكاملة")}
                </span>
              ) : null}
            </div>
            <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s52', "مسير الرواتب، تسجيل الحضور، السلف، وملفات الموظفين (يمكن إيقافه للمتاجر الفردية)")}</small>
          </div>
        </div>
        <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('hrModuleEnabled')} checked={Boolean(isHrActive)} disabled={disabled || isContractingVertical || isMaritimeVertical || !hasHrFeature} />
      </label>

      {/* التصنيع والإنتاج */}
      {(!isContractingVertical && !isMaritimeVertical) || isSuperAdmin ? (
        <label
          style={getCardStyle(Boolean(isManufacturingActive), hasManufacturingFeature)}
          onClick={(e) => {
            if (!hasManufacturingFeature) {
              e.preventDefault();
              handleLockedCardClick(
                t('settings.forms.tabs.modules_settings_tab.s53', "التصنيع والإنتاج"),
                t('settings.forms.tabs.modules_settings_tab.s54', "الباقة المتكاملة (Ultimate ERP)"),
                t('settings.forms.tabs.modules_settings_tab.s55', "يتيح لك هذا الموديول تعريف شجرة وقوائم المكونات (BOM)، أوامر الإنتاج، ومراكز العمل وحساب التكاليف.")
              );
            }
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={getIconBadgeStyle(Boolean(isManufacturingActive))}>
              <FactoryIcon size={20} />
            </div>
            <div style={premiumCardTextStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s56', "التصنيع والإنتاج")}</strong>
                {!hasManufacturingFeature && (
                  <span style={{ fontSize: '0.7rem', background: '#f5f3ff', color: '#6d28d9', border: '1px solid #ddd6fe', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                    <LockIcon size={11} /> {t('settings.forms.tabs.modules_settings_tab.s57', "الباقة المتكاملة")}
                  </span>
                )}
              </div>
              <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.modules_settings_tab.s58', "يضيف خيارات المكونات، وصفات الإنتاج، وأوامر التصنيع")}</small>
            </div>
          </div>
          <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('manufacturingModuleEnabled')} checked={Boolean(isManufacturingActive)} disabled={disabled || !hasManufacturingFeature} />
        </label>
      ) : null}

      {/* العروض المجمعة والوجبات */}
      {(!isContractingVertical && !isMaritimeVertical) || isSuperAdmin ? (
        <label style={getCardStyle(Boolean(isComboActive), true)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={getIconBadgeStyle(Boolean(isComboActive))}>
              <ComboPackageIcon size={20} />
            </div>
            <div style={premiumCardTextStyle}>
              <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>
                {isRestaurantVertical
                  ? t('settings.forms.tabs.modules_settings_tab.s59_restaurant', "العروض المجمعة والوجبات (Combo)")
                  : t('settings.forms.tabs.modules_settings_tab.s59', "الأطقم والعروض المجمعة (Bundles)")}
              </strong>
              <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                {isRestaurantVertical
                  ? t('settings.forms.tabs.modules_settings_tab.s60_restaurant', "يفعّل وجبات وعروض المطاعم المكوّنة من عدة أصناف (Combo)")
                  : t('settings.forms.tabs.modules_settings_tab.s60', "يفعّل باقات وأطقم الملابس والتجزئة المكوّنة من عدة أصناف (Bundles)")}
              </small>
            </div>
          </div>
          <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('comboModuleEnabled')} checked={Boolean(isComboActive)} disabled={disabled} />
        </label>
      ) : null}
  </>);
}
