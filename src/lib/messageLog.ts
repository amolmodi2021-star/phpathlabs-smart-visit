import { supabase } from "@/integrations/supabase/client";

/**
 * Log every outgoing WhatsApp message to the universal message_send_log table.
 * Fire-and-forget — errors are silently ignored so they don't break the send flow.
 */
export async function logMessageSend(
  mobile: string,
  patientName: string | null | undefined,
  messageType: string,
) {
  const mobile10 = (mobile || "").replace(/\D/g, "").slice(-10);
  if (!mobile10) return;

  try {
    await supabase.from("message_send_log").insert({
      mobile_number: mobile10,
      patient_name: patientName || null,
      message_type: messageType,
    });
  } catch {
    // silently ignore — logging must never break the send flow
  }
}
