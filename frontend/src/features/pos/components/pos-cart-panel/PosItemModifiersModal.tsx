import { useTranslation } from 'react-i18next';
import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addonsApi, type ModifierGroup } from '@/shared/api/addons.api';
import { buildGroupModifierSelection } from './group-modifier-mapping';
import type { PosItem } from '@/features/pos/types/pos.types';
import { DialogShell } from '@/shared/components/dialog-shell';
import { XIcon, CheckIcon, AlertCircleIcon, LayersIcon } from '@/shared/components/icons/AppIcons';

interface PosItemModifiersModalProps {
  open: boolean;
  onClose: () => void;
  item: PosItem | null;
  onSave: (modifiers: any[]) => void;
}

export function PosItemModifiersModal({ open, onClose, item, onSave }: PosItemModifiersModalProps) {
  const { t } = useTranslation();
  const [selectedModifiers, setSelectedModifiers] = useState<any[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  const productId = item?.productId ? Number(item.productId) : null;

  // 1. Fetch product-specific modifier groups
  const productGroupsQuery = useQuery({
    queryKey: ['product-modifier-groups', productId],
    queryFn: () => (productId ? addonsApi.getProductModifiers(productId) : Promise.resolve([])),
    enabled: open && !!productId,
  });

  // 2. Fetch all modifier groups as fallback
  const allGroupsQuery = useQuery({
    queryKey: ['all-modifier-groups'],
    queryFn: addonsApi.listModifierGroups,
    enabled: open,
  });

  // 3. Fetch flat legacy addons as fallback
  const addonsQuery = useQuery({
    queryKey: ['addons'],
    queryFn: addonsApi.list,
    enabled: open,
  });

  // Determine active groups or flat addons
  const activeGroups: ModifierGroup[] = useMemo(() => {
    if (productGroupsQuery.data && productGroupsQuery.data.length > 0) {
      return productGroupsQuery.data.filter(g => g.isActive !== false);
    }
    if (allGroupsQuery.data && allGroupsQuery.data.length > 0) {
      return allGroupsQuery.data.filter(g => g.isActive !== false);
    }
    return [];
  }, [productGroupsQuery.data, allGroupsQuery.data]);

  const flatAddons = useMemo(() => {
    return (addonsQuery.data || []).filter(a => a.isActive !== false);
  }, [addonsQuery.data]);

  const hasGroups = activeGroups.length > 0;
  const isLoading = productGroupsQuery.isLoading || allGroupsQuery.isLoading || addonsQuery.isLoading;

  useEffect(() => {
    if (open && item) {
      setSelectedModifiers(item.modifiers ? [...item.modifiers] : []);
      setValidationError(null);
    }
  }, [open, item]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open || !item) return null;

  // Handle option toggle in structured groups
  const handleToggleGroupOption = (group: ModifierGroup, opt: any) => {
    setValidationError(null);
    const existingIndex = selectedModifiers.findIndex(
      m => (m.optionId && m.optionId === opt.id) || (!m.optionId && (m.productId === opt.id || m.name === opt.name))
    );

    if (group.selectionType === 'single') {
      // Remove any previously selected option from this group
      const filtered = selectedModifiers.filter(m => m.groupId !== group.id);
      if (existingIndex >= 0 && !group.isMandatory) {
        // If clicked again on optional single, deselect it
        setSelectedModifiers(filtered);
      } else {
        setSelectedModifiers([
          ...filtered,
          buildGroupModifierSelection(group, opt),
        ]);
      }
    } else {
      // Multiple selection
      if (existingIndex >= 0) {
        // Option already selected, toggle off or decrease
        const next = [...selectedModifiers];
        next.splice(existingIndex, 1);
        setSelectedModifiers(next);
      } else {
        // Check max selections
        const currentGroupCount = selectedModifiers.filter(m => m.groupId === group.id).length;
        if (group.maxSelections && group.maxSelections > 0 && currentGroupCount >= group.maxSelections) {
          setValidationError(`الحد الأقصى للاختيار في مجموعة "${group.name}" هو ${group.maxSelections}`);
          return;
        }

        setSelectedModifiers([
          ...selectedModifiers,
          buildGroupModifierSelection(group, opt),
        ]);
      }
    }
  };

  // Handle flat legacy addons toggle
  const handleToggleFlatAddon = (addon: any) => {
    setValidationError(null);
    const existingIndex = selectedModifiers.findIndex(
      m => String(m.productId) === String(addon.id) || String(m.name) === addon.name
    );

    if (existingIndex >= 0) {
      const next = [...selectedModifiers];
      next[existingIndex].qty += 1;
      setSelectedModifiers(next);
    } else {
      setSelectedModifiers([
        ...selectedModifiers,
        {
          productId: addon.id,
          name: addon.name,
          qty: 1,
          price: Number(addon.price || 0),
          costPrice: Number(addon.costPrice || 0),
        },
      ]);
    }
  };

  const handleDecreaseFlatAddon = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    const next = [...selectedModifiers];
    if (next[index].qty > 1) {
      next[index].qty -= 1;
      setSelectedModifiers(next);
    } else {
      next.splice(index, 1);
      setSelectedModifiers(next);
    }
  };

  const handleSave = () => {
    // Validate mandatory groups
    if (hasGroups) {
      for (const group of activeGroups) {
        const count = selectedModifiers.filter(m => m.groupId === group.id).length;
        if (group.isMandatory && count === 0) {
          setValidationError(`يرجى تحديد اختيار لمجموعة "${group.name}" الإلزامية`);
          return;
        }
        if (group.minSelections && group.minSelections > 0 && count < group.minSelections) {
          setValidationError(`يرجى اختيار ما لا يقل عن ${group.minSelections} في مجموعة "${group.name}"`);
          return;
        }
      }
    }

    onSave(selectedModifiers);
    onClose();
  };

  // Calculate total additional modifier price
  const totalExtraPrice = selectedModifiers.reduce(
    (sum, m) => sum + (Number(m.price || 0) * Number(m.qty || 1)),
    0
  );

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      width="min(750px, 96vw)"
      ariaLabel={t('pos.pos_cart_panel.pos_item_modifiers_modal.s0', "إضافات وتعديلات الصنف")}
      shellClassName="pos-modifiers-dialog-shell"
    >
      <div
        className="modal-surface full-bleed pos-modifiers-modal-shell"
        style={{
          width: '100%',
          maxHeight: '92vh',
          background: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        dir="rtl"
      >
        {/* Header */}
        <header
          className="pos-modifiers-modal-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid #e2e8f0',
            background: '#f8fafc',
            flexShrink: 0,
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
            <div
              className="pos-modifiers-header-icon"
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: '#eff6ff',
                color: '#1d4ed8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <LayersIcon size={20} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h2
                className="pos-modifiers-header-title"
                style={{
                  margin: 0,
                  fontSize: '1.05rem',
                  fontWeight: 800,
                  color: '#0f172a',
                  lineHeight: 1.3,
                  wordBreak: 'break-word',
                }}
              >
                {t('pos.pos_cart_panel.pos_item_modifiers_modal.s1', "خيارات ومعدلات:")} {item.name}
              </h2>
              <div
                className="pos-modifiers-header-sub"
                style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {t('pos.pos_cart_panel.pos_item_modifiers_modal.s2', "السعر الأساسي:")} {item.price} {t('pos.pos_cart_panel.pos_item_modifiers_modal.s3', "ج | الإضافات المختارة: +")}{totalExtraPrice.toFixed(2)} {t('pos.pos_cart_panel.pos_item_modifiers_modal.s4', "ج")}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="pos-modifiers-close-btn"
            onClick={onClose}
            aria-label={t('pos.pos_cart_panel.pos_item_modifiers_modal.s5', "إغلاق")}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#64748b',
              padding: 6,
              borderRadius: 6,
              flexShrink: 0,
            }}
          >
            <XIcon size={20} />
          </button>
        </header>

        {/* Body */}
        <div className="modal-body pos-modifiers-modal-body" style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
          {validationError && (
            <div
              style={{
                marginBottom: 16,
                padding: '10px 14px',
                borderRadius: 8,
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                fontSize: '0.85rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <AlertCircleIcon size={18} />
              <span>{validationError}</span>
            </div>
          )}

          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>{t('pos.pos_cart_panel.pos_item_modifiers_modal.s6', "جاري تحميل خيارات المنتج...")}</div>
          ) : hasGroups ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {activeGroups.map(group => {
                const groupSelections = selectedModifiers.filter(m => m.groupId === group.id);
                const isSatisfied = !group.isMandatory || groupSelections.length >= (group.minSelections || 1);

                return (
                  <div
                    key={group.id}
                    style={{
                      border: isSatisfied ? '1px solid #e2e8f0' : '1px solid #fca5a5',
                      borderRadius: 12,
                      padding: 16,
                      background: '#ffffff',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 14,
                        paddingBottom: 8,
                        borderBottom: '1px solid #f1f5f9',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: '0.98rem', color: '#1e293b' }}>
                          {group.name}
                        </span>
                        {group.isMandatory ? (
                          <span
                            style={{
                              fontSize: '0.72rem',
                              fontWeight: 600,
                              background: '#fee2e2',
                              color: '#991b1b',
                              padding: '2px 8px',
                              borderRadius: 6,
                            }}
                          >
                            {t('pos.pos_cart_panel.pos_item_modifiers_modal.s7', "مطلوب إلزامي")}
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: '0.72rem',
                              fontWeight: 600,
                              background: '#f1f5f9',
                              color: '#475569',
                              padding: '2px 8px',
                              borderRadius: 6,
                            }}
                          >
                            {t('pos.pos_cart_panel.pos_item_modifiers_modal.s8', "اختياري")}
                          </span>
                        )}
                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          ({group.selectionType === 'single' ? t('pos.pos_cart_panel.pos_item_modifiers_modal.s9', "اختيار واحد فقط") : t('pos.pos_cart_panel.pos_item_modifiers_modal.s10', "خيارات متعددة")})
                        </span>
                      </div>
                      <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                        {t('pos.pos_cart_panel.pos_item_modifiers_modal.s11', "تم تحديد")} {groupSelections.length}
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
                      {(group.options || []).filter(opt => opt.isActive !== false).map(opt => {
                        const isSelected = selectedModifiers.some(
                          m => m.optionId === opt.id || (!m.optionId && m.productId === opt.id)
                        );
                        const optPrice = Number(opt.price || 0);

                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => handleToggleGroupOption(group, opt)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '10px 14px',
                              borderRadius: 10,
                              border: isSelected ? '2px solid #170e5e' : '1px solid #cbd5e1',
                              background: isSelected ? '#f5f3ff' : '#ffffff',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                              textAlign: 'right',
                              boxShadow: isSelected ? '0 2px 4px rgba(23, 14, 94, 0.08)' : 'none',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div
                                style={{
                                  width: 18,
                                  height: 18,
                                  borderRadius: group.selectionType === 'single' ? '50%' : 4,
                                  border: isSelected ? '2px solid #170e5e' : '1px solid #94a3b8',
                                  background: isSelected ? '#170e5e' : '#ffffff',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: '#ffffff',
                                  flexShrink: 0,
                                }}
                              >
                                {isSelected && (
                                  group.selectionType === 'single' ? (
                                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#ffffff' }} />
                                  ) : (
                                    <CheckIcon size={12} strokeWidth={3} />
                                  )
                                )}
                              </div>
                              <span style={{ fontWeight: 600, fontSize: '0.88rem', color: '#0f172a' }}>
                                {opt.name}
                              </span>
                            </div>

                            <span
                              style={{
                                fontSize: '0.8rem',
                                fontWeight: 700,
                                color: optPrice > 0 ? '#15803d' : '#64748b',
                              }}
                            >
                              {optPrice > 0 ? `+${optPrice} ج` : t('pos.pos_cart_panel.pos_item_modifiers_modal.s12', "مجاني")}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : flatAddons.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '40px',
                color: '#64748b',
                background: '#f8fafc',
                borderRadius: '12px',
                border: '1px dashed #cbd5e1',
              }}
            >
              {t('pos.pos_cart_panel.pos_item_modifiers_modal.s13', "لا توجد خيارات أو إضافات معرفة لهذا المنتج")}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '14px' }}>
              {flatAddons.map(addon => {
                const modIndex = selectedModifiers.findIndex(
                  m => String(m.productId) === String(addon.id) || String(m.name) === addon.name
                );
                const isSelected = modIndex >= 0;
                const qty = isSelected ? selectedModifiers[modIndex].qty : 0;

                return (
                  <div
                    key={addon.id}
                    onClick={() => handleToggleFlatAddon(addon)}
                    style={{
                      padding: '16px',
                      borderRadius: '12px',
                      border: isSelected ? '2px solid #170e5e' : '1px solid #e2e8f0',
                      background: isSelected ? '#f5f3ff' : '#ffffff',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      textAlign: 'center',
                      gap: '8px',
                      transition: 'all 0.15s ease',
                      position: 'relative',
                      userSelect: 'none',
                    }}
                  >
                    <span style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.95rem' }}>{addon.name}</span>
                    <span style={{ color: '#15803d', fontSize: '0.9rem', fontWeight: 600 }}>{addon.price} {t('pos.pos_cart_panel.pos_item_modifiers_modal.s14', "ج")}</span>

                    {isSelected && (
                      <div
                        style={{
                          position: 'absolute',
                          top: '-8px',
                          right: '-8px',
                          background: '#170e5e',
                          color: 'white',
                          width: '24px',
                          height: '24px',
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 'bold',
                          fontSize: '0.85rem',
                        }}
                      >
                        {qty}
                      </div>
                    )}

                    {isSelected && (
                      <button
                        type="button"
                        onClick={e => handleDecreaseFlatAddon(e, modIndex)}
                        style={{
                          marginTop: '4px',
                          background: '#e0e7ff',
                          border: 'none',
                          borderRadius: '6px',
                          width: '100%',
                          padding: '4px',
                          cursor: 'pointer',
                          color: '#3730a3',
                          fontWeight: 700,
                          fontSize: '0.8rem',
                        }}
                      >
                        {t('pos.pos_cart_panel.pos_item_modifiers_modal.s15', "إزالة / تقليل")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer
          className="pos-modifiers-modal-footer"
          style={{
            padding: '14px 20px',
            background: '#f8fafc',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexShrink: 0,
            boxSizing: 'border-box',
            width: '100%',
          }}
        >
          <div
            className="pos-modifiers-footer-total"
            style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap' }}
          >
            {t('pos.pos_cart_panel.pos_item_modifiers_modal.s16', "المجموع الإضافي:")} <span style={{ color: '#15803d', fontWeight: 800 }}>+{totalExtraPrice.toFixed(2)} {t('pos.pos_cart_panel.pos_item_modifiers_modal.s17', "ج")}</span>
          </div>

          <div
            className="pos-modifiers-footer-actions"
            style={{ display: 'flex', gap: '8px', alignItems: 'center' }}
          >
            <button
              type="button"
              className="btn btn-secondary pos-modifiers-cancel-btn"
              onClick={onClose}
              style={{ height: '38px', padding: '0 16px', fontSize: '13px', fontWeight: 600, minWidth: 0 }}
            >
              {t('pos.pos_cart_panel.pos_item_modifiers_modal.s18', "إلغاء")}
            </button>
            <button
              type="button"
              className="btn btn-primary pos-modifiers-save-btn"
              onClick={handleSave}
              style={{
                height: '38px',
                padding: '0 18px',
                fontSize: '13px',
                fontWeight: 700,
                background: '#170e5e',
                borderColor: '#170e5e',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              {t('pos.pos_cart_panel.pos_item_modifiers_modal.s19', "تأكيد وحفظ الإضافات")}
            </button>
          </div>
        </footer>
      </div>
    </DialogShell>
  );
}

