import { supabase } from "@/integrations/supabase/client";

// Safe alphabet: omit 0/O/1/I/L for unambiguous reading
const SAFE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateSuffix(length = 4): string {
  let out = "";
  const buf = new Uint32Array(length);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < length; i++) out += SAFE_ALPHABET[buf[i] % SAFE_ALPHABET.length];
  } else {
    for (let i = 0; i < length; i++) out += SAFE_ALPHABET[Math.floor(Math.random() * SAFE_ALPHABET.length)];
  }
  return out;
}

export function buildToken(invoiceNumber: string): string {
  return `${invoiceNumber}${generateSuffix(4)}`;
}

export async function createShareLink(
  registrationId: string,
  invoiceNumber: string,
  createdBy: string | null
): Promise<{ token: string; url: string }> {
  // Try up to 3 collision retries
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = buildToken(invoiceNumber);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from("report_share_links").insert({
      token,
      registration_id: registrationId,
      invoice_number: invoiceNumber,
      expires_at: expiresAt,
      created_by: createdBy,
    } as any);
    if (!error) {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      return { token, url: `${origin}/r/${token}` };
    }
    if (!String(error.message).toLowerCase().includes("duplicate")) {
      throw error;
    }
  }
  throw new Error("Failed to generate unique link token");
}

export async function lookupShareLink(token: string) {
  const { data, error } = await (supabase as any).rpc("portal_lookup", { p_token: token });
  if (error) throw error;
  if (!data) return null;
  if (data.expired) return { ...data.link, _expired: true };
  return data;
}

/** Token-scoped portal payload (regs/results/tubes/snips) — no anon table SELECT on PHI. */
export async function fetchPortalBundle(token: string) {
  const { data, error } = await (supabase as any).rpc("portal_bundle", { p_token: token });
  if (error) throw error;
  return data;
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const buf = new TextEncoder().encode(input);
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return input;
}

let cachedIpHash: string | null = null;
async function getIpHash(): Promise<string | null> {
  if (cachedIpHash) return cachedIpHash;
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const j = await res.json();
    if (j?.ip) {
      cachedIpHash = await sha256Hex(String(j.ip));
      return cachedIpHash;
    }
  } catch {}
  return null;
}

export async function logEvent(
  token: string,
  eventType:
    | "opened"
    | "verified"
    | "verification_failed"
    | "download_attempted"
    | "downloaded"
    | "blocked_due_pending"
    | "shared_whatsapp",
  sessionId?: string,
  metadata?: Record<string, any>
) {
  try {
    const ipHash = await getIpHash();
    await supabase.from("report_link_events").insert({
      token,
      event_type: eventType,
      ip_hash: ipHash,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : null,
      session_id: sessionId || null,
      metadata: metadata || {},
    } as any);
  } catch (e) {
    // analytics failures must never break the patient flow
    console.warn("logEvent failed", e);
  }
}

export function newSessionId(): string {
  if (typeof crypto !== "undefined" && (crypto as any).randomUUID) return (crypto as any).randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function startSession(token: string, sessionId: string) {
  try {
    await supabase.from("report_link_sessions").insert({
      session_id: sessionId,
      token,
      total_dwell_seconds: 0,
    } as any);
  } catch (e) {
    console.warn("startSession failed", e);
  }
}

export async function heartbeatSession(sessionId: string, addSeconds: number) {
  try {
    const { data } = await supabase
      .from("report_link_sessions")
      .select("total_dwell_seconds")
      .eq("session_id", sessionId)
      .maybeSingle();
    const current = (data as any)?.total_dwell_seconds || 0;
    await supabase
      .from("report_link_sessions")
      .update({
        last_heartbeat_at: new Date().toISOString(),
        total_dwell_seconds: current + addSeconds,
      } as any)
      .eq("session_id", sessionId);
  } catch (e) {
    // silent
  }
}
