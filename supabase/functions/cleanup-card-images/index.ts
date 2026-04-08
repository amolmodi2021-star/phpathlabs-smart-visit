import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    let totalDeleted = 0;

    for (const folder of folders) {
      const { data: files, error: listErr } = await supabase.storage
        .from("loyalty-cards")
        .list(folder, { limit: 1000 });

      if (listErr) {
        console.error(`Error listing ${folder}:`, listErr);
        continue;
      }

      if (files && files.length > 0) {
        // Only delete actual files — skip placeholder folders (id is null or name has no extension)
        const filePaths = files
          .filter((f) => f.id && f.name && f.metadata && Object.keys(f.metadata).length > 0)
          .map((f) => `${folder}/${f.name}`);

        if (filePaths.length > 0) {
          const { error: removeErr } = await supabase.storage.from("loyalty-cards").remove(filePaths);
          if (removeErr) {
            console.error(`Error removing from ${folder}:`, removeErr);
          } else {
            totalDeleted += filePaths.length;
          }
        }
      }
    }

    console.log(`Cleanup complete: deleted ${totalDeleted} card images`);

    return new Response(
      JSON.stringify({ success: true, deleted: totalDeleted }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Cleanup error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
