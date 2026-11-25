/** Reject economically invalid distributor lines before a stock receipt is booked. */
export type DistributorInvoiceLine = {
  productName: string;
  quantity: number;
  bonusQuantity?: number;
  costPrice: number;
  publicPrice: number;
};

export function validateDistributorInvoiceLines(lines: DistributorInvoiceLine[]): void {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('Distributor invoice requires at least one line');
  }
  for (const line of lines) {
    if (!line || typeof line.productName !== 'string' || !line.productName.trim()) {
      throw new Error('Distributor invoice line requires a product name');
    }
    if (
      ![line.quantity, line.bonusQuantity ?? 0, line.costPrice, line.publicPrice].every(
        (value) => value !== null && value !== undefined && Number.isFinite(Number(value)),
      )
    ) {
      throw new Error('Distributor invoice contains a non-finite quantity or price');
    }
    if (
      Number(line.quantity) <= 0 ||
      Number(line.bonusQuantity ?? 0) < 0 ||
      Number(line.costPrice) < 0 ||
      Number(line.publicPrice) < 0
    ) {
      throw new Error('Distributor invoice contains a negative or zero purchase quantity or price');
    }
  }
}
