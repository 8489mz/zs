import { useTranslation } from 'react-i18next';
import { useState, useEffect, useMemo, useRef } from 'react';
import type { Branch } from '@/types/domain';
import { SINGLE_STORE_MODE } from '@/config/product-scope';
import { PASSWORD_MIN_LENGTH_HINT } from '@/config/security';
import { useAuthStore } from '@/stores/auth-store';
import { isPlatformAdmin } from '@/shared/system/runtime-environment';
import type { ManagedUserRecord } from '@/features/settings/api/settings.api';
import { formatDateTime } from '@/features/settings/components/user-management.shared';
import { resolveCurrentVertical } from '@/shared/verticals/vertical-scope';
import {
  COUNTRY_BY_CODE,
  detectCountryFromPhone,
  splitPhoneForEditor,
  SUPPORTED_COUNTRIES,
  validateAndNormalizePhone,
} from '@/shared/utils/phone-utils';

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: '32px',
  minHeight: '32px',
  padding: '0 8px',
  fontSize: '0.82rem',
  fontWeight: 600,
  color: '#0f172a',
  background: '#ffffff',
  border: '1px solid #cbd5e1',
  borderRadius: '6px',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.74rem',
  fontWeight: 700,
  color: '#334155',
  marginBottom: '2px',
};

