import { type ReactNode, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { translateUiText } from '@/lib/auto-translator';
import { DialogShell } from '@/shared/components/dialog-shell';
import { XIcon, ArrowRightIcon } from '@/shared/components/icons/AppIcons';
import { Button } from '@/shared/ui/button';

export interface StandardDialogProps {
  open?: boolean;
  isOpen?: boolean;
  onClose: () => void;
  onBack?: () => void;
  backText?: string;
  title: ReactNode;
  /** Widened to match `title`: callers (e.g. job detail headers) compose rich content here, such
   * as a status badge next to the descriptive text, not just plain text. */
  subtitle?: ReactNode;
  children: ReactNode;
  width?: string;
  maxWidth?: string;
  minHeight?: string;
  height?: string;
  maxHeight?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | string;
  zIndex?: number;
  ariaLabel?: string;
  badge?: ReactNode;
  footerActions?: ReactNode;
  footer?: ReactNode;
  loading?: boolean;
  loadingText?: string;
  compact?: boolean;
  shellClassName?: string;
  containerStyle?: CSSProperties;
  bodyStyle?: CSSProperties;
  autoFocus?: boolean;
  closeOnBackdrop?: boolean;
}

/**
 * StandardDialog - المكون المعياري الرسمي للنوافذ المنبثقة (Popups / Modals) في Z-Systems
 * 
 * يضمن:
 * 1. مساحة تنفس وحشو داخلي مريح يمنع تآكل الحواف (Zero Margin Clipping).
 * 2. ثبات أبعاد النافذة تلقائياً ومنع التمدد الفجائي أو الانكماش (Anti-Ballooning & Anti-Shrink Standard).
 * 3. ترويسة مؤسسية موحدة بالخط الأزرق الملكي وزر الإغلاق.
 * 4. خلو تام من كلاسات Tailwind غير المدعومة.
 * 5. أزرار إجراءات قياسية متناسقة مع دستور النظام.
 */
export function StandardDialog({
  open,
  isOpen,
  onClose,
  onBack,
  backText,
  title,
  subtitle,
  badge,
  children,
  width,
  maxWidth,
  minHeight,
  height,
  maxHeight,
  zIndex = 10000,
  ariaLabel,
  footerActions,
  footer,
  loading = false,
  loadingText,
  size,
  compact = false,
  shellClassName = '',
  containerStyle,
  bodyStyle,
  autoFocus = true,
  closeOnBackdrop,
}: StandardDialogProps) {
  const { t: __t } = useTranslation();
  const { t, i18n } = useTranslation();
  const isLtr = i18n.language === 'en';
  const currentDir = isLtr ? 'ltr' : 'rtl';
  const isVisible = open !== undefined ? open : Boolean(isOpen);
  const displayTitle = typeof title === 'string' && isLtr ? (translateUiText(title) || title) : title;
  const displaySubtitle = typeof subtitle === 'string' && isLtr ? (translateUiText(subtitle) || subtitle) : subtitle;
    if (!isVisible) return null;

  const sizeMap: Record<string, string> = {
    sm: 'min(500px, 90vw)',
    md: 'min(680px, 92vw)',
    lg: 'min(840px, 95vw)',
    xl: 'min(1080px, 95vw)',
  };

  const resolvedWidth = width || maxWidth || (size && sizeMap[size]) || 'min(840px, 95vw)';
  const resolvedFooter = footerActions || footer;

  // Universal Pre-balanced Dimensions:
  // Prevents popups from opening collapsed (100px) then jumping/ballooning when async data loads.
  // Can be explicitly overridden with minHeight="auto" for small confirmation dialogs.
  const resolvedHeight = height;
  const resolvedMinHeight =
    minHeight !== undefined
      ? minHeight === 'auto'
        ? undefined
        : minHeight
      : resolvedHeight
      ? undefined
      : 'min(560px, 85vh)';

  const finalShellClass = [compact ? 'dialog-compact' : '', shellClassName].filter(Boolean).join(' ');

  return (
    <DialogShell
      open={isVisible}
      onClose={onClose}
      width={resolvedWidth}
      height={resolvedHeight}
      minHeight={resolvedMinHeight}
      maxHeight={maxHeight}
      zIndex={zIndex}
      shellClassName={finalShellClass}
      ariaLabel={ariaLabel || (typeof displayTitle === 'string' ? displayTitle : (isLtr ? 'Dialog' : __t('shared.standard_dialog.s0', "نافذة منبثقة")))}
      autoFocus={autoFocus}
      closeOnBackdrop={closeOnBackdrop}
    >
      <div
        className={`standard-dialog-container ${compact ? 'standard-dialog-compact' : ''}`}
        dir={currentDir}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          height: resolvedHeight ? '100%' : undefined,
          minHeight: resolvedMinHeight || 'auto',
          display: 'flex',
          flexDirection: 'column',
          ...containerStyle,
        }}
      >
        {/* Header */}
        <div className="standard-dialog-header" style={{ flexWrap: 'nowrap', gap: '8px', minWidth: 0 }}>
          <div className="standard-dialog-header-info" style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, width: '100%' }}>
              <h3
                className="standard-dialog-title"
                style={{
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flexShrink: 1,
                }}
              >
                {displayTitle}
              </h3>
              {badge && (
                <span
                  style={{
                    fontSize: '0.72rem',
                    background: '#eff6ff',
                    color: '#1e40af',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    fontWeight: 700,
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {badge}
                </span>
              )}
            </div>
            {/* div, not p: subtitle can now carry block-level content (e.g. a badge row), and a
                <div> inside a <p> is invalid HTML that browsers silently mis-nest. */}
            {displaySubtitle && (
              <div
                className="standard-dialog-subtitle"
                style={{
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  display: 'block',
                }}
              >
                {displaySubtitle}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="standard-dialog-back-btn"
                aria-label={backText || __t('shared.standard_dialog.s1', "الرجوع لعمليات المطعم")}
                title={backText || __t('shared.standard_dialog.s2', "الرجوع لمركز عمليات المطعم")}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  height: '28px',
                  padding: '0 9px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#f8fafc',
                  color: '#170e5e',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#eef2ff';
                  e.currentTarget.style.borderColor = '#170e5e';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#f8fafc';
                  e.currentTarget.style.borderColor = '#cbd5e1';
                }}
              >
                <ArrowRightIcon size={13} color="#170e5e" style={{ transform: isLtr ? 'scaleX(-1)' : undefined }} />
                <span>{backText || (isLtr ? 'Back' : __t('shared.standard_dialog.s3', "رجوع"))}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="standard-dialog-close-btn"
              aria-label={t('common.close', 'إغلاق')}
              title={t('common.close', 'إغلاق')}
              style={{ flexShrink: 0 }}
            >
              <XIcon size={18} />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div
          className="standard-dialog-body"
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            height: resolvedHeight ? '100%' : undefined,
            minHeight: resolvedHeight ? 0 : (resolvedMinHeight ? '280px' : 'auto'),
            minWidth: 0,
            width: '100%',
            boxSizing: 'border-box',
            overflowY: resolvedHeight ? 'hidden' : undefined,
            ...bodyStyle,
          }}
        >
          {loading ? (
            <div
              style={{
                flex: 1,
                minHeight: '280px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                color: '#64748b',
                backgroundColor: '#f8fafc',
                borderRadius: '8px',
              }}
            >
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  border: '3px solid #cbd5e1',
                  borderTopColor: '#170e5e',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              <span style={{ fontSize: 'var(--font-body)', fontWeight: 600 }}>
                {loadingText || (isLtr ? 'Loading data...' : __t('shared.standard_dialog.s4', "جارٍ تحميل البيانات..."))}
              </span>
            </div>
          ) : (
            children
          )}
        </div>

        {/* Optional Footer */}
        {resolvedFooter && (
          <div className="standard-dialog-footer">
            {resolvedFooter}
          </div>
        )}
      </div>
    </DialogShell>
  );
}

