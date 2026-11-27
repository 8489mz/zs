import {
  type CustomerDisplayPayload,
  POS_CFD_BROADCAST_CHANNEL,
  POS_CFD_STORAGE_KEY,
} from '@/shared/lib/pos-customer-display.types';

let broadcastChannelInstance: BroadcastChannel | null = null;

function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  if (!broadcastChannelInstance) {
    try {
      broadcastChannelInstance = new BroadcastChannel(POS_CFD_BROADCAST_CHANNEL);
    } catch {
      broadcastChannelInstance = null;
    }
  }
  return broadcastChannelInstance;
}

let cfdStorageTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCfdPayload: CustomerDisplayPayload | null = null;

function flushCfdStoragePersistence(): void {
  if (!pendingCfdPayload || typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(POS_CFD_STORAGE_KEY, JSON.stringify(pendingCfdPayload));
  } catch {
    // ignore storage quota error
  }
  pendingCfdPayload = null;
}

export function broadcastCustomerDisplayState(payload: CustomerDisplayPayload): void {
  // 1. Post message via BroadcastChannel (0ms in-browser communication)
  const channel = getBroadcastChannel();
  if (channel) {
    try {
      channel.postMessage({ type: 'CFD_STATE_UPDATE', payload });
    } catch {
      // ignore
    }
  }

  // 2. Debounce localStorage persistence to eliminate synchronous disk I/O on the main thread during rapid clicks
  pendingCfdPayload = payload;
  if (!cfdStorageTimer) {
    cfdStorageTimer = setTimeout(() => {
      cfdStorageTimer = null;
      flushCfdStoragePersistence();
    }, 200);
  }
}

export function getCustomerDisplayInitialState(): CustomerDisplayPayload | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(POS_CFD_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function subscribeCustomerDisplayState(
  callback: (payload: CustomerDisplayPayload) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};

  // 1. Listen via BroadcastChannel
  const channel = getBroadcastChannel();
  const onChannelMessage = (event: MessageEvent) => {
    if (event.data?.type === 'CFD_STATE_UPDATE' && event.data.payload) {
      callback(event.data.payload);
    }
  };

  if (channel) {
    channel.addEventListener('message', onChannelMessage);
  }

  // 2. Listen via storage event (fallback / cross-window sync)
  const onStorageChange = (event: StorageEvent) => {
    if (event.key === POS_CFD_STORAGE_KEY && event.newValue) {
      try {
        const parsed = JSON.parse(event.newValue);
        callback(parsed);
      } catch {
        // ignore
      }
    }
  };

  window.addEventListener('storage', onStorageChange);

  // Return unsubscribe cleanup function
  return () => {
    if (channel) {
      channel.removeEventListener('message', onChannelMessage);
    }
    window.removeEventListener('storage', onStorageChange);
  };
}

export function openCustomerDisplayWindow(): Window | null {
  if (typeof window === 'undefined') return null;
  const width = Math.min(1280, window.screen?.availWidth || 1024);
  const height = Math.min(800, window.screen?.availHeight || 768);
  const left = window.screen?.availWidth ? window.screen.availWidth - 100 : 0;

  return window.open(
    '/pos/customer-display',
    'CustomerFacingDisplayWindow',
    `width=${width},height=${height},left=${left},top=0,menubar=no,toolbar=no,location=no,status=no,resizable=yes`,
  );
}

export function openKitchenDisplayWindow(): Window | null {
  if (typeof window === 'undefined') return null;
  return window.open('/kds', 'KitchenDisplayWindow', 'menubar=no,toolbar=no,location=no,status=no,resizable=yes');
}

export function openDigitalSignageWindow(): Window | null {
  if (typeof window === 'undefined') return null;
  return window.open('/signage', 'DigitalSignageWindow', 'menubar=no,toolbar=no,location=no,status=no,resizable=yes');
}

export const POS_SIGNAGE_BROADCAST_CHANNEL = 'pos_signage_broadcast_channel';
export const POS_SIGNAGE_STORAGE_KEY = 'pos_signage_last_update';
export const POS_SIGNAGE_EVENT_NAME = 'pos-signage-offers-updated';

let signageBroadcastChannelInstance: BroadcastChannel | null = null;

function getSignageBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  if (!signageBroadcastChannelInstance) {
    try {
      signageBroadcastChannelInstance = new BroadcastChannel(POS_SIGNAGE_BROADCAST_CHANNEL);
    } catch {
      signageBroadcastChannelInstance = null;
    }
  }
  return signageBroadcastChannelInstance;
}

export function broadcastSignageOffersUpdate(): void {
  const timestamp = Date.now();

  // 1. In-window custom event (0ms same-window sync)
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(POS_SIGNAGE_EVENT_NAME, { detail: { timestamp } }));
    } catch {
      // ignore
    }
  }

  // 2. BroadcastChannel (0ms in-browser cross-tab/cross-window sync)
  const channel = getSignageBroadcastChannel();
  if (channel) {
    try {
      channel.postMessage({ type: 'SIGNAGE_OFFERS_UPDATED', timestamp });
    } catch {
      // ignore
    }
  }

  // 3. Persist to localStorage (cross-window storage event fallback)
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(POS_SIGNAGE_STORAGE_KEY, String(timestamp));
    } catch {
      // ignore
    }
  }
}

export function subscribeSignageOffersUpdate(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  // 1. Listen via CustomEvent (same window)
  const onCustomEvent = () => {
    callback();
  };
  window.addEventListener(POS_SIGNAGE_EVENT_NAME, onCustomEvent);

  // 2. Listen via BroadcastChannel (cross-window / cross-tab)
  const channel = getSignageBroadcastChannel();
  const onChannelMessage = (event: MessageEvent) => {
    if (event.data?.type === 'SIGNAGE_OFFERS_UPDATED') {
      callback();
    }
  };
  if (channel) {
    channel.addEventListener('message', onChannelMessage);
  }

  // 3. Listen via storage event (cross-window fallback)
  const onStorageChange = (event: StorageEvent) => {
    if (event.key === POS_SIGNAGE_STORAGE_KEY && event.newValue) {
      callback();
    }
  };
  window.addEventListener('storage', onStorageChange);

  return () => {
    window.removeEventListener(POS_SIGNAGE_EVENT_NAME, onCustomEvent);
    if (channel) {
      channel.removeEventListener('message', onChannelMessage);
    }
    window.removeEventListener('storage', onStorageChange);
  };
}


