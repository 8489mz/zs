import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { quotationsApi, type CreateQuotationPayload, type QuotationItem } from '../api/quotations.api';
import { customersApi } from '@/shared/api/customers.api';
import { toast } from '@/shared/components/system-alert';

export type { CreateQuotationPayload, QuotationItem };

export interface UseCreateQuotationFormOptions {
  onSuccess?: () => void;
}

export function useCreateQuotationForm(options: UseCreateQuotationFormOptions = {}) {
  const queryClient = useQueryClient();

  const { data: customersData, isLoading: isCustomersLoading } = useQuery({
    queryKey: ['customers-list-for-quotation'],
    queryFn: () => customersApi.list(),
  });

  const customers = Array.isArray(customersData) ? customersData : [];

  const createMutation = useMutation({
    mutationFn: (payload: CreateQuotationPayload) => quotationsApi.create(payload),
    onSuccess: (_data, variables) => {
      // I10-A (R8): the approve button must say so — the old single
      // toast ("تم إنشاء وحفظ عرض السعر بنجاح") hid that the
      // quotation had silently stayed a draft.
      toast.success(
        variables?.status === 'sent'
          ? 'تم اعتماد وحفظ عرض السعر بنجاح'
          : 'تم إنشاء وحفظ عرض السعر بنجاح',
      );
      queryClient.invalidateQueries({ queryKey: ['quotations'] });
      options.onSuccess?.();
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'message' in err ? String(err.message) : 'فشل حفظ عرض السعر';
      toast.error(msg);
    },
  });

  return {
    customers,
    isCustomersLoading,
    createQuotation: createMutation.mutate,
    createQuotationAsync: createMutation.mutateAsync,
    isSubmitting: createMutation.isPending,
  };
}
