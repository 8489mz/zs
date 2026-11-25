import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

// INV-DTO-PILOT-PURCHASES-INVENTORY (D2 pilot): POST
// /api/stock-transfers/:id/receive took an inline body type, so the
// global validation pipe never ran on it. The DTO mirrors the
// TransferReceiptTraceRequest shape the service reads (itemId,
// receivedQty, receivedSerials, batchReceipts) plus the two approval
// fields. varianceReason carries NO @MinLength here: the >= 8-character
// rule (INV-TRANSFER-RECEIPT-SHORTAGE-APPROVAL) applies only to SHORT
// receipts and the service enforces that conditional rule itself —
// a full receipt needs no reason at all.
export class TransferReceiptBatchDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  transitBatchId!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  receivedQty!: number;
}

export class TransferReceiptItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  itemId!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  receivedQty!: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  receivedSerials?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransferReceiptBatchDto)
  batchReceipts?: TransferReceiptBatchDto[];
}

export class ReceiveStockTransferDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransferReceiptItemDto)
  items?: TransferReceiptItemDto[];

  @IsOptional()
  @IsString()
  varianceReason?: string;

  @IsOptional()
  @IsString()
  approvalSecret?: string;
}
