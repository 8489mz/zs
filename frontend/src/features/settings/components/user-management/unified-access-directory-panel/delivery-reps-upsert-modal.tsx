import { UpsertDeliveryRepModal } from '@/shared/components/delivery-reps/UpsertDeliveryRepModal';
import type { Dispatch, SetStateAction } from 'react';
import type { DeliveryRep } from '@/shared/api/delivery-reps.api';

export interface DeliveryRepsUpsertModalProps {
  isUpsertOpen: boolean;
  setIsUpsertOpen: Dispatch<SetStateAction<boolean>>;
  setUpsertRep: Dispatch<SetStateAction<DeliveryRep | null>>;
  upsertRep: DeliveryRep | null;
}

export function DeliveryRepsUpsertModal({ isUpsertOpen, setIsUpsertOpen, setUpsertRep, upsertRep }: DeliveryRepsUpsertModalProps) {
  return (
    <>
    {/* Full Upsert Modal */}
    <UpsertDeliveryRepModal
      open={isUpsertOpen}
      onClose={() => {
        setIsUpsertOpen(false);
        setUpsertRep(null);
      }}
      rep={upsertRep}
    />
    </>
  );
}
