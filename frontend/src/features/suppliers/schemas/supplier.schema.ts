import { z } from 'zod';

export const supplierFormSchema = z.object({
  name: z.string().min(2, 'اسم المورد مطلوب'),
  phone: z.string().optional(),
  address: z.string().optional(),
  balance: z.coerce.number().min(0),
  notes: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  /* INV-SUPPLIER-PAGE-BILL-STATEMENT: top-level supplier type, NOT
   * metadata.supplierType (the import classification). The overdraft
   * limit is null when the owner leaves it empty — null means uncapped,
   * never 0. The Controller in the forms converts an empty input to
   * null before it reaches this schema. */
  supplierType: z.enum(['supplier', 'freelancer']).optional(),
  overdraftLimit: z.number().min(0, 'حد السحب على المكشوف يجب أن يكون صفرًا أو أكثر').nullable().optional(),
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
  supplierType?: 'supplier' | 'freelancer';
  overdraftLimit?: number | null;
}): {
  name: string;
  phone: string;
  address: string;
  balance: number;
  notes: string;
  metadata?: Record<string, unknown>;
  supplierType?: 'supplier' | 'freelancer';
  overdraftLimit?: number | null;
} {
  return {
    name: values.name,
    phone: values.phone || '',
    address: values.address || '',
    balance: Number(values.balance || 0),
    notes: values.notes || '',
    metadata: values.metadata,
    supplierType: values.supplierType,
    /* Undefined means "leave unchanged" on the server; an explicit
     * null clears the limit back to uncapped. The forms always carry
     * the current value, so an edit never clears by accident. */
    overdraftLimit: values.overdraftLimit,
  };
}
