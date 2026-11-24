export type LineItem = {
  id: number;
  productId: string;
  productName?: string;
  qty: number;
  fromLocationId?: string;
  fromLocationName?: string;
};

export type IssueOrderProductOption = {
  id: string;
  name: string;
  code: string;
  searchTerms: string;
  meta?: string;
  availableInScope: number;
  otherLocationsAvailable: number;
  globalStock: number;
  isOutOfStock: boolean;
};
