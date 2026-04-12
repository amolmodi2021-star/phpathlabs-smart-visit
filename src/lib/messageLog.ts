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
 * The proxy returns { status, body } where body is a JSON string from the API.
 * The AOC API typically returns { messageId: "..." } in the body.
 */
export function extractMessageId(proxyData: any): string | null {
  try {
    if (!proxyData?.body) return null;
    const parsed = typeof proxyData.body === "string" ? JSON.parse(proxyData.body) : proxyData.body;
    return parsed?.messageId || parsed?.message_id || parsed?.id || null;
  } catch {
    return null;
  }
}
