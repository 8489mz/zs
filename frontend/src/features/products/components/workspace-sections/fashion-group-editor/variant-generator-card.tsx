import { useTranslation } from 'react-i18next';
import { type Dispatch, type SetStateAction } from 'react';
import { normalizeArabicInput } from '@/lib/arabic-normalization';
import { mergeFashionTokens } from '@/features/products/components/fashion-variants.utils';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { ScentDropletIcon, FashionShirtIcon, PackageBoxIcon, SlidersConfigIcon, FASHION_SIZE_PRESETS, SCENT_SIZE_PRESETS, PACKAGING_PRESETS, type VariantTemplateType } from './fashion-group-data';

export function VariantGeneratorCard({ templateConfig, setActiveTemplate, mutation, activeTemplate, customPrimaryLabel, setCustomPrimaryLabel, customSecondaryLabel, setCustomSecondaryLabel, colorsValue, setColorsValue, sizesValue, setSizesValue, smartSyncFromTokens, generateFromTokens }: { templateConfig: { title: string; hint: string; primaryLabel: string; secondaryLabel: string; primarySingleLabel: string; secondarySingleLabel: string; primaryPlaceholder: string; secondaryPlaceholder: string; primaryPresets: string[] }; setActiveTemplate: Dispatch<SetStateAction<VariantTemplateType>>; mutation: { isPending: boolean }; activeTemplate: VariantTemplateType; customPrimaryLabel: string; setCustomPrimaryLabel: Dispatch<SetStateAction<string>>; customSecondaryLabel: string; setCustomSecondaryLabel: Dispatch<SetStateAction<string>>; colorsValue: string; setColorsValue: Dispatch<SetStateAction<string>>; sizesValue: string; setSizesValue: Dispatch<SetStateAction<string>>; smartSyncFromTokens: () => void | Promise<void>; generateFromTokens: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="product-compact-card" style={{ background: '#ffffff', borderColor: '#cbd5e1' }}>
      <div className="page-stack" style={{ gap: 12 }}>
        {/* Header with Template Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
          <div>
            <h4 style={{ margin: 0, fontSize: '0.94rem', fontWeight: 800, color: '#0f172a' }}>
              {t('products.workspace_sections.fashion_group_editor_card.s19', "مُنشئ ومولد المتغيرات السريع")}
            </h4>
            <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>{templateConfig.hint}</div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#f1f5f9', padding: '3px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <button
              type="button"
              onClick={() => setActiveTemplate('scents')}
              disabled={mutation.isPending}
              style={{
                background: activeTemplate === 'scents' ? '#ffffff' : 'transparent',
                color: activeTemplate === 'scents' ? '#1e1b4b' : '#475569',
                fontWeight: 700,
                border: activeTemplate === 'scents' ? '1px solid #cbd5e1' : '1px solid transparent',
                borderRadius: '6px',
                padding: '5px 10px',
                fontSize: '0.78rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                whiteSpace: 'nowrap',
                userSelect: 'none',
                boxShadow: activeTemplate === 'scents' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
              }}
            >
              <ScentDropletIcon size={14} />
              <span>{t('products.workspace_sections.fashion_group_editor_card.s20', "روائح ونكهات")}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTemplate('fashion')}
              disabled={mutation.isPending}
              style={{
                background: activeTemplate === 'fashion' ? '#ffffff' : 'transparent',
                color: activeTemplate === 'fashion' ? '#1e1b4b' : '#475569',
                fontWeight: 700,
                border: activeTemplate === 'fashion' ? '1px solid #cbd5e1' : '1px solid transparent',
                borderRadius: '6px',
                padding: '5px 10px',
                fontSize: '0.78rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                whiteSpace: 'nowrap',
                userSelect: 'none',
                boxShadow: activeTemplate === 'fashion' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
              }}
            >
              <FashionShirtIcon size={14} />
              <span>{t('products.workspace_sections.fashion_group_editor_card.s21', "ملابس وأحذية")}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTemplate('sizes')}
              disabled={mutation.isPending}
              style={{
                background: activeTemplate === 'sizes' ? '#ffffff' : 'transparent',
                color: activeTemplate === 'sizes' ? '#1e1b4b' : '#475569',
                fontWeight: 700,
                border: activeTemplate === 'sizes' ? '1px solid #cbd5e1' : '1px solid transparent',
                borderRadius: '6px',
                padding: '5px 10px',
                fontSize: '0.78rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                whiteSpace: 'nowrap',
                userSelect: 'none',
                boxShadow: activeTemplate === 'sizes' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
              }}
            >
              <PackageBoxIcon size={14} />
              <span>{t('products.workspace_sections.fashion_group_editor_card.s22', "أحجام وعبوات")}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTemplate('custom')}
              disabled={mutation.isPending}
              style={{
                background: activeTemplate === 'custom' ? '#ffffff' : 'transparent',
                color: activeTemplate === 'custom' ? '#1e1b4b' : '#475569',
                fontWeight: 700,
                border: activeTemplate === 'custom' ? '1px solid #cbd5e1' : '1px solid transparent',
                borderRadius: '6px',
                padding: '5px 10px',
                fontSize: '0.78rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                whiteSpace: 'nowrap',
                userSelect: 'none',
                boxShadow: activeTemplate === 'custom' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
              }}
            >
              <SlidersConfigIcon size={14} />
              <span>{t('products.workspace_sections.fashion_group_editor_card.s23', "مخصص")}</span>
            </button>
          </div>
        </div>

        {/* Custom Labels Inputs */}
        {activeTemplate === 'custom' && (
          <div className="product-form-grid-2" style={{ background: '#f8fafc', padding: '8px 12px', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
            <Field label={t('products.workspace_sections.fashion_group_editor_card.s24', "تسمية الخاصية الأولى (مثال: النوع، اللون، الخامة)")}>
              <input
                className="purchase-prototype-field-input"
                value={customPrimaryLabel}
                onChange={(e) => setCustomPrimaryLabel(normalizeArabicInput(e.target.value))}
                disabled={mutation.isPending}
                placeholder={t('products.workspace_sections.fashion_group_editor_card.s25', "الخاصية الأولى")}
              />
            </Field>
            <Field label={t('products.workspace_sections.fashion_group_editor_card.s26', "تسمية الخاصية الثانية (مثال: المقاس، السعة، التغليف)")}>
              <input
                className="purchase-prototype-field-input"
                value={customSecondaryLabel}
                onChange={(e) => setCustomSecondaryLabel(normalizeArabicInput(e.target.value))}
                disabled={mutation.isPending}
                placeholder={t('products.workspace_sections.fashion_group_editor_card.s27', "الخاصية الثانية")}
              />
            </Field>
          </div>
        )}

        {/* Generator Inputs: Primary & Secondary Tokens in 2 Columns */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px', alignItems: 'start' }}>
          {/* Primary Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <Field label={templateConfig.primaryLabel}>
              <input
                type="text"
                className="purchase-prototype-field-input"
                value={colorsValue}
                onChange={(event) => setColorsValue(normalizeArabicInput(event.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const trimmed = colorsValue.trim();
                    if (trimmed && !trimmed.endsWith('-') && !trimmed.endsWith('،') && !trimmed.endsWith(',')) {
                      setColorsValue(`${trimmed} - `);
                    }
                  }
                }}
                disabled={mutation.isPending}
                placeholder={templateConfig.primaryPlaceholder}
                style={{ height: '34px', minHeight: '34px', fontSize: '0.84rem' }}
              />
            </Field>
            {Boolean(templateConfig.primaryPresets.length) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', marginTop: '2px' }}>
                {templateConfig.primaryPresets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setColorsValue(mergeFashionTokens(colorsValue, [preset]))}
                    disabled={mutation.isPending}
                    style={{
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#334155',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                      lineHeight: 1.3,
                    }}
                  >
                    + {preset}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Secondary Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <Field label={templateConfig.secondaryLabel}>
              <input
                type="text"
                className="purchase-prototype-field-input"
                value={sizesValue}
                onChange={(event) => setSizesValue(normalizeArabicInput(event.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const trimmed = sizesValue.trim();
                    if (trimmed && !trimmed.endsWith('-') && !trimmed.endsWith('،') && !trimmed.endsWith(',')) {
                      setSizesValue(`${trimmed} - `);
                    }
                  }
                }}
                disabled={mutation.isPending}
                placeholder={templateConfig.secondaryPlaceholder}
                style={{ height: '34px', minHeight: '34px', fontSize: '0.84rem' }}
              />
            </Field>

            {activeTemplate === 'fashion' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', marginTop: '2px' }}>
                {FASHION_SIZE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setSizesValue(mergeFashionTokens(sizesValue, preset.values))}
                    disabled={mutation.isPending}
                    style={{
                      border: '1px solid #cbd5e1',
                      background: '#f8fafc',
                      color: '#1e1b4b',
                      padding: '1px 7px',
                      borderRadius: '4px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                      lineHeight: 1.3,
                    }}
                  >
                    + {preset.label}
                  </button>
                ))}
              </div>
            )}

            {activeTemplate === 'scents' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', marginTop: '2px' }}>
                {SCENT_SIZE_PRESETS.map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setSizesValue(mergeFashionTokens(sizesValue, [val]))}
                    disabled={mutation.isPending}
                    style={{
                      border: '1px solid #bbf7d0',
                      background: '#f0fdf4',
                      color: '#166534',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                      lineHeight: 1.3,
                    }}
                  >
                    + {val}
                  </button>
                ))}
              </div>
            )}

            {activeTemplate === 'sizes' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', marginTop: '2px' }}>
                {PACKAGING_PRESETS.map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setSizesValue(mergeFashionTokens(sizesValue, [val]))}
                    disabled={mutation.isPending}
                    style={{
                      border: '1px solid #fde047',
                      background: '#fefce8',
                      color: '#854d0e',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                      lineHeight: 1.3,
                    }}
                  >
                    + {val}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sync Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-start', paddingTop: '4px', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <Button
            type="button"
            variant="primary"
            onClick={smartSyncFromTokens}
            disabled={mutation.isPending || (!colorsValue.trim() && !sizesValue.trim())}
            style={{ fontSize: '0.8rem', padding: '5px 16px', fontWeight: 800, height: '32px' }}
            title={t('products.workspace_sections.fashion_group_editor_card.s28_sync_tip', "تحديث شبكة الأصناف الفرعية بناءً على المدخلات، وتطهير المقاسات غير المحددة، مع نقل وحماية أي صنف له رصيد")}
          >
            {t('products.workspace_sections.fashion_group_editor_card.s28', "توليد وتحديث شبكة الفروع بناءً على القيم أعلاه")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={generateFromTokens}
            disabled={mutation.isPending || (!colorsValue.trim() && !sizesValue.trim())}
            style={{ fontSize: '0.78rem', padding: '5px 12px', fontWeight: 600, height: '32px' }}
            title={t('products.workspace_sections.fashion_group_editor_card.s28_append_tip', "إضافة أي قيم جديدة تم إدخالها مع الإبقاء على كافة الفروع الحالية كما هي دون أي حذف")}
          >
            {t('products.workspace_sections.fashion_group_editor_card.s28_append', "إضافة الفروع الجديدة فقط (دون حذف الحالية)")}
          </Button>
        </div>
      </div>
    </div>
  );
}
