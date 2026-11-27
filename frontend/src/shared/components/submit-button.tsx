import {useState, useEffect, useRef, type ButtonHTMLAttributes, type ReactNode, type CSSProperties} from 'react';
import { Button } from '@/shared/ui/button';
import { CheckIcon } from '@/shared/components/icons/AppIcons';

export type SubmitButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  idleText: string;
  pendingText: string;
  isPending?: boolean;
  isSuccess?: boolean;
  successText?: string;
  successDuration?: number;
  showSuccessIcon?: boolean;
  children?: ReactNode;
  variant?: 'primary' | 'secondary' | 'success' | 'danger';
};

export function SubmitButton({
  idleText,
  pendingText,
  disabled,
  isPending,
  isSuccess,
  successText = 'تم الحفظ بنجاح!',
  successDuration = 2800,
  showSuccessIcon = true,
  children,
  style,
  ...props
}: SubmitButtonProps) {
  const isButtonPending = Boolean(isPending);
  const [justSaved, setJustSaved] = useState(false);
  const prevSuccessRef = useRef(Boolean(isSuccess));

  useEffect(() => {
    if (isSuccess && !prevSuccessRef.current) {
      setJustSaved(true);
      const timer = window.setTimeout(() => {
        setJustSaved(false);
      }, successDuration);
      prevSuccessRef.current = true;
      return () => window.clearTimeout(timer);
    }
    if (!isSuccess) {
      prevSuccessRef.current = false;
      setJustSaved(false);
    }
  }, [isSuccess, successDuration]);

  const activeSuccess = justSaved;

  const mergedStyle: CSSProperties = {
    transition: 'all 0.25s ease',
    ...style,
    ...(activeSuccess
      ? {
          backgroundColor: '#16a34a',
          borderColor: '#15803d',
          color: '#ffffff',
          boxShadow: '0 2px 10px rgba(22, 163, 74, 0.35)',
          transform: 'scale(1.008)',
        }
      : {}),
  };

  const content = (() => {
    if (children) return children;
    if (isButtonPending) return pendingText;
    if (activeSuccess) {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '7px' }}>
          {showSuccessIcon && <CheckIcon size={16} color="#ffffff" />}
          <span>{successText}</span>
        </span>
      );
    }
    return idleText;
  })();

  return (
    <Button
      {...props}
      style={mergedStyle}
      disabled={disabled || isButtonPending}
    >
      {content}
    </Button>
  );
}
