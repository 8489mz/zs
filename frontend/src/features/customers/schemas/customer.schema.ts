import { z } from 'zod';

export const customerFormSchema = z.object({
  name: z.string().min(2, 'اسم العميل مطلوب'),
  phone: z.string().optional(),
  address: z.string().optional(),
  balance: z.coerce.number().min(0),
  type: z.enum(['cash', 'vip', 'credit', 'wholesale', 'half_wholesale']),
  creditLimit: z.coerce.number().min(0),
  // INV-VAN-PRICE-LIST-WIRING: the price list assigned to this
  // customer (null = none). An unknown id is refused server-side
  // (PRICE_LIST_NOT_FOUND); an inactive list may be assigned and is
  // resolved as "no list" until reactivated.
  priceListId: z.number().int().positive().nullable().optional(),
  metadata: z.record(z.string(), z.any()).optional()
});

export type CustomerFormInput = z.input<typeof customerFormSchema>;
export type CustomerFormOutput = z.output<typeof customerFormSchema>;
