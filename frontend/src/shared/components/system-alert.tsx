import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Button } from '@/shared/ui/button';
import {
  CheckCircleIcon,
  AlertCircleIcon,
  AlertTriangleIcon,
  XIcon,
} from '@/shared/components/icons/AppIcons';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  title?: string;
  variant: ToastVariant;
  duration: number;
}

type AlertState = {
  isOpen: boolean;
  message: string;
  title?: string;
  variant?: 'info' | 'error' | 'warning' | 'success';
};

export interface ConfirmOptions {
  title?: string;
  message: string;
  badge?: string;
  impactItems?: string[];
  confirmText?: string;
  cancelText?: string;
  variant?: 'primary' | 'danger' | 'warning' | 'info';
  confirmVariant?: 'primary' | 'danger' | 'warning' | 'info';
}

type ConfirmState = {
  isOpen: boolean;
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
};

declare global {
  interface Window {
    __ZS_GLOBAL_SHOW_TOAST__?: (toast: Omit<ToastItem, 'id'>) => void;
    __ZS_GLOBAL_SET_ALERT__?: (state: AlertState) => void;
    __ZS_GLOBAL_CONFIRM__?: (options: ConfirmOptions) => Promise<boolean>;
  }
}

let globalShowToast: ((toast: Omit<ToastItem, 'id'>) => void) | null = null;
let globalSetAlert: ((state: AlertState) => void) | null = null;
let globalConfirm: ((options: ConfirmOptions) => Promise<boolean>) | null = null;

/**
 * Universal System Toast Notification
 * Displays a non-intrusive, auto-dismissing notification banner matching Z-Systems visual identity.
 */
export function showToast(
  message: string,
  variant: ToastVariant = 'info',
  options?: { title?: string; duration?: number }
) {
  const handler = globalShowToast || (typeof window !== 'undefined' ? window.__ZS_GLOBAL_SHOW_TOAST__ : null);
  if (handler) {
    handler({
      message,
      variant,
      title: options?.title,
      duration: options?.duration ?? (variant === 'error' ? 5000 : 3500),
    });
  } else {
    // Console fallback if provider not mounted
    console.log(`[Toast ${variant}]`, message);
  }
}

/**
 * Convenience shortcuts for Toast Notifications:
 * toast.success('تمت العملية بنجاح')
 * toast.error('حدث خطأ أثناء المعالجة')
 * toast.warning('يرجى الانتباه')
 * toast.info('معلومة للنظام')
 */
export const toast = {
  success: (message: string, title?: string, duration?: number) =>
    showToast(message, 'success', { title, duration }),
  error: (message: string, title?: string, duration?: number) =>
    showToast(message, 'error', { title, duration: duration ?? 5000 }),
  warning: (message: string, title?: string, duration?: number) =>
    showToast(message, 'warning', { title, duration }),
  info: (message: string, title?: string, duration?: number) =>
    showToast(message, 'info', { title, duration }),
};

export function useToast() {
  return {
    showToast,
    toast,
    systemAlert,
    systemConfirm,
  };
}

/**
 * Asynchronous Confirmation Dialog (Enterprise replacement for raw window.confirm)
 * Returns a Promise<boolean> that resolves when user clicks Confirm or Cancel.
 * Inviolable rule: NEVER calls native browser window.confirm under any circumstances.
 */
export function systemConfirm(options: ConfirmOptions | string): Promise<boolean> {
  const opts: ConfirmOptions = typeof options === 'string' ? { message: options } : options;
  const handler = globalConfirm || (typeof window !== 'undefined' ? window.__ZS_GLOBAL_CONFIRM__ : null);
  if (handler) {
    return handler(opts);
  }
  // Absolute Zero-Native-Confirm Standard:
  // Under NO circumstances should window.confirm ever be called!
  console.warn('[Z-Systems Safety Guard] systemConfirm invoked before provider registered. Resolving safely with warning toast.');
  showToast(opts.message, 'warning', { title: opts.title || 'تأكيد العملية' });
  return Promise.resolve(true);
}

/**
 * Modal Alert Dialog (for critical confirmation or mandatory user acknowledge)
 * Inviolable rule: NEVER calls native browser window.alert under any circumstances.
 */
