import { QuickStockAdjustmentDialog, type useInventoryActionCatalog } from '@/features/inventory';
import type { Product, Location } from '@/types/domain';

export function StockAdjustmentDialog({ selectedProductForAdjustment, handleCloseStockAdjustment, inventoryCatalog, locations }: { selectedProductForAdjustment: Product; handleCloseStockAdjustment: () => void; inventoryCatalog: ReturnType<typeof useInventoryActionCatalog>; locations: Location[] }) {
  return (
    <QuickStockAdjustmentDialog
      open={Boolean(selectedProductForAdjustment)}
      onClose={handleCloseStockAdjustment}
      product={selectedProductForAdjustment}
      branches={inventoryCatalog.branchesQuery.data || []}
      locations={locations || []}
      locationStocks={Array.isArray(inventoryCatalog.locationStocksQuery.data) ? inventoryCatalog.locationStocksQuery.data : []}
      canManageInventory={true}
    />
  );
}
