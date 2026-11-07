import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateCatalogDomain } from '@/app/query-invalidation';
import { customersApi } from '@/features/customers/api/customers.api';
import type { CustomerFormOutput } from '@/features/customers/schemas/customer.schema';
import { toast } from '@/shared/components/system-alert';

export type CustomerFormValues = CustomerFormOutput;

export function useCreateCustomerMutation(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: CustomerFormValues) => customersApi.create({
      name: values.name,
      phone: values.phone || '',
      address: values.address || '',
      balance: Number(values.balance || 0),
      type: values.type,
      creditLimit: Number(values.creditLimit || 0),
      storeCreditBalance: 0
    }),
    onSuccess: async (data) => {
      // INV-DUPLICATE-PHONE-WARN: the save already succeeded (warn but
      // allow). The create dialog closes on success, so the warning must
      // fire here, synchronously on the mutation result — an inline box
      // in the form would unmount unseen with the dialog.
      if (data?.phoneWarning?.message) toast.warning(data.phoneWarning.message);
      await invalidateCatalogDomain(queryClient, { includeCustomers: true, includeCustomerBalances: true });
      onSuccess?.();
    }
  });
}
