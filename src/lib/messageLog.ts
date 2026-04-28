/**
 * COST OPTIMIZATION (2026-04-28): logMessageSend is now a no-op.
 * The message_send_log table was the second-largest cost driver (2.18 B rows
 * scanned). User confirmed they don't use the Message Log / Marketing Retry
 * features, so we stop writing here. Existing historical rows are preserved.
 *
 * The signature is kept identical so every call site keeps compiling without
 * edits. To re-enable, restore the previous implementation from git history.
 */
export async function logMessageSend(
  _mobile: string,
  _patientName: string | null | undefined,
  _messageType: string,
  _umrNumber?: string | null,
  _primaryKey?: string | null,
  _messageContent?: string | null,
  _messageIdOrStatus?: string | null,
  _retryPayload?: Record<string, unknown> | null,
) {
  // intentionally empty — see header comment
}

/**
 * Extract messageId from a whatsapp-proxy response.
 *
 * supabase.functions.invoke returns { data, error }.
 * Pass proxyRes.data here — it contains { status, body } where body is a JSON string.
 * The AOC API typically returns { messageId: "..." } in the body.
 */
export function extractMessageId(proxyData: any): string | null {
  try {
    if (!proxyData) return null;

    // proxyData might be { status, body } from our proxy
    let body = proxyData.body ?? proxyData;

    // body might be a JSON string that needs parsing
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        return null;
      }
    }

    // Check common key paths for messageId
    const id =
      body?.messageId ||
      body?.message_id ||
      body?.id ||
      body?.messages?.[0]?.id ||
      null;

    if (id) {
      console.log("[extractMessageId] Captured:", id);
    } else {
      console.warn("[extractMessageId] No messageId found in:", JSON.stringify(proxyData).slice(0, 300));
    }

    return id;
  } catch {
    return null;
  }
}
