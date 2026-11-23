import { GccShipmentModal } from '../../components/GccShipmentModal';
import type { Dispatch, SetStateAction } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { OnlineOrderRecord } from '../../types/storefront.types';

export interface MerchantOrdersGccModalProps {
  gccModalOrder: OnlineOrderRecord;
  setGccModalOrder: Dispatch<SetStateAction<OnlineOrderRecord | null>>;
  queryClient: QueryClient;
  setSelectedOrder: Dispatch<SetStateAction<OnlineOrderRecord | null>>;
}

export function MerchantOrdersGccModal({
  gccModalOrder,
  setGccModalOrder,
  queryClient,
  setSelectedOrder,
}: MerchantOrdersGccModalProps) {
  return (
    <GccShipmentModal
      order={gccModalOrder}
      onClose={() => setGccModalOrder(null)}
      onSuccess={() => {
        queryClient.invalidateQueries({ queryKey: ['storefront-admin-orders'] });
        setSelectedOrder(null);
      }}
    />
  );
}
