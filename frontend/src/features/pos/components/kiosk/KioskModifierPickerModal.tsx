/* INV-REST-KIOSK-MODIFIER-UI (R7-B2): the CUSTOMER-facing modifier picker
 * for the self-ordering kiosk. It is deliberately NOT PosItemModifiersModal:
 * that modal is built for the authenticated POS workspace (PosItem shape,
 * the authenticated addonsApi, cashier copy). This one takes its groups as
 * props — the page fetches them through the kiosk hook from the PUBLIC
 * storefront endpoint, so the picker itself never touches any API and the
 * public kiosk gains no auth dependency. Big touch targets, Arabic-first
 * copy, per-option price, mandatory/single/multi rules, qty steppers for
 * multi options, and a running extra total. The selection it returns is
 * the shared GroupModifierSelection shape (group-modifier-mapping.ts), the
 * same shape the POS cart and the online-order DTO speak. */

import { useEffect, useRef, useState } from 'react';
import { DialogShell } from '@/shared/components/dialog-shell';
import { XIcon } from '@/shared/components/icons/AppIcons';
import type { ModifierGroup, ModifierOption } from '@/shared/api/addons.api';
import {
  buildGroupModifierSelection,
  type GroupModifierSelection,
} from '@/features/pos/components/pos-cart-panel/group-modifier-mapping';
import { calcModifiersTotal } from '@/features/pos/lib/pos-modifier-totals';
import {
  validateKioskModifierSelection,
} from '@/features/pos/hooks/useSelfOrderingKiosk';
import { formatCurrency } from '@/lib/format';

interface KioskModifierPickerModalProps {
  open: boolean;
  onClose: () => void;
  productName: string;
  productPrice: number;
  groups: ModifierGroup[];
  /** Pre-picked modifiers when editing an existing cart line. */
  initialModifiers?: GroupModifierSelection[];
  onSave: (modifiers: GroupModifierSelection[]) => void;
  /** Confirm button label: "أضف إلى السلة" for a new line, "تأكيد التعديل" for an edit. */
  saveLabel?: string;
}

