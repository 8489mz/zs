import type { MaritimeMailConfig } from '../../api/maritime-freight.api';

export const STANDARD_EMAIL_TEMPLATES = {
  subject: '[{{rfq_number}}] Freight Rate Inquiry: {{pol_name}} to {{pod_name}} ({{container_count}}x {{container_type}})',
  intro: 'Dear {{carrier_name}} Pricing Desk,\n\nPlease provide your most competitive freight spot rate for the following shipment:',
  signature: 'Best regards,\n{{company_name}} Operations & Freight Procurement Desk\n{{company_email}}',
};

export const DEFAULT_CONFIG: MaritimeMailConfig = {
  outgoingProvider: 'custom',
  smtpHost: 'mail.yourcompany.com',
  smtpPort: 465,
  smtpSecure: true,
  smtpUser: '',
  smtpPassword: '',
  fromName: 'إدارة الشحن واللوجستيات',
  fromEmail: '',

  incomingProvider: 'custom',
  imapHost: 'mail.yourcompany.com',
  imapPort: 993,
  imapSecure: true,
  imapUser: '',
  imapPassword: '',

  autoReadInboundBids: true,
  lastSyncAt: null,
  lastSyncStatus: null,
  lastSyncDetails: null,

  emailSubjectTemplate: STANDARD_EMAIL_TEMPLATES.subject,
  emailIntroTemplate: STANDARD_EMAIL_TEMPLATES.intro,
  emailSignatureTemplate: STANDARD_EMAIL_TEMPLATES.signature,
};
