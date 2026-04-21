import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { imageBase64, jobId, fileName } = await req.json();

    if (!imageBase64) {
      return new Response(JSON.stringify({ error: "Missing imageBase64" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Decode base64 image (JPEG preferred; PNG still accepted for backward compat)
    const mimeMatch = imageBase64.match(/^data:(image\/\w+);base64,/);
    const detectedMime = mimeMatch?.[1] || "image/jpeg";
    const isPng = detectedMime === "image/png";
    const ext = isPng ? "png" : "jpg";
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const filePath = `generated/${jobId || "manual"}/${fileName || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`}`;

    const { error: uploadError } = await supabase.storage
      .from("loyalty-cards")
      .upload(filePath, bytes, { contentType: detectedMime });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage.from("loyalty-cards").getPublicUrl(filePath);

    return new Response(JSON.stringify({ imageUrl: publicUrlData.publicUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("generate-loyalty-card error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
