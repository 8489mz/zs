import { useMutation } from '@tanstack/react-query';
import { http } from '@/lib/http';

/**
 * Staff-only freight-portal PIN reset (INV-FREIGHT-PORTAL-PIN-HASHED).
 * Calls the staff endpoint directly: the endpoint lives on the
 * maritime-freight controller, which is feature-guarded server-side,
 * and no customer-list invalidation is needed because a PIN change
 * does not change any customer row the list displays. The PIN is sent
 * once in the request body and is never returned by the server, never
 * logged, and never stored client-side.
 */
export function useSetFreightPortalPinMutation(
  customerId?: string,
  onSuccess?: () => void,
) {
  return useMutation({
    mutationFn: (pinCode: string) => {
      if (!customerId) throw new Error('A customer must be selected first');
      return http<{ ok: boolean; customerId: number }>(
        `/api/maritime-freight/customers/${encodeURIComponent(customerId)}/portal-pin`,
        { method: 'PUT', body: JSON.stringify({ pinCode }) },
      );
    },
    onSuccess: () => {
      onSuccess?.();
    },
  });
}
