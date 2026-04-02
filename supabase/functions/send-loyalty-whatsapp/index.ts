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
    const { jobId, apiKey, apiBaseUrl, templateName, variablesMapping, queueEnabled, delayMs } = await req.json();

    if (!jobId || !apiKey || !apiBaseUrl || !templateName) {
      return new Response(JSON.stringify({ error: "Missing required fields: jobId, apiKey, apiBaseUrl, templateName" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get all pending cards for this job
    const { data: cards, error: cardsError } = await supabase
      .from("loyalty_cards")
      .select("*")
      .eq("job_id", jobId)
      .eq("whatsapp_status", "pending")
      .order("created_at", { ascending: true });

    if (cardsError) throw cardsError;
    if (!cards || cards.length === 0) {
      return new Response(JSON.stringify({ message: "No pending cards to send" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sentCount = 0;
    const results: { id: string; status: string; error?: string }[] = [];

    for (const card of cards) {
      try {
        // Build template variables from card data and mapping
        const variables: Record<string, string> = {};
        const mapping = variablesMapping || {};
        for (const [varKey, fieldName] of Object.entries(mapping)) {
          const field = fieldName as string;
          switch (field) {
            case "Name": variables[varKey] = card.patient_name || ""; break;
            case "Mobile": variables[varKey] = card.mobile || ""; break;
            case "UMR": variables[varKey] = card.umr || ""; break;
            case "Discount %": variables[varKey] = card.discount || ""; break;
            case "Expiry Date": variables[varKey] = card.expiry_date || ""; break;
            default: variables[varKey] = "";
          }
        }

        // Call WhatsApp BSP API (generic format — works with Interakt/Wati/AiSensy style APIs)
        const whatsappPayload = {
          countryCode: "+91",
          phoneNumber: card.mobile?.replace(/^\+?91/, "") || "",
          type: "Template",
          template: {
            name: templateName,
            languageCode: "en",
            headerValues: card.image_url ? [card.image_url] : [],
            bodyValues: Object.values(variables),
          },
          data: {
            media: card.image_url ? { url: card.image_url } : undefined,
          },
        };

        const whatsappRes = await fetch(apiBaseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Basic ${apiKey}`,
          },
          body: JSON.stringify(whatsappPayload),
        });

        const responseText = await whatsappRes.text();

        if (whatsappRes.ok) {
          await supabase.from("loyalty_cards").update({ whatsapp_status: "sent", sent_at: new Date().toISOString() }).eq("id", card.id);
          sentCount++;
          results.push({ id: card.id, status: "sent" });
        } else {
          await supabase.from("loyalty_cards").update({ whatsapp_status: "failed" }).eq("id", card.id);
          results.push({ id: card.id, status: "failed", error: responseText });
        }
      } catch (err: any) {
        await supabase.from("loyalty_cards").update({ whatsapp_status: "failed" }).eq("id", card.id);
        results.push({ id: card.id, status: "failed", error: err.message });
      }

      // Delay between messages if queue enabled
      if (queueEnabled && delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    // Update job sent count
    await supabase.from("loyalty_card_jobs").update({ sent_count: sentCount, status: "completed" }).eq("id", jobId);

    return new Response(JSON.stringify({ sentCount, total: cards.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("send-loyalty-whatsapp error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
