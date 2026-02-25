import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { action, payload, id } = await req.json();

    switch (action) {
      case "list": {
        const { data, error } = await supabase
          .from("tests")
          .select("*")
          .order("test_name");
        if (error) return json({ error: error.message }, 400);
        return json({ data });
      }

      case "create": {
        const { error } = await supabase.from("tests").insert(payload);
        if (error) return json({ error: error.message }, 400);
        return json({ success: true });
      }

      case "update": {
        if (!id) return json({ error: "Missing id" }, 400);
        const { error } = await supabase
          .from("tests")
          .update(payload)
          .eq("id", id);
        if (error) return json({ error: error.message }, 400);
        return json({ success: true });
      }

      case "delete": {
        if (!id) return json({ error: "Missing id" }, 400);
        const { error } = await supabase
          .from("tests")
          .delete()
          .eq("id", id);
        if (error) return json({ error: error.message }, 400);
        return json({ success: true });
      }

      case "bulk_insert": {
        if (!Array.isArray(payload) || payload.length === 0)
          return json({ error: "Empty payload" }, 400);
        const { error } = await supabase.from("tests").insert(payload);
        if (error) return json({ error: error.message }, 400);
        return json({ success: true });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    return json({ error: err.message || "Internal error" }, 500);
  }
});
