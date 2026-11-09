import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateAuditLogs, invalidateSettingsReferenceDomain } from '@/app/query-invalidation';
import { queryKeys } from '@/app/query-keys';
import { settingsApi } from '@/features/settings/api/settings.api';
import { useAuthStore } from '@/stores/auth-store';
import { buildBranchPayload, buildLocationPayload, buildSettingsUpdatePayload } from '@/features/settings/contracts';
import { FORCED_SETTINGS_KEY_LABELS_AR, findOverriddenSettingsValues } from '@/features/settings/lib/settings-save-feedback';
import { setGlobalSystemCurrency } from '@/lib/currencies';
import { authApi } from '@/shared/api/auth';
import { toast } from '@/shared/components/system-alert';
import type { AppSettings } from '@/types/domain';
import type { BranchFormOutput, LocationFormOutput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';

export type SettingsFormValues = SettingsFormOutput;
export type BranchFormValues = BranchFormOutput;
export type LocationFormValues = LocationFormOutput;

export function useSettingsUpdateMutation(currentSettings?: AppSettings, onSuccessCallback?: () => void) {
  const queryClient = useQueryClient();
  const updateSessionMeta = useAuthStore((state) => state.updateSessionMeta);
  return useMutation({
    mutationFn: (values: SettingsFormValues) => settingsApi.update(buildSettingsUpdatePayload(currentSettings, values)),
    onSuccess: async (updatedSettings, variables) => {
      const currentTenant = useAuthStore.getState().tenant;
      const newActivity = (updatedSettings as any)?.activityType;
      const newPillar = (updatedSettings as any)?.pillar;
      const nextTenant = currentTenant && (newActivity || newPillar)
        ? {
            ...currentTenant,
            ...(newActivity ? { activityType: newActivity } : {}),
            ...(newPillar ? { pillar: newPillar } : {}),
          }
        : undefined;

      updateSessionMeta({
        storeName: typeof updatedSettings?.storeName === 'string' ? updatedSettings.storeName : undefined,
        theme: typeof updatedSettings?.theme === 'string' ? updatedSettings.theme : undefined,
        ...(nextTenant ? { tenant: nextTenant } : {}),
      });

      authApi.me().then((meRes) => {
        if (meRes?.tenant) {
          useAuthStore.getState().updateSessionMeta({ tenant: meRes.tenant });
        }
      }).catch(() => undefined);

      queryClient.setQueryData(queryKeys.settings, updatedSettings);
      queryClient.setQueryData(queryKeys.posSettings, updatedSettings);
      if (updatedSettings?.currency) {
        setGlobalSystemCurrency(updatedSettings.currency);
      }
      
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
        queryClient.invalidateQueries({ queryKey: queryKeys.posSettings }),
        queryClient.invalidateQueries({ queryKey: ['auth'] }),
        invalidateAuditLogs(queryClient),
      ]);
      // INV-REST-SUCCESS-FEEDBACK-TRUTH: never toast success for a value
      // the server silently overrode. The vertical force can discard a
      // requested enableEnterpriseFeatures / posModuleEnabled (form
      // defaults, submit handler, backend read/update paths); only the
      // confirmed persisted values may be claimed as saved.
      const overridden = findOverriddenSettingsValues(
        variables as unknown as Record<string, unknown>,
        updatedSettings as unknown as Record<string, unknown>,
      );
      if (overridden.length > 0) {
        const names = overridden.map((key) => FORCED_SETTINGS_KEY_LABELS_AR[key]).join('، ');
        toast.warning(`تم حفظ الإعدادات، لكن لم تُطبَّق: ${names} — لأن قطاع المنشأة يفرض هذه القيم ولا يمكن تغييرها من هنا.`);
      } else {
        toast.success('تم حفظ وتطبيق كافة إعدادات النظام بنجاح!');
      }
      onSuccessCallback?.();
    },
    onError: (error: any) => {
      toast.error(error?.message || 'تعذر حفظ إعدادات النظام، يرجى المحاولة مرة أخرى.');
    }
  });
}

