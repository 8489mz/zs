import type { PaymentChannel } from '@/features/pos/hooks/usePosWorkspace';

export type CheckoutPaymentPreset = 'cash' | 'card' | 'wallet' | 'instapay' | 'credit';
export type CheckoutPaymentRegion = 'universal' | 'kuwait' | 'ksa';
export type CheckoutShortcutSlot = 1 | 2 | 3 | 4 | 5;

export interface CheckoutPaymentButtonAction {
  slot: CheckoutShortcutSlot;
  shortcutLabel: `Alt+${CheckoutShortcutSlot}`;
  kind: 'cash' | 'card' | 'transfer' | 'credit';
  cardScheme?: 'knet' | 'mada' | 'visa';
  provider?: 'knet_pos' | 'geidea';
}

const REGION_ACTIONS: Record<CheckoutPaymentRegion, readonly CheckoutPaymentButtonAction[]> = {
  universal: [
    { slot: 1, shortcutLabel: 'Alt+1', kind: 'cash' },
    { slot: 2, shortcutLabel: 'Alt+2', kind: 'card', cardScheme: 'visa' },
    { slot: 3, shortcutLabel: 'Alt+3', kind: 'transfer' },
    { slot: 4, shortcutLabel: 'Alt+4', kind: 'credit' },
  ],
  kuwait: [
    { slot: 1, shortcutLabel: 'Alt+1', kind: 'cash' },
    { slot: 2, shortcutLabel: 'Alt+2', kind: 'card', cardScheme: 'knet', provider: 'knet_pos' },
    { slot: 3, shortcutLabel: 'Alt+3', kind: 'card', cardScheme: 'visa' },
    { slot: 4, shortcutLabel: 'Alt+4', kind: 'credit' },
    { slot: 5, shortcutLabel: 'Alt+5', kind: 'transfer' },
  ],
  ksa: [
    { slot: 1, shortcutLabel: 'Alt+1', kind: 'cash' },
    { slot: 2, shortcutLabel: 'Alt+2', kind: 'card', cardScheme: 'mada', provider: 'geidea' },
    { slot: 3, shortcutLabel: 'Alt+3', kind: 'card', cardScheme: 'visa' },
    { slot: 4, shortcutLabel: 'Alt+4', kind: 'credit' },
    { slot: 5, shortcutLabel: 'Alt+5', kind: 'transfer' },
  ],
};

const CODE_TO_SLOT: Record<string, CheckoutShortcutSlot> = {
  Digit1: 1,
  Numpad1: 1,
  Digit2: 2,
  Numpad2: 2,
  Digit3: 3,
  Numpad3: 3,
  Digit4: 4,
  Numpad4: 4,
  Digit5: 5,
  Numpad5: 5,
};

const KEY_TO_SLOT: Record<string, CheckoutShortcutSlot> = {
  '1': 1,
  '١': 1,
  '2': 2,
  '٢': 2,
  '3': 3,
  '٣': 3,
  '4': 4,
  '٤': 4,
  '5': 5,
  '٥': 5,
};

/** Resolve which regional payment preset grid applies in the POS checkout dialog. */
export function getCheckoutPaymentRegion(isKwdStore: boolean, isKsaStore: boolean): CheckoutPaymentRegion {
  if (isKwdStore) return 'kuwait';
  if (isKsaStore) return 'ksa';
  return 'universal';
}

/** Return the ordered checkout payment button actions for a region. */
export function getCheckoutPaymentActions(region: CheckoutPaymentRegion): readonly CheckoutPaymentButtonAction[] {
  return REGION_ACTIONS[region];
}

/**
 * Parse Alt+1..5 from either physical key code (language-independent for Arabic keyboards)
 * or key character fallback. Never matches plain digits or Ctrl/Shift/Meta combos.
 */
export function parseCheckoutAltDigit(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code' | 'key'>,
): CheckoutShortcutSlot | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (event.code && CODE_TO_SLOT[event.code]) return CODE_TO_SLOT[event.code];
  if (event.key && KEY_TO_SLOT[event.key]) return KEY_TO_SLOT[event.key];
  return null;
}

/** Find the checkout payment button action bound to an Alt+digit shortcut in a region. */
export function resolveCheckoutActionForSlot(
  region: CheckoutPaymentRegion,
  slot: CheckoutShortcutSlot | null,
): CheckoutPaymentButtonAction | null {
  if (!slot) return null;
  return REGION_ACTIONS[region].find((entry) => entry.slot === slot) || null;
}

/** Map a checkout button action into the concrete POS payment preset to activate. */
export function resolvePresetForCheckoutAction(
  action: CheckoutPaymentButtonAction,
  currentChannel: PaymentChannel | string,
  region: CheckoutPaymentRegion,
): CheckoutPaymentPreset {
  if (action.kind === 'transfer') {
    if (region === 'kuwait') {
      return currentChannel === 'instapay' ? 'instapay' : 'wallet';
    }
    return currentChannel === 'wallet' ? 'wallet' : 'instapay';
  }
  return action.kind;
}

/** Compute the initial payment preset chosen by Smart Auto-fill when the checkout dialog opens. */
export function resolveInitialCheckoutPreset(
  defaultChannel: string | undefined,
  isKwdStore: boolean,
  isKsaStore: boolean,
): CheckoutPaymentPreset {
  if (defaultChannel === 'card' || (defaultChannel === 'auto' && (isKwdStore || isKsaStore))) {
    return 'card';
  }
  if (defaultChannel === 'wallet') {
    return isKwdStore ? 'instapay' : 'wallet';
  }
  return 'cash';
}
