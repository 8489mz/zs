export interface WhatsAppGatewayConfig {
  enabled: boolean;
  provider: 'ultramsg' | 'greenapi' | 'custom_webhook';
  apiUrl?: string;
  instanceId?: string;
  token?: string;
  autoSendInvoice: boolean;
  autoSendOnlineOrder: boolean;
  invoiceTemplate?: string;
  aiBotEnabled?: boolean;
  aiBotPrompt?: string;
  aiBotWelcomeMessage?: string;
  aiBotOffHoursOnly?: boolean;
}

export interface AiConfigResponse {
  hasApiKey: boolean;
  isCustomKey: boolean;
  maskedKey: string;
  engine: string;
  provider?: 'gemini' | 'openai' | 'custom';
  model: string;
  baseUrl?: string;
}

export interface SimChatMessage {
  id: string;
  sender: 'customer' | 'bot';
  text: string;
  time: string;
  engine?: string;
}
