import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';

class PurchaseItemDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  productId!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  qty!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cost!: number;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  unitName?: string;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0.000001)
  unitMultiplier?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  categoryId?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  locationId?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  receivedQty?: number;

  @IsOptional()
  @IsArray()
  serials?: string[];

  @IsOptional()
  @IsString()
  batchNumber?: string;

  @IsOptional()
  @IsString()
  expiryDate?: string;
}

export class PurchaseLandedCostInputDto {
  @IsIn(['freight', 'customs', 'handling', 'insurance', 'other'])
  costType!: 'freight' | 'customs' | 'handling' | 'insurance' | 'other';

  @IsString()
  description!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  vendorId?: number | null;
}

export class PurchaseLandedCostsInputDto {
  @IsOptional()
  @IsIn(['value', 'qty', 'equal'])
  allocationMethod?: 'value' | 'qty' | 'equal';

  @IsOptional()
  @IsString()
  notes?: string;

  @ValidateNested({ each: true })
  @Type(() => PurchaseLandedCostInputDto)
  costs!: PurchaseLandedCostInputDto[];
}

export class UpsertPurchaseDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  supplierId!: number;

  @IsOptional()
  @IsString()
  supplierInvoiceNo?: string;

  @IsOptional()
  @IsBoolean()
  confirmedDuplicateWarning?: boolean;

  @IsOptional()
  @IsBoolean()
  allowDuplicateOverride?: boolean;

  @IsOptional()
  @IsString()
  duplicateOverrideReason?: string;

  @IsOptional()
  @IsIn(['cash', 'credit'])
  paymentType?: 'cash' | 'credit';

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRate?: number;

  @IsOptional()
  @IsBoolean()
  pricesIncludeTax?: boolean;

  @IsOptional()
  @IsString()
  note?: string;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(1)
  branchId?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(1)
  locationId?: number;

  @IsOptional()
  @Type(() => Date)
  requiredDate?: Date;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  managerPin?: string;

  @IsOptional()
  @IsString()
  editReason?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  contactId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  shippingAddressId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  costCenterId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  projectId?: number;

  @IsOptional()
  @IsUUID()
  importProjectId?: string;

  @IsOptional()
  @IsString()
  termsTemplate?: string;

  @IsOptional()
  @IsString()
  lifecycleStatus?: string;

  /*
   * INV-LANDED-COST-ALLOCATION: freight / landed costs carried on the
   * invoice itself, allocated to item cost at posting time. Without
   * this the invoice posted inventory at item cost only and the
   * freight never reached the WAC; the only allocation was the
   * separate post-posting step. Third-party freight (a vendor other
   * than the invoice supplier) still belongs to that post-posting
   * step — the invoice total is payable to this supplier alone.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => PurchaseLandedCostsInputDto)
  landedCosts?: PurchaseLandedCostsInputDto;

  @IsOptional()
  @IsString()
  matchedStatus?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items!: PurchaseItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseAttachmentDto)
  attachments?: PurchaseAttachmentDto[];
}

export class PurchaseAttachmentDto {
  @IsString()
  fileName!: string;

  @IsString()
  fileUrl!: string;

  @Type(() => Number)
  @IsNumber()
  fileSize!: number;

  @IsString()
  fileType!: string;
}
