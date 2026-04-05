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
      const { data: files } = await supabase.storage
        .from("loyalty-cards")
        .list(folder, { limit: 1000 });

      if (files && files.length > 0) {
        // Only delete actual files, not subfolders
        const filePaths = files
          .filter((f) => f.name && !f.name.endsWith("/"))
          .map((f) => `${folder}/${f.name}`);

        if (filePaths.length > 0) {
          await supabase.storage.from("loyalty-cards").remove(filePaths);
          totalDeleted += filePaths.length;
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
