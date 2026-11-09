import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useSettingsUpdateMutation } from '@/features/settings/hooks/useSettingsMutations';
import { useAuthStore } from '@/stores/auth-store';

const { updateMock, toastSuccess, toastWarning, toastError, toastInfo } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock('@/features/settings/api/settings.api', () => ({
  settingsApi: {
    update: updateMock,
  },
}));

vi.mock('@/shared/components/system-alert', () => ({
  toast: {
    success: toastSuccess,
    warning: toastWarning,
    error: toastError,
    info: toastInfo,
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useSettingsUpdateMutation', () => {
  it('syncs updated store branding into the active auth session', async () => {
    useAuthStore.setState({
      user: {
        id: 'u-root',
        username: 'root',
        role: 'super_admin',
        permissions: [],
        displayName: 'Root',
        branchIds: ['b-1'],
        defaultBranchId: 'b-1',
      },
      storeName: 'Legacy Store',
      theme: 'light',
      initialized: true,
    });

    updateMock.mockResolvedValueOnce({
      storeName: 'New Global Store',
      theme: 'dark',
    });

    const { result } = renderHook(() => useSettingsUpdateMutation(undefined), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        storeName: 'New Global Store',
        brandName: 'New Global Store',
        phone: '',
        address: '',
        lowStockThreshold: 0,
        invoiceFooter: '',
        invoiceQR: '',
        taxNumber: '',
        taxRate: 0,
        taxMode: 'exclusive',
        paperSize: 'a4',
        managerPin: '',
        autoBackup: 'on',
        accentColor: '#170c5c',
        logoData: '',
        currentBranchId: '',
        currentLocationId: '',
      } as never);
    });

    await waitFor(() => {
      expect(useAuthStore.getState().storeName).toBe('New Global Store');
      expect(useAuthStore.getState().theme).toBe('dark');
    });
  });

  it('safely preserves existing customer data (storeName, phone, logo, branches) when applying onboarding or partial updates', async () => {
    const existingClientSettings = {
      storeName: 'مطعم ومشويات الحرمين',
      brandName: 'الحرمين',
      phone: '01012345678',
      address: 'شارع الجمهورية - المنصورة',
      logoData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
      currentBranchId: '10',
      currentLocationId: '20',
      taxNumber: '987-654-321',
      taxRate: 14,
      taxMode: 'exclusive' as const,
      accentColor: '#170c5c',
      posModuleEnabled: true,
      inventoryModuleEnabled: true,
      purchasesModuleEnabled: true,
      restaurantModuleEnabled: false,
    };

    updateMock.mockResolvedValueOnce({
      ...existingClientSettings,
      restaurantModuleEnabled: true,
      onboardingCompleted: true,
    });

    const { result } = renderHook(
      () => useSettingsUpdateMutation(existingClientSettings as any),
      { wrapper: createWrapper() }
    );

    // Partial update like clicking "المطاعم" or "تخطي" in onboarding
    await act(async () => {
      await result.current.mutateAsync({
        businessIndustry: 'restaurant',
        restaurantModuleEnabled: true,
        onboardingCompleted: true,
      } as any);
    });

    expect(updateMock).toHaveBeenCalled();
    const passedPayload = updateMock.mock.calls[0][0].settings;

    // Must preserve existing store name and never revert to "Z Systems"
    expect(passedPayload.storeName).toBe('مطعم ومشويات الحرمين');
    expect(passedPayload.brandName).toBe('الحرمين');
    expect(passedPayload.phone).toBe('01012345678');
    expect(passedPayload.address).toBe('شارع الجمهورية - المنصورة');
    expect(passedPayload.logoData).toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==');
    expect(passedPayload.currentBranchId).toBe('10');
    expect(passedPayload.currentLocationId).toBe('20');
    expect(passedPayload.taxNumber).toBe('987-654-321');
    expect(passedPayload.taxRate).toBe(14);
    // Must update the new flags
    expect(passedPayload.restaurantModuleEnabled).toBe(true);
    expect(passedPayload.businessIndustry).toBe('restaurant');
    expect(passedPayload.onboardingCompleted).toBe(true);
  });

  // INV-REST-SUCCESS-FEEDBACK-TRUTH (Restaurant Batch 9, T2): the save
  // toast may only claim what the server response confirms. The vertical
  // force silently overrides enableEnterpriseFeatures / posModuleEnabled,
  // so a requested value that did not survive must warn by name instead
  // of toasting success.
  describe('honest save feedback when the server overrides a requested value', () => {
    const baseValues = {
      storeName: 'My Store',
      brandName: 'My Store',
      phone: '',
      address: '',
      lowStockThreshold: 0,
      invoiceFooter: '',
      invoiceQR: '',
      taxNumber: '',
      taxRate: 0,
      taxMode: 'exclusive',
      paperSize: 'a4',
      managerPin: '',
      autoBackup: 'on',
      accentColor: '#170c5c',
      logoData: '',
      currentBranchId: '',
      currentLocationId: '',
    };

    it('warns by name instead of toasting success when the server keeps enterprise mode on', async () => {
      toastSuccess.mockClear();
      toastWarning.mockClear();
      updateMock.mockResolvedValueOnce({
        storeName: 'My Store',
        theme: 'light',
        enableEnterpriseFeatures: true,
        posModuleEnabled: false,
      });

      const onSuccessCallback = vi.fn();
      const { result } = renderHook(
        () => useSettingsUpdateMutation(undefined, onSuccessCallback),
        { wrapper: createWrapper() },
      );

      await act(async () => {
        await result.current.mutateAsync({
          ...baseValues,
          enableEnterpriseFeatures: false,
          posModuleEnabled: false,
        } as never);
      });

      await waitFor(() => {
        expect(toastWarning).toHaveBeenCalledTimes(1);
      });
      expect(toastWarning.mock.calls[0][0]).toContain('نمط التشغيل المؤسسي');
      expect(toastSuccess).not.toHaveBeenCalled();
      // The save itself succeeded — only the forced value was lost.
      expect(onSuccessCallback).toHaveBeenCalledTimes(1);
    });

    it('warns by name instead of toasting success when the server keeps POS off', async () => {
      toastSuccess.mockClear();
      toastWarning.mockClear();
      updateMock.mockResolvedValueOnce({
        storeName: 'My Store',
        theme: 'light',
        enableEnterpriseFeatures: true,
        posModuleEnabled: false,
      });

      const { result } = renderHook(() => useSettingsUpdateMutation(undefined), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.mutateAsync({
          ...baseValues,
          enableEnterpriseFeatures: true,
          posModuleEnabled: true,
        } as never);
      });

      await waitFor(() => {
        expect(toastWarning).toHaveBeenCalledTimes(1);
      });
      expect(toastWarning.mock.calls[0][0]).toContain('نقاط البيع');
      expect(toastSuccess).not.toHaveBeenCalled();
    });

    it('toasts success when the server confirms the requested values', async () => {
      toastSuccess.mockClear();
      toastWarning.mockClear();
      updateMock.mockResolvedValueOnce({
        storeName: 'My Store',
        theme: 'light',
        enableEnterpriseFeatures: false,
        posModuleEnabled: false,
      });

      const { result } = renderHook(() => useSettingsUpdateMutation(undefined), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.mutateAsync({
          ...baseValues,
          enableEnterpriseFeatures: false,
          posModuleEnabled: false,
        } as never);
      });

      await waitFor(() => {
        expect(toastSuccess).toHaveBeenCalledTimes(1);
      });
      expect(toastWarning).not.toHaveBeenCalled();
    });
  });
});
