import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "npm:zod@3.25.76";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RowSchema = z.object({
  contact_primary_key: z.string().min(1),
  test_name: z.string().min(1),
  test_date: z.string().nullable(),
  result_value: z.string().nullable(),
  normal_range: z.string().nullable(),
});

const BodySchema = z.object({
  rows: z.array(RowSchema).min(1).max(500),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return json({ error: parsed.error.flatten().fieldErrors }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const rows = parsed.data.rows;

    // Deduplicate within this batch
    const dedupMap = new Map<string, z.infer<typeof RowSchema>>();
    let skippedInBatch = 0;
    for (const row of rows) {
      const key = `${row.contact_primary_key}||${row.test_name}||${row.test_date || ""}`;
      if (dedupMap.has(key)) {
        skippedInBatch++;
      } else {
        dedupMap.set(key, row);
      }
    }

    const uniqueRows = Array.from(dedupMap.values());

    // Fetch existing records for these primary keys only
    const primaryKeys = Array.from(new Set(uniqueRows.map((r) => r.contact_primary_key)));
    const existingMap = new Map<string, { id: string; result_value: string | null; normal_range: string | null }>();

    for (let i = 0; i < primaryKeys.length; i += 100) {
      const batch = primaryKeys.slice(i, i + 100);
      const { data } = await supabase
        .from("crm_abnormal_tests")
        .select("id, contact_primary_key, test_name, test_date, result_value, normal_range")
        .in("contact_primary_key", batch);

      for (const row of data || []) {
        const key = `${row.contact_primary_key}||${row.test_name}||${row.test_date || ""}`;
        existingMap.set(key, { id: row.id, result_value: row.result_value, normal_range: row.normal_range });
      }
    }

    const toInsert: z.infer<typeof RowSchema>[] = [];
    const toUpdate: { id: string; result_value: string | null; normal_range: string | null }[] = [];
    let skippedDup = skippedInBatch;

    for (const row of uniqueRows) {
      const key = `${row.contact_primary_key}||${row.test_name}||${row.test_date || ""}`;
      const existing = existingMap.get(key);

      if (!existing) {
        toInsert.push(row);
        continue;
      }

      if (existing.result_value !== row.result_value || existing.normal_range !== row.normal_range) {
        toUpdate.push({ id: existing.id, result_value: row.result_value, normal_range: row.normal_range });
      } else {
        skippedDup++;
      }
    }

    // Insert
    if (toInsert.length > 0) {
      const { error } = await supabase.from("crm_abnormal_tests").insert(toInsert);
      if (error) return json({ error: error.message }, 400);
    }

    // Update
    for (const u of toUpdate) {
      await supabase
        .from("crm_abnormal_tests")
        .update({ result_value: u.result_value, normal_range: u.normal_range })
        .eq("id", u.id);
    }

    return json({
      inserted: toInsert.length,
      updated: toUpdate.length,
      skippedDup,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});