import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const PAGE = 1000;

async function fetchAll(buildQuery: (from: number, to: number) => any): Promise<any[]> {
  const out: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function fetchAbnormalParameterCatalog() {
  const supabase = sb();
  const rows = await fetchAll((f, t) =>
    supabase
      .from("report_test_parameters")
      .select("parameter_name")
      .eq("is_active", true)
      .order("parameter_name", { ascending: true })
      .range(f, t),
  );
  const seen = new Set<string>();
  const data: Array<{ id: string; name: string; code: string }> = [];
  for (const r of rows) {
    const name = String(r.parameter_name || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    data.push({
      id: name,
      name,
      code: "",
    });
  }
  return data;
}

async function fetchAbnormalResults(opts: {
  names: string[];
  fromDate: string;
  afterInvoice: string;
}) {
  const supabase = sb();
  const names = [...new Set(opts.names.map((n) => n.trim()).filter(Boolean))];
  const afterInvoice = opts.afterInvoice || "2608100018";
  const fromDate = opts.fromDate || null;

  const rows = await fetchAll((f, t) =>
    supabase
      .rpc("desktop_abnormal_results", {
        p_names: names,
        p_from: fromDate,
        p_after_invoice: afterInvoice,
      })
      .range(f, t),
  );

  const data = (rows as any[])
    .map((row) => ({
      umr_number: String(row.umr_number || "").trim(),
      mobile_number: String(row.mobile_number || "").trim(),
      parameter_name: String(row.parameter_name || "").trim(),
      result_value: String(row.result_value || "").trim(),
      reference_range: String(row.reference_range || "").trim(),
      result_date: String(row.result_date || ""),
    }))
    .filter((r) => r.umr_number && r.parameter_name);

  return {
    after_invoice: afterInvoice,
    from_date: fromDate,
    count: { results: data.length, parameters: names.length },
    data,
  };
}

function requireApiKey(req: Request): Response | null {
  // Local demo fallback when edge container wasn't recreated with secrets.
  const expected =
    Deno.env.get("DESKTOP_API_KEY")?.trim() ||
    (Deno.env.get("SUPABASE_URL")?.includes("kong") || Deno.env.get("SUPABASE_URL")?.includes("127.0.0.1")
      ? "phpathlabs-local-desktop-api"
      : "");
  const provided = req.headers.get("x-api-key");
  if (!expected || provided !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }
  return null;
}

function sb() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

function storagePathFromRow(row: any): string | null {
  const fromPayload = row?.payload?.storage_path;
  if (typeof fromPayload === "string" && (fromPayload.startsWith("invoices/") || fromPayload.startsWith("reports/"))) {
    return fromPayload;
  }
  const url = String(row?.media_url || "");
  const marker = "/chat-attachments/";
  const idx = url.indexOf(marker);
  if (idx >= 0) {
    const path = decodeURIComponent(url.slice(idx + marker.length).split("?")[0] || "");
    if (path.startsWith("invoices/") || path.startsWith("reports/")) return path;
  }
  return null;
}

type CloudinaryMediaRef = {
  cloudName: string;
  publicId: string;
  resourceType: "image" | "raw" | "video";
};

function cloudinaryRefFromRow(row: any): CloudinaryMediaRef | null {
  const p = row?.payload && typeof row.payload === "object" ? row.payload : null;
  const publicId = typeof p?.cloudinary_public_id === "string" ? p.cloudinary_public_id.trim() : "";
  if (!publicId) return null;
  const cloudName =
    (typeof p?.cloudinary_cloud_name === "string" && p.cloudinary_cloud_name.trim()) ||
    "";
  const rt = String(p?.cloudinary_resource_type || "").toLowerCase();
  const resourceType: "image" | "raw" | "video" =
    rt === "raw" ? "raw" : rt === "video" ? "video" : "image";
  return { cloudName, publicId, resourceType };
}

async function sha1Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type CloudinaryCreds = { cloudName: string; apiKey: string; apiSecret: string };
const CLOUDINARY_CREDS_CACHE_MS = 30 * 60 * 1000;
const cloudinaryCredsCache = new Map<string, { value: CloudinaryCreds | null; ts: number }>();

function cloudinaryCacheKey(preferredCloudName?: string): string {
  return (preferredCloudName || "").trim() || "__active__";
}

async function resolveCloudinaryCreds(
  supabase: ReturnType<typeof sb>,
  preferredCloudName?: string,
): Promise<CloudinaryCreds | null> {
  const key = cloudinaryCacheKey(preferredCloudName);
  const hit = cloudinaryCredsCache.get(key);
  const now = Date.now();
  if (hit && now - hit.ts < CLOUDINARY_CREDS_CACHE_MS) return hit.value;

  const preferred = (preferredCloudName || "").trim();
  let resolved: CloudinaryCreds | null = null;
  if (preferred) {
    const { data } = await supabase
      .from("cloudinary_accounts")
      .select("cloud_name, api_key, api_secret")
      .eq("cloud_name", preferred)
      .limit(1)
      .maybeSingle();
    if (data?.api_key && data?.api_secret) {
      resolved = { cloudName: data.cloud_name, apiKey: data.api_key, apiSecret: data.api_secret };
    }
  }
  if (!resolved) {
    const { data: active } = await supabase
      .from("cloudinary_accounts")
      .select("cloud_name, api_key, api_secret")
      .eq("is_active", true)
      .maybeSingle();
    if (active?.api_key && active?.api_secret) {
      resolved = { cloudName: active.cloud_name, apiKey: active.api_key, apiSecret: active.api_secret };
    }
  }
  if (!resolved) {
    const apiKey = Deno.env.get("CLOUDINARY_API_KEY") || "";
    const apiSecret = Deno.env.get("CLOUDINARY_API_SECRET") || "";
    const cloudName = preferred || Deno.env.get("CLOUDINARY_CLOUD_NAME") || "dd7qn3t3d";
    if (apiKey && apiSecret) resolved = { cloudName, apiKey, apiSecret };
  }

  cloudinaryCredsCache.set(key, { value: resolved, ts: now });
  return resolved;
}

async function destroyCloudinaryResource(
  cloudName: string,
  apiKey: string,
  apiSecret: string,
  publicId: string,
  resourceType: "image" | "raw" | "video",
): Promise<boolean> {
  const timestamp = Math.floor(Date.now() / 1000);
  // Admin delete_resources signature: public_ids[]=...&timestamp=...
  const rawToSign = `public_ids[]=${publicId}&timestamp=${timestamp}`;
  const signature = await sha1Hex(rawToSign + apiSecret);
  const fd = new FormData();
  fd.append("public_ids[]", publicId);
  fd.append("timestamp", String(timestamp));
  fd.append("api_key", apiKey);
  fd.append("signature", signature);
  const url = `https://api.cloudinary.com/v1_1/${cloudName}/resources/${resourceType}/upload`;
  const res = await fetch(url, { method: "DELETE", body: fd });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn(`Cloudinary destroy failed ${res.status} ${publicId}: ${text.slice(0, 180)}`);
    // PDF often lands as image; retry image destroy once if raw failed.
    if (resourceType === "raw") {
      return destroyCloudinaryResource(cloudName, apiKey, apiSecret, publicId, "image");
    }
    return false;
  }
  const json = await res.json().catch(() => ({} as Record<string, unknown>));
  const deletedMap = (json?.deleted ?? {}) as Record<string, string>;
  const status = deletedMap[publicId];
  return status === "deleted" || status === "not_found" || !status;
}

async function deleteInvoiceMedia(supabase: ReturnType<typeof sb>, row: any): Promise<void> {
  const cref = cloudinaryRefFromRow(row);
  if (cref) {
    try {
      const creds = await resolveCloudinaryCreds(supabase, cref.cloudName);
      if (creds) {
        const ok = await destroyCloudinaryResource(
          creds.cloudName,
          creds.apiKey,
          creds.apiSecret,
          cref.publicId,
          cref.resourceType,
        );
        if (ok) return;
      } else {
        console.warn("Cloudinary credentials missing for outbox media delete", cref.publicId);
      }
    } catch (e) {
      console.warn("Cloudinary media delete failed", cref.publicId, e);
    }
  }

  // Legacy Supabase Storage path (pre-Cloudinary WA media)
  const path = storagePathFromRow(row);
  if (!path) return;
  try {
    await supabase.storage.from("chat-attachments").remove([path]);
  } catch (e) {
    console.warn("invoice media delete failed", path, e);
  }
}

type ListedStorageObject = { path: string; createdAtMs: number };

/**
 * Grace period before orphan sweeps may delete a storage object.
 * Prevents a race where LIMS uploads a file, prune runs before/while the
 * outbox row is inserted, and WhatsApp Console then gets HTTP 400 on download.
 */
const ORPHAN_MEDIA_GRACE_MS = 60 * 60 * 1000;

async function listStorageFolderObjects(
  supabase: ReturnType<typeof sb>,
  folder: string,
): Promise<ListedStorageObject[]> {
  const out: ListedStorageObject[] = [];
  let offset = 0;
  for (;;) {
    const { data: listed } = await supabase.storage.from("chat-attachments").list(folder, {
      limit: 100,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    const batch = listed || [];
    for (const item of batch) {
      if (!item?.name) continue;
      const createdRaw =
        (item as { created_at?: string }).created_at ||
        (item as { updated_at?: string }).updated_at ||
        "";
      const createdAtMs = Date.parse(createdRaw);
      out.push({
        path: `${folder}/${item.name}`,
        createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0,
      });
    }
    if (batch.length < 100) break;
    offset += batch.length;
    if (offset > 8000) break;
  }
  return out;
}

/**
 * Invoice JPEGs + report PDFs must not linger.
 * Prefer Cloudinary destroy via outbox payload; also clean legacy Supabase
 * Storage objects. Only sweep true Storage orphans after a grace period so
 * in-flight uploads are never removed before the outbox row can claim them.
 *
 * Call from the Console/Reception 60‑minute prune timer (or explicit prune_outbox).
 * Do NOT run on every idle claim — that caused massive PostgREST egress via
 * repeated cloudinary_accounts lookups.
 */
const MIN_PRUNE_INTERVAL_MS = 15 * 60 * 1000;
let lastPruneAtMs = 0;

async function pruneInvoiceOutbox24h(
  opts: { force?: boolean } = {},
): Promise<{ rows: number; files: number; skipped?: boolean }> {
  const nowMs = Date.now();
  if (!opts.force && lastPruneAtMs > 0 && nowMs - lastPruneAtMs < MIN_PRUNE_INTERVAL_MS) {
    return { rows: 0, files: 0, skipped: true };
  }
  lastPruneAtMs = nowMs;

  const supabase = sb();
  const { data: active, error: activeErr } = await supabase
    .from("whatsapp_console_outbox")
    .select("id, media_url, payload, status")
    .in("status", ["pending", "claimed"]);
  if (activeErr) throw activeErr;

  const keepStorage = new Set<string>();
  const keepCloudinary = new Set<string>();
  for (const row of active || []) {
    const path = storagePathFromRow(row);
    if (path) keepStorage.add(path);
    const cref = cloudinaryRefFromRow(row);
    if (cref) keepCloudinary.add(`${cref.resourceType}:${cref.publicId}`);
  }

  // Only rows that still have media — already-cleared rows skip Cloudinary lookups.
  const { data: inactive } = await supabase
    .from("whatsapp_console_outbox")
    .select("id, media_url, payload, media_mime")
    .in("status", ["sent", "failed", "cancelled"])
    .not("media_url", "is", null)
    .limit(100);

  let files = 0;
  for (const row of inactive || []) {
    const cref = cloudinaryRefFromRow(row);
    const path = storagePathFromRow(row);
    if (cref && keepCloudinary.has(`${cref.resourceType}:${cref.publicId}`)) continue;
    if (path && keepStorage.has(path)) continue;
    if (!cref && !path) continue;
    await deleteInvoiceMedia(supabase, row);
    files += 1;
  }
  const inactiveIds = (inactive || []).map((r) => r.id).filter(Boolean);
  if (inactiveIds.length) {
    await supabase
      .from("whatsapp_console_outbox")
      .update({ media_url: null, updated_at: new Date().toISOString() })
      .in("id", inactiveIds)
      .not("media_url", "is", null);
  }

  // Re-read keep immediately before orphan sweep (jobs may have arrived mid-prune).
  const { data: activeAgain } = await supabase
    .from("whatsapp_console_outbox")
    .select("id, media_url, payload, status")
    .in("status", ["pending", "claimed"]);
  for (const row of activeAgain || []) {
    const path = storagePathFromRow(row);
    if (path) keepStorage.add(path);
  }

  const orphanCutoff = Date.now() - ORPHAN_MEDIA_GRACE_MS;
  for (const folder of ["invoices", "reports"] as const) {
    const listed = await listStorageFolderObjects(supabase, folder);
    const stale = listed
      .filter((obj) => !keepStorage.has(obj.path) && obj.createdAtMs > 0 && obj.createdAtMs < orphanCutoff)
      .map((obj) => obj.path);
    if (!stale.length) continue;
    for (let i = 0; i < stale.length; i += 50) {
      const chunk = stale.slice(i, i + 50);
      const { error: rmErr } = await supabase.storage.from("chat-attachments").remove(chunk);
      if (!rmErr) files += chunk.length;
    }
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: oldRows, error } = await supabase
    .from("whatsapp_console_outbox")
    .select("id, media_url, payload, media_mime")
    .lt("created_at", cutoff)
    .limit(100);
  if (error) throw error;
  const rows = oldRows || [];
  for (const row of rows) {
    await deleteInvoiceMedia(supabase, row);
  }
  if (rows.length) {
    await supabase
      .from("whatsapp_console_outbox")
      .delete()
      .in(
        "id",
        rows.map((r) => r.id),
      );
  }
  return { rows: rows.length, files };
}

const STUCK_CLAIM_MS = 5 * 60 * 1000;
const RECLAIM_MIN_INTERVAL_MS = 2 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 2;
let lastReclaimAtMs = 0;

/** Re-queue claims abandoned mid-send (Console crash / laptop sleep). */
async function reclaimStuckClaims(supabase: ReturnType<typeof sb>) {
  const nowMs = Date.now();
  if (lastReclaimAtMs > 0 && nowMs - lastReclaimAtMs < RECLAIM_MIN_INTERVAL_MS) return;
  lastReclaimAtMs = nowMs;

  const cutoff = new Date(Date.now() - STUCK_CLAIM_MS).toISOString();
  const now = new Date().toISOString();
  await supabase
    .from("whatsapp_console_outbox")
    .update({
      status: "pending",
      claimed_at: null,
      claimed_by: null,
      next_retry_at: null,
      updated_at: now,
      last_error: "reclaimed_stuck_claim",
    })
    .eq("status", "claimed")
    .lt("claimed_at", cutoff);
}

const CLAIM_OUTBOX_COLS =
  "id, kind, phone, patient_name, invoice_number, caption, media_url, media_mime, payload, status, attempts, max_attempts, next_retry_at, created_at, last_error";

function normalizeOutboxPhone(raw: unknown): string {
  return String(raw || "").replace(/\D/g, "").slice(-10);
}

/** Oldest-first, at most one job per phone; skip phones that already have a claimed job. */
function pickOutboxJobsSerializingPhone<T extends { phone?: string | null }>(
  pending: T[],
  alreadyClaimedPhones: Iterable<string>,
  limit: number,
): T[] {
  const cap = Math.min(Math.max(Math.floor(Number(limit) || 0), 0), pending.length);
  if (cap <= 0) return [];
  const busy = new Set(
    [...alreadyClaimedPhones].map((p) => normalizeOutboxPhone(p)).filter(Boolean),
  );
  const picked: T[] = [];
  for (const row of pending) {
    if (picked.length >= cap) break;
    const phone = normalizeOutboxPhone(row.phone);
    if (!phone || busy.has(phone)) continue;
    picked.push(row);
    busy.add(phone);
  }
  return picked;
}

/** Atomically claim pending outbox rows for WhatsApp Console. */
async function claimOutbox(limit = 5, claimedBy = "whatsapp-console") {
  const supabase = sb();
  const lim = Math.min(Math.max(Number(limit) || 5, 1), 25);
  await reclaimStuckClaims(supabase);

  const nowIso = new Date().toISOString();
  // Fetch extra pending rows so same-phone filtering can still fill the claim batch.
  const { data: pending, error } = await supabase
    .from("whatsapp_console_outbox")
    .select(CLAIM_OUTBOX_COLS)
    .eq("status", "pending")
    .or(`next_retry_at.is.null,next_retry_at.lte."${nowIso}"`)
    .order("created_at", { ascending: true })
    .limit(Math.max(lim * 10, 50));
  if (error) throw error;
  const rows = pending || [];

  // Idle claim must NOT prune — Reception already runs prune on a 60‑minute timer.
  // Pruning here caused ~145k cloudinary_accounts PostgREST calls (Database Egress).
  if (!rows.length) return [];

  const { data: inFlight } = await supabase
    .from("whatsapp_console_outbox")
    .select("phone")
    .eq("status", "claimed");
  const selected = pickOutboxJobsSerializingPhone(
    rows,
    (inFlight || []).map((r) => String(r.phone || "")),
    lim,
  );
  if (!selected.length) return [];

  const now = new Date().toISOString();
  const claimed: any[] = [];
  for (const row of selected) {
    const { data, error: updErr } = await supabase
      .from("whatsapp_console_outbox")
      .update({
        status: "claimed",
        claimed_at: now,
        claimed_by: claimedBy,
        attempts: (row.attempts || 0) + 1,
        next_retry_at: null,
        updated_at: now,
      })
      .eq("id", row.id)
      .eq("status", "pending")
      .select(CLAIM_OUTBOX_COLS)
      .maybeSingle();
    if (!updErr && data) claimed.push(data);
  }
  return claimed;
}

/** Claim pending Tally voucher jobs for the Windows Tally bridge. */
async function claimTallyOutbox(limit = 5, claimedBy = "tally-bridge") {
  const supabase = sb();
  const lim = Math.min(Math.max(Number(limit) || 5, 1), 25);
  const nowIso = new Date().toISOString();

  // Reclaim stuck claimed rows older than 10 minutes
  const stuckBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await supabase
    .from("accounts_tally_voucher_outbox")
    .update({
      status: "pending",
      claimed_at: null,
      claimed_by: null,
      updated_at: nowIso,
      last_error: "reclaimed_stuck_claim",
    })
    .eq("status", "claimed")
    .lt("claimed_at", stuckBefore);

  const { data: pending, error } = await supabase
    .from("accounts_tally_voucher_outbox")
    .select("*")
    .eq("status", "pending")
    .or(`next_retry_at.is.null,next_retry_at.lte."${nowIso}"`)
    .order("created_at", { ascending: true })
    .limit(lim);
  if (error) throw error;

  const claimed: any[] = [];
  for (const row of pending || []) {
    const { data, error: updErr } = await supabase
      .from("accounts_tally_voucher_outbox")
      .update({
        status: "claimed",
        claimed_at: nowIso,
        claimed_by: claimedBy,
        attempts: (row.attempts || 0) + 1,
        next_retry_at: null,
        updated_at: nowIso,
      })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();
    if (!updErr && data) claimed.push(data);
  }
  return claimed;
}

async function completeTallyOutbox(
  id: string,
  status: "sent" | "failed" | "pending",
  lastError?: string | null,
  tallyResponse?: string | null,
) {
  const supabase = sb();
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from("accounts_tally_voucher_outbox")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!existing) throw new Error("tally outbox row not found");

  const attempts = Number(existing.attempts || 0);
  const maxAttempts = Number(existing.max_attempts || 3);
  let finalStatus: string = status;
  let nextRetry: string | null = null;

  if (status === "failed" && attempts < maxAttempts) {
    finalStatus = "pending";
    nextRetry = new Date(Date.now() + Math.min(30 * Math.pow(2, attempts), 900) * 1000).toISOString();
  }

  const { data, error } = await supabase
    .from("accounts_tally_voucher_outbox")
    .update({
      status: finalStatus,
      last_error: lastError ?? null,
      tally_response: tallyResponse ?? existing.tally_response ?? null,
      claimed_at: finalStatus === "pending" ? null : existing.claimed_at,
      claimed_by: finalStatus === "pending" ? null : existing.claimed_by,
      next_retry_at: nextRetry,
      updated_at: now,
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;

  if (existing.kind === "card_settlement" && existing.settlement_id) {
    const settlementStatus =
      finalStatus === "sent" ? "posted" : finalStatus === "failed" ? "failed" : "queued";
    await supabase
      .from("accounts_tally_card_settlements")
      .update({ status: settlementStatus, updated_at: now })
      .eq("id", existing.settlement_id);
  }

  return data;
}

function retryDelaySeconds(attempts: number): number {
  // First retry quickly (~8s); then 30s, 60s, 120s … capped at 15 min
  if (attempts <= 1) return 8;
  return Math.min(30 * Math.pow(2, Math.max(0, attempts - 2)), 900);
}

function isUnrecoverableOutboxError(errText: string | null): boolean {
  if (!errText) return false;
  return /invalid_phone|empty_job|empty_text|cancelled|unsupported_kind|dead_media|localhost_media|127\.0\.0\.1|media download HTTP 400|media download HTTP 404|file missing/i.test(
    errText,
  );
}

type WaFeedback = {
  ack?: number | null;
  via?: string | null;
};

async function completeOutbox(
  id: string,
  status: "sent" | "failed" | "pending",
  lastError?: string | null,
  wa?: WaFeedback,
) {
  const supabase = sb();
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from("whatsapp_console_outbox")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  const attempts = Number(existing?.attempts || 0);
  const maxAttempts = DEFAULT_MAX_ATTEMPTS;
  const errText = lastError ?? null;
  const terminalError = isUnrecoverableOutboxError(errText);

  // WhatsApp Console ack is the source of truth for sent vs failed.
  // One automatic retry only — then fail (number may not be on WhatsApp).
  let finalStatus = status;
  if (status === "failed" && !terminalError && attempts < maxAttempts) {
    finalStatus = "pending";
  }

  const prevPayload =
    existing?.payload && typeof existing.payload === "object" && !Array.isArray(existing.payload)
      ? { ...(existing.payload as Record<string, unknown>) }
      : {};
  const ackNum = typeof wa?.ack === "number" && Number.isFinite(wa.ack) ? wa.ack : null;
  const viaStr = wa?.via ? String(wa.via) : null;
  prevPayload.wa_feedback = {
    ok: finalStatus === "sent",
    ack: ackNum,
    via: viaStr,
    error: finalStatus === "sent" ? null : errText,
    attempts,
    at: now,
  };

  const patch: Record<string, unknown> = {
    status: finalStatus,
    updated_at: now,
    last_error: finalStatus === "sent" ? null : errText,
    payload: prevPayload,
  };
  if (finalStatus === "sent") {
    patch.sent_at = now;
    // Clear media URL after send — file deleted below (don't keep forever).
    patch.media_url = null;
    patch.next_retry_at = null;
    patch.claimed_at = null;
    patch.claimed_by = null;
  } else if (finalStatus === "failed") {
    patch.media_url = null;
    patch.claimed_at = null;
    patch.claimed_by = null;
    patch.next_retry_at = null;
  } else if (finalStatus === "pending") {
    patch.claimed_at = null;
    patch.claimed_by = null;
    // First retry + WA-not-ready / ack timeouts: try again immediately.
    const immediate =
      attempts <= 1 ||
      !errText ||
      /no_whatsapp_web|not.?connected|offline|network|timeout|temporar|ack_|msg_not_delivered|msg_failed|sendToChat|no_webpack|send_no_msg|no_ack/i.test(
        String(errText),
      );
    patch.next_retry_at = immediate
      ? null
      : new Date(Date.now() + retryDelaySeconds(attempts) * 1000).toISOString();
  }

  const { data, error } = await supabase
    .from("whatsapp_console_outbox")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;

  if ((finalStatus === "sent" || finalStatus === "failed") && existing) {
    await deleteInvoiceMedia(supabase, existing);
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const denied = requireApiKey(req);
  if (denied) return denied;

  const url = new URL(req.url);

  try {
    // ── WhatsApp Console outbox bridge (POST) ──
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const action = String(body?.action || "").toLowerCase();

      if (action === "claim_outbox" || action === "claim") {
        const jobs = await claimOutbox(body?.limit, body?.claimed_by || "whatsapp-console");
        return json({ ok: true, count: jobs.length, data: jobs, idle: jobs.length === 0 });
      }

      if (action === "claim_tally_outbox" || action === "claim_tally") {
        const jobs = await claimTallyOutbox(body?.limit, body?.claimed_by || "tally-bridge");
        return json({ ok: true, count: jobs.length, data: jobs, idle: jobs.length === 0 });
      }

      if (action === "prune_outbox") {
        const result = await pruneInvoiceOutbox24h();
        return json({ ok: true, ...result });
      }

      if (action === "complete_outbox" || action === "complete") {
        const id = String(body?.id || "");
        const status = String(body?.status || "sent").toLowerCase();
        if (!id) return json({ error: "id required" }, 400);
        if (!["sent", "failed", "pending"].includes(status)) {
          return json({ error: "status must be sent|failed|pending" }, 400);
        }
        const ackRaw = body?.ack;
        const ack =
          typeof ackRaw === "number" && Number.isFinite(ackRaw)
            ? ackRaw
            : ackRaw != null && String(ackRaw).trim() !== "" && Number.isFinite(Number(ackRaw))
              ? Number(ackRaw)
              : null;
        const row = await completeOutbox(
          id,
          status as "sent" | "failed" | "pending",
          body?.error ?? body?.last_error,
          { ack, via: body?.via != null ? String(body.via) : null },
        );
        return json({ ok: true, data: row });
      }

      if (action === "complete_tally_outbox" || action === "complete_tally") {
        const id = String(body?.id || "");
        const status = String(body?.status || "sent").toLowerCase();
        if (!id) return json({ error: "id required" }, 400);
        if (!["sent", "failed", "pending"].includes(status)) {
          return json({ error: "status must be sent|failed|pending" }, 400);
        }
        const row = await completeTallyOutbox(
          id,
          status as "sent" | "failed" | "pending",
          body?.error ?? body?.last_error,
          body?.tally_response != null ? String(body.tally_response) : null,
        );
        return json({ ok: true, data: row });
      }

      if (action === "dismiss_outbox" || action === "clear_failed") {
        const supabase = sb();
        const now = new Date().toISOString();
        const id = String(body?.id || "").trim();
        if (id) {
          const { data: existing } = await supabase
            .from("whatsapp_console_outbox")
            .select("*")
            .eq("id", id)
            .maybeSingle();
          if (existing) await deleteInvoiceMedia(supabase, existing);
          const { error } = await supabase
            .from("whatsapp_console_outbox")
            .update({
              status: "cancelled",
              updated_at: now,
              last_error: body?.error || "dismissed",
              media_url: null,
              claimed_at: null,
              claimed_by: null,
              next_retry_at: null,
            })
            .eq("id", id);
          if (error) throw error;
          return json({ ok: true, cleared: 1, id });
        }
        // Clear all terminal failed rows
        const { data: failed } = await supabase
          .from("whatsapp_console_outbox")
          .select("id, media_url, payload")
          .eq("status", "failed")
          .limit(200);
        let cleared = 0;
        for (const row of failed || []) {
          await deleteInvoiceMedia(supabase, row);
          const { error } = await supabase
            .from("whatsapp_console_outbox")
            .update({
              status: "cancelled",
              updated_at: now,
              last_error: "cleared_failed",
              media_url: null,
              claimed_at: null,
              claimed_by: null,
              next_retry_at: null,
            })
            .eq("id", row.id);
          if (!error) cleared += 1;
        }
        return json({ ok: true, cleared });
      }

      if (action === "abnormal_results" || action === "abnormal" || action === "sync_abnormal") {
        const names = Array.isArray(body?.parameter_names)
          ? (body.parameter_names as unknown[]).map((n) => String(n || "").trim()).filter(Boolean)
          : String(body?.parameter_names || "")
              .split(",")
              .map((n) => n.trim())
              .filter(Boolean);
        if (!names.length) {
          return json({ error: "parameter_names required (select parameters in Abnormal tab)" }, 400);
        }
        const fromDate = String(body?.from_date || "").trim();
        const afterInvoice = String(body?.after_invoice || "2608100018").trim() || "2608100018";
        const result = await fetchAbnormalResults({ names, fromDate, afterInvoice });
        return json({ ok: true, ...result });
      }

      return json({ error: `Unknown action: ${action}` }, 400);
    }

    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const type = (url.searchParams.get("type") ?? "all").toLowerCase();
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const supabase = sb();

    // Idle prune (rows + invoice images older than 24h)
    if (type === "prune_outbox") {
      const result = await pruneInvoiceOutbox24h();
      return json({ ok: true, ...result, retention_hours: 24 });
    }

    // Realtime credentials for WhatsApp Console (push wake on pending outbox)
    if (type === "realtime_config") {
      const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("ANON_KEY") || "";
      if (!supabaseUrl || !anonKey) {
        return json({ error: "Realtime config unavailable on this environment" }, 500);
      }
      return json({
        ok: true,
        supabaseUrl,
        anonKey,
        table: "whatsapp_console_outbox",
        mode: "realtime",
        media_retention_hours: 24,
      });
    }

    // Peek pending outbox (non-claiming) for Console UI / health
    if (type === "outbox") {
      const cols =
        "id, kind, phone, patient_name, invoice_number, status, caption, media_url, created_at, attempts, last_error, next_retry_at, max_attempts, sent_at, payload";
      const [{ data: openRows, error: openErr }, { data: sentRows, error: sentErr }] = await Promise.all([
        supabase
          .from("whatsapp_console_outbox")
          .select(cols)
          .in("status", ["pending", "claimed", "failed"])
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("whatsapp_console_outbox")
          .select(cols)
          .eq("status", "sent")
          .order("sent_at", { ascending: false })
          .limit(20),
      ]);
      if (openErr) throw openErr;
      if (sentErr) throw sentErr;
      const data = [...(openRows || []), ...(sentRows || [])];
      const active = (openRows || []).filter((r: any) => r.status === "pending" || r.status === "claimed");
      const failed = (openRows || []).filter((r: any) => r.status === "failed");
      return json({
        count: { outbox: active.length, failed: failed.length, sent: (sentRows || []).length, total: data.length },
        data,
        mode: "realtime_queue",
      });
    }

    if (type === "abnormal_parameters" || type === "abnormal_params") {
      const data = await fetchAbnormalParameterCatalog();
      return json({ ok: true, count: { parameters: data.length }, data });
    }

    if (type === "abnormal_results") {
      const names = (url.searchParams.get("parameter_names") || "")
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean);
      if (!names.length) {
        return json({ error: "parameter_names required (select parameters in Abnormal tab)" }, 400);
      }
      const fromDate = (url.searchParams.get("from_date") || "").trim();
      const afterInvoice =
        (url.searchParams.get("after_invoice") || "2608100018").trim() || "2608100018";
      const result = await fetchAbnormalResults({ names, fromDate, afterInvoice });
      return json({ ok: true, ...result });
    }

    // Today's birthdays: Registered Patients + legacy completed home-visit master.
    if (type === "today_birthdays" || type === "birthdays") {
      const { data, error } = await supabase.rpc("desktop_today_birthdays");
      if (error) return json({ error: error.message }, 500);
      const rows = Array.isArray(data) ? data : [];
      return json({
        ok: true,
        count: { birthdays: rows.length },
        data: rows.map((r: any) => ({
          title: String(r.title || "").trim(),
          patient_name: String(r.patient_name || "").trim(),
          dob: r.dob || null,
          mobile_number: String(r.mobile_number || "").trim(),
          source: String(r.source || "").trim() || "registered",
        })),
      });
    }

    // Sender CRM: Registered Patients after old-software cutoff (invoice_number is YYMMDD+seq text).
    if (type === "registrations" || type === "registered_patients" || type === "sender_crm") {
      const afterInvoice = (url.searchParams.get("after_invoice") || "2608100018").trim() || "2608100018";
      const rows = await fetchAll((f, t) =>
        supabase
          .from("patient_registrations")
          .select(
            "id, invoice_number, patient_name, title, mobile_number, umr_number, created_at, remarks, doctor_name, visit_type, payments, paid_amount, due_amount, gross_amount, global_discount_type, global_discount_value, discount_amount, bill_cancelled, channel_id, channels:channel_id(billing_type)",
          )
          .gt("invoice_number", afterInvoice)
          .eq("bill_cancelled", false)
          .neq("visit_type", "pickup_point")
          .order("invoice_number", { ascending: true })
          .range(f, t),
      );
      return json({
        ok: true,
        after_invoice: afterInvoice,
        count: { registrations: rows.length },
        data: rows.map((r: any) => {
          const channel = Array.isArray(r.channels) ? r.channels[0] : r.channels;
          // Lab / home visit = debit. Channel credit/debit follows channel billing_type.
          // Pickup-point registrations are excluded above.
          const billingMode: "credit" | "debit" =
            r.channel_id && channel?.billing_type === "credit" ? "credit" : "debit";
          return {
            source: "registration",
            id: r.id,
            invoice_number: r.invoice_number,
            patient_name: r.patient_name,
            title: r.title,
            mobile_number: r.mobile_number,
            umr_number: r.umr_number,
            created_at: r.created_at,
            remarks: r.remarks,
            doctor_name: r.doctor_name,
            visit_type: r.visit_type,
            payments: r.payments,
            paid_amount: r.paid_amount,
            due_amount: r.due_amount,
            gross_amount: r.gross_amount,
            global_discount_type: r.global_discount_type,
            global_discount_value: r.global_discount_value,
            discount_amount: r.discount_amount,
            channel_billing_type: channel?.billing_type || null,
            billing_mode: billingMode,
          };
        }),
      });
    }

    const fromIso = from ? new Date(from + "T00:00:00Z").toISOString() : null;
    const toIso = to ? new Date(to + "T23:59:59Z").toISOString() : null;

    const results: { estimates?: any[]; home_visits?: any[] } = {};

    if (type === "all" || type === "estimates") {
      const rows = await fetchAll((f, t) => {
        let q = supabase
          .from("estimates")
          .select("id, patient_name, whatsapp_number, created_at")
          .order("created_at", { ascending: false })
          .range(f, t);
        if (fromIso) q = q.gte("created_at", fromIso);
        if (toIso) q = q.lte("created_at", toIso);
        return q;
      });
      results.estimates = rows.map((e: any) => ({
        source: "estimate",
        id: e.id,
        patient_name: e.patient_name,
        phone: e.whatsapp_number,
        date: e.created_at,
      }));
    }

    if (type === "all" || type === "home_visits") {
      const rows = await fetchAll((f, t) => {
        let q = supabase
          .from("home_visits")
          .select("id, created_at, visit_date, visit_time, estimate_id, estimates:estimate_id(patient_name, whatsapp_number)")
          .order("created_at", { ascending: false })
          .range(f, t);
        if (fromIso) q = q.gte("created_at", fromIso);
        if (toIso) q = q.lte("created_at", toIso);
        return q;
      });
      results.home_visits = rows.map((h: any) => ({
        source: "home_visit",
        id: h.id,
        patient_name: h.estimates?.patient_name ?? null,
        phone: h.estimates?.whatsapp_number ?? null,
        date: h.created_at,
        visit_date: h.visit_date,
        time: h.visit_time,
      }));
    }

    const hv_completed: any[] = [];
    if (type === "all" || type === "hv_completed" || type === "completed_home_visits") {
      const rows = await fetchAll((f, t) => {
        let q = supabase
          .from("home_visits")
          .select("id, created_at, visit_date, visit_time, updated_at, status, estimate_id, estimates:estimate_id(patient_name, whatsapp_number)")
          .eq("status", "completed")
          .order("updated_at", { ascending: false })
          .range(f, t);
        if (fromIso) q = q.gte("updated_at", fromIso);
        if (toIso) q = q.lte("updated_at", toIso);
        return q;
      });
      hv_completed.push(...rows.map((h: any) => ({
        source: "HV Completed",
        id: h.id,
        patient_name: h.estimates?.patient_name ?? null,
        phone: h.estimates?.whatsapp_number ?? null,
        date: h.updated_at,
        visit_date: h.visit_date,
        time: h.visit_time,
      })));
    }

    const whatsapp_chats: any[] = [];
    if (type === "all" || type === "whatsapp" || type === "whatsapp_chats") {
      const rows = await fetchAll((f, t) => {
        let q = supabase
          .from("webhook_messages")
          .select("sender_number, sender_name, message, created_at, direction")
          .order("created_at", { ascending: false })
          .range(f, t);
        if (fromIso) q = q.gte("created_at", fromIso);
        if (toIso) q = q.lte("created_at", toIso);
        return q;
      });
      const byMobile = new Map<string, any>();
      for (const r of rows as any[]) {
        const digits = String(r.sender_number || "").replace(/\D/g, "");
        const mobile10 = digits.slice(-10);
        if (mobile10.length !== 10) continue;
        const existing = byMobile.get(mobile10);
        if (!existing || new Date(r.created_at) > new Date(existing.date)) {
          byMobile.set(mobile10, {
            source: "whatsapp",
            id: mobile10,
            patient_name: r.sender_name || null,
            phone: mobile10,
            date: r.created_at,
            last_message: r.message ?? null,
            direction: r.direction ?? null,
          });
        } else if (!existing.patient_name && r.sender_name) {
          existing.patient_name = r.sender_name;
        }
      }
      whatsapp_chats.push(...byMobile.values());
      whatsapp_chats.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    const combined = [
      ...(results.estimates ?? []),
      ...(results.home_visits ?? []),
      ...hv_completed,
      ...whatsapp_chats,
    ];

    return json({
      count: {
        estimates: results.estimates?.length ?? 0,
        home_visits: results.home_visits?.length ?? 0,
        hv_completed: hv_completed.length,
        whatsapp_chats: whatsapp_chats.length,
        total: combined.length,
      },
      data: combined,
    });
  } catch (e) {
    console.error("desktop-api error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
