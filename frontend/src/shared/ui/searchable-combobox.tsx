import { useTranslation } from 'react-i18next';
import { CSSProperties, KeyboardEvent, RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Field } from '@/shared/ui/field';

import { matchesArabic } from '@/lib/arabic-normalization';
import { translateUiText } from '@/lib/auto-translator';

export type ComboboxOption = {
  id: string;
  label?: string;
};

type SearchableComboboxProps<T extends ComboboxOption> = {
  label?: string;
  ariaLabel?: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  options: T[];
  search?: (option: T, query: string) => boolean;
  getLabel: (option: T) => string;
  getMeta?: (option: T) => string | undefined;
  onSelect: (option: T) => void;
  onCreate?: (query: string) => void;
  createLabel?: (query: string) => string;
  emptyLabel?: string;
  error?: string;
  inputId?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  className?: string;
  inputClassName?: string;
  dropdownClassName?: string;
  forceOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  inline?: boolean;
  minSearchLength?: number;
  searchOnSingleDigit?: boolean;
  idleHelperLabel?: string;
  showIdleHelper?: boolean;
  showDropdownOnEmpty?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
  inputStyle?: CSSProperties;
};

const containsDigitLikeCharacter = (value: string) => /[0-9٠-٩۰-۹]/.test(value);
const EMPTY_OPTIONS: any[] = [];

