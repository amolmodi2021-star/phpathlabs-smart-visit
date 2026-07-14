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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const expected = Deno.env.get("DESKTOP_API_KEY");
  const provided = req.headers.get("x-api-key");
  if (!expected || provided !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(req.url);
  const type = (url.searchParams.get("type") ?? "all").toLowerCase(); // all | estimates | home_visits
  const from = url.searchParams.get("from"); // YYYY-MM-DD (created_at >= from)
  const to = url.searchParams.get("to");     // YYYY-MM-DD (created_at <= to 23:59)

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const fromIso = from ? new Date(from + "T00:00:00Z").toISOString() : null;
  const toIso = to ? new Date(to + "T23:59:59Z").toISOString() : null;

  const results: { estimates?: any[]; home_visits?: any[] } = {};

  try {
    if (type === "all" || type === "estimates") {
      let q = supabase
        .from("estimates")
        .select("id, patient_name, whatsapp_number, created_at")
        .order("created_at", { ascending: false });
      if (fromIso) q = q.gte("created_at", fromIso);
      if (toIso) q = q.lte("created_at", toIso);
      const { data, error } = await q;
      if (error) throw error;
      results.estimates = (data ?? []).map((e) => ({
        source: "estimate",
        id: e.id,
        patient_name: e.patient_name,
        phone: e.whatsapp_number,
        date: e.created_at,
      }));
    }

    if (type === "all" || type === "home_visits") {
      let q = supabase
        .from("home_visits")
        .select("id, visit_date, visit_time, estimate_id, estimates:estimate_id(patient_name, whatsapp_number)")
        .order("visit_date", { ascending: false });
      if (from) q = q.gte("visit_date", from);
      if (to) q = q.lte("visit_date", to);
      const { data, error } = await q;
      if (error) throw error;
      results.home_visits = (data ?? []).map((h: any) => ({
        source: "home_visit",
        id: h.id,
        patient_name: h.estimates?.patient_name ?? null,
        phone: h.estimates?.whatsapp_number ?? null,
        date: h.visit_date,
        time: h.visit_time,
      }));
    }

    const combined = [
      ...(results.estimates ?? []),
      ...(results.home_visits ?? []),
    ];

    return json({
      count: {
        estimates: results.estimates?.length ?? 0,
        home_visits: results.home_visits?.length ?? 0,
        total: combined.length,
      },
      data: combined,
    });
  } catch (e) {
    console.error("desktop-api error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
