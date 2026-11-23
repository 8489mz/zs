import { PosSaleSuccessDialog } from '@/features/pos/components/pos-workspace/PosSaleSuccessDialog';
import { printPostedSaleReceipt } from '@/lib/pos-printing';
import type { Dispatch, SetStateAction } from 'react';
import type { Sale } from '@/types/domain';
import type { StorefrontInfo } from '../../types/storefront.types';

export interface MerchantOrdersPosSuccessDialogProps {
  isSuccessModalOpen: boolean;
  completedSale: Sale | null;
  settings: StorefrontInfo | undefined;
  setIsSuccessModalOpen: Dispatch<SetStateAction<boolean>>;
  setCompletedSale: Dispatch<SetStateAction<Sale | null>>;
}

export function MerchantOrdersPosSuccessDialog({
  isSuccessModalOpen,
  completedSale,
  settings,
  setIsSuccessModalOpen,
  setCompletedSale,
}: MerchantOrdersPosSuccessDialogProps) {
  return (
    <PosSaleSuccessDialog
      open={isSuccessModalOpen && Boolean(completedSale)}
      sale={completedSale}
      customer={(completedSale as any)?.customer ? (completedSale as any).customer : { name: completedSale?.customerName || '', phone: (completedSale as any)?.customerPhone || '' } as any}
      settings={settings as any}
      onClose={() => {
        setIsSuccessModalOpen(false);
        setCompletedSale(null);
      }}
      onNewSale={() => {
        setIsSuccessModalOpen(false);
        setCompletedSale(null);
      }}
      onPrintReceipt={() => {
        if (completedSale) {
          printPostedSaleReceipt(completedSale, { pageSize: 'receipt', settings: settings as any });
        }
      }}
      onPrintA4={() => {
        if (completedSale) {
          printPostedSaleReceipt(completedSale, { pageSize: 'a4', settings: settings as any });
        }
      }}
    />
  );
}