export function SearchableCombobox<T extends ComboboxOption>({
  label,
  ariaLabel,
  placeholder,
  value,
  onChange,
  options,
  search,
  getLabel,
  getMeta,
  onSelect,
  onCreate,
  createLabel,
  emptyLabel = 'لا توجد نتائج',
  error,
  inputId,
  inputRef,
  className,
  inputClassName,
  dropdownClassName,
  forceOpen,
  onOpenChange,
  onKeyDown,
  inline = false,
  minSearchLength = 0,
  searchOnSingleDigit = false,
  idleHelperLabel,
  showIdleHelper = true,
  showDropdownOnEmpty = true,
  disabled,
  style,
  inputStyle,
}: SearchableComboboxProps<T>) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const resolvedPlaceholder = isEn && placeholder ? (translateUiText(placeholder) || placeholder) : placeholder;
  const resolvedEmptyLabel = isEn && emptyLabel ? (translateUiText(emptyLabel) || emptyLabel) : emptyLabel;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties | null>(null);

  const isOpen = forceOpen ?? open;
  const normalizedValue = value.trim();
  const hasDigitLikeSearch = containsDigitLikeCharacter(value);
  const hasSearchIntent = normalizedValue.length >= minSearchLength || (searchOnSingleDigit && hasDigitLikeSearch);
  const filteredOptions = useMemo(
    () => {
      if (!isOpen || !hasSearchIntent) {
        return EMPTY_OPTIONS as T[];
      }
      const results: T[] = [];
      for (let i = 0; i < options.length; i++) {
        const option = options[i];
        if (search) {
          if (search(option, value)) {
            results.push(option);
            if (results.length >= 8) break;
          }
          continue;
        }
        const labelText = getLabel(option);
        if (matchesArabic(labelText, value)) {
          results.push(option);
          if (results.length >= 8) break;
          continue;
        }
        const metaText = getMeta?.(option);
        if (metaText && matchesArabic(metaText, value)) {
          results.push(option);
          if (results.length >= 8) break;
        }
      }
      return results;
    },
    [getLabel, getMeta, hasSearchIntent, isOpen, options, search, value]
  );
  const showCreate = Boolean(onCreate && normalizedValue && hasSearchIntent && filteredOptions.length === 0);
  const optionCount = filteredOptions.length + (showCreate ? 1 : 0);

  const getAnchorElement = () => inputRef?.current ?? (rootRef.current?.querySelector('input') as HTMLInputElement | null);

  const close = useCallback(() => {
    setOpen(false);
    onOpenChange?.(false);
  }, [onOpenChange]);

  const updateDropdownPosition = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const anchor = getAnchorElement();
    if (!anchor) {
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;

    // If anchor is scrolled completely off-screen, close dropdown to avoid floating in empty space
    if (rect.bottom < 0 || rect.top > vh) {
      close();
      return;
    }

    const scrollY = typeof window !== 'undefined' ? (window.scrollY ?? window.pageYOffset ?? document.documentElement.scrollTop ?? 0) : 0;
    const scrollX = typeof window !== 'undefined' ? (window.scrollX ?? window.pageXOffset ?? document.documentElement.scrollLeft ?? 0) : 0;

    const gap = 6;
    const viewportPadding = 8;
    const maxDropdownWidth = Math.max(120, vw - viewportPadding * 2);
    const dropdownWidth = Math.min(Math.max(200, Math.round(rect.width)), maxDropdownWidth);
    const maxLeft = Math.max(viewportPadding, vw - dropdownWidth - viewportPadding);

    const isRtl = typeof document !== 'undefined' && (
      document.documentElement.dir === 'rtl' ||
      (anchor && window.getComputedStyle(anchor).direction === 'rtl')
    );
    let left: number;
    if (isRtl) {
      // In RTL, align right edge of dropdown with right edge of input
      const desiredLeft = Math.round(rect.right - dropdownWidth);
      left = Math.min(Math.max(desiredLeft, viewportPadding), maxLeft) + scrollX;
    } else {
      left = Math.min(Math.max(Math.round(rect.left), viewportPadding), maxLeft) + scrollX;
    }

    const spaceBelow = Math.max(0, vh - rect.bottom - gap - viewportPadding);
    const spaceAbove = Math.max(0, rect.top - gap - viewportPadding);

    // Determine whether to flip above the input:
    // Only flip if space below is genuinely constrained (< 120px) AND space above offers more room
    const shouldFlip = spaceBelow < 120 && spaceAbove > spaceBelow;

    let top: number;
    let maxHeight: number;
    let transform: string | undefined;

    if (shouldFlip) {
      // Anchored directly to top of input in document coordinates
      maxHeight = Math.max(80, Math.min(240, Math.round(spaceAbove)));
      top = Math.round(rect.top + scrollY - gap);
      transform = 'translateY(-100%)';
    } else {
      // Normal placement below the input in document coordinates
      maxHeight = Math.max(80, Math.min(260, Math.round(spaceBelow)));
      top = Math.round(rect.bottom + scrollY + gap);
      transform = 'none';
    }

    setDropdownStyle({
      position: 'absolute',
      left,
      top,
      width: dropdownWidth,
      maxHeight,
      transform,
      transformOrigin: shouldFlip ? 'bottom center' : 'top center',
      boxShadow: shouldFlip
        ? '0 -10px 25px -5px rgba(15, 23, 42, 0.12), 0 -8px 10px -6px rgba(15, 23, 42, 0.06)'
        : undefined,
      overflowY: 'auto',
      zIndex: 10050,
    });
  }, [close, inputRef]);

  useEffect(() => {
    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        close();
      }
    };

    document.addEventListener('mousedown', onDocumentMouseDown);
    return () => document.removeEventListener('mousedown', onDocumentMouseDown);
  }, [close]);

  useEffect(() => {
    if (!isOpen) {
      setHighlightedIndex(-1);
      setDropdownStyle(null);
      return;
    }

    if (filteredOptions.length > 0) {
      setHighlightedIndex(0);
      return;
    }

    setHighlightedIndex(-1);
  }, [isOpen, filteredOptions.length, showCreate]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    updateDropdownPosition();
    const rafId = window.requestAnimationFrame(updateDropdownPosition);

    const handleViewportChange = (e?: Event) => {
      // If scrolling inside the dropdown itself, allow natural scrolling
      if (e && e.type === 'scroll') {
        const target = e.target as Node | null;
        if (dropdownRef.current && (dropdownRef.current === target || (target && dropdownRef.current.contains(target)))) {
          return;
        }
      }
      window.requestAnimationFrame(updateDropdownPosition);
    };

    document.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', handleViewportChange);
      vv.addEventListener('scroll', handleViewportChange);
    }

    return () => {
      window.cancelAnimationFrame(rafId);
      document.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
      if (vv) {
        vv.removeEventListener('resize', handleViewportChange);
        vv.removeEventListener('scroll', handleViewportChange);
      }
    };
  }, [close, inputRef, isOpen, normalizedValue, filteredOptions.length, showCreate, updateDropdownPosition]);

  const openDropdown = () => {
    updateDropdownPosition();
    setOpen(true);
    onOpenChange?.(true);
  };

  const selectOption = (option: T) => {
    // INV-IMPORT-PI-ITEM-PICKER-BIND: the text echo must run BEFORE
    // onSelect. Callers clear derived link state in onChange (typing
    // a new name invalidates the old link) and set it in onSelect;
    // the old order (onSelect then onChange) let the echo wipe the
    // link the selection had just set, so no click or keyboard pick
    // ever bound — the PI dialog showed its suggestion yet stayed
    // "غير مربوط بصنف حقيقي" and the PI could never save, and the
    // feasibility grid in ImportProjectsManager shares the pattern.
    // The selection is the final word now.
    onChange(getLabel(option));
    onSelect(option);
    close();
  };

  const createOption = () => {
    if (!onCreate) {
      close();
      return;
    }

    onCreate(value);
    close();
  };

  const currentOpen = forceOpen ?? open;
  const hasCreateRow = Boolean(showCreate);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!currentOpen) {
        openDropdown();
      }
      setHighlightedIndex((index) => {
        const maxIndex = Math.max(optionCount - 1, 0);
        if (index < 0) {
          return 0;
        }

        return Math.min(index + 1, maxIndex);
      });
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(index - 1, -1));
      return;
    }

    if (event.key === 'Enter') {
      const highlightedOption = highlightedIndex >= 0 ? filteredOptions[highlightedIndex] : undefined;
      if (highlightedOption) {
        event.preventDefault();
        selectOption(highlightedOption);
        return;
      }

      if (hasCreateRow && highlightedIndex === filteredOptions.length) {
        event.preventDefault();
        createOption();
      }
    }
  };

  const shouldRenderDropdown = currentOpen && dropdownStyle && (showDropdownOnEmpty || hasSearchIntent);
  const dropdown = shouldRenderDropdown ? createPortal(
    <div
      ref={dropdownRef}
      className={`purchase-prototype-combobox-dropdown ${dropdownClassName ?? ''}`.trim()}
      role="listbox"
      aria-label={label}
      style={dropdownStyle}
    >
      {filteredOptions.length ? (
        <>
          {filteredOptions.map((option, index) => (
            <button
              key={option.id}
              type="button"
              className={`purchase-prototype-combobox-option${index === highlightedIndex ? ' is-highlighted' : ''}`}
              onMouseEnter={() => setHighlightedIndex(index)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectOption(option)}
            >
              <span className="purchase-prototype-combobox-option-title">{isEn ? (translateUiText(getLabel(option)) || getLabel(option)) : getLabel(option)}</span>
              {getMeta?.(option) ? <span className="purchase-prototype-combobox-option-meta">{getMeta(option)}</span> : null}
            </button>
          ))}
          {hasCreateRow ? (
            <button
              type="button"
              className={`purchase-prototype-combobox-create${highlightedIndex === filteredOptions.length ? ' is-highlighted' : ''}`}
              onMouseEnter={() => setHighlightedIndex(filteredOptions.length)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={createOption}
            >
              {createLabel?.(value)}
            </button>
          ) : null}
        </>
      ) : hasSearchIntent ? (
        <div className="purchase-prototype-combobox-empty">
          <span>{resolvedEmptyLabel}</span>
          {hasCreateRow ? (
            <button
              type="button"
              className={`purchase-prototype-combobox-create${highlightedIndex === filteredOptions.length ? ' is-highlighted' : ''}`}
              onMouseEnter={() => setHighlightedIndex(filteredOptions.length)}
              onClick={createOption}
            >
              {createLabel?.(value)}
            </button>
          ) : null}
        </div>
      ) : showIdleHelper ? (
        <div className="purchase-prototype-combobox-empty purchase-prototype-combobox-helper">
          <span>{idleHelperLabel ?? t('shared.ui.searchable_combobox.s0', "ابدأ بالكتابة لعرض النتائج")}</span>
        </div>
      ) : null}
    </div>,
    document.body
  ) : null;

  return (
    <div
      ref={rootRef}
      className={`purchase-prototype-combobox ${inline ? 'is-inline' : ''} ${className ?? ''}`.trim()}
      style={style}
    >
      {inline ? (
        <input
          ref={inputRef}
          id={inputId}
          className={inputClassName}
          style={inputStyle}
          aria-invalid={Boolean(error)}
          aria-label={ariaLabel || label || placeholder}
          value={value}
          placeholder={resolvedPlaceholder}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={currentOpen}
          onChange={(event) => {
            onChange(event.target.value);
            openDropdown();
          }}
          onFocus={(event) => {
            openDropdown();
            const target = event.currentTarget;
            target.select();
            requestAnimationFrame(() => target.select());
          }}
          onClick={(event) => {
            openDropdown();
            const target = event.currentTarget;
            target.select();
            requestAnimationFrame(() => target.select());
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
      ) : (
        <Field label={label ?? ''} error={error}>
          <input
            ref={inputRef}
            id={inputId}
            className={inputClassName}
            style={inputStyle}
            aria-invalid={Boolean(error)}
            aria-label={ariaLabel || label || placeholder}
            value={value}
            placeholder={resolvedPlaceholder}
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={currentOpen}
            onChange={(event) => {
              onChange(event.target.value);
              openDropdown();
            }}
            onFocus={(event) => {
              openDropdown();
              const target = event.currentTarget;
              target.select();
              requestAnimationFrame(() => target.select());
            }}
            onClick={(event) => {
              openDropdown();
              const target = event.currentTarget;
              target.select();
              requestAnimationFrame(() => target.select());
            }}
            onKeyDown={handleKeyDown}
            disabled={disabled}
          />
        </Field>
      )}
      {dropdown}
    </div>
  );
}
