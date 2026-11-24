import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { matchesArabic, normalizeArabicDigits, scoreArabicSearchRelevance } from '@/lib/arabic-normalization';
import { translateUiText } from '@/lib/auto-translator';

export interface SelectOption {
  value: string | number;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  code?: string;
}

export interface CustomSelectProps {
  value: string | number | undefined | null;
  onChange: (value: string) => void;
  options: readonly SelectOption[] | SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  style?: React.CSSProperties;
  className?: string;
  dropdownAlign?: 'right' | 'left';
  openOnFocus?: boolean;
  onCreateOption?: (query: string) => void | Promise<void>;
  createOptionLabel?: (query: string) => string;
}

export function CustomSelect({
  value,
  onChange,
  options,
  placeholder = 'اختر...',
  disabled = false,
  style,
  className = '',
  dropdownAlign = 'right',
  openOnFocus = false,
  onCreateOption,
  createOptionLabel,
}: CustomSelectProps) {
  const { t } = useTranslation();
  const { i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const isRtl = !isEn && (typeof document !== 'undefined' ? document.documentElement.dir !== 'ltr' : true);

  const getOptionLabel = (label: string) => {
    if (!isEn || !label) return label;
    return translateUiText(label) || label;
  };

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState<number>(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Find currently selected option
  const selectedOption = useMemo(() => {
    return options.find((opt) => String(opt.value) === String(value ?? ''));
  }, [options, value]);

  // Sync display text when value changes and closed
  useEffect(() => {
    if (!isOpen) {
      setQuery(selectedOption ? getOptionLabel(selectedOption.label) : '');
    }
  }, [value, selectedOption, isOpen, isEn]);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        // Reset query back to selected label if user typed something but didn't select
        setQuery(selectedOption ? getOptionLabel(selectedOption.label) : '');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectedOption, isEn]);

  // Filter options based on typed query
  const isSearching = isOpen && query.trim() !== '' && query.trim() !== (selectedOption ? getOptionLabel(selectedOption.label) : '');
  const trimmedQuery = query.trim();
  const hasExactMatch = useMemo(() => {
    if (!trimmedQuery) return true;
    const lower = trimmedQuery.toLowerCase();
    return options.some((opt) => opt.label.trim().toLowerCase() === lower);
  }, [options, trimmedQuery]);
  const canCreate = Boolean(onCreateOption && isSearching && trimmedQuery && !hasExactMatch);

  const filteredOptions = useMemo(() => {
    if (!isSearching) return options;
    const q = query.trim();
    const normalizedQ = normalizeArabicDigits(q);
    const isNumericSearch = /^\d+$/.test(normalizedQ);

    const matched = options.filter((opt) => {
      if (isNumericSearch) {
        const rawCode = String(opt.code || opt.hint?.replace(/[^\d]/g, '') || opt.label.match(/\(([^)]+)\)$/)?.[1] || '').trim();
        if (rawCode) {
          const normalizedCode = normalizeArabicDigits(rawCode);
          const unpaddedCode = normalizedCode.replace(/^0+/, '') || '0';
          const unpaddedQ = normalizedQ.replace(/^0+/, '') || '0';

          // 1. Exact numeric code match: e.g. "2" or "002" matches "002"
          if (unpaddedCode === unpaddedQ) return true;

          // 2. Exact match on raw code: e.g. "002" matches "002"
          if (normalizedCode === normalizedQ) return true;

          // 3. Prefix match on raw code (e.g. typing "00" matches "001", "002", or "12" matches "1250")
          if (normalizedCode.startsWith(normalizedQ)) return true;

          // 4. Exact match on option value if numeric
          if (String(opt.value) === normalizedQ) return true;

          return false;
        }
      }

      return (
        matchesArabic(opt.label, query) ||
        (opt.hint && matchesArabic(opt.hint, query)) ||
        (isEn && opt.label.toLowerCase().includes(query.toLowerCase())) ||
        (isEn && getOptionLabel(opt.label).toLowerCase().includes(query.toLowerCase()))
      );
    });
    if (isNumericSearch) return matched;
    return matched
      .map((opt, idx) => ({
        opt,
        idx,
        score: scoreArabicSearchRelevance(opt.label, query, [opt.code], [opt.hint]) || 100,
      }))
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.idx - b.idx))
      .map((entry) => entry.opt);
  }, [options, query, isSearching, isEn]);

  // Highlight selection
  useEffect(() => {
    if (filteredOptions.length > 0) {
      const idx = filteredOptions.findIndex((opt) => String(opt.value) === String(value ?? ''));
      setHighlightedIndex(idx >= 0 ? idx : 0);
    } else if (canCreate) {
      setHighlightedIndex(0);
    } else {
      setHighlightedIndex(-1);
    }
  }, [filteredOptions.length, value, canCreate]);

  // Scroll highlighted item into view. Guarded: the method does not
  // exist in jsdom (and the `?.` only guards a null ref, not a missing
  // method) — without the guard the dropdown crashes on open. Real
  // browsers always have scrollIntoView, so behaviour is unchanged there.
  useEffect(() => {
    if (isOpen && highlightedIndex >= 0) {
      const el = itemRefs.current[highlightedIndex];
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({
          block: 'nearest',
          behavior: 'smooth',
        });
      }
    }
  }, [highlightedIndex, isOpen]);

  const handleSelect = (opt: SelectOption) => {
    onChange(String(opt.value));
    setQuery(getOptionLabel(opt.label));
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      const maxIndex = canCreate ? filteredOptions.length : filteredOptions.length - 1;
      setHighlightedIndex((prev) => (prev < maxIndex ? prev + 1 : prev));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
      return;
    }

    if (e.key === 'Enter') {
      if (isOpen) {
        if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
          e.preventDefault();
          handleSelect(filteredOptions[highlightedIndex]);
          return;
        }
        if (canCreate && (highlightedIndex === filteredOptions.length || filteredOptions.length === 0)) {
          e.preventDefault();
          void onCreateOption!(trimmedQuery);
          setIsOpen(false);
          return;
        }
      }
      return;
    }

    if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault();
        setIsOpen(false);
        setQuery(selectedOption ? getOptionLabel(selectedOption.label) : '');
      }
      return;
    }

    if (e.key === 'Tab') {
      if (isOpen && filteredOptions.length > 0 && highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
        handleSelect(filteredOptions[highlightedIndex]);
      }
      setIsOpen(false);
    }
  };

  const {
    border,
    borderRadius,
    background,
    backgroundColor,
    height,
    fontSize,
    fontWeight,
    color,
    textAlign,
    ...wrapperStyle
  } = (style || {}) as any;

  const effectivePlaceholder = isEn
    ? (translateUiText(placeholder) || (placeholder === 'اختر...' ? 'Select...' : placeholder))
    : placeholder;

  return (
    <div
      ref={containerRef}
      className={`custom-select-wrapper ${className}`.trim()}
      style={{
        position: 'relative',
        width: '100%',
        ...wrapperStyle,
        ...(isOpen ? { zIndex: 60 } : {}),
      }}
    >
      <div style={{ position: 'relative', width: '100%' }}>
        {selectedOption?.icon && !isSearching && (
          <div
            style={{
              position: 'absolute',
              ...(isRtl ? { right: '8px', left: 'auto' } : { left: '8px', right: 'auto' }),
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#334155',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          >
            {selectedOption.icon}
          </div>
        )}
        <input
          ref={inputRef}
          type="text"
          name="custom_select_search_field"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-lpignore="true"
          data-form-type="other"
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          disabled={disabled}
          value={query}
          placeholder={effectivePlaceholder}
          className="purchase-prototype-field-input"
          style={{
            width: '100%',
            height: height || '36px',
            background: background || backgroundColor || (disabled ? '#f8fafc' : '#ffffff'),
            padding: isRtl
              ? (selectedOption?.icon && !isSearching ? '0 28px 0 24px' : (canCreate ? '0 8px 0 54px' : '0 8px 0 24px'))
              : (selectedOption?.icon && !isSearching ? '0 24px 0 28px' : (canCreate ? '0 54px 0 8px' : '0 24px 0 8px')),
            borderRadius: borderRadius || '8px',
            border: border || '1px solid #cbd5e1',
            boxSizing: 'border-box',
            fontSize: fontSize || '13px',
            color: color || '#0f172a',
            fontWeight: fontWeight || 500,
            cursor: disabled ? 'not-allowed' : 'text',
            textAlign: textAlign || (isRtl ? 'right' : 'left'),
            textOverflow: 'ellipsis',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            display: 'block',
            lineHeight: 'normal',
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={(e) => {
            if (disabled) return;
            if (openOnFocus) {
              setIsOpen(true);
            }
            const target = e.currentTarget;
            target.select();
            requestAnimationFrame(() => {
              target.select();
            });
          }}
          onClick={(e) => {
            if (disabled) return;
            if (!isOpen) setIsOpen(true);
            const target = e.currentTarget;
            target.select();
            requestAnimationFrame(() => {
              target.select();
            });
          }}
          onKeyDown={handleKeyDown}
        />

        {/* Chevron Toggle Button */}
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            const next = !isOpen;
            setIsOpen(next);
            if (next) {
              inputRef.current?.focus();
              inputRef.current?.select();
            }
          }}
          style={{
            position: 'absolute',
            ...(isRtl ? { left: '6px', right: 'auto' } : { right: '6px', left: 'auto' }),
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'none',
            border: 'none',
            padding: '2px',
            cursor: disabled ? 'default' : 'pointer',
            color: '#64748b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2,
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transition: 'transform 0.18s ease',
              transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>

        {/* Quick Add (+) Button when typing new item */}
        {canCreate && (
          <button
            type="button"
            title={createOptionLabel ? createOptionLabel(trimmedQuery) : `إضافة "${trimmedQuery}"`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void onCreateOption!(trimmedQuery);
              setIsOpen(false);
            }}
            style={{
              position: 'absolute',
              ...(isRtl ? { left: '26px', right: 'auto' } : { right: '26px', left: 'auto' }),
              top: '50%',
              transform: 'translateY(-50%)',
              background: '#170e5e',
              color: '#ffffff',
              border: 'none',
              borderRadius: '5px',
              width: '22px',
              height: '22px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '15px',
              fontWeight: 800,
              zIndex: 3,
              padding: 0,
              boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
            }}
          >
            +
          </button>
        )}
      </div>

      {/* Floating Dropdown Menu */}
      {isOpen && !disabled && (
        <div
          ref={dropdownRef}
          className="custom-combobox-dropdown"
          style={{
            top: 'calc(100% + 4px)',
            ...(dropdownAlign === 'left' || !isRtl ? { left: 0, right: 'auto' } : { right: 0, left: 'auto' }),
            width: 'max(100%, 250px)',
            maxWidth: '85vw',
          }}
        >
          {filteredOptions.length > 0 ? (
            <>
              {filteredOptions.map((opt, index) => {
                const isSelected = String(opt.value) === String(value ?? '');
                const isHighlighted = highlightedIndex === index;

                return (
                  <div
                    key={String(opt.value)}
                    ref={(el) => {
                      itemRefs.current[index] = el;
                    }}
                    className={`custom-combobox-option ${isSelected ? 'is-selected' : ''} ${isHighlighted ? 'is-highlighted' : ''}`}
                    onClick={() => handleSelect(opt)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    style={{
                      fontWeight: isSelected || isHighlighted ? 700 : 500,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                      {opt.icon && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '22px',
                            height: '22px',
                            borderRadius: '4px',
                            background: isSelected ? '#170c5c' : '#f1f5f9',
                            color: isSelected ? '#ffffff' : '#334155',
                            flexShrink: 0,
                          }}
                        >
                          {opt.icon}
                        </span>
                      )}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getOptionLabel(opt.label)}</span>
                    </div>
                    {opt.hint && (
                      <span
                        style={{
                          fontSize: '0.72rem',
                          color: opt.hint.startsWith('#') || /^\d+$/.test(opt.hint) ? '#170e5e' : '#64748b',
                          background: opt.hint.startsWith('#') || /^\d+$/.test(opt.hint) ? '#f1f5f9' : 'transparent',
                          border: opt.hint.startsWith('#') || /^\d+$/.test(opt.hint) ? '1px solid #e2e8f0' : 'none',
                          borderRadius: '4px',
                          padding: opt.hint.startsWith('#') || /^\d+$/.test(opt.hint) ? '1px 6px' : '0',
                          fontFamily: opt.hint.startsWith('#') || /^\d+$/.test(opt.hint) ? 'monospace' : 'inherit',
                          fontWeight: opt.hint.startsWith('#') || /^\d+$/.test(opt.hint) ? 700 : 500,
                          flexShrink: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {isEn && opt.hint ? (translateUiText(opt.hint) || opt.hint) : opt.hint}
                      </span>
                    )}
                  </div>
                );
              })}
              {canCreate && (
                <div
                  ref={(el) => {
                    itemRefs.current[filteredOptions.length] = el;
                  }}
                  className={`custom-combobox-option is-create-option ${highlightedIndex === filteredOptions.length ? 'is-highlighted' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void onCreateOption!(trimmedQuery);
                    setIsOpen(false);
                  }}
                  onMouseEnter={() => setHighlightedIndex(filteredOptions.length)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 12px',
                    background: highlightedIndex === filteredOptions.length ? '#eef2ff' : '#f8fafc',
                    color: '#170e5e',
                    fontWeight: 700,
                    fontSize: '0.825rem',
                    cursor: 'pointer',
                    borderTop: '1px dashed #cbd5e1',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '20px',
                      height: '20px',
                      borderRadius: '4px',
                      background: '#e0e7ff',
                      color: '#170e5e',
                      flexShrink: 0,
                      fontSize: '14px',
                      fontWeight: 800,
                    }}
                  >
                    +
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {createOptionLabel
                      ? createOptionLabel(trimmedQuery)
                      : (isEn ? `Add "${trimmedQuery}"` : `+ إضافة "${trimmedQuery}" جديد`)}
                  </span>
                </div>
              )}
            </>
          ) : canCreate ? (
            <div
              ref={(el) => {
                itemRefs.current[0] = el;
              }}
              className={`custom-combobox-option is-create-option ${highlightedIndex === 0 ? 'is-highlighted' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                void onCreateOption!(trimmedQuery);
                setIsOpen(false);
              }}
              onMouseEnter={() => setHighlightedIndex(0)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '9px 12px',
                background: highlightedIndex === 0 ? '#eef2ff' : '#f8fafc',
                color: '#170e5e',
                fontWeight: 700,
                fontSize: '0.825rem',
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '20px',
                  height: '20px',
                  borderRadius: '4px',
                  background: '#e0e7ff',
                  color: '#170e5e',
                  flexShrink: 0,
                  fontSize: '14px',
                  fontWeight: 800,
                }}
              >
                +
              </span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {createOptionLabel
                  ? createOptionLabel(trimmedQuery)
                  : (isEn ? `Add "${trimmedQuery}"` : `+ إضافة "${trimmedQuery}" جديد`)}
              </span>
            </div>
          ) : (
            <div style={{ padding: '8px 10px', fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center' }}>
              {isEn ? 'No results found' : t('shared.ui.custom_select.s0', "لا توجد نتائج")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
