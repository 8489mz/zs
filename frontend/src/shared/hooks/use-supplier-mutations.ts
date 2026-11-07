import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateCatalogDomain } from '@/app/query-invalidation';
import { suppliersApi } from '@/shared/api/suppliers.api';
import { buildSupplierPayload } from '@/features/suppliers/schemas/supplier.schema';

export interface SupplierFormValues {
  name: string;
  phone?: string;
  address?: string;
  balance?: number;
  notes?: string;
  /* INV-INSTAPAY-FIELD-MISSING: the create form collects metadata
   * (import currency/type and the InstaPay IPA); the mutation used to
   * drop it, so nothing the form collected ever reached the server. */
  metadata?: Record<string, unknown>;
}

export function useCreateSupplierMutation(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: SupplierFormValues) => suppliersApi.create(buildSupplierPayload(values)),
    onSuccess: async () => {
      await invalidateCatalogDomain(queryClient, { includeSuppliers: true });
      onSuccess?.();
    }
  });
}
