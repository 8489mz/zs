import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  broadcastSignageOffersUpdate,
  subscribeSignageOffersUpdate,
  POS_SIGNAGE_EVENT_NAME,
  POS_SIGNAGE_STORAGE_KEY,
} from './pos-customer-display-bridge';

describe('pos-customer-display-bridge signage sync', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('broadcastSignageOffersUpdate dispatches custom event and sets localStorage key', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    broadcastSignageOffersUpdate();

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: POS_SIGNAGE_EVENT_NAME,
      }),
    );
    expect(setItemSpy).toHaveBeenCalledWith(POS_SIGNAGE_STORAGE_KEY, expect.any(String));
  });

  it('subscribeSignageOffersUpdate triggers callback on custom event and unsubscribes cleanly', () => {
    const callback = vi.fn();
    const unsubscribe = subscribeSignageOffersUpdate(callback);

    // Trigger same-window event
    window.dispatchEvent(new CustomEvent(POS_SIGNAGE_EVENT_NAME));
    expect(callback).toHaveBeenCalledTimes(1);

    // Unsubscribe and verify no further triggers
    unsubscribe();
    window.dispatchEvent(new CustomEvent(POS_SIGNAGE_EVENT_NAME));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('subscribeSignageOffersUpdate triggers callback on storage event', () => {
    const callback = vi.fn();
    const unsubscribe = subscribeSignageOffersUpdate(callback);

    // Simulate cross-window storage event
    const storageEvent = new StorageEvent('storage', {
      key: POS_SIGNAGE_STORAGE_KEY,
      newValue: String(Date.now()),
    });
    window.dispatchEvent(storageEvent);

    expect(callback).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
