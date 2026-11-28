/**
 * Shared port for sending WhatsApp security/loss-prevention alerts
 * without coupling consumer modules (such as inventory) directly to
 * SettingsModule (INV-LOSS-PREVENTION-SHIELD).
 *
 * WhatsAppGatewayService extends this abstract class and SettingsModule
 * binds `{ provide: WhatsAppAlertPort, useExisting: WhatsAppGatewayService }`
 * globally, matching the ExchangeReturnPort pattern.
 */
export abstract class WhatsAppAlertPort {
  abstract sendRawMessage(
    tenantId: string,
    phone: string,
    text: string,
  ): Promise<{ success: boolean; message?: string }>;
}
