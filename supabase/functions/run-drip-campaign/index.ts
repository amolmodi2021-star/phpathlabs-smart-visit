// Server-side drip campaign runner.
// Pre-built contact_queue + config is read from the drip_runs row.
// Each iteration sends one WhatsApp message, logs it, updates CRM only on success,
// and persists progress so closing the browser does NOT interrupt the run.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface QueueItem {
  filterId: string;
  filterName: string;
  messageType: "abc_card" | "abnormal_card" | "promotion";
  cycle: number;
  contact: {
    id?: string;
    primary_key?: string;
    patient_name?: string;
    mobile_number?: string;
    umr_number?: string;
    default_discount_pct?: number;
    image_url?: string; // pre-generated card image URL (for abc_card / abnormal_card)
    abnormal_image_url?: string;
  };
}

interface RunConfig {
  // Global WA settings
  baseUrl: string;
  apiKey: string;
  authHeaderName: string;
  authHeaderPrefix: string;
  fromNumber: string;
  delayMs: number;
  // Per-message-type templates
  abc?: {
    templateName: string;
    campaignName: string;
    bodyMapping: Record<string, string>;
    staticExpiryDate: string;
  };
  abnormal?: {
    templateName: string;
    campaignName: string;
    includeMediaHeader: boolean;
    staticExpiryDate: string;
  };
  promotion?: Record<string, {
    apiUrl: string;
    apiKey: string;
    headerName: string;
    headerPrefix: string;
    templateName: string;
    fromNumber: string;
    bodyMapping: Record<string, string>;
  }>; // keyed by templateId
}

function extractMessageId(proxyData: any): string | null {
  try {
    if (!proxyData) return null;
    let body = proxyData.body ?? proxyData;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { return null; }
    }
    return body?.messageId || body?.message_id || body?.id || body?.messages?.[0]?.id || null;
  } catch { return null; }
}

async function logDrip(
  sb: any,
  filterId: string,
  filterName: string,
  messageType: string,
  contact: any,
  status: string,
  skipReason: string | null,
  cycleNum: number,
) {
  const mob = (contact.mobile_number || "").replace(/\D/g, "").slice(-10);
  await sb.from("drip_campaign_log").insert({
    filter_id: filterId,
    filter_name: filterName,
    message_type: messageType,
    mobile_number: mob,
    patient_name: contact.patient_name || "",
    contact_primary_key: contact.primary_key || "",
    status,
    skip_reason: skipReason,
    cycle_number: cycleNum,
  });
}

async function logMessageSend(
  sb: any,
  mobile: string,
  patientName: string | null | undefined,
  messageType: string,
  umr: string | null | undefined,
  primaryKey: string | null | undefined,
  messageId: string | null,
  deliveryStatus: "sent" | "failed",
) {
  const mobile10 = (mobile || "").replace(/\D/g, "").slice(-10);
  if (!mobile10) return;
  try {
    const row: any = {
      mobile_number: mobile10,
      patient_name: patientName || null,
      message_type: messageType,
      umr_number: umr || null,
      primary_key: primaryKey || null,
      message_id: messageId || null,
      delivery_status: deliveryStatus,
    };
    if (deliveryStatus === "failed") row.failed_at = new Date().toISOString();
    await sb.from("message_send_log").insert(row);
  } catch { /* ignore */ }
}

