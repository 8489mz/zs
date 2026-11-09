import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * INV-REST-SHIFT-CLOSE-CONTROL (I22): a manager review is a
 * decision, not a rubber stamp. 'approve' closes the shift and
 * posts the variance; 'reject' reopens it with the reason stamped
 * and posts nothing. A note of at least 10 characters is required
 * for every rejection and for approving any mismatch (declared /
 * computed delta, count delta, or itemised-detail delta).
 */
export class ReviewCashierShiftDto {
  @IsString()
  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
