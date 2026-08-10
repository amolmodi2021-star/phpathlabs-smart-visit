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

async function deleteInvoiceMedia(supabase: ReturnType<typeof sb>, row: any): Promise<void> {
  const path = storagePathFromRow(row);
  if (!path) return;
  try {
    await supabase.storage.from("chat-attachments").remove([path]);
  } catch (e) {
    console.warn("invoice media delete failed", path, e);
  }
}

/** Drop outbox rows + storage objects older than 24 hours (cost control). */
async function pruneInvoiceOutbox24h(): Promise<{ rows: number; files: number }> {
  const supabase = sb();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: oldRows, error } = await supabase
    .from("whatsapp_console_outbox")
    .select("id, media_url, payload")
    .lt("created_at", cutoff)
    .limit(500);
  if (error) throw error;
  const rows = oldRows || [];
  let files = 0;
  for (const row of rows) {
    const path = storagePathFromRow(row);
    if (path) {
      const { error: rmErr } = await supabase.storage.from("chat-attachments").remove([path]);
      if (!rmErr) files += 1;
    }
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
  // Also sweep orphan invoice/report files older than 24h (paginate)
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  for (const folder of ["invoices", "reports"] as const) {
    let offset = 0;
    for (;;) {
      const { data: listed } = await supabase.storage.from("chat-attachments").list(folder, {
        limit: 100,
        offset,
        sortBy: { column: "created_at", order: "asc" },
      });
      const batch = listed || [];
      if (!batch.length) break;
      const staleFiles: string[] = [];
      for (const item of batch) {
        if (!item?.name) continue;
        const created = item.created_at ? Date.parse(item.created_at) : 0;
        if (created && created < cutoffMs) staleFiles.push(`${folder}/${item.name}`);
      }
      if (staleFiles.length) {
        const { error: rmErr } = await supabase.storage.from("chat-attachments").remove(staleFiles);
        if (!rmErr) files += staleFiles.length;
      }
      if (batch.length < 100) break;
      offset += batch.length;
      // Safety: avoid infinite loops on weird list APIs
      if (offset > 5000) break;
    }
  }
  return { rows: rows.length, files };
}

const STUCK_CLAIM_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 8;

/** Re-queue claims abandoned mid-send (Console crash / laptop sleep). */
async function reclaimStuckClaims(supabase: ReturnType<typeof sb>) {
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

/** Atomically claim pending outbox rows for WhatsApp Console. */
async function claimOutbox(limit = 5, claimedBy = "whatsapp-console") {
  const supabase = sb();
  const lim = Math.min(Math.max(Number(limit) || 5, 1), 25);
  await reclaimStuckClaims(supabase);

  const nowIso = new Date().toISOString();
  // Due pending rows: never-scheduled OR retry time reached
  const { data: pending, error } = await supabase
    .from("whatsapp_console_outbox")
    .select("*")
    .eq("status", "pending")
    .or(`next_retry_at.is.null,next_retry_at.lte."${nowIso}"`)
    .order("created_at", { ascending: true })
    .limit(lim);
  if (error) throw error;
  const rows = pending || [];

  // Only prune when idle — avoids extra storage work on every busy claim.
  if (!rows.length) {
    try {
      await pruneInvoiceOutbox24h();
    } catch (e) {
      console.warn("pruneInvoiceOutbox24h", e);
    }
    return [];
  }

  const now = new Date().toISOString();
  const claimed: any[] = [];
  for (const row of rows) {
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
      .select("*")
      .maybeSingle();
    if (!updErr && data) claimed.push(data);
  }
  return claimed;
}

function retryDelaySeconds(attempts: number): number {
  // 30s, 60s, 120s … capped at 15 min
  return Math.min(30 * Math.pow(2, Math.max(0, attempts - 1)), 900);
}

async function completeOutbox(
  id: string,
  status: "sent" | "failed" | "pending",
  lastError?: string | null,
) {
  const supabase = sb();
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from("whatsapp_console_outbox")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  const attempts = Number(existing?.attempts || 0);
  const maxAttempts = Number(existing?.max_attempts || DEFAULT_MAX_ATTEMPTS);
  const errText = lastError ?? null;
  const terminalError =
    !!errText &&
    /invalid_phone|empty_job|empty_text|cancelled|unsupported_kind|dead_media|localhost_media|127\.0\.0\.1/i.test(
      String(errText),
    );

  // Transient / retryable failures stay in the durable queue as pending.
  let finalStatus = status;
  if (status === "failed" && !terminalError && attempts < maxAttempts) {
    finalStatus = "pending";
  }

  const patch: Record<string, unknown> = {
    status: finalStatus,
    updated_at: now,
    last_error: errText,
  };
  if (finalStatus === "sent") {
    patch.sent_at = now;
    // Clear media URL after send — file deleted below (don't keep forever).
    patch.media_url = null;
    patch.next_retry_at = null;
    patch.claimed_at = null;
    patch.claimed_by = null;
  } else if (finalStatus === "pending") {
    patch.claimed_at = null;
    patch.claimed_by = null;
    // Immediate retry when WA Web missing; otherwise exponential backoff.
    const immediate =
      !errText ||
      /no_whatsapp_web|not.?connected|offline|network|timeout|temporar/i.test(String(errText));
    patch.next_retry_at = immediate
      ? null
      : new Date(Date.now() + retryDelaySeconds(attempts) * 1000).toISOString();
  } else if (finalStatus === "failed") {
    patch.claimed_at = null;
    patch.claimed_by = null;
    patch.next_retry_at = null;
  }

  const { data, error } = await supabase
    .from("whatsapp_console_outbox")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;

  if (finalStatus === "sent" && existing) {
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
        const row = await completeOutbox(id, status as "sent" | "failed" | "pending", body?.error ?? body?.last_error);
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
      const { data, error } = await supabase
        .from("whatsapp_console_outbox")
        .select("id, kind, phone, patient_name, invoice_number, status, caption, media_url, created_at, attempts, last_error, next_retry_at, max_attempts")
        .in("status", ["pending", "claimed", "failed"])
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const active = (data || []).filter((r: any) => r.status === "pending" || r.status === "claimed");
      const failed = (data || []).filter((r: any) => r.status === "failed");
      return json({
        count: { outbox: active.length, failed: failed.length, total: (data || []).length },
        data: data || [],
        mode: "realtime_queue",
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
