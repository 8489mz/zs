import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface DialogShellProps {
  open?: boolean;
  isOpen?: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: string;
  minHeight?: string;
  height?: string;
  maxHeight?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  zIndex?: number;
  closeOnBackdrop?: boolean;
  showCloseButton?: boolean;
  ariaLabel?: string;
  overlayClassName?: string;
  shellClassName?: string;
  autoFocus?: boolean;
}

function getFocusableElements(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
}

// Module-level state to track nested dialogs and safely restore original overflow
let activeDialogCount = 0;
let savedBodyOverflow = '';
let savedHtmlOverflow = '';

export function useBodyScrollLock(isLocked: boolean) {
  useEffect(() => {
    if (!isLocked || typeof document === 'undefined') return;

    if (activeDialogCount === 0) {
      savedBodyOverflow = document.body.style.overflow;
      savedHtmlOverflow = document.documentElement.style.overflow;

      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
      document.body.classList.add('dialog-shell-open');
      document.documentElement.classList.add('dialog-shell-open');
    }
    activeDialogCount++;

    return () => {
      activeDialogCount--;
      if (activeDialogCount <= 0) {
        activeDialogCount = 0;
        document.body.style.overflow = savedBodyOverflow;
        document.documentElement.style.overflow = savedHtmlOverflow;
        document.body.classList.remove('dialog-shell-open');
        document.documentElement.classList.remove('dialog-shell-open');
      }
    };
  }, [isLocked]);
}

export function DialogShell({
  open,
  isOpen,
  onClose,
  children,
  width,
  minHeight,
  height,
  maxHeight,
  size,
  zIndex = 10000,
  closeOnBackdrop = true,
  showCloseButton: _showCloseButton = false,
  ariaLabel,
  overlayClassName = '',
  shellClassName = '',
  autoFocus = true,
}: DialogShellProps) {
  const isVisible = open !== undefined ? open : Boolean(isOpen);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isVisible || typeof document === 'undefined') return;

    if (activeDialogCount === 0) {
      savedBodyOverflow = document.body.style.overflow;
      savedHtmlOverflow = document.documentElement.style.overflow;
      document.body.style.setProperty('overflow', 'hidden', 'important');
      document.documentElement.style.setProperty('overflow', 'hidden', 'important');
      document.body.classList.add('dialog-shell-open');
      document.documentElement.classList.add('dialog-shell-open');
      const rootEl = document.getElementById('root');
      if (rootEl) {
        rootEl.style.setProperty('overflow', 'hidden', 'important');
        rootEl.style.setProperty('overflow-y', 'hidden', 'important');
        rootEl.style.setProperty('touch-action', 'none', 'important');
      }
    }
    activeDialogCount++;

    previousActiveElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusDialog = () => {
      const shell = shellRef.current;
      if (!shell) return;
      // Do not steal focus if an element inside the dialog shell is already focused
      if (shell.contains(document.activeElement) && document.activeElement !== shell) return;
      const target =
        shell.querySelector<HTMLElement>('[data-autofocus]') ||
        shell.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]):not(.dialog-shell-close-btn)');
      if (target) {
        target.focus({ preventScroll: true });
      } else {
        shell.focus({ preventScroll: true });
      }
    };

    let frameId: number | null = null;
    if (autoFocus) {
      frameId = window.requestAnimationFrame(focusDialog);
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;
      const shell = shellRef.current;
      if (!shell) return;
      const focusable = getFocusableElements(shell);
      if (!focusable.length) {
        event.preventDefault();
        shell.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      previousActiveElementRef.current?.focus();

      activeDialogCount = Math.max(0, activeDialogCount - 1);
      if (activeDialogCount === 0) {
        if (savedBodyOverflow) {
          document.body.style.overflow = savedBodyOverflow;
        } else {
          document.body.style.removeProperty('overflow');
        }
        if (savedHtmlOverflow) {
          document.documentElement.style.overflow = savedHtmlOverflow;
        } else {
          document.documentElement.style.removeProperty('overflow');
        }
        document.body.classList.remove('dialog-shell-open');
        document.documentElement.classList.remove('dialog-shell-open');
        const rootEl = document.getElementById('root');
        if (rootEl) {
          rootEl.style.removeProperty('overflow');
          rootEl.style.removeProperty('overflow-y');
          rootEl.style.removeProperty('touch-action');
        }
      }
    };
  }, [isVisible, autoFocus]);

  // Bulletproof background scroll trap: intercepts any touch dragging or mouse wheel outside or at edges of the dialog
  useEffect(() => {
    if (!isVisible) return;

    const preventBackgroundTouch = (e: TouchEvent) => {
      const shell = shellRef.current;
      // If the touch originated outside the active modal, block background scrolling completely
      if (shell && !shell.contains(e.target as Node)) {
        if (e.cancelable) {
          e.preventDefault();
        }
      }
    };

    const preventBackgroundWheel = (e: WheelEvent) => {
      const shell = shellRef.current;
      if (!shell) return;

      // If inside another dialog shell (nested modal), allow it to scroll freely
      const activeShells = Array.from(document.querySelectorAll('.dialog-shell'));
      const isOverAnyShell = activeShells.some((s) => s.contains(e.target as Node));
      if (!shell.contains(e.target as Node)) {
        if (isOverAnyShell) return;
        if (e.cancelable) {
          e.preventDefault();
        }
        return;
      }

      // If wheel is directly inside this modal shell, allow smooth natural scrolling for inner containers
      let el = e.target as HTMLElement | null;
      let hasScrollRoom = false;
      while (el && el !== document.body) {
        const style = window.getComputedStyle(el);
        const overflowY = style.overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
          hasScrollRoom = true;
          break;
        }
        if (el === shell) {
          if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
            hasScrollRoom = true;
          }
          break;
        }
        el = el.parentElement;
      }

      // If inside modal, do NOT block wheel unless attempting to scroll completely outside
      if (hasScrollRoom) {
        return;
      }
    };

    document.addEventListener('touchmove', preventBackgroundTouch, { passive: false });
    document.addEventListener('wheel', preventBackgroundWheel, { passive: false });

    return () => {
      document.removeEventListener('touchmove', preventBackgroundTouch);
      document.removeEventListener('wheel', preventBackgroundWheel);
    };
  }, [isVisible]);

  if (!isVisible || typeof document === 'undefined') return null;

  const effectiveZIndex = zIndex && zIndex >= 1000 ? zIndex : 10000 + (zIndex || 0);

  const sizeWidthMap: Record<string, string> = {
    sm: 'min(480px, 95vw)',
    md: 'min(600px, 95vw)',
    lg: 'min(820px, 95vw)',
    xl: 'min(1040px, 95vw)',
    full: 'min(1240px, 98vw)',
  };
  const effectiveWidth = width || (size ? sizeWidthMap[size] : 'min(720px, 100%)');

  return createPortal(
    <div
      ref={overlayRef}
      className={`dialog-overlay ${overlayClassName}`.trim()}
      style={{ zIndex: effectiveZIndex }}
      onClick={(event) => {
        if (!closeOnBackdrop) return;
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={shellRef}
        className={`dialog-shell ${shellClassName}`.trim()}
        style={{
          width: effectiveWidth,
          ...(height ? { height } : {}),
          ...(minHeight ? { minHeight } : {}),
          ...(maxHeight ? { maxHeight } : {}),
        }}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(event) => event.stopPropagation()}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
