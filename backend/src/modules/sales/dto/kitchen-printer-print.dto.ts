/*
 * D5 sales — kitchen printer print DTO.
 *
 * PrintKitchenTicketDto: the print-ticket route takes
 * { saleId } only (caller: kitchen-printers.api.ts
 * printTicket). The controller itself throws on a non-integer
 * or non-positive sale id; the DTO mirrors that bar so the
 * pipe rejects it first with VALIDATION_ERROR.
 */

import { IsInt, Min } from 'class-validator';

export class PrintKitchenTicketDto {
  @IsInt()
  @Min(1)
  saleId!: number;
}
