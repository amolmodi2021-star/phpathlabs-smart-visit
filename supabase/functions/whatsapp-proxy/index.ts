const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { apiBaseUrl, apiKey, authHeaderName, authHeaderPrefix, payload } = await req.json();

    if (!apiBaseUrl || !apiKey || !payload) {
      return new Response(JSON.stringify({ error: "Missing apiBaseUrl, apiKey, or payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authValue = authHeaderPrefix ? `${authHeaderPrefix} ${apiKey}` : apiKey;

    const res = await fetch(apiBaseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [authHeaderName || "apikey"]: authValue,
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    console.log("[whatsapp-proxy] API response:", res.status, text.slice(0, 500));

    return new Response(JSON.stringify({ status: res.status, body: text }), {
      status: res.ok ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
