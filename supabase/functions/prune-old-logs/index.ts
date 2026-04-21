import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Per-table retention windows (days). Tune here.
const RETENTION = [
  { table: "message_send_log", column: "sent_at", days: 180 },
  { table: "drip_campaign_log", column: "created_at", days: 90 },
  { table: "lims_interface_logs", column: "created_at", days: 90 },
  { table: "app_user_login_history", column: "login_at", days: 365 },
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
