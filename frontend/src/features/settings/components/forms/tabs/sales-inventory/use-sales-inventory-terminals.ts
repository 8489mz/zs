// Terminals hook — pure move from SalesInventorySettingsTab.tsx (slice S6).
// The facade calls useSalesInventoryTerminals({ form, settings }) once and passes
// its returns as props to the S7 terminals section (S6 merges before S7).

import { useState, useEffect } from 'react';
import { toast } from '@/shared/components/system-alert';
import { posApi, HardwareBridgeClient } from '@/features/pos';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { AppSettings } from '@/types/domain';
import type { PosTerminalDeviceConfig } from '@/types/domain-models/settings';
import { isKuwait, isSaudi } from '@/lib/currencies';

// PosTerminalTestResult mirrors the facade interface (L302-313, owned by S7).
// Module-local on purpose: the facade does not export it, and no slice imports
// another slice — the identical shape is what matters (structural typing).
interface PosTerminalTestResult {
  reachable: boolean;
  pingSucceeded: boolean;
  portOpen: boolean;
  ip: string;
  port: number;
  latencyMs?: number;
  message: string;
  details?: string;
  provider?: string;
  timestamp?: number;
}

export function useSalesInventoryTerminals({
  form,
  settings,
}: {
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  settings?: AppSettings;
}) {
  const [testingTerminalId, setTestingTerminalId] = useState<string | null>(null);
  const [terminalTestResults, setTerminalTestResults] = useState<Record<string, PosTerminalTestResult>>({});

  const [isMasterPosTerminalEnabled, setIsMasterPosTerminalEnabled] = useState<boolean>(() => form.getValues('posTerminalEnabled') === true);

  useEffect(() => {
    if (settings?.posTerminalEnabled !== undefined) {
      setIsMasterPosTerminalEnabled(settings.posTerminalEnabled === true);
    }
  }, [settings?.posTerminalEnabled]);

  // Dedicated local state for terminals to guarantee instant reactivity on add, update, remove, and default change
  const [terminalsList, setTerminalsList] = useState<PosTerminalDeviceConfig[]>(() => {
    const fromForm = form.getValues('posTerminals');
    if (Array.isArray(fromForm) && fromForm.length > 0) return fromForm as PosTerminalDeviceConfig[];
    if (Array.isArray(settings?.posTerminals) && settings.posTerminals.length > 0) return settings.posTerminals as PosTerminalDeviceConfig[];
    const isKw = isKuwait(settings);
    const isSa = isSaudi(settings);
    const defaultProv = isKw ? 'knet_pos' : isSa ? 'geidea' : 'fawry';
    const defaultName = isKw ? 'ماكينة كي-نت الرئيسية (K-NET)' : isSa ? 'ماكينة مدى الرئيسية (mada)' : 'ماكينة فوري / باكس الرئيسية';
    return [
      {
        id: 'term-1',
        name: form.getValues('posTerminalName') || settings?.posTerminalName || defaultName,
        provider: (form.getValues('posTerminalProvider') || settings?.posTerminalProvider || defaultProv) as any,
        ip: form.getValues('posTerminalIp') || settings?.posTerminalIp || '192.168.1.150',
        port: Number(form.getValues('posTerminalPort') || settings?.posTerminalPort || 8080),
        enabled: form.getValues('posTerminalEnabled') === true,
        isDefault: true,
      },
    ];
  });

  // Keep terminals in sync if settings loads from API
  useEffect(() => {
    if (Array.isArray(settings?.posTerminals) && settings.posTerminals.length > 0) {
      setTerminalsList(settings.posTerminals as PosTerminalDeviceConfig[]);
      form.setValue('posTerminals', settings.posTerminals as any);
    }
  }, [settings?.posTerminals]);

  const syncTerminalsAndPrimary = (next: PosTerminalDeviceConfig[]) => {
    setTerminalsList(next);
    form.setValue('posTerminals', next as any, { shouldDirty: true, shouldValidate: true });
    const defaultTerm = next.find((t) => t.isDefault) || next[0];
    if (defaultTerm) {
      form.setValue('posTerminalName', defaultTerm.name, { shouldDirty: true });
      form.setValue('posTerminalProvider', defaultTerm.provider as any, { shouldDirty: true });
      form.setValue('posTerminalIp', defaultTerm.ip, { shouldDirty: true });
      form.setValue('posTerminalPort', defaultTerm.port, { shouldDirty: true });
    }
  };

  const handleUpdateTerminal = (updated: PosTerminalDeviceConfig) => {
    const next = terminalsList.map((t) => (t.id === updated.id ? updated : t));
    syncTerminalsAndPrimary(next);
  };

  const handleAddTerminal = () => {
    const isKw = isKuwait(settings);
    const isSa = isSaudi(settings);
    const nextIdx = terminalsList.length + 1;
    let newProvider = 'fawry';
    let newName = `ماكينة ${nextIdx}`;

    if (isKw) {
      newProvider = 'knet_pos';
      newName = `ماكينة ${nextIdx} (كي-نت)`;
    } else if (isSa) {
      newProvider = 'geidea';
      newName = `ماكينة ${nextIdx} (مدى)`;
    } else {
      newProvider = nextIdx % 2 === 0 ? 'paymob' : 'fawry';
      newName = `ماكينة ${nextIdx} (${nextIdx % 2 === 0 ? 'باي موب' : 'فوري'})`;
    }

    const newTerminal: PosTerminalDeviceConfig = {
      id: `term-${Date.now()}`,
      name: newName,
      provider: newProvider as any,
      ip: `192.168.1.${150 + nextIdx - 1}`,
      port: 8080,
      enabled: true,
      isDefault: false,
      pairingKey: '',
      terminalTid: '',
    };
    const next = [...terminalsList, newTerminal];
    syncTerminalsAndPrimary(next);
    toast.success(`تمت إضافة ${newTerminal.name} بنجاح`);
  };

  const handleRemoveTerminal = (id: string) => {
    if (terminalsList.length <= 1) {
      toast.warning('يجب الإبقاء على ماكينة دفع واحدة على الأقل');
      return;
    }
    let next = terminalsList.filter((t) => t.id !== id);
    if (!next.some((t) => t.isDefault) && next.length > 0) {
      next = next.map((t, idx) => (idx === 0 ? { ...t, isDefault: true } : t));
    }
    syncTerminalsAndPrimary(next);
    toast.info('تمت إزالة الماكينة');
  };

  const handleSetDefaultTerminal = (id: string) => {
    const next = terminalsList.map((t) => ({
      ...t,
      isDefault: t.id === id,
    }));
    syncTerminalsAndPrimary(next);
    const target = next.find((t) => t.id === id);
    toast.success(`تم تعيين (${target?.name || 'الماكينة'}) كافتراضية`);
  };

  const handleTestTerminalDevice = async (term: PosTerminalDeviceConfig) => {
    setTestingTerminalId(term.id);
    try {
      const isBridge = await HardwareBridgeClient.isAvailable();
      let resData: any = null;

      if (isBridge) {
        try {
          const bridgeRes = await HardwareBridgeClient.testTerminal({
            ip: term.ip || '192.168.1.150',
            port: Number(term.port || 8080),
            provider: term.provider || 'fawry',
          });
          if (bridgeRes?.data) {
            resData = {
              reachable: Boolean(bridgeRes.data.reachable),
              portOpen: Boolean(bridgeRes.data.portOpen ?? bridgeRes.data.reachable),
              pingSucceeded: Boolean(bridgeRes.data.pingSucceeded ?? bridgeRes.data.reachable),
              latencyMs: bridgeRes.data.latencyMs,
              message: `${bridgeRes.data.message} (عبر جسر العتاد 127.0.0.1:18181)`,
              details: `استجابة الماكينة: ${bridgeRes.data.latencyMs}ms عبر جسر Z-Systems المحلي`,
            };
          } else {
            const errMsg = bridgeRes?.error || 'المنفذ مغلق أو الماكينة لا تستجيب على الشبكة المحلية';
            resData = {
              reachable: false,
              portOpen: false,
              pingSucceeded: false,
              latencyMs: 0,
              message: `${errMsg} (عبر جسر العتاد 127.0.0.1:18181)`,
              details: `قام الجسر المحلي بفحص ${term.ip}:${term.port} ولكن الجهاز رفض الاتصال أو أن التطبيق غير مفتوح على الماكينة.`,
            };
          }
        } catch (bridgeErr: any) {
          resData = {
            reachable: false,
            portOpen: false,
            pingSucceeded: false,
            latencyMs: 0,
            message: `تعذر الاتصال بالماكينة عبر جسر العتاد: ${bridgeErr?.message || 'خطأ اتصال'}`,
            details: 'تأكد من تشغيل الماكينة واتصالها بنفس الراوتر المحلي.',
          };
        }
      } else {
        const res = await posApi.testTerminalConnection({
          ip: term.ip || '192.168.1.150',
          port: Number(term.port || 8080),
          provider: term.provider || 'fawry',
        });
        resData = res.data;
      }

      if (resData) {
        setTerminalTestResults((prev) => ({
          ...prev,
          [term.id]: {
            ...resData,
            timestamp: Date.now(),
          },
        }));
        if (resData.portOpen || resData.reachable) {
          toast.success(resData.message);
        } else if (resData.pingSucceeded) {
          toast.warning(resData.message);
        } else {
          toast.error(resData.message);
        }
      }
    } catch (err: any) {
      const fallbackResult: PosTerminalTestResult = {
        reachable: false,
        pingSucceeded: false,
        portOpen: false,
        ip: term.ip,
        port: term.port,
        message: err?.message || 'فشل الاتصال بالماكينة',
        details: 'حدث خطأ أثناء محاولة فحص الاتصال بالماكينة. يرجى التأكد من تشغيلها واتصالها بنفس الشبكة.',
        timestamp: Date.now(),
      };
      setTerminalTestResults((prev) => ({
        ...prev,
        [term.id]: fallbackResult,
      }));
      toast.error(fallbackResult.message);
    } finally {
      setTestingTerminalId(null);
    }
  };
  return {
    testingTerminalId,
    terminalTestResults,
    isMasterPosTerminalEnabled,
    setIsMasterPosTerminalEnabled,
    terminalsList,
    handleUpdateTerminal,
    handleAddTerminal,
    handleRemoveTerminal,
    handleSetDefaultTerminal,
    handleTestTerminalDevice,
  };
}