export function KioskModifierPickerModal({
  open,
  onClose,
  productName,
  productPrice,
  groups,
  initialModifiers,
  onSave,
  saveLabel = 'أضف إلى السلة',
}: KioskModifierPickerModalProps) {
  const [selectedModifiers, setSelectedModifiers] = useState<GroupModifierSelection[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  // The initial selection is read when the modal OPENS (an edit re-opens
  // it with the line's current picks); later prop changes while open are
  // the customer's own taps, never overwritten.
  const initialRef = useRef(initialModifiers);
  initialRef.current = initialModifiers;
  useEffect(() => {
    if (open) {
      setSelectedModifiers(initialRef.current ? [...initialRef.current] : []);
      setValidationError(null);
    }
  }, [open]);

  if (!open) return null;

  const activeGroups = (groups || []).filter((g) => g.isActive !== false);
  const extraTotal = calcModifiersTotal(selectedModifiers);
  const unitTotal = Number(productPrice || 0) + extraTotal;

  const findSelection = (opt: ModifierOption) =>
    selectedModifiers.findIndex(
      (m) => (m.optionId && m.optionId === opt.id) || (!m.optionId && m.name === opt.name),
    );

  const handleToggleOption = (group: ModifierGroup, opt: ModifierOption) => {
    setValidationError(null);
    const existingIndex = findSelection(opt);

    if (group.selectionType === 'single') {
      // Single-select: the tap replaces the group's pick. Tapping the
      // already-picked option of an OPTIONAL group deselects it; a
      // mandatory group's pick stays (it must have a selection).
      const filtered = selectedModifiers.filter((m) => m.groupId !== group.id);
      if (existingIndex >= 0 && !group.isMandatory) {
        setSelectedModifiers(filtered);
      } else {
        setSelectedModifiers([...filtered, buildGroupModifierSelection(group, opt)]);
      }
      return;
    }

    // Multi-select: tap toggles the option; the max cap is enforced here
    // with a specific error instead of silently ignoring the tap.
    if (existingIndex >= 0) {
      const next = [...selectedModifiers];
      next.splice(existingIndex, 1);
      setSelectedModifiers(next);
      return;
    }
    const currentGroupCount = selectedModifiers.filter((m) => m.groupId === group.id).length;
    if (group.maxSelections && group.maxSelections > 0 && currentGroupCount >= group.maxSelections) {
      setValidationError(`الحد الأقصى للاختيار في مجموعة "${group.name}" هو ${group.maxSelections}`);
      return;
    }
    setSelectedModifiers([...selectedModifiers, buildGroupModifierSelection(group, opt)]);
  };

  const handleChangeOptionQty = (opt: ModifierOption, delta: number) => {
    setValidationError(null);
    const existingIndex = findSelection(opt);
    if (existingIndex < 0) return;
    const next = [...selectedModifiers];
    const nextQty = Number(next[existingIndex].qty || 1) + delta;
    if (nextQty <= 0) {
      next.splice(existingIndex, 1);
    } else {
      next[existingIndex] = { ...next[existingIndex], qty: nextQty };
    }
    setSelectedModifiers(next);
  };

  const handleSave = () => {
    // A mandatory group blocks the add until it is chosen — the customer
    // sees WHICH group is missing, never a generic error.
    const error = validateKioskModifierSelection(activeGroups, selectedModifiers);
    if (error) {
      setValidationError(error);
      return;
    }
    onSave(selectedModifiers);
    onClose();
  };

  const groupHint = (group: ModifierGroup): string => {
    if (group.selectionType === 'single') return 'اختر واحداً';
    const min = Number(group.minSelections || 0);
    const max = Number(group.maxSelections || 0);
    if (min > 0 && max > 0) return `اختر من ${min} إلى ${max}`;
    if (min > 0) return `اختر ${min} على الأقل`;
    if (max > 0) return `اختر حتى ${max}`;
    return 'اختر ما يناسبك';
  };

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      width="min(560px, 96vw)"
      minHeight="min(560px, 85vh)"
      ariaLabel={`إضافات ${productName}`}
      zIndex={10010}
    >
      <div dir="rtl" style={{ padding: '20px 22px', fontFamily: 'inherit' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1.5px solid #f1f5f9',
            paddingBottom: '12px',
            marginBottom: '14px',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '19px', fontWeight: 900, color: '#0f172a' }}>
              إضافات {productName}
            </h3>
            <div style={{ fontSize: '13px', color: '#64748b', marginTop: '3px' }}>
              السعر الأساسي: {formatCurrency(productPrice)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            style={{
              background: '#f1f5f9',
              border: 'none',
              borderRadius: '10px',
              cursor: 'pointer',
              padding: '10px',
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <XIcon size={20} />
          </button>
        </div>

        {activeGroups.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#64748b', fontSize: '14px', padding: '28px 0' }}>
            لا توجد إضافات متاحة لهذا الصنف حالياً
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', maxHeight: '52vh', overflowY: 'auto' }}>
            {activeGroups.map((group) => (
              <div key={group.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '15.5px', fontWeight: 900, color: '#0f172a' }}>{group.name}</span>
                  {group.isMandatory && (
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 900,
                        color: '#b91c1c',
                        backgroundColor: '#fee2e2',
                        padding: '2px 8px',
                        borderRadius: '6px',
                      }}
                    >
                      إلزامي
                    </span>
                  )}
                  <span style={{ fontSize: '12px', color: '#64748b' }}>{groupHint(group)}</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {(group.options || []).map((opt) => {
                    const selectedIndex = findSelection(opt);
                    const isSelected = selectedIndex >= 0;
                    const selectedQty = isSelected ? Number(selectedModifiers[selectedIndex].qty || 1) : 0;
                    const price = Number(opt.price || 0);
                    return (
                      <div
                        key={opt.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '10px',
                          minHeight: '56px',
                          padding: '10px 14px',
                          borderRadius: '14px',
                          border: isSelected ? '2px solid #170e5e' : '1.5px solid #e2e8f0',
                          backgroundColor: isSelected ? '#f5f3ff' : '#ffffff',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => handleToggleOption(group, opt)}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            textAlign: 'right',
                            padding: 0,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                          }}
                        >
                          <span
                            style={{
                              width: '26px',
                              height: '26px',
                              borderRadius: '50%',
                              border: isSelected ? 'none' : '2px solid #cbd5e1',
                              backgroundColor: isSelected ? '#170e5e' : '#ffffff',
                              color: '#ffffff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '15px',
                              fontWeight: 900,
                              flexShrink: 0,
                            }}
                          >
                            {isSelected ? '✓' : ''}
                          </span>
                          <span style={{ minWidth: 0 }}>
                            <span
                              style={{
                                display: 'block',
                                fontSize: '16px',
                                fontWeight: 800,
                                color: '#0f172a',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {opt.name}
                            </span>
                            {opt.nameEn && opt.nameEn !== opt.name && (
                              <span style={{ display: 'block', fontSize: '12px', color: '#64748b' }}>{opt.nameEn}</span>
                            )}
                          </span>
                        </button>

                        <span style={{ fontSize: '15px', fontWeight: 900, color: '#170e5e', whiteSpace: 'nowrap' }}>
                          {price > 0 ? `+${formatCurrency(price)}` : 'مجاناً'}
                        </span>

                        {isSelected && group.selectionType !== 'single' && (
                          /* عداد الكمية الصارم RTL: [+] (الكمية) [-] */
                          <span
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              border: '1.5px solid #170e5e',
                              borderRadius: '10px',
                              overflow: 'hidden',
                              backgroundColor: '#ffffff',
                              flexShrink: 0,
                            }}
                          >
                            <button
                              type="button"
                              aria-label={`زيادة ${opt.name}`}
                              onClick={() => handleChangeOptionQty(opt, 1)}
                              style={{
                                width: '44px',
                                height: '44px',
                                border: 'none',
                                backgroundColor: '#170e5e',
                                color: '#ffffff',
                                fontSize: '20px',
                                fontWeight: 900,
                                cursor: 'pointer',
                              }}
                            >
                              +
                            </button>
                            <span
                              style={{
                                minWidth: '34px',
                                textAlign: 'center',
                                fontWeight: 900,
                                fontSize: '16px',
                                color: '#0f172a',
                              }}
                            >
                              {selectedQty}
                            </span>
                            <button
                              type="button"
                              aria-label={`إنقاص ${opt.name}`}
                              onClick={() => handleChangeOptionQty(opt, -1)}
                              style={{
                                width: '44px',
                                height: '44px',
                                border: 'none',
                                backgroundColor: '#f1f5f9',
                                color: '#334155',
                                fontSize: '20px',
                                fontWeight: 900,
                                cursor: 'pointer',
                              }}
                            >
                              -
                            </button>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {validationError && (
          <div
            role="alert"
            style={{
              marginTop: '14px',
              backgroundColor: '#fee2e2',
              border: '1.5px solid #fecaca',
              borderRadius: '12px',
              padding: '10px 14px',
              fontSize: '14px',
              fontWeight: 800,
              color: '#b91c1c',
            }}
          >
            {validationError}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '16px',
            paddingTop: '14px',
            borderTop: '1.5px solid #f1f5f9',
          }}
        >
          <div>
            <div style={{ fontSize: '12.5px', color: '#64748b' }}>
              إضافات: {extraTotal > 0 ? `+${formatCurrency(extraTotal)}` : formatCurrency(0)}
            </div>
            <div style={{ fontSize: '18px', fontWeight: 900, color: '#170e5e' }}>
              سعر الوحدة: {formatCurrency(unitTotal)}
            </div>
          </div>
          <button
            type="button"
            onClick={handleSave}
            style={{
              height: '52px',
              padding: '0 26px',
              borderRadius: '14px',
              fontSize: '16px',
              fontWeight: 900,
              backgroundColor: '#170e5e',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}
