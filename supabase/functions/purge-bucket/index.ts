import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PASSWORD = "9819111107";
const PAGE_SIZE = 1000;
const REMOVE_BATCH = 100;

// Per-bucket protected prefixes — never deleted, even by purge.
const PROTECTED_PREFIXES: Record<string, string[]> = {
  "loyalty-cards": ["logos/", "backgrounds/"],
};

async function listAllRecursive(
  supabase: any,
  bucket: string,
  prefix: string,
  collected: string[]
) {
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const item of data) {
      const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
      // Files have an `id`; folders are placeholder entries with null id.
      if (item.id) {
        collected.push(fullPath);
      } else {
        // Recurse into subfolder
        await listAllRecursive(supabase, bucket, fullPath, collected);
      }
    }

    if (data.length < PAGE_SIZE) break;
    offset += data.length;
    if (offset > PAGE_SIZE * 100) break; // safety cap 100k entries per folder
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { bucket, password } = await req.json();

    if (!password || password !== PASSWORD) {
      return new Response(JSON.stringify({ error: "Invalid password" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!bucket || typeof bucket !== "string") {
      return new Response(JSON.stringify({ error: "Missing bucket" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify bucket exists
    const { data: buckets, error: bErr } = await supabase.storage.listBuckets();
    if (bErr) throw bErr;
    if (!buckets.find((b: any) => b.name === bucket || b.id === bucket)) {
      return new Response(JSON.stringify({ error: `Bucket ${bucket} not found` }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Collect every file path recursively
    const allPaths: string[] = [];
    await listAllRecursive(supabase, bucket, "", allPaths);

    // Filter out protected prefixes (e.g. reusable assets in loyalty-cards)
    const protectedPrefixes = PROTECTED_PREFIXES[bucket] ?? [];
    const paths = protectedPrefixes.length
      ? allPaths.filter((p) => !protectedPrefixes.some((pre) => p.startsWith(pre)))
      : allPaths;
    const skipped = allPaths.length - paths.length;

    let filesRemoved = 0;
    for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
      const chunk = paths.slice(i, i + REMOVE_BATCH);
      const { error: rmErr } = await supabase.storage.from(bucket).remove(chunk);
      if (rmErr) {
        console.error("Remove batch error:", rmErr);
      } else {
        filesRemoved += chunk.length;
      }
    }

    const summary = { bucket, files_removed: filesRemoved, protected_skipped: skipped };
    await supabase.from("cleanup_runs").insert({ function_name: "purge-bucket", summary });

    console.log("Purge complete:", summary);
    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Purge error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
