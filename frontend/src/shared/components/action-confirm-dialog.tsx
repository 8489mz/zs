import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { translateUiText } from '@/lib/auto-translator';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { DialogShell } from '@/shared/components/dialog-shell';
import { getErrorMessage } from '@/lib/errors';

interface ActionConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'primary' | 'secondary' | 'success' | 'danger';
  isBusy?: boolean;
  confirmationKeyword?: string;
  confirmationLabel?: string;
  confirmationHint?: ReactNode;
  managerPinRequired?: boolean;
  managerPinLabel?: string;
  managerPinHint?: ReactNode;
  managerPinPlaceholder?: string;
  managerPinInputType?: 'password' | 'text';
  reasonRequired?: boolean;
  reasonLabel?: string;
  reasonHint?: ReactNode;
  reasonPlaceholder?: string;
  minReasonLength?: number;
  overlayClassName?: string;
  shellClassName?: string;
  onConfirm: (context: { confirmationValue: string; managerPin: string; reason: string }) => void | Promise<void>;
  onCancel: () => void;
}

export function ActionConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  confirmVariant = 'danger',
  isBusy = false,
  confirmationKeyword = '',
  confirmationLabel,
  confirmationHint,
  managerPinRequired = false,
  managerPinLabel,
  managerPinHint,
  managerPinPlaceholder,
  managerPinInputType,
  reasonRequired = false,
  reasonLabel,
  reasonHint,
  reasonPlaceholder,
  minReasonLength = 1,
  overlayClassName = '',
  shellClassName = '',
  onConfirm,
  onCancel
}: ActionConfirmDialogProps) {
  const { t: __t, i18n } = useTranslation();
  const { t } = useTranslation();
  const isEn = i18n.language === 'en';

      const resolvedConfirmLabel = isEn ? (confirmLabel ? (translateUiText(confirmLabel) || confirmLabel) : 'Confirm') : (confirmLabel || t('common.confirm', 'تأكيد'));
  const resolvedCancelLabel = isEn ? (cancelLabel ? (translateUiText(cancelLabel) || cancelLabel) : 'Cancel') : (cancelLabel || t('common.cancel', 'إلغاء'));
  const [confirmationValue, setConfirmationValue] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [reason, setReason] = useState('');
  const [submitError, setSubmitError] = useState<string>('');

  useEffect(() => {
    if (!open) {
      setConfirmationValue('');
      setManagerPin('');
      setReason('');
      setSubmitError('');
    }
  }, [open]);

  const requiresKeyword = Boolean(confirmationKeyword.trim());
  const isKeywordMatched = useMemo(() => {
    if (!requiresKeyword) return true;
    return confirmationValue.trim() === confirmationKeyword.trim();
  }, [confirmationKeyword, confirmationValue, requiresKeyword]);

  const trimmedReason = reason.trim();
  const isManagerPinReady = !managerPinRequired || Boolean(managerPin.trim());
  const isReasonReady = !reasonRequired || trimmedReason.length >= minReasonLength;
  const canSubmit = isKeywordMatched && isManagerPinReady && isReasonReady && !isBusy;

  async function handleConfirm() {
    if (!canSubmit) return;

    setSubmitError('');

    try {
      await onConfirm({
        confirmationValue: confirmationValue.trim(),
        managerPin: managerPin.trim(),
        reason: trimmedReason,
      });
    } catch (error) {
      setManagerPin('');
      setSubmitError(getErrorMessage(error, 'تعذر تنفيذ العملية المطلوبة.'));
    }
  }

  if (!open) return null;

  return (
    <DialogShell open={open} onClose={isBusy ? () => {} : onCancel} width="min(560px, 100%)" zIndex={60} overlayClassName={overlayClassName} shellClassName={shellClassName}>
      <Card title={title} className="dialog-card">
        <div className="dialog-description" style={{ fontSize: '1.05rem', color: '#334155', fontWeight: 500, lineHeight: 1.6 }}>{description}</div>

        {requiresKeyword ? (
          <div className="field" style={{ marginTop: 16 }}>
            <label>
              <span>{confirmationLabel}</span>
              <input
                value={confirmationValue}
                onChange={(event) => {
                  setConfirmationValue(event.target.value);
                  if (submitError) setSubmitError('');
                }}
                placeholder={confirmationKeyword}
                autoFocus={!managerPinRequired}
                disabled={isBusy}
              />
            </label>
            <div className="muted small" style={{ marginTop: 8 }}>
              {confirmationHint || `اكتب ${confirmationKeyword} لتأكيد العملية.`}
            </div>
          </div>
        ) : null}

        {reasonRequired ? (
          <div className="field" style={{ marginTop: 16 }}>
            <label>
              <span>{reasonLabel}</span>
              <textarea
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  if (submitError) setSubmitError('');
                }}
                placeholder={reasonPlaceholder}
                rows={3}
                disabled={isBusy}
              />
            </label>
            <div className="muted small" style={{ marginTop: 8 }}>
              {reasonHint || (minReasonLength > 1 ? `اكتب سببًا واضحًا لا يقل عن ${minReasonLength} أحرف.` : 'اكتب سببًا واضحًا.')}
            </div>
          </div>
        ) : null}

        {managerPinRequired ? (
          <div className="field" style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {managerPinLabel ? (
              <label htmlFor="pin_verification_entry" style={{ display: 'block', fontWeight: 700, fontSize: 13, color: '#1e293b' }}>
                {managerPinLabel}
              </label>
            ) : null}
            <input
              value={managerPin}
              onChange={(event) => {
                setManagerPin(event.target.value);
                if (submitError) setSubmitError('');
              }}
              type={managerPinInputType || (String(managerPinHint || '').includes(__t('shared.action_confirm_dialog.s0', "كلمة مرور")) || managerPinLabel?.includes(__t('shared.action_confirm_dialog.s1', "كلمة مرور")) ? 'password' : 'text')}
              id="pin_verification_entry"
              name="pin_verification_entry"
              placeholder={managerPinPlaceholder || (String(managerPinHint || '').includes(__t('shared.action_confirm_dialog.s2', "كلمة مرور")) || managerPinLabel?.includes(__t('shared.action_confirm_dialog.s3', "كلمة مرور")) ? __t('shared.action_confirm_dialog.s4', "أدخل كلمة المرور الحالية") : __t('shared.action_confirm_dialog.s5', "أدخل الرمز"))}
              inputMode={managerPinInputType === 'password' || String(managerPinHint || '').includes(__t('shared.action_confirm_dialog.s6', "كلمة مرور")) || managerPinLabel?.includes(__t('shared.action_confirm_dialog.s7', "كلمة مرور")) ? undefined : 'numeric'}
              autoComplete="current-password"
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus={managerPinRequired && !requiresKeyword}
              disabled={isBusy}
              style={{
                width: '100%',
                minHeight: 42,
                padding: '8px 14px',
                borderRadius: 10,
                border: '1.5px solid #cbd5e1',
                background: '#ffffff',
                color: '#0f172a',
                fontSize: 14,
                fontWeight: 600,
                boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
            <div className="muted small" style={{ marginTop: 4, color: '#64748b', fontSize: 12 }}>
              {managerPinHint || __t('shared.action_confirm_dialog.s8', "أدخل رمز اعتماد المدير لإتمام هذه العملية.")}
            </div>
          </div>
        ) : null}

        {submitError ? (
          <div
            role="alert"
            style={{
              marginTop: 16,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid rgba(220, 38, 38, 0.25)',
              background: 'rgba(220, 38, 38, 0.08)',
              color: '#991b1b',
              fontSize: 14,
              lineHeight: 1.6,
            }}
          >
            {submitError}
          </div>
        ) : null}

        <div className="actions" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onCancel} disabled={isBusy}>
            {resolvedCancelLabel}
          </Button>
          <Button
            variant={confirmVariant}
            onClick={() => void handleConfirm()}
            disabled={!canSubmit}
            data-autofocus={!requiresKeyword && !managerPinRequired && !reasonRequired ? true : undefined}
          >
            {isBusy ? t('common.loading', 'جارٍ التنفيذ...') : resolvedConfirmLabel}
          </Button>
        </div>
      </Card>
    </DialogShell>
  );
}
