import { IsString, Length, MinLength } from 'class-validator';

/** رمز من تطبيق المصادقة (6 أرقام) أو رمز استرداد (19 محرفاً بالشُّرَط). */
export class MfaCodeDto {
  @IsString()
  @Length(6, 32)
  code!: string;
}

export class MfaLoginDto {
  @IsString()
  @Length(20, 2000)
  mfaToken!: string;

  @IsString()
  @Length(6, 32)
  code!: string;
}

export class DisableMfaDto {
  @IsString()
  // Verification of an EXISTING credential, not a new password: keep
  // the presence floor at 1 so legacy weak accounts can still
  // authenticate to reach the password-change flow.
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @Length(6, 32)
  code!: string;
}
