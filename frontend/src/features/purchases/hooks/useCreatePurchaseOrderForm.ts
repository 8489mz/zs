import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { purchaseOrdersApi, type CreatePurchaseOrderPayload, type PurchaseOrderItem } from '../api/purchase-orders.api';
import { suppliersApi } from '@/shared/api/suppliers.api';
import { sharedProductsApi } from '@/shared/api/products';
import { toast } from '@/shared/components/system-alert';

export type { CreatePurchaseOrderPayload, PurchaseOrderItem };

export interface UseCreatePurchaseOrderFormOptions {
  onSuccess?: (res: { message?: string; [key: string]: unknown }) => void;
}

export function useCreatePurchaseOrderForm(options: UseCreatePurchaseOrderFormOptions = {}) {
  const queryClient = useQueryClient();

  const { data: suppliersData, isLoading: isSuppliersLoading } = useQuery({
    queryKey: ['suppliers-list-for-po-page'],
    queryFn: () => suppliersApi.list(),
  });

  const { data: productsData, isLoading: isProductsLoading } = useQuery({
    queryKey: ['products-list-for-po-page'],
    queryFn: () => sharedProductsApi.list(),
  });

  const suppliers = Array.isArray(suppliersData) ? suppliersData : [];
  const products = Array.isArray(productsData) ? productsData : [];

  // Approve path (INV-PURCHASE-ORDER-DRAFT-APPROVE): creates the order
  // and runs the approval check server-side in the same call. The toast
  // names the REAL outcome the server returned -- approval is never
  // claimed when the order came back a draft.
  const approveMutation = useMutation({
    mutationFn: (payload: CreatePurchaseOrderPayload) =>
      purchaseOrdersApi.create({ ...payload, submitForApproval: true }),
    onSuccess: (res) => {
      if (res.status === 'draft') {
        toast.error('تعذر اعتماد أمر الشراء: ما زال في حالة مسودة');
        return;
      }
      toast.success(
        res.message ||
          (res.status === 'pending_approval'
            ? 'أمر الشراء بانتظار موافقة مدير آخر'
            : 'تم اعتماد أمر الشراء بنجاح'),
      );
      queryClient.invalidateQueries({ queryKey: ['purchase-orders-list'] });
      options.onSuccess?.(res);
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'message' in err ? String(err.message) : 'فشل اعتماد أمر الشراء';
      toast.error(msg);
    },
  });

  // Draft path (INV-PURCHASE-ORDER-DRAFT-APPROVE): saves a real
  // server-side draft, so it shows in the orders list under the
  // drafts filter. Success is toasted only after the server confirms.
  const draftMutation = useMutation({
    mutationFn: (payload: CreatePurchaseOrderPayload) => purchaseOrdersApi.create(payload),
    onSuccess: (res) => {
      toast.success('تم حفظ مسودة أمر الشراء بنجاح');
      queryClient.invalidateQueries({ queryKey: ['purchase-orders-list'] });
      options.onSuccess?.(res);
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'message' in err ? String(err.message) : 'فشل حفظ مسودة أمر الشراء';
      toast.error(msg);
    },
  });

  return {
    suppliers,
    products,
    isSuppliersLoading,
    isProductsLoading,
    createPurchaseOrder: approveMutation.mutate,
    createPurchaseOrderAsync: approveMutation.mutateAsync,
    saveDraftPurchaseOrder: draftMutation.mutate,
    saveDraftPurchaseOrderAsync: draftMutation.mutateAsync,
    isSubmitting: approveMutation.isPending || draftMutation.isPending,
  };
}
