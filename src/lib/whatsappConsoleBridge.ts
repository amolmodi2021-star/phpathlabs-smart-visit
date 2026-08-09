import { supabase } from "@/integrations/supabase/client";

export type WhatsAppConsoleOutboxKind = "invoice" | "text" | "image";

export interface EnqueueWhatsAppConsolePayload {
  kind?: WhatsAppConsoleOutboxKind;
  phone: string;
  patient_name?: string | null;
  registration_id?: string | null;
  invoice_number?: string | null;
  caption?: string | null;
  media_url?: string | null;
  media_mime?: string | null;
  payload?: Record<string, unknown>;
}

function phone10(raw: string): string {
  return String(raw || "").replace(/\D/g, "").slice(-10);
}

/** Queue a WhatsApp send for WhatsApp Console middleware to deliver. */
export async function enqueueWhatsAppConsoleMessage(
  input: EnqueueWhatsAppConsolePayload,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const phone = phone10(input.phone);
  if (phone.length !== 10) {
    return { ok: false, error: "Valid 10-digit mobile required" };
  }

  const row = {
    kind: input.kind || "text",
    phone,
    patient_name: input.patient_name || null,
    registration_id: input.registration_id || null,
    invoice_number: input.invoice_number || null,
    caption: input.caption || null,
    media_url: input.media_url || null,
    media_mime: input.media_mime || (input.media_url ? "image/jpeg" : null),
    status: "pending",
    payload: input.payload || {},
  };

  const { data, error } = await supabase
    .from("whatsapp_console_outbox" as any)
    .insert(row as any)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: (data as any)?.id };
}

/** Upload invoice JPEG and enqueue for Console delivery. */
export async function enqueueInvoiceForWhatsAppConsole(opts: {
  phone: string;
  patient_name?: string | null;
  registration_id?: string | null;
  invoice_number: string;
  caption: string;
  blob: Blob;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const phone = phone10(opts.phone);
  if (phone.length !== 10) return { ok: false, error: "Valid 10-digit mobile required" };

  const path = `invoices/${opts.invoice_number}-${Date.now()}.jpg`;
  const { error: upErr } = await supabase.storage
    .from("chat-attachments")
    .upload(path, opts.blob, { contentType: "image/jpeg", upsert: true });
  if (upErr) return { ok: false, error: upErr.message };

  const { data: pub } = supabase.storage.from("chat-attachments").getPublicUrl(path);
  return enqueueWhatsAppConsoleMessage({
    kind: "invoice",
    phone,
    patient_name: opts.patient_name,
    registration_id: opts.registration_id,
    invoice_number: opts.invoice_number,
    caption: opts.caption,
    media_url: pub.publicUrl,
    media_mime: "image/jpeg",
    payload: { storage_path: path },
  });
}
