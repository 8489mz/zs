import { IsString, MinLength } from 'class-validator';
import { MIN_PASSWORD_LENGTH } from '../../../core/auth/utils/password-policy';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: 'كلمة المرور الجديدة قصيرة جداً؛ يجب ألا تقل عن الحد الأدنى المطلوب لدورك.',
  })
  newPassword!: string;
}