/**
 * StandardDialogFooter - تذييل قياسي لأزرار الحفظ والإلغاء
 */
export interface StandardDialogFooterProps {
  children?: ReactNode;
  style?: CSSProperties;
  className?: string;
  onCancel?: () => void;
  onClose?: () => void;
  onBack?: () => void;
  backText?: string;
  onSubmit?: (e?: any) => void | Promise<void>;
  onConfirm?: (e?: any) => void | Promise<void>;
  cancelText?: string;
  cancelLabel?: string;
  closeLabel?: string;
  submitText?: string;
  submitLabel?: string;
  confirmText?: string;
  confirmLabel?: string;
  primaryLabel?: string;
  onPrimary?: (e?: any) => void | Promise<void>;
  isSubmitting?: boolean;
  isPending?: boolean;
  isPrimaryLoading?: boolean;
  loadingText?: string;
  submitDisabled?: boolean;
  disabled?: boolean;
  isPrimaryDisabled?: boolean;
  extraActions?: ReactNode;
  primaryButton?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    variant?: string;
  };
}

export function StandardDialogFooter({
  onCancel,
  onClose,
  onBack,
  backText,
  onSubmit,
  onConfirm,
  onPrimary,
  cancelText,
  cancelLabel,
  closeLabel,
  submitText,
  submitLabel,
  confirmText,
  confirmLabel,
  primaryLabel,
  isSubmitting = false,
  isPending = false,
  isPrimaryLoading = false,
  loadingText = 'جاري الحفظ...',
  submitDisabled = false,
  disabled = false,
  isPrimaryDisabled = false,
  extraActions,
  primaryButton,
  children,
  style,
  className,
}: StandardDialogFooterProps) {
  const { t } = useTranslation();
  if (children) {
    return (
      <div className={`standard-dialog-footer ${className || ''}`.trim()} style={style}>
        {children}
      </div>
    );
  }

  const handleCancel = onCancel || onClose;
  const handleSubmit = onSubmit || onConfirm || onPrimary || primaryButton?.onClick;
  const resolvedCancelText = cancelText || cancelLabel || closeLabel || 'إلغاء';
  const resolvedSubmitText = confirmText || confirmLabel || submitText || submitLabel || primaryLabel || primaryButton?.label || 'حفظ التغييرات';
  const resolvedIsSubmitting = isSubmitting || isPending || isPrimaryLoading;
  const resolvedSubmitDisabled = submitDisabled || disabled || isPrimaryDisabled || Boolean(primaryButton?.disabled);

  return (
    <div className={`standard-dialog-footer ${className || ''}`.trim()} style={style}>
      {extraActions}
      {onBack && (
        <Button
          type="button"
          variant="secondary"
          onClick={onBack}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
        >
          <ArrowRightIcon size={14} color="#170e5e" />
          <span>{backText || t('shared.standard_dialog.s5', "الرجوع لعمليات المطعم")}</span>
        </Button>
      )}
      {handleCancel && (
        <Button
          type="button"
          variant="secondary"
          onClick={handleCancel}
          disabled={resolvedIsSubmitting}
        >
          {resolvedCancelText}
        </Button>
      )}
      {handleSubmit && (
        <Button
          type="button"
          variant={(primaryButton?.variant as any) || 'primary'}
          onClick={handleSubmit}
          disabled={resolvedSubmitDisabled || resolvedIsSubmitting}
        >
          {resolvedIsSubmitting ? loadingText : resolvedSubmitText}
        </Button>
      )}
    </div>
  );
}
