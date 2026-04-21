import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Files older than this are eligible for deletion. WhatsApp delivery is
// usually complete within minutes; 6 hours is a safe buffer.
const MAX_AGE_HOURS = 6;
const PAGE_SIZE = 1000;
const REMOVE_BATCH = 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const folders = ["generated/crm", "generated/abnormal", "generated"];
    const cutoff = Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000;
    let totalDeleted = 0;
    let totalScanned = 0;
    let totalSkippedRecent = 0;

    for (const folder of folders) {
      let offset = 0;
      // Paginate through every file in the folder. storage.list() caps at
      // 1000 per call, so without paging we can never drain a folder larger
      // than 1000 — which is why the bucket was growing.
      while (true) {
        const { data: files, error: listErr } = await supabase.storage
          .from("loyalty-cards")
          .list(folder, { limit: PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } });

        if (listErr) {
          console.error(`Error listing ${folder} (offset ${offset}):`, listErr);
          break;
        }
        if (!files || files.length === 0) break;

        const eligible: string[] = [];
        for (const f of files) {
          // Skip Supabase placeholder folders (no metadata, null id, no extension).
          if (!f.id || !f.name || !f.metadata || Object.keys(f.metadata).length === 0) continue;
          totalScanned++;

          // Prefer file metadata timestamp; fall back to filename prefix
          // (we name files `${Date.now()}_xxxx.png`).
          let createdMs = 0;
          const created = (f as any).created_at ?? (f as any).updated_at;
          if (created) createdMs = new Date(created).getTime();
          if (!createdMs) {
            const m = f.name.match(/^(\d{12,16})_/);
            if (m) createdMs = parseInt(m[1], 10);
          }

          if (createdMs && createdMs > cutoff) {
            totalSkippedRecent++;
            continue;
          }
          eligible.push(`${folder}/${f.name}`);
        }

        // Batched remove (Supabase remove() recommended ≤100 paths per call).
        for (let i = 0; i < eligible.length; i += REMOVE_BATCH) {
          const chunk = eligible.slice(i, i + REMOVE_BATCH);
          const { error: rmErr } = await supabase.storage.from("loyalty-cards").remove(chunk);
          if (rmErr) {
            console.error(`Error removing batch from ${folder}:`, rmErr);
          } else {
            totalDeleted += chunk.length;
          }
        }

        // If we got fewer than PAGE_SIZE entries the listing is exhausted.
        if (files.length < PAGE_SIZE) break;
        // Otherwise advance. NB: we removed eligible files, so the next page
        // shifts back; but since we sort by name asc, advancing by
        // (files.length - eligible.length) keeps us aligned with what's left.
        offset += files.length - eligible.length;
        // Safety cap: never loop more than 50 pages (= 50k files) per run.
        if (offset > PAGE_SIZE * 50) break;
      }
    }

    const summary = {
      success: true,
      deleted: totalDeleted,
      scanned: totalScanned,
      skipped_recent: totalSkippedRecent,
      max_age_hours: MAX_AGE_HOURS,
    };
    console.log("Cleanup complete:", summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Cleanup error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
