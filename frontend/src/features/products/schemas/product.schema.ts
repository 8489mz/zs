import { z } from 'zod';

/**
 * Maps an empty numeric input to null for optional numeric fields. A
 * `type="number"` input registered with `valueAsNumber: true` yields NaN when
 * empty, and `z.number()` rejects NaN — so without this step an optional
 * field still blocks submit. Any other value passes through unchanged.
 */
const emptyNumberToNull = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === 'number' && Number.isNaN(value) ? null : value),
    schema,
  );

export const productFormSchema = z.object({
  name: z.string().default(''),
  nameEn: z.string().default(''),
  barcode: z.string().optional(),
  sku: z.string().optional(),
  itemType: z.enum(['product', 'raw_material', 'service']).default('product'),
  itemKind: z.enum(['standard', 'fashion']).default('standard'),
  styleCode: z.string().optional(),
  color: z.string().optional(),
  size: z.string().optional(),
  fashionColors: z.string().optional(),
  fashionSizes: z.string().optional(),
  variantStock: z.coerce.number().default(0),
  costPrice: z.coerce.number().min(0),
  retailPrice: z.coerce.number().min(0),
  wholesalePrice: z.coerce.number().min(0),
  creditPrice: z.coerce.number().min(0).optional().nullable(),
  consumerPrice: z.coerce.number().min(0).optional().nullable(),
  stock: z.coerce.number(),
  minStock: z.coerce.number().min(0),
  categoryId: z.string().optional(),
  supplierId: z.string().optional(),
  warehouseId: z.string().optional().or(z.literal('')),
  binLocation: z.string().optional(),
  notes: z.string().optional(),
  icon: z.string().optional(),
  imageUrl: z.string().optional(),
  expiryDate: z.string().optional(),
  trackSerials: z.boolean().default(false),
  isCombo: z.boolean().default(false),
  comboComponents: z.array(z.object({
    productId: z.number(),
    quantity: z.number().min(0.0001)
  })).optional(),
  taxCodeType: z.string().optional(),
  taxCode: z.string().optional(),
  // z.preprocess is a pipe, and a pipe is NOT optional in the schema input
  // type — without the outer .optional() the calories key becomes required
  // (unknown) and the forms' defaultValues (which omit it) fail tsc TS2741.
  calories: emptyNumberToNull(z.coerce.number().optional().nullable()).optional(),
  allergens: z.array(z.string()).optional(),
  isSpicy: z.boolean().default(false),
  isVegetarian: z.boolean().default(false),
  isGlutenFree: z.boolean().default(false),
  metadata: z.object({
    imageUrl: z.string().optional(),
    expiryDate: z.string().optional(),
    oemNumber: z.string().optional(),
    partNumber: z.string().optional(),
    carBrand: z.string().optional(),
    carModel: z.string().optional(),
    carYearFrom: z.string().optional(),
    carYearTo: z.string().optional(),
    origin: z.string().optional(),
    condition: z.string().optional(),
  }).passthrough().optional()
}).superRefine((data, ctx) => {
  const hasName = Boolean(data.name && data.name.trim().length > 0);
  const hasNameEn = Boolean(data.nameEn && data.nameEn.trim().length > 0);
  if (!hasName && !hasNameEn) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'اسم الصنف مطلوب (بالعربية أو الإنجليزية)',
      path: ['name'],
    });
  }
});

export type ProductFormInput = z.input<typeof productFormSchema>;
export type ProductFormOutput = z.output<typeof productFormSchema>;
