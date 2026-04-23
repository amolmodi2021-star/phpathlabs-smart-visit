import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Per-table retention windows (days). Tune here.
//
// COST OPTIMIZATION (2026-04): tightened message_send_log to 30 days (was 180)
// and lims_interface_logs to 30 days (was 90). The send log only stores
// metadata (no captions), and the LIMS logs hold verbose request/response JSON
// that's only useful for short-term debugging.
//
// NOTE: Abnormal tables (crm_abnormal_tests, abnormal_history) are intentionally
// NEVER pruned — they are required for long-term clinical analytics.
const RETENTION = [
  { table: "message_send_log", column: "sent_at", days: 30 },
  { table: "drip_campaign_log", column: "created_at", days: 90 },
  { table: "lims_interface_logs", column: "created_at", days: 30 },
  { table: "app_user_login_history", column: "login_at", days: 365 },
  { table: "webhook_messages", column: "created_at", days: 90 },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const results: Record<string, { deleted: number; cutoff: string; error?: string }> = {};

    // Special pre-step: null out webhook_messages.raw_payload for rows older
    // than 7 days. Keeps the row + searchable fields (message, sender_number,
    // direction, etc.) for chat history but drops the byte-heavy raw JSON
    // payload to cap storage growth. The 90-day full-row prune entry below
    // still applies for ancient rows.
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { count: nullCount, error: nullCountErr } = await supabase
        .from("webhook_messages")
        .select("*", { count: "exact", head: true })
        .lt("created_at", sevenDaysAgo)
        .not("raw_payload", "is", null);
      if (nullCountErr) {
        results["webhook_messages_raw_payload_nulled"] = { deleted: 0, cutoff: sevenDaysAgo, error: nullCountErr.message };
      } else if ((nullCount ?? 0) > 0) {
        const { error: nullErr } = await supabase
          .from("webhook_messages")
          .update({ raw_payload: null })
          .lt("created_at", sevenDaysAgo)
          .not("raw_payload", "is", null);
        results["webhook_messages_raw_payload_nulled"] = {
          deleted: nullErr ? 0 : (nullCount ?? 0),
          cutoff: sevenDaysAgo,
          ...(nullErr ? { error: nullErr.message } : {}),
        };
      } else {
        results["webhook_messages_raw_payload_nulled"] = { deleted: 0, cutoff: sevenDaysAgo };
      }
    } catch (e) {
      results["webhook_messages_raw_payload_nulled"] = {
        deleted: 0,
        cutoff: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        error: (e as Error).message,
      };
    }

    for (const { table, column, days } of RETENTION) {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      // Two-step: count matching rows, then delete. We use head:true on the
      // count query so it doesn't pull rows.
      const { count, error: countErr } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true })
        .lt(column, cutoff);

      if (countErr) {
        results[table] = { deleted: 0, cutoff, error: countErr.message };
        continue;
      }

      if ((count ?? 0) === 0) {
        results[table] = { deleted: 0, cutoff };
        continue;
      }

      const { error: delErr } = await supabase.from(table).delete().lt(column, cutoff);
      results[table] = {
        deleted: delErr ? 0 : (count ?? 0),
        cutoff,
        ...(delErr ? { error: delErr.message } : {}),
      };
    }


    console.log("Prune complete:", results);

    await supabase.from("cleanup_runs").insert({
      function_name: "prune-old-logs",
      summary: { results },
    });

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Prune error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
