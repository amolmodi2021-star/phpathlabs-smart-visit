import { supabase } from "@/integrations/supabase/client";

/**
 * Log every outgoing WhatsApp message to the universal message_send_log table.
 * Fire-and-forget — errors are silently ignored so they don't break the send flow.
 *
 * COST OPTIMIZATION (2026-04): we no longer persist `message_content` or
 * `retry_payload` here. Storing the full WhatsApp caption was adding ~25 MB/day
 * of database growth and bloated realtime broadcast payloads. The `message_type`
 * column (e.g. "ABC Card", "Abnormal History", "Promotion") is enough audit
 * detail; the WhatsApp Chat UI reads message bodies from `webhook_messages`,
 * not from this log.
 *
 * Trade-off: Marketing/Promotion retries from `retry_payload` are no longer
 * possible — failed rows surface as "missing payload" in the Retry tab. ABC and
 * Abnormal retries are unaffected (they regenerate the card from CRM).
 *
 * Backward-compatible signature: existing callers passing (mobile, name, type)
 * or (mobile, name, type, umr, primaryKey, messageContent, messageId) still
 * work — `messageContent` and `retryPayload` are simply ignored on insert.
 */
export async function logMessageSend(
  mobile: string,
  patientName: string | null | undefined,
  messageType: string,
  umrNumber?: string | null,
  primaryKey?: string | null,
  _messageContent?: string | null,
  messageIdOrStatus?: string | null,
  _retryPayload?: Record<string, unknown> | null,
) {
  const mobile10 = (mobile || "").replace(/\D/g, "").slice(-10);
  if (!mobile10) return;

  // Auto-detect: 7th arg can be a status keyword or a messageId.
  let deliveryStatus: "sent" | "failed" = "sent";
  let messageId: string | null = null;
  if (messageIdOrStatus === "sent" || messageIdOrStatus === "failed") {
    deliveryStatus = messageIdOrStatus;
  } else if (messageIdOrStatus) {
    messageId = messageIdOrStatus;
  }

  const insertRow: Record<string, unknown> = {
    mobile_number: mobile10,
    patient_name: patientName || null,
    message_type: messageType,
    umr_number: umrNumber || null,
    primary_key: primaryKey || null,
    message_content: null,
    message_id: messageId,
    delivery_status: deliveryStatus,
    retry_payload: null,
  };
  if (deliveryStatus === "failed") {
    insertRow.failed_at = new Date().toISOString();
    insertRow.retry_count = 0;
  }

  try {
    await supabase.from("message_send_log").insert(insertRow as any);
  } catch {
    // silently ignore — logging must never break the send flow
  }
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
