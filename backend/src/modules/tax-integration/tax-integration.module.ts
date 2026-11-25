import { Module } from '@nestjs/common';
import { EtaAuthService } from './services/eta-auth/eta-auth.service';
import { EtaSerializerService } from './services/eta-serializer/eta-serializer.service';
import { EtaSubmissionService } from './services/eta-submission/eta-submission.service';
import { EtaSignatureBridgeService } from './services/eta-submission/eta-signature-bridge.service';
import { ZatcaPhase2Service } from './services/zatca/zatca-phase2.service';
import { ZatcaOnboardingService } from './services/zatca/zatca-onboarding.service';
import { ZatcaSubmissionService } from './services/zatca/zatca-submission.service';
import { TaxSettingsService } from './services/tax-settings/tax-settings.service';
import { TaxSettingsController } from './controllers/tax-settings/tax-settings.controller';
import { EtaInvoicesController } from './controllers/eta-invoices/eta-invoices.controller';
import { ZatcaController } from './controllers/zatca/zatca.controller';

import { VatDeclarationService } from './services/vat-declaration/vat-declaration.service';
import { VatDeclarationController } from './controllers/vat-declaration/vat-declaration.controller';

@Module({
  providers: [
    EtaAuthService,
    EtaSerializerService,
    EtaSubmissionService,
    EtaSignatureBridgeService,
    ZatcaPhase2Service,
    ZatcaOnboardingService,
    ZatcaSubmissionService,
    TaxSettingsService,
    VatDeclarationService,
  ],
  controllers: [TaxSettingsController, EtaInvoicesController, ZatcaController, VatDeclarationController],
  exports: [
    EtaSubmissionService,
    EtaSignatureBridgeService,
    ZatcaPhase2Service,
    ZatcaOnboardingService,
    ZatcaSubmissionService,
    VatDeclarationService,
  ],
})
export class TaxIntegrationModule {}