export function UserManagementEditorCard({
  branches,
  draft,
  currentUserRole: _currentUserRole,
  isCurrentUserSelected,
  selectedDraftDisableProtection,
  canDirectlyDisableSelected,
  onDraftChange,
  onApplyRolePermissions,
}: {
  branches: Branch[];
  draft: ManagedUserRecord;
  currentUserRole?: string;
  isCurrentUserSelected: boolean;
  selectedDraftDisableProtection: 'super_admin' | 'current_user' | 'last_active_privileged' | null;
  canDirectlyDisableSelected: boolean;
  onDraftChange: (updater: (current: ManagedUserRecord) => ManagedUserRecord) => void;
  onApplyRolePermissions: (role: 'super_admin' | 'admin' | 'cashier') => void;
}) {
  const { t } = useTranslation();
  const disableReasonLabel = selectedDraftDisableProtection === 'super_admin'
    ? 'سوبر أدمن'
    : selectedDraftDisableProtection === 'current_user'
      ? 'الحساب الحالي'
      : selectedDraftDisableProtection === 'last_active_privileged'
        ? 'آخر حساب إداري فعّال'
        : '';

  const currentUser = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);
  const vertical = resolveCurrentVertical(tenant);
  const isMaritime = vertical === 'maritime';
  const isContracting = vertical === 'contracting';
  const isPlatformUser = isPlatformAdmin(currentUser);

  const [selectedCountry, setSelectedCountry] = useState<string>(() => {
    return draft.phone ? detectCountryFromPhone(draft.phone) : 'EG';
  });
  const [isPhoneFocused, setIsPhoneFocused] = useState(false);
  const [isCountryDropdownOpen, setIsCountryDropdownOpen] = useState(false);
  const [highlightedCountryIndex, setHighlightedCountryIndex] = useState(0);
  const countryDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (countryDropdownRef.current && !countryDropdownRef.current.contains(e.target as Node)) {
        setIsCountryDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (draft.phone) {
      setSelectedCountry(detectCountryFromPhone(draft.phone));
    }
  }, [draft.id]);

  const currentCountryDef = useMemo(() => {
    return COUNTRY_BY_CODE.get(selectedCountry) || COUNTRY_BY_CODE.get('EG')!;
  }, [selectedCountry]);

  const displayPhoneNumber = useMemo(() => {
    if (!draft.phone) return '';
    const trimmed = String(draft.phone).trim();
    if (trimmed.startsWith('+') || trimmed.startsWith('00')) {
      const split = splitPhoneForEditor(trimmed, selectedCountry);
      return split.nationalNumber || trimmed;
    }
    return trimmed;
  }, [draft.phone, selectedCountry]);

  const phoneValidation = useMemo(() => {
    if (!draft.phone || !String(draft.phone).trim()) {
      return { isValid: false, error: 'رقم الهاتف مطلوب لتسجيل الدخول والتحقق', normalized: '' };
    }
    return validateAndNormalizePhone(draft.phone, selectedCountry);
  }, [draft.phone, selectedCountry]);

  const handleCountrySelect = (code: string) => {
    setSelectedCountry(code);
    setIsCountryDropdownOpen(false);
    onDraftChange((current) => ({ ...current, countryCode: code } as any));
  };

  const handleDropdownKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isCountryDropdownOpen) {
        setIsCountryDropdownOpen(true);
      } else {
        setHighlightedCountryIndex((prev) => (prev < SUPPORTED_COUNTRIES.length - 1 ? prev + 1 : prev));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isCountryDropdownOpen) {
        setIsCountryDropdownOpen(true);
      } else {
        setHighlightedCountryIndex((prev) => (prev > 0 ? prev - 1 : 0));
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (isCountryDropdownOpen) {
        e.preventDefault();
        handleCountrySelect(SUPPORTED_COUNTRIES[highlightedCountryIndex].code);
      } else {
        e.preventDefault();
        setIsCountryDropdownOpen(true);
      }
    } else if (e.key === 'Escape') {
      if (isCountryDropdownOpen) {
        e.preventDefault();
        setIsCountryDropdownOpen(false);
      }
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {/* Sleek Identity Strip (Rendered only when editing an existing user) */}
      {draft.id ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 10px',
          background: '#f8fafc',
          borderRadius: '6px',
          border: '1px solid #e2e8f0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '24px',
              height: '24px',
              borderRadius: '4px',
              background: '#0f172a',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: '0.75rem',
            }}>
              {(draft.name || draft.username || 'U')[0].toUpperCase()}
            </div>
            <strong style={{ fontSize: '0.84rem', color: '#0f172a' }}>
              {draft.name || draft.username}
            </strong>
            <span style={{ fontSize: '0.70rem', color: '#64748b' }}>
              {t('settings.user_management_panels.user_management_editor_card.s0', "(آخر دخول:")} {formatDateTime(draft.lastLoginAt)})
              {isCurrentUserSelected ? t('settings.user_management_panels.user_management_editor_card.s1', " · حسابك الحالي") : ''}
            </span>
          </div>

          <span style={{
            fontSize: '0.70rem',
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: '10px',
            background: draft.isActive !== false ? '#dcfce7' : '#fee2e2',
            color: draft.isActive !== false ? '#166534' : '#991b1b',
            border: `1px solid ${draft.isActive !== false ? '#bbf7d0' : '#fecaca'}`,
          }}>
            {draft.isActive !== false ? t('settings.user_management_panels.user_management_editor_card.s2', "نشط ومفعّل") : t('settings.user_management_panels.user_management_editor_card.s3', "حساب موقوف")}
          </span>
        </div>
      ) : null}

      {/* Main 4-Column Compact Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '6px' }}>
        {/* 1. Username */}
        <div>
          <label style={labelStyle}>{t('settings.user_management_panels.user_management_editor_card.s4', "اسم المستخدم (Login ID)")}</label>
          <input
            style={inputStyle}
            value={draft.username}
            onChange={(e) => onDraftChange((current) => ({ ...current, username: e.target.value }))}
            placeholder={isMaritime ? t('settings.user_management_panels.user_management_editor_card.s5', "مثال: ahmed_ops") : isContracting ? t('settings.user_management_panels.user_management_editor_card.s6', "مثال: eng_ahmed") : t('settings.user_management_panels.user_management_editor_card.s7', "مثال: ahmed_pos")}
          />
        </div>

        {/* 2. Display Name */}
        <div>
          <label style={labelStyle}>{t('settings.user_management_panels.user_management_editor_card.s8', "الاسم المعروض (Display Name)")}</label>
          <input
            style={inputStyle}
            value={draft.name}
            onChange={(e) => onDraftChange((current) => ({ ...current, name: e.target.value }))}
            placeholder={
              isMaritime
                ? t('settings.user_management_panels.user_management_editor_card.s9', "مثال: أحمد محمد (عمليات شحن)")
                : isContracting
                ? t('settings.user_management_panels.user_management_editor_card.s10', "مثال: م. أحمد محمد (مدير مشروع)")
                : t('settings.user_management_panels.user_management_editor_card.s11', "مثال: أحمد محمد (كاشير)")
            }
          />
        </div>

        {/* 3. Unified Mobile Phone Input with Custom Floating Combobox on the LEFT */}
        <div ref={countryDropdownRef} style={{ position: 'relative' }}>
          <label style={labelStyle} dir="rtl">
            <span>{t('settings.user_management_panels.user_management_editor_card.s12', "رقم الهاتف المحمول")}</span>
            <span style={{ color: '#dc2626', marginInlineStart: '2px' }}>*</span>
            <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 500, marginInlineStart: '4px' }} dir="ltr">(Mobile)</span>
          </label>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              height: '32px',
              minHeight: '32px',
              background: '#ffffff',
              border: `1px solid ${
                !draft.phone
                  ? isPhoneFocused || isCountryDropdownOpen ? '#170e5e' : '#cbd5e1'
                  : phoneValidation.isValid
                  ? '#16a34a'
                  : '#ef4444'
              }`,
              borderRadius: '6px',
              boxSizing: 'border-box',
              overflow: 'hidden',
              transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
              boxShadow: isPhoneFocused || isCountryDropdownOpen ? '0 0 0 1px #170e5e' : 'none',
              direction: 'ltr',
            }}
          >
            {/* Country Selector Addon Button on the LEFT (عشمال الرقم) */}
            <button
              type="button"
              onClick={() => setIsCountryDropdownOpen((prev) => !prev)}
              onKeyDown={handleDropdownKeyDown}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                background: '#f8fafc',
                border: 'none',
                borderRight: '1px solid #cbd5e1',
                padding: '0 6px',
                gap: '4px',
                cursor: 'pointer',
                flexShrink: 0,
                outline: 'none',
              }}
              title={t('settings.user_management_panels.user_management_editor_card.s13', "اختر الدولة")}
            >
              <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#0f172a' }}>
                {currentCountryDef.code === 'OTHER' ? 'INTL' : currentCountryDef.code}
              </span>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569' }} dir="ltr">
                {currentCountryDef.dialCode}
              </span>
              <svg
                width="7"
                height="4"
                viewBox="0 0 8 5"
                fill="none"
                style={{
                  marginInlineStart: '1px',
                  transition: 'transform 0.18s ease',
                  transform: isCountryDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                }}
              >
                <path d="M1 1L4 4L7 1" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {/* Local Phone Input to the RIGHT of the code */}
            <input
              style={{
                flex: 1,
                height: '100%',
                padding: '0 8px',
                fontSize: '0.82rem',
                fontWeight: 600,
                color: '#0f172a',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                boxSizing: 'border-box',
                direction: 'ltr',
                textAlign: 'left',
              }}
              type="tel"
              value={displayPhoneNumber}
              onFocus={() => setIsPhoneFocused(true)}
              onBlur={() => setIsPhoneFocused(false)}
              onChange={(e) => {
                const val = e.target.value;
                onDraftChange((current) => ({ ...current, phone: val, countryCode: selectedCountry } as any));
              }}
              placeholder={currentCountryDef.placeholder}
              title={!phoneValidation.isValid ? phoneValidation.error : currentCountryDef.hint}
              dir="ltr"
            />
          </div>

          {/* Premium Floating Combobox Dropdown */}
          {isCountryDropdownOpen && (
            <div
              className="custom-combobox-dropdown"
              style={{
                top: 'calc(100% + 4px)',
                left: 0,
                width: 'max(100%, 230px)',
                maxHeight: '200px',
                overflowY: 'auto',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.12), 0 8px 10px -6px rgba(15, 23, 42, 0.06)',
                padding: '4px',
                zIndex: 1200,
                boxSizing: 'border-box',
              }}
            >
              {SUPPORTED_COUNTRIES.map((c, index) => {
                const isSelected = c.code === selectedCountry;
                const isHighlighted = highlightedCountryIndex === index;
                const cleanName = c.name.replace(/\s*\u200E?\(\+\d+\)/g, '');

                return (
                  <div
                    key={c.code}
                    className={`custom-combobox-option ${isHighlighted ? 'is-highlighted' : ''}`}
                    onClick={() => handleCountrySelect(c.code)}
                    onMouseEnter={() => setHighlightedCountryIndex(index)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '5px 8px',
                      borderRadius: '5px',
                      cursor: 'pointer',
                      background: isSelected ? '#f8fafc' : isHighlighted ? '#f1f5f9' : 'transparent',
                      color: '#0f172a',
                      fontWeight: isSelected ? 700 : 500,
                      fontSize: '0.80rem',
                      gap: '6px',
                      border: isSelected ? '1px solid #e2e8f0' : '1px solid transparent',
                      boxSizing: 'border-box',
                      transition: 'background 0.12s ease',
                      direction: 'rtl',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {isSelected && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#170e5e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                      <span>{cleanName}</span>
                    </div>

                    <span
                      style={{
                        fontSize: '0.70rem',
                        fontWeight: 700,
                        color: isSelected ? '#170e5e' : '#64748b',
                        background: isSelected ? '#eff6ff' : '#f1f5f9',
                        padding: '1px 5px',
                        borderRadius: '4px',
                        border: `1px solid ${isSelected ? '#bfdbfe' : '#e2e8f0'}`,
                      }}
                      dir="ltr"
                    >
                      {c.code === 'OTHER' ? 'INTL' : c.code} {c.dialCode}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 4. Role */}
        <div>
          <label style={labelStyle}>{t('settings.user_management_panels.user_management_editor_card.s14', "مستوى النظام الأساسي (Role)")}</label>
          <select
            style={{ ...inputStyle, cursor: 'pointer', paddingInlineEnd: '20px' }}
            value={draft.role}
            onChange={(e) => onApplyRolePermissions(e.target.value as 'super_admin' | 'admin' | 'cashier')}
            disabled={draft.role === 'super_admin' && !isPlatformUser}
          >
            <option value="cashier">
              {isMaritime
                ? t('settings.user_management_panels.user_management_editor_card.s15', "مسؤول عمليات شحن وتتبع (Ops)")
                : isContracting
                ? t('settings.user_management_panels.user_management_editor_card.s16', "مهندس موقع / مسؤول مشاريع")
                : t('settings.user_management_panels.user_management_editor_card.s17', "كاشير (مبيعات وتشغيل)")}
            </option>
            <option value="admin">
              {isMaritime
                ? t('settings.user_management_panels.user_management_editor_card.s18', "مدير / مالك المكتب الملاحي")
                : isContracting
                ? t('settings.user_management_panels.user_management_editor_card.s19', "مدير مشاريع / مالك المنشأة")
                : t('settings.user_management_panels.user_management_editor_card.s20', "مدير / مالك المنشأة")}
            </option>
            {isPlatformUser ? (
              <option value="super_admin">{t('settings.user_management_panels.user_management_editor_card.s21', "سوبر أدمن (إدارة المنصة)")}</option>
            ) : draft.role === 'super_admin' ? (
              <option value="super_admin" disabled>
                {t('settings.user_management_panels.user_management_editor_card.s22', "سوبر أدمن (إدارة المنصة)")}
              </option>
            ) : null}
          </select>
        </div>

        {/* 5. Password */}
        <div>
          <label style={labelStyle}>{t('settings.user_management_panels.user_management_editor_card.s23', "كلمة المرور")}</label>
          <input
            type="text"
            className="secure-password-field"
            style={inputStyle}
            value={draft.password || ''}
            onChange={(e) => onDraftChange((current) => ({ ...current, password: e.target.value }))}
            placeholder={draft.id ? t('settings.user_management_panels.user_management_editor_card.s24', "اتركها فارغة للتخطي") : t('settings.user_management_panels.user_management_editor_card.s25', "مطلوبة للمستخدم الجديد")}
            autoComplete="new-password"
            data-lpignore="true"
            data-1p-ignore="true"
            data-form-type="other"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            title={PASSWORD_MIN_LENGTH_HINT}
          />
        </div>

        {/* 6. Default Branch */}
        {!SINGLE_STORE_MODE ? (
          <div>
            <label style={labelStyle}>
              {isMaritime ? t('settings.user_management_panels.user_management_editor_card.s26', "المكتب الملاحي الافتراضي") : isContracting ? t('settings.user_management_panels.user_management_editor_card.s27', "المقر / موقع العمل الافتراضي") : t('settings.user_management_panels.user_management_editor_card.s28', "الفرع الافتراضي")}
            </label>
            <select
              style={{ ...inputStyle, cursor: 'pointer', paddingInlineEnd: '20px' }}
              value={draft.defaultBranchId}
              onChange={(e) => onDraftChange((current) => ({ ...current, defaultBranchId: e.target.value }))}
            >
              <option value="">
                {isMaritime ? t('settings.user_management_panels.user_management_editor_card.s29', "بدون مقر افتراضي") : isContracting ? t('settings.user_management_panels.user_management_editor_card.s30', "بدون موقع افتراضي") : t('settings.user_management_panels.user_management_editor_card.s31', "بدون افتراضي")}
              </option>
              {branches.filter((branch) => draft.branchIds.includes(branch.id)).map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
          </div>
        ) : (
          <div />
        )}

        {/* 7. Account Status & Security (Spans 2 columns) */}
        <div style={{ gridColumn: 'span 2' }}>
          <label style={labelStyle}>{t('settings.user_management_panels.user_management_editor_card.s32', "حالة الحساب والأمان")}</label>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            height: '32px',
            padding: '0 8px',
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            boxSizing: 'border-box',
          }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={draft.isActive !== false}
                disabled={!canDirectlyDisableSelected && draft.isActive !== false}
                onChange={(e) => onDraftChange((current) => ({ ...current, isActive: e.target.checked }))}
                style={{ accentColor: '#0f172a', width: '14px', height: '14px', margin: 0 }}
              />
              <span>{t('settings.user_management_panels.user_management_editor_card.s33', "نشط ومفعّل")}</span>
            </label>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={draft.mustChangePassword === true}
                onChange={(e) => onDraftChange((current) => ({ ...current, mustChangePassword: e.target.checked }))}
                style={{ accentColor: '#0f172a', width: '14px', height: '14px', margin: 0 }}
              />
              <span>{t('settings.user_management_panels.user_management_editor_card.s34', "إلزام تغيير كلمة المرور")}</span>
            </label>
            {!canDirectlyDisableSelected ? (
              <span style={{ fontSize: '0.68rem', color: '#dc2626', marginInlineStart: 'auto' }}>
                {t('settings.user_management_panels.user_management_editor_card.s35', "محمي:")} {disableReasonLabel}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

