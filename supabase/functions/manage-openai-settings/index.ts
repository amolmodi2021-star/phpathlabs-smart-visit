import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-ph-access-token",
};

function maskKey(key: string | null | undefined): { configured: boolean; last4: string | null } {
  const k = String(key || "").trim();
  if (!k) return { configured: false, last4: null };
  return { configured: true, last4: k.slice(-4) };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "status");
    const envKey = Deno.env.get("OPENAI_API_KEY") || "";
    const envModel = Deno.env.get("OPENAI_CBC_MODEL") || "";

    const { data: row } = await supabase
      .from("ai_api_secrets")
      .select("api_key, model_override, updated_at, updated_by")
      .eq("provider", "openai")
      .maybeSingle();

    if (action === "status") {
      const dbMask = maskKey(row?.api_key);
      const envMask = maskKey(envKey);
      const active = dbMask.configured ? "settings" : envMask.configured ? "env" : null;
      return new Response(
        JSON.stringify({
          configured: !!(dbMask.configured || envMask.configured),
          source: active,
          last4: dbMask.configured ? dbMask.last4 : envMask.last4,
          model_override: row?.model_override || envModel || null,
          updated_at: row?.updated_at || null,
          updated_by: row?.updated_by || null,
          settings_configured: dbMask.configured,
          env_configured: envMask.configured,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "save") {
      const apiKey = String(body?.api_key || "").trim();
      const modelOverride = String(body?.model_override || "").trim() || null;
      const updatedBy = String(body?.updated_by || "").trim() || null;
      if (!apiKey.startsWith("sk-") || apiKey.length < 20) {
        throw new Error("Enter a valid OpenAI API key (starts with sk-)");
      }
      const { error } = await supabase.from("ai_api_secrets").upsert(
        {
          provider: "openai",
          api_key: apiKey,
          model_override: modelOverride,
          updated_at: new Date().toISOString(),
          updated_by: updatedBy,
        },
        { onConflict: "provider" },
      );
      if (error) throw error;
      return new Response(
        JSON.stringify({ ok: true, ...maskKey(apiKey), model_override: modelOverride, source: "settings" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "clear") {
      const { error } = await supabase.from("ai_api_secrets").delete().eq("provider", "openai");
      if (error) throw error;
      const envMask = maskKey(envKey);
      return new Response(
        JSON.stringify({
          ok: true,
          configured: envMask.configured,
          source: envMask.configured ? "env" : null,
          last4: envMask.last4,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "test") {
      const key = String(row?.api_key || envKey || "").trim();
      if (!key) throw new Error("No OpenAI API key configured");
      const resp = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`OpenAI rejected the key (${resp.status}). ${text.slice(0, 180)}`);
      }
      return new Response(JSON.stringify({ ok: true, message: "OpenAI key is valid" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e) {
    console.error("manage-openai-settings error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
