import { IsString, IsNumber, IsOptional, Min, IsIn, IsNotEmpty, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class PostSourcingTripExpenseDto {
  @IsString()
  @IsNotEmpty()
  approvalRequestId!: string;

  /** Tenant supplier the trip expense is owed to (the payable leg's partner). */
  @Type(() => Number)
  @IsNumber()
  supplierId!: number;

  /** Expense-type account the trip cost posts to (validated as an expense account, never defaulted). */
  @Type(() => Number)
  @IsNumber()
  expenseAccountId!: number;
}

export class CreateImportDocumentDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  shipmentId?: string;

  @IsString()
  documentType!: string;

  @IsString()
  fileName!: string;

  @IsString()
  fileUrl!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  fileSizeBytes?: number;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsString()
  issueDate?: string;

  @IsOptional()
  @IsString()
  expiryDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateApprovalRequestDto {
  @IsIn([
    'supplier_bank_change',
    'large_transfer',
    'broker_settlement',
    'partner_distribution',
    'project_closure',
    'import_receipt_reversal',
    'import_legacy_receipt_review',
    'broker_expense_verification',
    'sourcing_trip_expense',
  ])
  actionType!:
    | 'supplier_bank_change'
    | 'large_transfer'
    | 'broker_settlement'
    | 'partner_distribution'
    | 'project_closure'
    | 'import_receipt_reversal'
    | 'import_legacy_receipt_review'
    | 'broker_expense_verification'
    | 'sourcing_trip_expense';

  @IsString()
  referenceId!: string;

  @IsOptional()
  requestPayload?: any;
}

export class CloseImportProjectDto {
  @IsString()
  @IsNotEmpty()
  approvalRequestId!: string;
}

export class ReverseImportReceiptDto {
  @IsString()
  @IsNotEmpty()
  approvalRequestId!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class ResolveLegacyReceiptDto {
  @IsString()
  @IsNotEmpty()
  approvalRequestId!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class VerifyBrokerExpenseDto {
  @IsString()
  @IsNotEmpty()
  approvalRequestId!: string;
}

export class DecideApprovalRequestDto {
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  rejectionReason?: string;

  @IsOptional()
  @IsString()
  decisionNotes?: string;

  @IsOptional()
  @IsString()
  comments?: string;
}

export class ResolveExceptionDto {
  @IsString()
  resolutionNotes!: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class RecordPartnerPayoutDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01, { message: 'مبلغ صرف الأرباح يجب أن يكون أكبر من الصفر.' })
  amount!: number;

  @IsString()
  @IsNotEmpty({ message: 'معرّف طلب الاعتماد (approvalRequestId) إلزامي لصرف أرباح الشركاء وفق سياسة Maker-Checker.' })
  approvalRequestId!: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  treasuryAccountId?: string;

  /** Optional idempotency key (service-level key path): a caller that sends a key owns the retry identity — a retry with the same key returns the original payout with no second row. A caller that sends no key gets pass-through, exactly as before (a retry then fails at the already-consumed approval instead of replaying). */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}
