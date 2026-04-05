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
        // If we already saw this key, it's a DB duplicate — mark older one for deletion
        if (existingMap.has(key)) {
          // Keep the one already in the map, delete this older one
          // Actually we don't know which is newer, so just keep first seen
        }
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

    // Insert — handle unique constraint conflicts gracefully
    let insertedCount = 0;
    if (toInsert.length > 0) {
      for (let i = 0; i < toInsert.length; i += 50) {
        const batch = toInsert.slice(i, i + 50);
        const { error, data } = await supabase.from("crm_abnormal_tests").insert(batch).select("id");
        if (error) {
          // If batch fails due to unique constraint, insert one by one
          for (const row of batch) {
            const { error: singleErr } = await supabase.from("crm_abnormal_tests").insert(row);
            if (!singleErr) insertedCount++;
            else skippedDup++;
          }
        } else {
          insertedCount += (data?.length || batch.length);
        }
      }
    }

    // Update
    let updatedCount = 0;
    for (const u of toUpdate) {
      const { error } = await supabase
        .from("crm_abnormal_tests")
        .update({ result_value: u.result_value, normal_range: u.normal_range })
        .eq("id", u.id);

      if (!error) updatedCount++;
    }

    // Post-import cleanup: remove any remaining duplicates for affected primary keys
    // Keep only the newest record (by created_at) for each (contact_primary_key, test_name, test_date)
    let cleanedDup = 0;
    for (let i = 0; i < primaryKeys.length; i += 20) {
      const pkBatch = primaryKeys.slice(i, i + 20);
      for (const pk of pkBatch) {
        const { data: allTests } = await supabase
          .from("crm_abnormal_tests")
          .select("id, test_name, test_date, created_at")
          .eq("contact_primary_key", pk)
          .order("created_at", { ascending: false });

        if (!allTests || allTests.length === 0) continue;

        const seen = new Set<string>();
        const toDelete: string[] = [];
        for (const t of allTests) {
          const dupKey = `${t.test_name}||${t.test_date || ""}`;
          if (seen.has(dupKey)) {
            toDelete.push(t.id);
          } else {
            seen.add(dupKey);
          }
        }

        if (toDelete.length > 0) {
          await supabase.from("crm_abnormal_tests").delete().in("id", toDelete);
          cleanedDup += toDelete.length;
        }
      }
    }

    return json({
      inserted: insertedCount,
      updated: updatedCount,
      skippedDup,
      cleanedDup,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
