import { z } from 'zod';

export const purchaseHeaderSchema = z.object({
  supplierId: z.string().trim().min(1, 'اختر المورد'),
  supplierInvoiceNo: z.string().trim().optional(),
  paymentType: z.enum(['cash', 'credit']),
  discount: z.coerce.number().min(0, 'الخصم لا يكون سالبًا').default(0),
  // INV-LANDED-COST-ALLOCATION: freight entered on the invoice itself.
  // Sent as landedCosts (single 'freight' cost, vendor = invoice
  // supplier) so the backend allocates it to item cost at posting;
  // 0 means no freight and no landedCosts key is sent at all.
  freight: z.coerce.number().min(0, 'الشحن لا يكون سالبًا').default(0),
  branchId: z.string().trim().optional().default(''),
  locationId: z.string().trim().optional().default(''),
  note: z.string().trim().optional().default(''),
  requiredDate: z.string().optional().nullable(),
  currency: z.string().optional().nullable(),
  companyName: z.string().optional().nullable(),
  contactId: z.string().optional().nullable(),
  shippingAddressId: z.string().optional().nullable(),
  costCenterId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
  termsTemplate: z.string().optional().nullable(),
});

export const purchaseLineSchema = z.object({
  productId: z.string().trim().min(1, 'اختر الصنف'),
  qty: z.coerce.number().positive('الكمية يجب أن تكون أكبر من صفر'),
  cost: z.coerce.number().min(0, 'التكلفة يجب أن تكون صفرًا أو أكبر')
});

export type PurchaseHeaderInput = z.input<typeof purchaseHeaderSchema>;
export type PurchaseHeaderOutput = z.output<typeof purchaseHeaderSchema>;
export type PurchaseLineInput = z.input<typeof purchaseLineSchema>;
export type PurchaseLineOutput = z.output<typeof purchaseLineSchema>;
