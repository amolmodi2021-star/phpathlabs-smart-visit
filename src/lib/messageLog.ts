import { supabase } from "@/integrations/supabase/client";

/**
 * Log every outgoing WhatsApp message to the universal message_send_log table.
 * Fire-and-forget — errors are silently ignored so they don't break the send flow.
 */
export async function logMessageSend(
  mobile: string,
  patientName: string | null | undefined,
  messageType: string,
  umrNumber?: string | null,
  primaryKey?: string | null,
  messageContent?: string | null,
  messageId?: string | null,
) {
  const mobile10 = (mobile || "").replace(/\D/g, "").slice(-10);
  if (!mobile10) return;

  try {
    await supabase.from("message_send_log").insert({
      mobile_number: mobile10,
      patient_name: patientName || null,
      message_type: messageType,
      umr_number: umrNumber || null,
      primary_key: primaryKey || null,
      message_content: messageContent || null,
      message_id: messageId || null,
      delivery_status: "sent",
    } as any);
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
