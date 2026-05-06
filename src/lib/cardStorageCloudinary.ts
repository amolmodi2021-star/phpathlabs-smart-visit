/**
 * Cloudinary upload helper for personalized card JPEGs.
 *
 * Account selection: cloud_name + upload_preset are now resolved at runtime
 * from the `cloudinary_accounts` table (the row where is_active = true).
 * Admins manage accounts via WhatsApp Settings → Cloudinary Accounts.
 *
 * Why Cloudinary instead of Lovable Cloud Storage:
 *  - Lovable Cloud egress was costing $4–5/day for ~1000 cards (each WhatsApp
 *    fetch counts as paid egress). Cloudinary's free tier (25 GB/month bandwidth,
 *    25 GB storage) easily covers our send volume at $0.
 *  - Cloudinary auto-assigns unguessable public IDs.
 *  - Browser-side unsigned upload means no edge function in the hot path.
 */
import type { CardFailureReason } from "@/lib/cardRenderer";
import { supabase } from "@/integrations/supabase/client";

export type CloudinaryFailureReason =
  | "cloudinary_5xx"
  | "cloudinary_4xx"
  | "cloudinary_network";

interface ActiveAccount {
  cloudName: string;
  uploadPreset: string;
}

let cachedAccount: { value: ActiveAccount | null; ts: number } | null = null;
const CACHE_MS = 60_000;

export function invalidateCloudinaryAccountCache() {
  cachedAccount = null;
}

async function getActiveAccount(): Promise<ActiveAccount> {
  const now = Date.now();
  if (cachedAccount && now - cachedAccount.ts < CACHE_MS && cachedAccount.value) {
    return cachedAccount.value;
  }
  const { data, error } = await supabase
    .from("cloudinary_accounts")
    .select("cloud_name, upload_preset")
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) {
    throw new Error("cloudinary_4xx: no active Cloudinary account configured");
  }
  const value = { cloudName: data.cloud_name, uploadPreset: data.upload_preset };
  cachedAccount = { value, ts: now };
  return value;
}

function classifyCloudinaryError(err: unknown): CloudinaryFailureReason {
  const msg = String((err as { message?: string })?.message || err || "").toLowerCase();
  const m = msg.match(/cloudinary_(\d{3})/);
  if (m) {
    const code = Number(m[1]);
    if (code >= 500) return "cloudinary_5xx";
    if (code >= 400) return "cloudinary_4xx";
  }
  if (/\b(5\d\d|429|timeout)\b/.test(msg)) return "cloudinary_5xx";
  if (/\b(4\d\d)\b/.test(msg)) return "cloudinary_4xx";
  return "cloudinary_network";
}

/**
 * Upload a JPEG blob to the active Cloudinary account via unsigned preset and
 * return the `secure_url`. Throws on failure (caller should classify with the
 * retry wrapper below).
 */
export async function uploadJpegToCloudinary(blob: Blob): Promise<string> {
  const acct = await getActiveAccount();
  const url = `https://api.cloudinary.com/v1_1/${acct.cloudName}/image/upload`;
  const fd = new FormData();
  fd.append("file", blob);
  fd.append("upload_preset", acct.uploadPreset);
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: fd });
  } catch (e) {
    throw new Error(`cloudinary_network: ${(e as Error)?.message || e}`);
  }
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j?.error?.message || JSON.stringify(j).slice(0, 200);
    } catch {}
    throw new Error(`cloudinary_${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const json = (await res.json()) as { secure_url?: string };
  if (!json?.secure_url) throw new Error("cloudinary_4xx: missing secure_url");
  return json.secure_url;
}

/**
 * Upload with bounded retries. The blob is re-encoded each attempt so a
 * transient `toBlob` null doesn't kill the whole record. Tagged failure
 * reasons (`cloudinary_5xx` | `cloudinary_4xx` | `cloudinary_network` |
 * `toblob_null`) feed the drip diagnostic log.
 */
export async function uploadJpegToCloudinaryWithRetry(
  blobFn: () => Promise<Blob>,
): Promise<string> {
  let lastErr: unknown = null;
  let lastReason: CardFailureReason = "cloudinary_network";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const blob = await blobFn();
      return await uploadJpegToCloudinary(blob);
    } catch (e) {
      lastErr = e;
      const msg = String((e as Error)?.message || e || "");
      lastReason = msg === "toblob_null" ? "toblob_null" : classifyCloudinaryError(e);
      if (lastReason === "cloudinary_4xx" && !/429/.test(msg)) break;
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 250 * Math.pow(3, attempt)));
  }
  const tagged = new Error(lastReason) as Error & { reason: CardFailureReason };
  tagged.reason = lastReason;
  (tagged as { cause?: unknown }).cause = lastErr;
  throw tagged;
}
