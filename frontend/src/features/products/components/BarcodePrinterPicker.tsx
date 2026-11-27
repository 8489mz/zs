import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/app/query-keys';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';
import { HardwareBridgeClient } from '@/shared/lib/hardware-bridge-client';
import { settingsApi } from '@/features/settings';
import { useAuthStore } from '@/stores/auth-store';
import {
  resolveBridgePrinter,
  resolveElectronPrinter,
  saveWorkstationPrinterPreference,
} from '@/lib/printer-preferences';
import type { AppSettings } from '@/types/domain';

interface BarcodePrinterPickerProps {
  open: boolean;
  settings?: AppSettings | null;
}

interface PrinterOptionItem {
  value: string;
  label: string;
}

export function BarcodePrinterPicker({ open, settings }: BarcodePrinterPickerProps) {
  const queryClient = useQueryClient();
  const hasElectron = typeof window !== 'undefined' && Boolean((window as any).electronPrinter?.getPrinters);

  const [selectedPrinter, setSelectedPrinter] = useState<string>(() =>
    hasElectron ? resolveElectronPrinter('barcode', settings) : resolveBridgePrinter('barcode', settings),
  );
  const [installedPrinters, setInstalledPrinters] = useState<PrinterOptionItem[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [bridgeOnline, setBridgeOnline] = useState(false);

  const scanPrinters = useCallback(async () => {
    setIsScanning(true);
    try {
      if (hasElectron) {
        const list = await (window as any).electronPrinter.getPrinters().catch(() => []);
        if (Array.isArray(list)) {
          setInstalledPrinters(
            list
              .map((p: any) => ({
                value: String(p?.name || '').trim(),
                label: String(p?.displayName || p?.name || '').trim(),
              }))
              .filter((p) => Boolean(p.value)),
          );
        }
        return;
      }

      const res = await HardwareBridgeClient.listPrinters();
      if (res.success && Array.isArray(res.printers)) {
        setBridgeOnline(true);
        setInstalledPrinters(
          res.printers
            .map((name) => String(name || '').trim())
            .filter(Boolean)
            .map((name) => ({ value: name, label: name })),
        );
      } else {
        setBridgeOnline(false);
      }
    } finally {
      setIsScanning(false);
    }
  }, [hasElectron]);

  useEffect(() => {
    if (!open) return;
    setSelectedPrinter(
      hasElectron ? resolveElectronPrinter('barcode', settings) : resolveBridgePrinter('barcode', settings),
    );
    void scanPrinters();
  }, [open, hasElectron, settings, scanPrinters]);

  const selectOptions = useMemo(() => {
    const base: PrinterOptionItem[] = [
      {
        value: '',
        label: hasElectron ? '- نافذة الطباعة العادية -' : '- نافذة طباعة المتصفح -',
      },
    ];
    if (selectedPrinter && !installedPrinters.some((p) => p.value === selectedPrinter)) {
      base.push({ value: selectedPrinter, label: `${selectedPrinter} (محفوظة)` });
    }
    return [...base, ...installedPrinters];
  }, [hasElectron, installedPrinters, selectedPrinter]);

  const handleSelectPrinter = (nextPrinter: string) => {
    const normalized = String(nextPrinter || '').trim();
    const mode = hasElectron ? 'electron' : 'bridge';
    const settingKey: keyof AppSettings = hasElectron
      ? 'posElectronBarcodePrinter'
      : 'posWindowsBarcodePrinterName';

    setSelectedPrinter(normalized);
    saveWorkstationPrinterPreference(mode, 'barcode', normalized);

    const patch = { [settingKey]: normalized };
    queryClient.setQueryData(queryKeys.settings, (prev: any) =>
      prev && typeof prev === 'object' ? { ...prev, ...patch } : prev,
    );
    queryClient.setQueryData(queryKeys.posSettings, (prev: any) =>
      prev && typeof prev === 'object' ? { ...prev, ...patch } : prev,
    );

    const user = useAuthStore.getState().user;
    const canPersistTenant = Boolean(
      user?.role === 'super_admin' ||
      user?.role === 'admin' ||
      user?.permissions?.includes('canManageSettings') ||
      user?.permissions?.includes('settings'),
    );
    if (canPersistTenant) {
      void settingsApi.update(patch)
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
          void queryClient.invalidateQueries({ queryKey: queryKeys.posSettings });
        })
        .catch(() => undefined);
    }

    if (normalized) {
      toast.success(`تم تثبيت طابعة الباركود «${normalized}» للطباعة التلقائية بدون اختيار متكرر`);
    } else {
      toast.info('تم التبديل إلى نافذة الطباعة العادية على هذا الجهاز');
    }
  };

  if (!hasElectron && !bridgeOnline && !selectedPrinter) {
    return (
      <div
        style={{
          marginTop: '6px',
          padding: '6px 9px',
          background: '#f8fafc',
          border: '1px solid #cbd5e1',
          borderRadius: '6px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          fontSize: '0.71rem',
          color: '#475569',
        }}
      >
        <span>
          <strong>تذكّر الطابعة التلقائي:</strong> لحفظ طابعة الباركود والطباعة الصامتة دون نافذة المتصفح، شغّل <strong>جسر Z-Systems</strong> أو افتح <strong>تطبيق سطح المكتب (Electron)</strong>.
        </span>
        <button
          type="button"
          onClick={() => void scanPrinters()}
          disabled={isScanning}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '3px 8px',
            fontSize: '0.7rem',
            fontWeight: 700,
            color: '#170e5e',
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '4px',
            cursor: isScanning ? 'wait' : 'pointer',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          <AppIcons.RefreshCw size={12} />
          <span>{isScanning ? 'جارٍ الفحص...' : 'فحص الطابعات'}</span>
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: '8px' }}>
      <Field
        label={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span>طابعة الباركود المحفوظة لهذا الجهاز</span>
            {selectedPrinter && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  fontSize: '0.67rem',
                  fontWeight: 700,
                  color: '#15803d',
                  background: '#dcfce7',
                  padding: '1px 6px',
                  borderRadius: '999px',
                }}
              >
                <AppIcons.CheckCircle size={11} />
                <span>محفوظة تلقائياً</span>
              </span>
            )}
          </span> as any
        }
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <CustomSelect
              value={selectedPrinter}
              options={selectOptions}
              onChange={handleSelectPrinter}
            />
          </div>
          <button
            type="button"
            onClick={() => void scanPrinters()}
            disabled={isScanning}
            title="تحديث قائمة الطابعات المثبتة"
            style={{
              height: '32px',
              padding: '0 8px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              background: '#ffffff',
              color: '#170e5e',
              cursor: isScanning ? 'wait' : 'pointer',
              flexShrink: 0,
            }}
          >
            <AppIcons.RefreshCw size={13} />
          </button>
        </div>
      </Field>
    </div>
  );
}