async function callWhatsappProxy(
  apiBaseUrl: string,
  apiKey: string,
  authHeaderName: string,
  authHeaderPrefix: string,
  payload: any,
): Promise<{ ok: boolean; data: any }> {
  try {
    const authValue = authHeaderPrefix ? `${authHeaderPrefix} ${apiKey}` : apiKey;
    const res = await fetch(apiBaseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [authHeaderName || "apikey"]: authValue,
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    return { ok: res.ok, data: { status: res.status, body: text } };
  } catch (e) {
    return { ok: false, data: { error: String(e) } };
  }
}

async function processRun(runId: string) {
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Load run row
  const { data: run, error: loadErr } = await sb.from("drip_runs").select("*").eq("id", runId).maybeSingle();
  if (loadErr || !run) {
    console.error("[run-drip-campaign] run not found:", runId, loadErr);
    return;
  }
  if (run.status === "completed" || run.status === "cancelled" || run.status === "failed") {
    console.log("[run-drip-campaign] run already finished:", run.status);
    return;
  }

  const queue: QueueItem[] = (run.contact_queue || []) as QueueItem[];
  const config: RunConfig = (run.config || {}) as RunConfig;
  const total = queue.length;

  await sb.from("drip_runs").update({
    status: "running",
    started_at: run.started_at || new Date().toISOString(),
    total_count: total,
  }).eq("id", runId);

  let sentCount = run.sent_count || 0;
  let failedCount = run.failed_count || 0;
  let skippedCount = run.skipped_count || 0;
  let idx = run.current_index || 0;

  try {
    for (; idx < queue.length; idx++) {
      // Cancellation check
      const { data: chk } = await sb.from("drip_runs").select("cancel_requested").eq("id", runId).maybeSingle();
      if (chk?.cancel_requested) {
        await sb.from("drip_runs").update({
          status: "cancelled",
          finished_at: new Date().toISOString(),
          current_index: idx,
        }).eq("id", runId);
        console.log("[run-drip-campaign] cancelled at index", idx);
        return;
      }

      const item = queue[idx];
      const c = item.contact;
      const mob = (c.mobile_number || "").replace(/\D/g, "").slice(-10);
      const phase = `[${item.filterName}] ${idx + 1}/${total}`;

      if (!mob || mob.length !== 10) {
        await logDrip(sb, item.filterId, item.filterName, item.messageType, c, "skipped", "invalid_mobile", item.cycle);
        skippedCount++;
        await sb.from("drip_runs").update({
          current_index: idx + 1, skipped_count: skippedCount, current_phase: phase,
        }).eq("id", runId);
        continue;
      }

      let payload: any = null;
      let crmUpdate: { last_sent_type: string } | null = null;
      let logType = "";

      if (item.messageType === "abc_card" && config.abc) {
        const components: Record<string, any> = {};
        const mapping = config.abc.bodyMapping || {};
        if (Object.keys(mapping).length > 0) {
          const sortedKeys = Object.keys(mapping).sort((a, b) => Number(a) - Number(b));
          const params = sortedKeys.map((key) => {
            const field = mapping[key];
            switch (field) {
              case "Name": return c.patient_name || "";
              case "Mobile": return c.mobile_number || "";
              case "UMR": return c.umr_number || "";
              case "Discount %": return `${c.default_discount_pct ?? 20}%`;
              case "Expiry Date": return config.abc!.staticExpiryDate;
              default: return "";
            }
          });
          components.body = { params };
        }
        if (c.image_url) components.header = { type: "image", image: { link: c.image_url } };
        payload = {
          from: config.fromNumber,
          to: `+91${mob}`,
          templateName: config.abc.templateName,
          campaignName: config.abc.campaignName,
          type: "template",
          ...(Object.keys(components).length > 0 ? { components } : {}),
        };
        crmUpdate = { last_sent_type: "ABC" };
        logType = "ABC";
      } else if (item.messageType === "abnormal_card" && config.abnormal) {
        const components: Record<string, any> = {};
        if (config.abnormal.includeMediaHeader && c.abnormal_image_url) {
          components.header = { type: "image", image: { link: c.abnormal_image_url } };
        }
        components.body = { params: [(c.patient_name || "").toUpperCase()] };
        payload = {
          from: config.fromNumber,
          to: `+91${mob}`,
          templateName: config.abnormal.templateName,
          campaignName: config.abnormal.campaignName,
          type: "template",
          components,
        };
        crmUpdate = { last_sent_type: "Abnormal History" };
        logType = "Abnormal History";
      } else if (item.messageType === "promotion" && config.promotion) {
        const promoCfg = config.promotion[item.filterId];
        if (!promoCfg) {
          await logDrip(sb, item.filterId, item.filterName, item.messageType, c, "failed", "no_template", item.cycle);
          failedCount++;
          await sb.from("drip_runs").update({
            current_index: idx + 1, failed_count: failedCount, current_phase: phase,
          }).eq("id", runId);
          continue;
        }
        const components: Record<string, any> = {};
        const mapping = promoCfg.bodyMapping || {};
        if (Object.keys(mapping).length > 0) {
          const sortedKeys = Object.keys(mapping).sort((a, b) => Number(a) - Number(b));
          const params = sortedKeys.map((key) => {
            const field = mapping[key];
            switch (field) {
              case "Name": return c.patient_name || "";
              case "Mobile": return c.mobile_number || "";
              default: return field || "";
            }
          });
          components.body = { params };
        }
        payload = {
          from: promoCfg.fromNumber || config.fromNumber,
          to: `+91${mob}`,
          templateName: promoCfg.templateName,
          type: "template",
          ...(Object.keys(components).length > 0 ? { components } : {}),
        };
        crmUpdate = { last_sent_type: "Promotion" };
        logType = "Promotion";

        const result = await callWhatsappProxy(
          promoCfg.apiUrl, promoCfg.apiKey, promoCfg.headerName, promoCfg.headerPrefix, payload,
        );
        
        const apiOk = result.ok && (result.data?.status ?? 200) < 400;
        const messageId = extractMessageId(result.data);
        if (apiOk) {
          await logDrip(sb, item.filterId, item.filterName, item.messageType, c, "sent", null, item.cycle);
          if (crmUpdate && c.id) {
            await sb.from("crm_contacts").update({
              ...crmUpdate,
              last_sent_date: new Date().toISOString(),
            }).eq("id", c.id);
          }
          await logMessageSend(sb, mob, c.patient_name, logType, c.umr_number, c.primary_key, messageId, "sent");
          sentCount++;
        } else {
          await logDrip(sb, item.filterId, item.filterName, item.messageType, c, "failed", "wa_api_error", item.cycle);
          await logMessageSend(sb, mob, c.patient_name, logType, c.umr_number, c.primary_key, messageId, "failed");
          failedCount++;
        }
        
        await sb.from("drip_runs").update({
          current_index: idx + 1,
          sent_count: sentCount,
          failed_count: failedCount,
          current_phase: phase,
        }).eq("id", runId);
        if (config.delayMs > 0 && idx < queue.length - 1) {
          await new Promise((r) => setTimeout(r, config.delayMs));
        }
        continue;
      } else {
        await logDrip(sb, item.filterId, item.filterName, item.messageType, c, "failed", "wa_not_configured", item.cycle);
        failedCount++;
        await sb.from("drip_runs").update({
          current_index: idx + 1, failed_count: failedCount, current_phase: phase,
        }).eq("id", runId);
        continue;
      }

      const result = await callWhatsappProxy(
        config.baseUrl, config.apiKey, config.authHeaderName, config.authHeaderPrefix, payload,
      );

      const apiOk = result.ok && (result.data?.status ?? 200) < 400;
      const messageId = extractMessageId(result.data);

      if (apiOk) {
        await logDrip(sb, item.filterId, item.filterName, item.messageType, c, "sent", null, item.cycle);
        if (crmUpdate && c.id) {
          await sb.from("crm_contacts").update({
            ...crmUpdate,
            last_sent_date: new Date().toISOString(),
            ...(item.messageType === "abc_card" ? { record_tag: null } : {}),
          }).eq("id", c.id);
        }
        await logMessageSend(sb, mob, c.patient_name, logType, c.umr_number, c.primary_key, messageId, "sent");
        sentCount++;
      } else {
        await logDrip(sb, item.filterId, item.filterName, item.messageType, c, "failed", "wa_api_error", item.cycle);
        await logMessageSend(sb, mob, c.patient_name, logType, c.umr_number, c.primary_key, messageId, "failed");
        failedCount++;
      }

      await sb.from("drip_runs").update({
        current_index: idx + 1,
        sent_count: sentCount,
        failed_count: failedCount,
        current_phase: phase,
      }).eq("id", runId);

      if (config.delayMs > 0 && idx < queue.length - 1) {
        await new Promise((r) => setTimeout(r, config.delayMs));
      }
    }

    await sb.from("drip_runs").update({
      status: "completed",
      finished_at: new Date().toISOString(),
      current_index: idx,
      sent_count: sentCount,
      failed_count: failedCount,
      skipped_count: skippedCount,
      current_phase: "Done",
    }).eq("id", runId);
  } catch (err) {
    console.error("[run-drip-campaign] uncaught error:", err);
    await sb.from("drip_runs").update({
      status: "failed",
      error: String(err),
      finished_at: new Date().toISOString(),
      current_index: idx,
      sent_count: sentCount,
      failed_count: failedCount,
      skipped_count: skippedCount,
    }).eq("id", runId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { runId } = await req.json();
    if (!runId) {
      return new Response(JSON.stringify({ error: "runId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fire-and-forget: keep processing after HTTP response is sent.
    // @ts-ignore EdgeRuntime is provided by Supabase Edge runtime
    EdgeRuntime.waitUntil(processRun(runId));

    return new Response(JSON.stringify({ ok: true, runId }), {
      status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
