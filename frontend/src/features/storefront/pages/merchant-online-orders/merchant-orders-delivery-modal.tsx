import { ConvertDeliveryModal } from '../../components/ConvertDeliveryModal';
import type { Dispatch, SetStateAction } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { OnlineOrderRecord } from '../../types/storefront.types';
import type { Sale } from '@/types/domain';

export interface MerchantOrdersDeliveryModalProps {
  deliveryModalOrder: OnlineOrderRecord | null;
  setDeliveryModalOrder: Dispatch<SetStateAction<OnlineOrderRecord | null>>;
  queryClient: QueryClient;
  setSelectedOrder: Dispatch<SetStateAction<OnlineOrderRecord | null>>;
  setCompletedSale: Dispatch<SetStateAction<Sale | null>>;
  setIsSuccessModalOpen: Dispatch<SetStateAction<boolean>>;
  handleLoadToPos: (orderId: number) => Promise<void>;
}

export function MerchantOrdersDeliveryModal({
  deliveryModalOrder,
  setDeliveryModalOrder,
  queryClient,
  setSelectedOrder,
  setCompletedSale,
  setIsSuccessModalOpen,
  handleLoadToPos,
}: MerchantOrdersDeliveryModalProps) {
  return (
    <ConvertDeliveryModal
      order={deliveryModalOrder}
      isOpen={Boolean(deliveryModalOrder)}
      onClose={() => setDeliveryModalOrder(null)}
      onSuccess={(data) => {
        queryClient.invalidateQueries({ queryKey: ['storefront-admin-orders'] });
        setSelectedOrder(null);
        setDeliveryModalOrder(null);
        if (data?.sale) {
          setCompletedSale(data.sale);
          setIsSuccessModalOpen(true);
        }
      }}
      onLoadToPos={handleLoadToPos}
    />
  );
}
