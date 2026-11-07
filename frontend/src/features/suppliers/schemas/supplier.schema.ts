import { z } from 'zod';

export const supplierFormSchema = z.object({
  name: z.string().min(2, 'اسم المورد مطلوب'),
  phone: z.string().optional(),
  address: z.string().optional(),
  balance: z.coerce.number().min(0),
  notes: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional()
});

export type SupplierFormInput = z.input<typeof supplierFormSchema>;
export type SupplierFormOutput = z.output<typeof supplierFormSchema>;

/* INV-INSTAPAY-FIELD-MISSING: the single payload builder for the
 * supplier create and update mutations. It used to live in two
 * places that both dropped `metadata` — so the InstaPay IPA (and the
 * import currency/type) the forms collect never reached the server,
 * and an edit even nulled the stored metadata. The builder carries
 * the whole metadata object through, IPA included. */
export function buildSupplierPayload(values: {
  name: string;
  phone?: string;
  address?: string;
  balance?: number;
  notes?: string;
  metadata?: Record<string, unknown>;
}): {
  name: string;
  phone: string;
  address: string;
  balance: number;
  notes: string;
  metadata?: Record<string, unknown>;
} {
  return {
    name: values.name,
    phone: values.phone || '',
    address: values.address || '',
    balance: Number(values.balance || 0),
    notes: values.notes || '',
    metadata: values.metadata,
  };
}
