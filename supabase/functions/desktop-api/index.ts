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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const expected = Deno.env.get("DESKTOP_API_KEY");
  const provided = req.headers.get("x-api-key");
  if (!expected || provided !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(req.url);
  const type = (url.searchParams.get("type") ?? "all").toLowerCase();
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

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
          .select("id, visit_date, visit_time, estimate_id, estimates:estimate_id(patient_name, whatsapp_number)")
          .order("visit_date", { ascending: false })
          .range(f, t);
        if (from) q = q.gte("visit_date", from);
        if (to) q = q.lte("visit_date", to);
        return q;
      });
      results.home_visits = rows.map((h: any) => ({
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
