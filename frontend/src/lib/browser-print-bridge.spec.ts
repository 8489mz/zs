/**
 * Silent Windows print wiring in printHtmlDocument (frontend/src/lib/browser.ts):
 * when a Windows printer name is configured, the local bridge is attempted
 * BEFORE the browser print dialog; on any bridge failure the dialog path
 * runs through a hidden in-page iframe, so a print is never lost.
 * No window.open is used anywhere: browsers clamp off-screen popup
 * coordinates on-screen, so the old tiny window flashed on every sale.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { queryClient } from '@/app/providers';
import { queryKeys } from '@/app/query-keys';
import { printHtmlDocument } from '@/lib/browser';
import { HardwareBridgeClient } from '@/features/pos/lib/hardware-bridge-client';

vi.mock('@/features/pos/lib/hardware-bridge-client', () => ({
  HardwareBridgeClient: {
    isAvailable: vi.fn(),
    printWindows: vi.fn(),
    listPrinters: vi.fn(),
  },
}));

// A real iframe node (so appendChild/removeChild work) whose window and
// document are stubbed, so the dialog path is observable without a real
// print dialog. jsdom's own iframe print is a no-op, so the stubs are the
// assertions' target.
function makeFakePrintFrame() {
  const frame = document.createElement('iframe');
  const printSpy = vi.fn();
  const focusSpy = vi.fn();
  const writeSpy = vi.fn();
  const doc = {
    open: vi.fn(),
    write: writeSpy,
    close: vi.fn(),
    readyState: 'complete' as const,
  };
  Object.defineProperty(frame, 'contentWindow', {
    value: { focus: focusSpy, print: printSpy },
    configurable: true,
  });
  Object.defineProperty(frame, 'contentDocument', { value: doc, configurable: true });
  return { frame, printSpy, focusSpy, writeSpy, doc };
}

describe('printHtmlDocument bridge silent print', () => {
  let fakeFrame: ReturnType<typeof makeFakePrintFrame>;
  let createElementSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.removeQueries({ queryKey: queryKeys.settings });
    document.body.querySelectorAll('iframe').forEach((el) => el.remove());
    fakeFrame = makeFakePrintFrame();
    const origCreateElement = document.createElement.bind(document);
    createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string, ...args: any[]) => {
      if (tag === 'iframe') return fakeFrame.frame as any;
      return (origCreateElement as any)(tag, ...args);
    }) as any);
    vi.spyOn(window, 'open').mockReturnValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    queryClient.removeQueries({ queryKey: queryKeys.settings });
    document.body.querySelectorAll('iframe').forEach((el) => el.remove());
  });

  it('prints silently through the bridge, opens no window and creates no iframe when configured', async () => {
    queryClient.setQueryData(queryKeys.settings, { posWindowsPrinterName: 'EPSON WF-C5290BA' });
    vi.mocked(HardwareBridgeClient.isAvailable).mockResolvedValue(true);
    vi.mocked(HardwareBridgeClient.printWindows).mockResolvedValue({ success: true, printer: 'EPSON WF-C5290BA' });

    printHtmlDocument('receipt', '<div>total 10.00</div>', { pageSize: 'A4' });

    await vi.waitFor(() => {
      expect(HardwareBridgeClient.printWindows).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceName: 'EPSON WF-C5290BA',
          pageSize: 'A4',
          html: expect.stringContaining('total 10.00'),
        }),
      );
    });
    // Give the async bridge path a beat to (not) fall through to the dialog.
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(window.open).not.toHaveBeenCalled();
    expect(createElementSpy).not.toHaveBeenCalledWith('iframe');
    expect(fakeFrame.printSpy).not.toHaveBeenCalled();
    expect(fakeFrame.writeSpy).not.toHaveBeenCalled();
  });

  it('falls back to the hidden-iframe dialog when the bridge is unavailable', async () => {
    queryClient.setQueryData(queryKeys.settings, { posWindowsPrinterName: 'EPSON WF-C5290BA' });
    vi.mocked(HardwareBridgeClient.isAvailable).mockResolvedValue(false);

    printHtmlDocument('receipt', '<div>total 10.00</div>', { pageSize: 'A4' });

    await vi.waitFor(() => {
      expect(fakeFrame.writeSpy).toHaveBeenCalledWith(expect.stringContaining('total 10.00'));
    });
    await vi.waitFor(() => {
      expect(fakeFrame.printSpy).toHaveBeenCalled();
    });
    expect(window.open).not.toHaveBeenCalled();
    expect(HardwareBridgeClient.printWindows).not.toHaveBeenCalled();
  });

  it('falls back to the hidden-iframe dialog when the bridge answers failure', async () => {
    queryClient.setQueryData(queryKeys.settings, { posWindowsPrinterName: 'EPSON WF-C5290BA' });
    vi.mocked(HardwareBridgeClient.isAvailable).mockResolvedValue(true);
    vi.mocked(HardwareBridgeClient.printWindows).mockResolvedValue({ success: false, error: 'printer offline' });

    printHtmlDocument('receipt', '<div>total 10.00</div>', { pageSize: 'A4' });

    await vi.waitFor(() => {
      expect(fakeFrame.writeSpy).toHaveBeenCalledWith(expect.stringContaining('total 10.00'));
    });
    await vi.waitFor(() => {
      expect(fakeFrame.printSpy).toHaveBeenCalled();
    });
    expect(window.open).not.toHaveBeenCalled();
  });

  it('never contacts the bridge when no Windows printer is configured', async () => {
    queryClient.setQueryData(queryKeys.settings, {});

    printHtmlDocument('receipt', '<div>total 10.00</div>', { pageSize: 'A4' });

    await vi.waitFor(() => {
      expect(fakeFrame.writeSpy).toHaveBeenCalledWith(expect.stringContaining('total 10.00'));
    });
    await vi.waitFor(() => {
      expect(fakeFrame.printSpy).toHaveBeenCalled();
    });
    expect(window.open).not.toHaveBeenCalled();
    expect(HardwareBridgeClient.isAvailable).not.toHaveBeenCalled();
    expect(HardwareBridgeClient.printWindows).not.toHaveBeenCalled();
  });
});
