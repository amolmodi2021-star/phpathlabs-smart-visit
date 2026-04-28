/**
 * Message logging fully removed (cost optimization, 2026-04-28).
 * This shim keeps existing call sites compiling without writing anything to
 * the database. The `message_send_log` table has been DROPPED — do not
 * re-introduce it.
 */
export async function logMessageSend(
  _mobile: string,
  _patientName?: string | null,
  _messageType?: string,
  _umrNumber?: string | null,
  _primaryKey?: string | null,
  _messageContent?: string | null,
  _messageIdOrStatus?: string | null,
  _retryPayload?: Record<string, unknown> | null,
): Promise<void> {
  // intentionally empty
}

/** Extract WhatsApp messageId from the proxy response (used by chat for delivery ticks). */
export function extractMessageId(proxyData: unknown): string | null {
  try {
    if (!proxyData) return null;
    let body: any = (proxyData as any).body ?? proxyData;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { return null; }
    }
    return (
      body?.messageId ||
      body?.message_id ||
      body?.id ||
      body?.messages?.[0]?.id ||
      null
    );
  } catch {
    return null;
  }
}
