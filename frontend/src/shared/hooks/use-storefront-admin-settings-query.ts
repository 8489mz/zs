import { useQuery } from '@tanstack/react-query';
import { storefrontApi } from '@/features/storefront/api/storefront.api';

export function useStorefrontAdminSettingsQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['storefront-admin-settings'],
    queryFn: storefrontApi.getSettings,
    enabled: options?.enabled ?? true,
  });
}