export function useCreateBranchMutation(onSuccess?: (result: { branchId?: string | null }) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: BranchFormValues) => settingsApi.createBranch(buildBranchPayload(values)),
    onSuccess: async (result, values) => {
      const createdBranchId = String(result?.branch?.id || result?.branchId || '').trim();
      await invalidateSettingsReferenceDomain(queryClient, { includeSettings: false, includeBranches: true, includeLocations: true });
      const responseBranchId = String(result?.branchId || '').trim();
      const normalizedName = String(values?.name || '').trim().toLowerCase();
      const normalizedCode = String(values?.code || '').trim().toLowerCase();
      const matchedBranch = Array.isArray(result?.branches)
        ? result.branches.find((branch) => {
            const sameName = String(branch?.name || '').trim().toLowerCase() === normalizedName;
            if (normalizedCode) {
              return sameName && String(branch?.code || '').trim().toLowerCase() === normalizedCode;
            }
            return sameName;
          })
        : null;
      const fallbackBranchId = String(matchedBranch?.id || '').trim()
        || (Array.isArray(result?.branches) && result.branches.length ? String(result.branches[result.branches.length - 1]?.id || '').trim() : '');
      toast.success('تم إنشاء الفرع بنجاح!');
      onSuccess?.({ branchId: createdBranchId || responseBranchId || fallbackBranchId || null });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'تعذر إنشاء الفرع، يرجى مراجعة البيانات.');
    }
  });
}

export function useUpdateBranchMutation(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ branchId, values }: { branchId: string; values: BranchFormValues }) => settingsApi.updateBranch(branchId, buildBranchPayload(values)),
    onSuccess: async () => {
      await invalidateSettingsReferenceDomain(queryClient, { includeSettings: true, includeBranches: true, includeLocations: true });
      toast.success('تم تحديث بيانات الفرع بنجاح!');
      onSuccess?.();
    },
    onError: (err: any) => {
      toast.error(err?.message || 'تعذر تحديث بيانات الفرع.');
    }
  });
}

export function useDeleteBranchMutation(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (branchId: string) => settingsApi.deleteBranch(branchId),
    onSuccess: async () => {
      await invalidateSettingsReferenceDomain(queryClient, { includeSettings: true, includeBranches: true, includeLocations: true });
      toast.success('تم حذف الفرع بنجاح!');
      onSuccess?.();
    },
    onError: (err: any) => {
      toast.error(err?.message || 'تعذر حذف الفرع.');
    }
  });
}

export function useCreateLocationMutation(onSuccess?: (result: { locationId?: string | null }) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: LocationFormValues) => settingsApi.createLocation(buildLocationPayload(values)),
    onSuccess: async (result, values) => {
      const createdLocationId = String(result?.location?.id || result?.locationId || '').trim();
      await invalidateSettingsReferenceDomain(queryClient, { includeSettings: false, includeBranches: true, includeLocations: true });
      const responseLocationId = String(result?.locationId || '').trim();
      const normalizedName = String(values?.name || '').trim().toLowerCase();
      const normalizedCode = String(values?.code || '').trim().toLowerCase();
      const normalizedBranchId = String(values?.branchId || '').trim();
      const matchedLocation = Array.isArray(result?.locations)
        ? result.locations.find((location) => {
            const sameName = String(location?.name || '').trim().toLowerCase() === normalizedName;
            const sameBranch = normalizedBranchId ? String(location?.branchId || '') === normalizedBranchId : true;
            if (normalizedCode) {
              return sameName && sameBranch && String(location?.code || '').trim().toLowerCase() === normalizedCode;
            }
            return sameName && sameBranch;
          })
        : null;
      const fallbackLocationId = String(matchedLocation?.id || '').trim()
        || (Array.isArray(result?.locations) && result.locations.length ? String(result.locations[result.locations.length - 1]?.id || '').trim() : '');
      toast.success('تم إنشاء المخزن بنجاح!');
      onSuccess?.({ locationId: createdLocationId || responseLocationId || fallbackLocationId || null });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'تعذر إنشاء المخزن، يرجى مراجعة البيانات.');
    }
  });
}

export function useUpdateLocationMutation(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ locationId, values }: { locationId: string; values: LocationFormValues }) => settingsApi.updateLocation(locationId, buildLocationPayload(values)),
    onSuccess: async () => {
      await invalidateSettingsReferenceDomain(queryClient, { includeSettings: true, includeBranches: false, includeLocations: true });
      toast.success('تم تحديث بيانات المخزن بنجاح!');
      onSuccess?.();
    },
    onError: (err: any) => {
      toast.error(err?.message || 'تعذر تحديث بيانات المخزن.');
    }
  });
}

export function useDeleteLocationMutation(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (locationId: string) => settingsApi.deleteLocation(locationId),
    onSuccess: async () => {
      await invalidateSettingsReferenceDomain(queryClient, { includeSettings: true, includeBranches: false, includeLocations: true });
      toast.success('تم حذف المخزن بنجاح!');
      onSuccess?.();
    },
    onError: (err: any) => {
      toast.error(err?.message || 'تعذر حذف المخزن.');
    }
  });
}
