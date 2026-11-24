import { useTranslation } from 'react-i18next';
import React, { useEffect, useMemo, useState } from 'react';
import { matchesArabic, normalizeArabicSearchKey, scoreArabicSearchRelevance } from '@/lib/arabic-normalization';
import { translateUiText } from '@/lib/auto-translator';

const normalizeLookupText = (value: unknown) => normalizeArabicSearchKey(value);

export interface ComboboxSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ id: string; label: string }>;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  onCreateNew?: (name: string) => void;
  createLabel?: string;
  isPending?: boolean;
}

export function ComboboxSelect({
  value,
  onChange,
  options,
  placeholder = 'ابحث...',
  emptyLabel = 'بدون',
  disabled,
  onCreateNew,
  createLabel,
  isPending,
}: ComboboxSelectProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';

  const getOptionLabel = (label: string) => {
    if (!isEn || !label) return label;
    return translateUiText(label) || label;
  };

  const resolvedPlaceholder = isEn && placeholder === 'ابحث...' ? 'Search...' : (isEn && placeholder ? (translateUiText(placeholder) || placeholder) : placeholder);
  const resolvedEmptyLabel = isEn && emptyLabel === 'بدون' ? 'None' : (isEn && emptyLabel ? (translateUiText(emptyLabel) || emptyLabel) : emptyLabel);
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const selectedOption = options.find((o) => o.id === value);

  useEffect(() => {
    if (!isOpen) {
      setQuery(selectedOption ? getOptionLabel(selectedOption.label) : '');
    }
  }, [isOpen, selectedOption, isEn]);

  const filteredOptions = useMemo(() => {
    const q = normalizeLookupText(query);
    if (!q || (selectedOption && normalizeLookupText(selectedOption.label) === q)) return options;
    return options
      .filter((o) => matchesArabic(o.label, query))
      .map((o, idx) => ({ o, idx, score: scoreArabicSearchRelevance(o.label, query) || 100 }))
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.idx - b.idx))
      .map((entry) => entry.o);
  }, [options, query, selectedOption]);

  const hasExactMatch = useMemo(() => {
    const q = normalizeLookupText(query);
    return !q || options.some((o) => normalizeLookupText(o.label) === q);
  }, [options, query]);

  function handleSelect(optionId: string) {
    onChange(optionId);
    setIsOpen(false);
  }

  function handleBlur() {
    window.setTimeout(() => setIsOpen(false), 150);
  }

  const showCreateOption = Boolean(onCreateNew && query.trim() && !hasExactMatch && !isPending);
  const totalOptions = filteredOptions.length + (showCreateOption ? 1 : 0) + 1;

  useEffect(() => {
    if (highlightedIndex >= totalOptions) {
      setHighlightedIndex(Math.max(totalOptions - 1, 0));
    }
  }, [totalOptions, highlightedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.min(prev + 1, totalOptions - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex === 0) {
        handleSelect('');
      } else if (highlightedIndex <= filteredOptions.length) {
        const opt = filteredOptions[highlightedIndex - 1];
        if (opt) handleSelect(opt.id);
      } else if (showCreateOption && highlightedIndex === filteredOptions.length + 1) {
        onCreateNew?.(query.trim());
        setIsOpen(false);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        background: '#fff',
        border: '1px solid var(--border, #dbe2ea)',
        borderRadius: 8,
        padding: '0 4px',
        opacity: disabled ? 0.6 : 1,
        pointerEvents: disabled ? 'none' : 'auto'
      }}>
        <input
          className="purchase-prototype-field-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
            setHighlightedIndex(1);
          }}
          onFocus={(e) => {
            setIsOpen(true);
            e.target.select();
          }}
          onClick={(e) => {
            if (!isOpen) setIsOpen(true);
            (e.target as HTMLInputElement).select();
          }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={resolvedPlaceholder}
          disabled={disabled}
          style={{ border: 'none', background: 'transparent', boxShadow: 'none', flex: 1, padding: '7px 8px' }}
        />
        {value ? (
          <button
            type="button"
            onClick={() => { onChange(''); setQuery(''); }}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#9ca3af', padding: '0 4px', fontSize: 13 }}
            title={t('shared.ui.combobox_select.s0', "إلغاء الاختيار")}
          >
            ×
          </button>
        ) : null}
        <span style={{ padding: '0 8px', color: '#9ca3af', fontSize: 12, pointerEvents: 'none', userSelect: 'none' }}>▾</span>
      </div>

      {isOpen && (
        <div
          className="custom-combobox-dropdown"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 1000,
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: 8,
            boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.12), 0 8px 10px -6px rgba(15, 23, 42, 0.06)',
            marginTop: 4,
            maxHeight: 220,
            overflowY: 'auto',
            padding: 4,
          }}
        >
          <button
            type="button"
            style={{ width: '100%', textAlign: isEn ? 'left' : 'right', background: highlightedIndex === 0 ? '#f1f5f9' : 'transparent', border: 'none', padding: '7px 10px', borderRadius: 6, cursor: 'pointer', color: '#64748b', fontSize: '0.84rem' }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleSelect('')}
            onMouseEnter={() => setHighlightedIndex(0)}
          >
            {resolvedEmptyLabel}
          </button>
          {filteredOptions.map((opt, i) => (
            <button
              key={opt.id}
              type="button"
              style={{
                width: '100%',
                textAlign: isEn ? 'left' : 'right',
                background: highlightedIndex === i + 1 ? '#f1f5f9' : 'transparent',
                border: 'none',
                padding: '7px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                fontWeight: value === opt.id ? 700 : 500,
                color: highlightedIndex === i + 1 ? '#0f172a' : '#334155',
                fontSize: '0.86rem',
                transition: 'background 0.12s ease',
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(opt.id)}
              onMouseEnter={() => setHighlightedIndex(i + 1)}
            >
              {getOptionLabel(opt.label)}
            </button>
          ))}
          {filteredOptions.length === 0 && !showCreateOption && (
            <div style={{ padding: '8px 10px', color: '#94a3b8', textAlign: 'center', fontSize: '0.82rem' }}>{t('shared.ui.combobox_select.s1', "لا توجد نتائج")}</div>
          )}
          {showCreateOption && (
            <button
              type="button"
              style={{
                width: '100%',
                textAlign: isEn ? 'left' : 'right',
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                padding: '7px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                color: '#1e40af',
                fontWeight: 700,
                fontSize: '0.84rem',
                marginTop: 4,
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onCreateNew?.(query.trim()); setIsOpen(false); }}
              onMouseEnter={() => setHighlightedIndex(filteredOptions.length + 1)}
            >
              + {createLabel || t('shared.ui.combobox_select.s2', "إضافة")}: "{query.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  );
}
