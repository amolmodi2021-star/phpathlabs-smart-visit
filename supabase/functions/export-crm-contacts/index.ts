// Streams a filtered CRM contacts export as CSV.
// Replaces a client-side paginated JSON fetch (~12 MB) with a single
// server-side CSV stream (~7 MB), eliminating column-name repetition
// per row and the JSON quoting overhead.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const COLUMNS: { key: string; header: string }[] = [
  { key: "primary_key", header: "Primary Key" },
  { key: "location", header: "Location" },
  { key: "umr_number", header: "UMR" },
  { key: "bill_number", header: "Bill #" },
  { key: "visit_date", header: "Visit Date" },
  { key: "patient_name", header: "Patient Name" },
  { key: "mobile_number", header: "Mobile" },
  { key: "visit_type", header: "Visit Type" },
  { key: "doctor_name", header: "Doctor" },
  { key: "gross_amount", header: "Gross Amt" },
  { key: "discount_amount", header: "Discount Amt" },
  { key: "net_amount", header: "Net Amt" },
  { key: "paid_amount", header: "Paid Amt" },
  { key: "due_amount", header: "Due Amt" },
  { key: "payment_type", header: "Payment Type" },
  { key: "remarks", header: "Remarks" },
  { key: "created_by", header: "Created By" },
  { key: "record_tag", header: "Tag" },
  { key: "default_discount_pct", header: "Discount %" },
  { key: "last_sent_type", header: "Last Sent" },
  { key: "last_sent_date", header: "Last Sent Date" },
];

const SELECT_COLS = COLUMNS.map((c) => c.key).join(",");

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const search = url.searchParams.get("search") || "";
    const location = url.searchParams.get("location") || "ALL";
    const tag = url.searchParams.get("tag") || "ALL";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const BATCH = 1000;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Header row
          controller.enqueue(
            encoder.encode(COLUMNS.map((c) => csvEscape(c.header)).join(",") + "\n"),
          );

          let total = 0;
          // Keyset pagination on (created_at, id) to avoid silent row loss
          // when many rows share the same created_at timestamp.
          let lastCreatedAt: string | null = null;
          let lastId: string | null = null;

          while (true) {
            let q = supabase
              .from("crm_contacts")
              .select(SELECT_COLS + ",id,created_at")
              .order("created_at", { ascending: true })
              .order("id", { ascending: true })
              .limit(BATCH);

            if (location !== "ALL") q = q.eq("location", location);
            if (tag !== "ALL") q = q.eq("record_tag", tag);
            if (search) {
              q = q.or(
                `patient_name.ilike.%${search}%,mobile_number.ilike.%${search}%,umr_number.ilike.%${search}%`,
              );
            }

            if (lastCreatedAt && lastId) {
              q = q.or(
                `created_at.gt.${lastCreatedAt},and(created_at.eq.${lastCreatedAt},id.gt.${lastId})`,
              );
            }

            const { data, error } = await q;
            if (error) throw error;
            if (!data || data.length === 0) break;

            for (const row of data) {
              const line = COLUMNS.map((c) => csvEscape((row as any)[c.key])).join(",");
              controller.enqueue(encoder.encode(line + "\n"));
            }

            total += data.length;
            const last = data[data.length - 1] as any;
            lastCreatedAt = last.created_at;
            lastId = last.id;
            if (data.length < BATCH) break;
          }

          console.log(`[export-crm-contacts] streamed ${total} rows`);
          controller.close();
        } catch (err) {
          console.error("[export-crm-contacts] stream error", err);
          controller.error(err);
        }
      },
    });

    const filename = `CRM_Contacts_${new Date().toISOString().slice(0, 10)}.csv`;

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[export-crm-contacts] error", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});
