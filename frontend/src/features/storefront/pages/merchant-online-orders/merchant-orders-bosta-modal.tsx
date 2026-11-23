import { BostaShipmentModal } from '../../components/BostaShipmentModal';
import type { Dispatch, SetStateAction } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { OnlineOrderRecord } from '../../types/storefront.types';

export interface MerchantOrdersBostaModalProps {
  bostaModalOrder: OnlineOrderRecord;
  setBostaModalOrder: Dispatch<SetStateAction<OnlineOrderRecord | null>>;
  queryClient: QueryClient;
  setSelectedOrder: Dispatch<SetStateAction<OnlineOrderRecord | null>>;
}

export function MerchantOrdersBostaModal({
  bostaModalOrder,
  setBostaModalOrder,
  queryClient,
  setSelectedOrder,
}: MerchantOrdersBostaModalProps) {
  return (
    <BostaShipmentModal
      order={bostaModalOrder}
      onClose={() => setBostaModalOrder(null)}
      onSuccess={() => {
        queryClient.invalidateQueries({ queryKey: ['storefront-admin-orders'] });
        setSelectedOrder(null);
      }}
    />
  );
}
