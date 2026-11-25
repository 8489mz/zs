import { Module } from '@nestjs/common';
import { AuditModule } from '../../core/audit/audit.module';
import { PlatformMailService } from '../../common/mail/platform-mail.service';
import { InMemoryRateLimitService } from '../../common/security/in-memory-rate-limit.service';
import { ActivationModule } from '../activation/activation.module';
import { SessionsController } from './sessions.controller';
import { PasswordResetMailService } from './password-reset-mail.service';
import { PasswordResetService } from './password-reset.service';
import { MfaService } from './mfa.service';

@Module({
  imports: [AuditModule, ActivationModule],
  controllers: [SessionsController],
  providers: [
    InMemoryRateLimitService,
    PlatformMailService,
    PasswordResetMailService,
    PasswordResetService,
    MfaService,
  ],
})
export class SessionsModule {}
