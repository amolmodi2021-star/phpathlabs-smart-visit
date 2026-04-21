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
const BUCKET = "loyalty-cards";

type Stats = { scanned: number; deleted: number; skippedRecent: number };

async function processFolder(
  supabase: any,
  folder: string,
  cutoff: number,
  stats: Stats
) {
  let offset = 0;
  while (true) {
    const { data: files, error: listErr } = await supabase.storage
      .from(BUCKET)
      .list(folder, { limit: PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } });

    if (listErr) {
      console.error(`Error listing ${folder} (offset ${offset}):`, listErr);
      return;
    }
    if (!files || files.length === 0) return;

    const eligible: string[] = [];
    for (const f of files) {
      // Folder placeholder entries have no id / no metadata — skip here
      // (recursion handles them at the parent level).
      if (!f.id || !f.name || !f.metadata || Object.keys(f.metadata).length === 0) continue;
      stats.scanned++;

      let createdMs = 0;
      const created = (f as any).created_at ?? (f as any).updated_at;
      if (created) createdMs = new Date(created).getTime();
      if (!createdMs) {
        const m = f.name.match(/^(\d{12,16})_/);
        if (m) createdMs = parseInt(m[1], 10);
      }

      if (createdMs && createdMs > cutoff) {
        stats.skippedRecent++;
        continue;
      }
      eligible.push(folder ? `${folder}/${f.name}` : f.name);
    }

    for (let i = 0; i < eligible.length; i += REMOVE_BATCH) {
      const chunk = eligible.slice(i, i + REMOVE_BATCH);
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove(chunk);
      if (rmErr) {
        console.error(`Error removing batch from ${folder}:`, rmErr);
      } else {
        stats.deleted += chunk.length;
      }
    }

    if (files.length < PAGE_SIZE) return;
    offset += files.length - eligible.length;
    if (offset > PAGE_SIZE * 50) return;
  }
}

async function listSubfolders(supabase: any, folder: string): Promise<string[]> {
  const subs: string[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(folder, { limit: PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) {
      console.error(`Error listing subfolders of ${folder}:`, error);
      break;
    }
    if (!data || data.length === 0) break;
    for (const item of data) {
      // Folder placeholder: no id, no metadata
      if (!item.id && (!item.metadata || Object.keys(item.metadata).length === 0)) {
        subs.push(folder ? `${folder}/${item.name}` : item.name);
      }
    }
    if (data.length < PAGE_SIZE) break;
    offset += data.length;
    if (offset > PAGE_SIZE * 50) break;
  }
  return subs;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const cutoff = Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000;
    const stats: Stats = { scanned: 0, deleted: 0, skippedRecent: 0 };

    // 1) Process flat top-level folders (legacy fallback for any flat files)
    const topFolders = ["generated", "generated/crm", "generated/abnormal", "logos", "backgrounds"];
    for (const folder of topFolders) {
      await processFolder(supabase, folder, cutoff, stats);
    }

    // 2) Recurse into every UUID subfolder under generated/
    //    Real layout: generated/<campaign-UUID>/<file>.png
    const generatedSubs = await listSubfolders(supabase, "generated");
    for (const sub of generatedSubs) {
      await processFolder(supabase, sub, cutoff, stats);
    }

    // 3) Also recurse one level under generated/crm and generated/abnormal
    //    in case future code nests by date or campaign.
    for (const parent of ["generated/crm", "generated/abnormal"]) {
      const subs = await listSubfolders(supabase, parent);
      for (const sub of subs) {
        await processFolder(supabase, sub, cutoff, stats);
      }
    }

    const summary = {
      success: true,
      deleted: stats.deleted,
      scanned: stats.scanned,
      skipped_recent: stats.skippedRecent,
      max_age_hours: MAX_AGE_HOURS,
    };
    console.log("Cleanup complete:", summary);

    await supabase.from("cleanup_runs").insert({ function_name: "cleanup-card-images", summary });

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
