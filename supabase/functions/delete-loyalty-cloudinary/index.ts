// Deletes loyalty card images from Cloudinary in batches of 100 (Cloudinary's
// per-call max for the Admin `delete_resources` endpoint). Free-tier Admin API
// rate limit = 500 calls/hour; we add a brief pause every 400 calls to stay
// well below it. Anything we miss ages out via the 7-day Cloudinary auto-delete
// rule, so partial failures are non-fatal.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

async function hmacSha1Hex(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  // Cloudinary signs with SHA1 of `params + api_secret` (not HMAC). Keep helper
  // for parity but we use the documented signature scheme below.
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha1Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function deleteBatch(cloudName: string, publicIds: string[], apiKey: string, apiSecret: string): Promise<{ deleted: number; failed: number }> {
  const timestamp = Math.floor(Date.now() / 1000);
  const rawToSign = `public_ids[]=${publicIds.join("&public_ids[]=")}&timestamp=${timestamp}`;
  const signature = await sha1Hex(rawToSign + apiSecret);

  const fd = new FormData();
  for (const id of publicIds) fd.append("public_ids[]", id);
  fd.append("timestamp", String(timestamp));
  fd.append("api_key", apiKey);
  fd.append("signature", signature);

  const url = `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload`;
  const res = await fetch(url, { method: "DELETE", body: fd });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`Cloudinary delete batch failed ${res.status}: ${text.slice(0, 200)}`);
    return { deleted: 0, failed: publicIds.length };
  }
  const json = await res.json().catch(() => ({} as any));
  const deletedMap = (json?.deleted ?? {}) as Record<string, string>;
  let deleted = 0;
  let failed = 0;
  for (const id of publicIds) {
    const status = deletedMap[id];
    if (status === "deleted" || status === "not_found") deleted++;
    else failed++;
  }
  return { deleted, failed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({} as any));
    const publicIds: string[] = Array.isArray(body?.publicIds) ? body.publicIds.filter((x: unknown): x is string => typeof x === "string" && x.length > 0) : [];
    if (publicIds.length === 0) {
      return new Response(JSON.stringify({ deleted: 0, failed: 0, skipped: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve cloud_name + credentials: prefer the active row in cloudinary_accounts,
    // fall back to legacy env-var configuration for the original "dd7qn3t3d" account.
    let cloudName = body?.cloudName as string | undefined;
    let apiKey = body?.apiKey as string | undefined;
    let apiSecret = body?.apiSecret as string | undefined;

    if (!cloudName || !apiKey || !apiSecret) {
      try {
        const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const { data } = await sb.from("cloudinary_accounts").select("cloud_name, api_key, api_secret").eq("is_active", true).maybeSingle();
        if (data) {
          cloudName = cloudName || data.cloud_name;
          apiKey = apiKey || data.api_key || undefined;
          apiSecret = apiSecret || data.api_secret || undefined;
        }
      } catch (e) { console.warn("cloudinary_accounts lookup failed", e); }
    }
    cloudName = cloudName || "dd7qn3t3d";
    apiKey = apiKey || Deno.env.get("CLOUDINARY_API_KEY") || "";
    apiSecret = apiSecret || Deno.env.get("CLOUDINARY_API_SECRET") || "";
    if (!apiKey || !apiSecret) {
      return new Response(JSON.stringify({ error: "Cloudinary credentials not configured for active account" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let deleted = 0;
    let failed = 0;
    const BATCH = 100;
    let batchIndex = 0;

    for (let i = 0; i < publicIds.length; i += BATCH) {
      const slice = publicIds.slice(i, i + BATCH);
      const r = await deleteBatch(cloudName, slice, apiKey, apiSecret);
      deleted += r.deleted;
      failed += r.failed;
      batchIndex++;
      if (batchIndex % 400 === 0) await new Promise((r) => setTimeout(r, 2000));
    }

    return new Response(JSON.stringify({ deleted, failed, skipped: 0, batches: batchIndex }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("delete-loyalty-cloudinary error", e);
    return new Response(JSON.stringify({ error: (e as Error)?.message || "unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