export function systemAlert(
  messageOrOptions: string | { message: string; title?: string; variant?: AlertState['variant'] },
  title: string = 'تنبيه',
  variant: AlertState['variant'] = 'info'
) {
  const message = typeof messageOrOptions === 'string' ? messageOrOptions : messageOrOptions.message;
  const finalTitle = typeof messageOrOptions === 'string' ? title : (messageOrOptions.title || 'تنبيه');
  const finalVariant = typeof messageOrOptions === 'string' ? variant : (messageOrOptions.variant || 'info');

  const handler = globalSetAlert || (typeof window !== 'undefined' ? window.__ZS_GLOBAL_SET_ALERT__ : null);
  if (handler) {
    handler({ isOpen: true, message, title: finalTitle, variant: finalVariant });
  } else {
    showToast(message, finalVariant === 'error' ? 'error' : finalVariant === 'warning' ? 'warning' : 'info', { title: finalTitle });
  }
}

export function SystemAlertProvider({ children }: { children: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const isLtr = i18n.language === 'en';
  const currentDir = isLtr ? 'ltr' : 'rtl';

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [alertState, setAlertState] = useState<AlertState>({
    isOpen: false,
    message: '',
    title: 'تنبيه',
    variant: 'info',
  });
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    isOpen: false,
    options: { message: '' },
    resolve: () => {},
  });

  const addToast = useCallback((toastData: Omit<ToastItem, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast: ToastItem = { ...toastData, id };

    setToasts((prev) => [...prev.slice(-4), newToast]);

    if (toastData.duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, toastData.duration);
    }
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleConfirmPrompt = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({
        isOpen: true,
        options,
        resolve,
      });
    });
  }, []);

  const handleConfirmClose = useCallback((result: boolean) => {
    setConfirmState((prev) => {
      prev.resolve(result);
      return { ...prev, isOpen: false };
    });
  }, []);

  // Instant synchronization with window globals on render:
  globalShowToast = addToast;
  globalSetAlert = setAlertState;
  globalConfirm = handleConfirmPrompt;
  if (typeof window !== 'undefined') {
    window.__ZS_GLOBAL_SHOW_TOAST__ = addToast;
    window.__ZS_GLOBAL_SET_ALERT__ = setAlertState;
    window.__ZS_GLOBAL_CONFIRM__ = handleConfirmPrompt;
  }

  useEffect(() => {
    globalShowToast = addToast;
    globalSetAlert = setAlertState;
    globalConfirm = handleConfirmPrompt;

    if (typeof window !== 'undefined') {
      window.__ZS_GLOBAL_SHOW_TOAST__ = addToast;
      window.__ZS_GLOBAL_SET_ALERT__ = setAlertState;
      window.__ZS_GLOBAL_CONFIRM__ = handleConfirmPrompt;
    }

    // Global Browser Alert Interceptor:
    // Automatically intercepts any raw window.alert(...) calls across the entire application
    // and upgrades them into modern, non-blocking Z-Systems Toast notifications.
    const originalAlert = window.alert;
    window.alert = (message?: any) => {
      const text = typeof message === 'string' ? message : String(message ?? '');
      if (!text.trim()) return;

      const isError = /فشل|خطأ|تعذر|لم يتم|error|failed|cannot|invalid|خاطئ/i.test(text);
      const isSuccess = /بنجاح|تم|success|saved|created|updated|حفظ|إرسال/i.test(text);
      const isWarning = /يرجى|تنبيه|تحذير|warning|attention|لا يوجد/i.test(text);

      if (isError) {
        addToast({ message: text, variant: 'error', duration: 5000 });
      } else if (isSuccess) {
        addToast({ message: text, variant: 'success', duration: 4000 });
      } else if (isWarning) {
        addToast({ message: text, variant: 'warning', duration: 4500 });
      } else {
        addToast({ message: text, variant: 'info', duration: 4000 });
      }
    };

    // Global Browser Confirm Interceptor (Strict Zero-Native-Confirm Shield):
    // Automatically intercepts any legacy or rogue window.confirm(...) calls across the entire application
    // and routes them to enterprise modals or toasts, preventing native browser dialogs!
    const originalConfirm = window.confirm;
    window.confirm = (message?: string) => {
      const text = typeof message === 'string' ? message : String(message ?? '');
      console.warn('[Z-Systems Zero-Native-Confirm Shield] Blocked native browser window.confirm:', text);
      const activeConfirm = globalConfirm || (typeof window !== 'undefined' ? window.__ZS_GLOBAL_CONFIRM__ : null);
      if (activeConfirm) {
        activeConfirm({ message: text });
      } else {
        addToast({ message: text, variant: 'warning', duration: 5000 });
      }
      return false; // Safely block native modal
    };

    return () => {
      window.alert = originalAlert;
      window.confirm = originalConfirm;
    };
  }, [addToast, handleConfirmPrompt]);

  return (
    <>
      {children}

      {/* Floating System Toast Container */}
      {toasts.length > 0 && (
        <div className="system-toast-container" dir={currentDir}>
          {toasts.map((item) => (
            <div key={item.id} className={`system-toast-card toast-${item.variant}`}>
              <div className={`system-toast-icon-wrapper icon-${item.variant}`}>
                {item.variant === 'success' && <CheckCircleIcon size={18} color="#059669" />}
                {item.variant === 'error' && <AlertCircleIcon size={18} color="#dc2626" />}
                {item.variant === 'warning' && <AlertTriangleIcon size={18} color="#d97706" />}
                {item.variant === 'info' && <AlertCircleIcon size={18} color="#170e5e" />}
              </div>
              <div className="system-toast-body">
                {item.title && <div className="system-toast-title">{item.title}</div>}
                <div className="system-toast-message">{item.message}</div>
              </div>
              <button
                type="button"
                className="system-toast-close-btn"
                onClick={() => removeToast(item.id)}
                aria-label={t('common.close', 'إغلاق')}
              >
                <XIcon size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Upgraded Modal Dialog for systemAlert */}
      <DialogShell
        open={alertState.isOpen}
        onClose={() => setAlertState({ ...alertState, isOpen: false })}
        width="min(440px, 92vw)"
        zIndex={99999}
      >
        <div style={{ padding: '24px 20px', textAlign: 'center' }} dir={currentDir}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              margin: '0 auto 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor:
                alertState.variant === 'success'
                  ? '#ecfdf5'
                  : alertState.variant === 'error'
                  ? '#fef2f2'
                  : alertState.variant === 'warning'
                  ? '#fffbeb'
                  : '#f1f5f9',
            }}
          >
            {alertState.variant === 'success' && <CheckCircleIcon size={26} color="#059669" />}
            {alertState.variant === 'error' && <AlertCircleIcon size={26} color="#dc2626" />}
            {alertState.variant === 'warning' && <AlertTriangleIcon size={26} color="#d97706" />}
            {(!alertState.variant || alertState.variant === 'info') && (
              <AlertCircleIcon size={26} color="#170e5e" />
            )}
          </div>
          <h3
            style={{
              margin: '0 0 10px',
              fontSize: 'var(--font-section-title, 1.02rem)',
              fontWeight: 800,
              color: '#0f172a',
            }}
          >
            {alertState.title}
          </h3>
          <p
            style={{
              margin: '0 0 22px',
              fontSize: 'var(--font-body, 0.85rem)',
              color: '#475569',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
            }}
          >
            {alertState.message}
          </p>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Button
              onClick={() => setAlertState({ ...alertState, isOpen: false })}
              variant="primary"
              style={{
                minWidth: '120px',
                height: '38px',
                backgroundColor: '#170e5e',
                color: '#ffffff',
                fontWeight: 700,
                borderRadius: '8px',
              }}
            >
              {t('common.ok', 'حسناً')}
            </Button>
          </div>
        </div>
      </DialogShell>

      {/* Upgraded Executive Modal Dialog for systemConfirm */}
      <DialogShell
        open={confirmState.isOpen}
        onClose={() => handleConfirmClose(false)}
        width="min(520px, 94vw)"
        zIndex={99999}
      >
        <div style={{ padding: '28px 24px 24px', textAlign: 'center' }} dir={currentDir}>
          {/* Executive Icon Container with Dual Ring & Soft Shadow */}
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '16px',
              margin: '0 auto 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor:
                confirmState.options.variant === 'danger'
                  ? '#fef2f2'
                  : confirmState.options.variant === 'warning'
                  ? '#fffbeb'
                  : '#eef2ff',
              border:
                confirmState.options.variant === 'danger'
                  ? '1px solid #fee2e2'
                  : confirmState.options.variant === 'warning'
                  ? '1px solid #fde68a'
                  : '1px solid #e0e7ff',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
            }}
          >
            {confirmState.options.variant === 'danger' && <AlertCircleIcon size={28} color="#dc2626" />}
            {confirmState.options.variant === 'warning' && <AlertTriangleIcon size={28} color="#d97706" />}
            {(!confirmState.options.variant ||
              confirmState.options.variant === 'primary' ||
              confirmState.options.variant === 'info') && (
              <CheckCircleIcon size={28} color="#170e5e" />
            )}
          </div>

          {/* Title */}
          <h3
            style={{
              margin: '0 0 8px',
              fontSize: 'var(--font-page-title, 1.12rem)',
              fontWeight: 800,
              color: '#0f172a',
              letterSpacing: '-0.2px',
            }}
          >
            {confirmState.options.title || t('common.confirm_action', 'تأكيد الإجراء')}
          </h3>

          {/* Optional Code / Reference Pill Badge */}
          {confirmState.options.badge && (
            <div style={{ marginBottom: '14px' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '4px 12px',
                  backgroundColor: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  color: '#170e5e',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  fontFamily: 'monospace',
                  letterSpacing: '0.5px',
                }}
              >
                {confirmState.options.badge}
              </span>
            </div>
          )}

          {/* Core Message */}
          <p
            style={{
              margin: '0 0 16px',
              fontSize: 'var(--font-body, 0.88rem)',
              color: '#334155',
              lineHeight: 1.65,
              whiteSpace: 'pre-wrap',
            }}
          >
            {confirmState.options.message}
          </p>

          {/* Operational Impact Sub-card (If provided) */}
          {confirmState.options.impactItems && confirmState.options.impactItems.length > 0 && (
            <div
              style={{
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '12px 16px',
                margin: '0 0 22px',
                textAlign: 'start',
              }}
            >
              <div
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  color: '#64748b',
                  marginBottom: '8px',
                }}
              >
                {t('common.operational_impact', 'الأثر التشغيلي للإجراء:')}
              </div>
              <ul style={{ margin: 0, paddingInlineStart: '18px' }}>
                {confirmState.options.impactItems.map((item, idx) => (
                  <li
                    key={idx}
                    style={{
                      fontSize: '0.8125rem',
                      color: '#1e293b',
                      lineHeight: 1.55,
                      marginBottom: idx === confirmState.options.impactItems!.length - 1 ? 0 : '5px',
                    }}
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions Footer */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: '12px',
              marginTop: confirmState.options.impactItems ? '0' : '8px',
            }}
          >
            <Button
              type="button"
              onClick={() => handleConfirmClose(false)}
              variant="secondary"
              style={{
                minWidth: '110px',
                height: '42px',
                padding: '0 18px',
                whiteSpace: 'nowrap',
                borderRadius: '8px',
                borderColor: '#cbd5e1',
                color: '#475569',
                fontWeight: 600,
                fontSize: '0.88rem',
              }}
            >
              {confirmState.options.cancelText || t('common.cancel', 'تراجع')}
            </Button>
            <Button
              type="button"
              onClick={() => handleConfirmClose(true)}
              variant="primary"
              style={{
                minWidth: '140px',
                height: '42px',
                padding: '0 20px',
                whiteSpace: 'nowrap',
                borderRadius: '8px',
                backgroundColor:
                  (confirmState.options.variant === 'danger' || confirmState.options.confirmVariant === 'danger') ? '#dc2626' : '#170e5e',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '0.88rem',
                border: 'none',
                boxShadow:
                  (confirmState.options.variant === 'danger' || confirmState.options.confirmVariant === 'danger')
                    ? '0 2px 8px rgba(220, 38, 38, 0.28)'
                    : '0 2px 8px rgba(23, 14, 94, 0.28)',
              }}
            >
              {confirmState.options.confirmText || t('common.confirm', 'تأكيد')}
            </Button>
          </div>
        </div>
      </DialogShell>
    </>
  );
}

