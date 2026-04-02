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
    const {
      jobId,
      apiBaseUrl,
      apiKey,
      authHeaderName = "apikey",
      authHeaderPrefix = "",
      fromNumber = "",
      campaignName = "",
      templateName,
      variablesMapping,
      includeMediaHeader = true,
      queueEnabled,
      delayMs,
    } = await req.json();

    if (!jobId || !apiKey || !apiBaseUrl || !templateName) {
      return new Response(JSON.stringify({ error: "Missing required fields: jobId, apiKey, apiBaseUrl, templateName" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: cards, error: cardsError } = await supabase
      .from("loyalty_cards")
      .select("*")
      .eq("job_id", jobId)
      .eq("whatsapp_status", "pending")
      .order("created_at", { ascending: true });

    if (cardsError) throw cardsError;
    if (!cards || cards.length === 0) {
      return new Response(JSON.stringify({ message: "No pending cards to send", sentCount: 0, total: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build dynamic auth header
    const authHeaderValue = authHeaderPrefix ? `${authHeaderPrefix} ${apiKey}` : apiKey;

    let sentCount = 0;
    const results: { id: string; status: string; error?: string }[] = [];

    for (const card of cards) {
      try {
        // Build body params from mapping
        const mapping = variablesMapping || {};
        const params: string[] = [];
        const sortedKeys = Object.keys(mapping).sort((a, b) => Number(a) - Number(b));
        for (const key of sortedKeys) {
          const field = mapping[key] as string;
          switch (field) {
            case "Name": params.push(card.patient_name || ""); break;
            case "Mobile": params.push(card.mobile || ""); break;
            case "UMR": params.push(card.umr || ""); break;
            case "Discount %": params.push(card.discount || ""); break;
            case "Expiry Date": params.push(card.expiry_date || ""); break;
            default: params.push("");
          }
        }

        // Format recipient number
        const rawMobile = (card.mobile || "").replace(/\D/g, "");
        const normalizedLocalMobile = rawMobile.length > 10 ? rawMobile.slice(-10) : rawMobile;
        const toNumber = normalizedLocalMobile ? `+91${normalizedLocalMobile}` : "";

        // Build components object — only include body if there are actual params
        const components: Record<string, unknown> = {};
        if (params.length > 0) {
          components.body = { params };
        }

        if (includeMediaHeader && card.image_url) {
          components.header = {
            type: "image",
            image: { link: card.image_url },
          };
        }

        const payload = {
          from: fromNumber,
          to: toNumber,
          templateName,
          campaignName: campaignName || "",
          type: "template",
          components,
        };

        console.log(`Sending to ${toNumber}:`, JSON.stringify(payload));

        const whatsappRes = await fetch(apiBaseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [authHeaderName]: authHeaderValue,
          },
          body: JSON.stringify(payload),
        });

        const responseText = await whatsappRes.text();
        console.log(`Response for ${toNumber}:`, whatsappRes.status, responseText);

        if (whatsappRes.ok) {
          await supabase.from("loyalty_cards").update({ whatsapp_status: "sent", sent_at: new Date().toISOString() }).eq("id", card.id);
          sentCount++;
          results.push({ id: card.id, status: "sent", payload, apiResponse: responseText });
        } else {
          await supabase.from("loyalty_cards").update({ whatsapp_status: "failed" }).eq("id", card.id);
          results.push({ id: card.id, status: "failed", payload, error: responseText });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        await supabase.from("loyalty_cards").update({ whatsapp_status: "failed" }).eq("id", card.id);
        results.push({ id: card.id, status: "failed", error: message });
      }

      if (queueEnabled && delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    await supabase.from("loyalty_card_jobs").update({ sent_count: sentCount, status: "completed" }).eq("id", jobId);

    return new Response(JSON.stringify({ sentCount, total: cards.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("send-loyalty-whatsapp error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
