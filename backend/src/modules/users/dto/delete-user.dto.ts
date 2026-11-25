/*
 * D10 — users delete write DTO (new file; 1 site).
 *
 * Caller trap (verified against settings.api.ts at 7413c4f3e):
 * managerPin is REQUIRED and NON-EMPTY — the service throws
 * CURRENT_USER_PASSWORD_REQUIRED when it is missing/blank. The
 * settings user-management caller sends { managerPin }.
 */
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';

export class DeleteUserDto {
  // The service trims and throws on a blank PIN, so the pipe trims too.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  managerPin!: string;
}
