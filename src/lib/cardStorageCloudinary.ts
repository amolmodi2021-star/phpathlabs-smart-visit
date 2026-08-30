/**
 * Cloudinary upload helper for personalized card JPEGs.
 *
 * Account selection: cloud_name + upload_preset are now resolved at runtime
 * from the `cloudinary_accounts` table (the row where is_active = true).
 * Admins manage accounts via WhatsApp Settings → Cloudinary Accounts.
 *
 * Why Cloudinary:
 *  - WhatsApp fetches the image URL directly; Cloudinary's free tier covers
 *    typical send volume without extra app-hosting egress.
 *  - Cloudinary auto-assigns unguessable public IDs.
 *  - Browser-side unsigned upload means no edge function in the hot path.
 */
import type { CardFailureReason } from "@/lib/cardRenderer";
import { supabase } from "@/integrations/supabase/client";

export type CloudinaryFailureReason =
  | "cloudinary_5xx"
  | "cloudinary_4xx"
  | "cloudinary_network";

export type CloudinaryPurpose = "whatsapp" | "outsourced_pdf" | "bills";

interface ActiveAccount {
  cloudName: string;
  uploadPreset: string;
}

let cachedAccounts: { value: Record<string, ActiveAccount | null>; ts: number } | null = null;
const CACHE_MS = 60_000;

export function invalidateCloudinaryAccountCache() {
  cachedAccounts = null;
}

async function getActiveAccount(purpose: CloudinaryPurpose = "whatsapp"): Promise<ActiveAccount> {
  const now = Date.now();
  if (cachedAccounts && now - cachedAccounts.ts < CACHE_MS && cachedAccounts.value[purpose]) {
    return cachedAccounts.value[purpose]!;
  }
  const { data, error } = await supabase
    .from("cloudinary_accounts")
    .select("cloud_name, upload_preset, purpose")
    .eq("is_active", true)
    .eq("purpose", purpose)
    .maybeSingle();
  if (error || !data) {
    // Fallback: legacy rows without purpose filter (pre-migration) for whatsapp only
    if (purpose === "whatsapp") {
      const legacy = await supabase
        .from("cloudinary_accounts")
        .select("cloud_name, upload_preset")
        .eq("is_active", true)
        .maybeSingle();
      if (legacy.data) {
        const value = { cloudName: legacy.data.cloud_name, uploadPreset: legacy.data.upload_preset };
        cachedAccounts = { value: { ...(cachedAccounts?.value || {}), whatsapp: value }, ts: now };
        return value;
      }
    }
    throw new Error(
      purpose === "outsourced_pdf"
        ? "cloudinary_4xx: no active Outsourced PDF Cloudinary account — configure it in LIMS → Settings → Cloudinary"
        : purpose === "bills"
          ? "cloudinary_4xx: no active Bills Cloudinary account — configure it in Accounts → Settings → Cloudinary (Bills)"
          : "cloudinary_4xx: no active Cloudinary account configured",
    );
  }
  const value = { cloudName: data.cloud_name, uploadPreset: data.upload_preset };
  cachedAccounts = {
    value: { ...(cachedAccounts?.value || {}), [purpose]: value },
    ts: now,
  };
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

export type CloudinaryResourceType = "image" | "raw" | "auto";

export interface CloudinaryUploadResult {
  secure_url: string;
  public_id: string;
  cloud_name: string;
  /** Effective type after upload (`auto` resolves to image|raw|video). */
  resource_type: "image" | "raw" | "video";
  /** Folder prefix requested at upload (e.g. loyalty-cards/invoices). */
  folder?: string;
}

/**
 * Upload a blob to the active Cloudinary account via unsigned preset.
 * JPEG → image; PDF → auto (keeps original bytes; works with image-oriented presets).
 * Bytes are sent as-is; callers must not re-encode for quality.
 */
export async function uploadBlobToCloudinary(
  blob: Blob,
  opts: {
    resourceType: CloudinaryResourceType;
    /** Subfolder under the preset root, e.g. `invoices` (preset root is usually loyalty-cards). */
    folder?: string;
    /** Optional stable public id (without extension). Nested ids like `invoices/x` are fine. */
    publicId?: string;
    filename?: string;
    /** Defaults to WhatsApp media account. Use outsourced_pdf for lab PDFs. */
    purpose?: CloudinaryPurpose;
  },
): Promise<CloudinaryUploadResult> {
  const acct = await getActiveAccount(opts.purpose || "whatsapp");
  const resourceType = opts.resourceType;
  const url = `https://api.cloudinary.com/v1_1/${acct.cloudName}/${resourceType}/upload`;
  const fd = new FormData();
  if (opts.filename) {
    fd.append("file", blob, opts.filename);
  } else {
    fd.append("file", blob);
  }
  fd.append("upload_preset", acct.uploadPreset);
  if (opts.folder) fd.append("folder", opts.folder);
  if (opts.publicId) fd.append("public_id", opts.publicId);
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
  const json = (await res.json()) as {
    secure_url?: string;
    public_id?: string;
    resource_type?: string;
  };
  if (!json?.secure_url) throw new Error("cloudinary_4xx: missing secure_url");
  if (!json?.public_id) throw new Error("cloudinary_4xx: missing public_id");
  const rtRaw = String(json.resource_type || resourceType || "image");
  const rt: "image" | "raw" | "video" =
    rtRaw === "raw" ? "raw" : rtRaw === "video" ? "video" : "image";
  return {
    secure_url: json.secure_url,
    public_id: json.public_id,
    cloud_name: acct.cloudName,
    resource_type: rt,
    folder: opts.folder,
  };
}

/**
 * Upload a JPEG blob to the active Cloudinary account via unsigned preset and
 * return the `secure_url`. Throws on failure (caller should classify with the
 * retry wrapper below).
 */
export async function uploadJpegToCloudinary(blob: Blob): Promise<string> {
  const result = await uploadBlobToCloudinary(blob, { resourceType: "image" });
  return result.secure_url;
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
