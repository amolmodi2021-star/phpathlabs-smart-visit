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

    // Chunk cap per invocation: keeps each run safely under the edge-function
    // wall-clock timeout (~150s). With a 3s WhatsApp delay, 40 cards ≈ 120s.
    // The client re-invokes this function in a loop until pending = 0.
    const safeDelay = Math.max(0, Number(delayMs) || 0);
    const perCardBudgetMs = safeDelay + 1500; // ~1.5s for fetch + DB writes
    const MAX_WALL_MS = 120_000; // leave ~30s headroom under the platform cap
    const chunkLimit = Math.max(5, Math.min(200, Math.floor(MAX_WALL_MS / perCardBudgetMs)));

    const { data: cards, error: cardsError } = await supabase
      .from("loyalty_cards")
      .select("*")
      .eq("job_id", jobId)
      .eq("whatsapp_status", "pending")
      .order("created_at", { ascending: true })
      .limit(chunkLimit);

    // Total still-pending count for the job (for client progress + loop control)
    const { count: pendingTotal } = await supabase
      .from("loyalty_cards")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId)
      .eq("whatsapp_status", "pending");

    if (cardsError) throw cardsError;
    if (!cards || cards.length === 0) {
      await supabase.from("loyalty_card_jobs").update({ status: "completed" }).eq("id", jobId);
      return new Response(JSON.stringify({ message: "No pending cards to send", sentCount: 0, total: 0, remainingPending: 0, hasMore: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeaderValue = authHeaderPrefix ? `${authHeaderPrefix} ${apiKey}` : apiKey;

    let sentCount = 0;
    const results: { id: string; status: string; mobile?: string; error?: string }[] = [];
    

    for (const card of cards) {
      try {
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

        const rawMobile = (card.mobile || "").replace(/\D/g, "");
        const normalizedLocalMobile = rawMobile.length > 10 ? rawMobile.slice(-10) : rawMobile;
        const toNumber = normalizedLocalMobile ? `+91${normalizedLocalMobile}` : "";

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
          results.push({ id: card.id, status: "sent", mobile: normalizedLocalMobile });

          // Log to universal message_send_log
          if (normalizedLocalMobile) {
            await supabase.from("message_send_log").insert({
              mobile_number: normalizedLocalMobile,
              patient_name: card.patient_name || null,
              message_type: "Loyalty Card",
              umr_number: card.umr || null,
            });
          }

          // Update CRM contacts with last sent info — single most-recent row per
          // mobile, never a blanket update across every visit row for that mobile
          // (which was causing 35K+ writes per drip cycle).
          if (normalizedLocalMobile) {
            const { data: crmRow } = await supabase
              .from("crm_contacts")
              .select("id")
              .eq("mobile_number", normalizedLocalMobile)
              .order("updated_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (crmRow?.id) {
              await supabase.from("crm_contacts").update({
                last_sent_type: "ABC",
                last_sent_date: new Date().toISOString(),
              }).eq("id", crmRow.id);
            }
          }
        } else {
          await supabase.from("loyalty_cards").update({ whatsapp_status: "failed" }).eq("id", card.id);
          results.push({ id: card.id, status: "failed", error: responseText });
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


    // Recompute remaining pending after this chunk to drive the client's loop
    const { count: remainingPending } = await supabase
      .from("loyalty_cards")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId)
      .eq("whatsapp_status", "pending");

    // Aggregate sent_count for the job from the source-of-truth table
    const { count: jobSentCount } = await supabase
      .from("loyalty_cards")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId)
      .eq("whatsapp_status", "sent");

    const hasMore = (remainingPending || 0) > 0;
    await supabase
      .from("loyalty_card_jobs")
      .update({ sent_count: jobSentCount || 0, status: hasMore ? "processing" : "completed" })
      .eq("id", jobId);

    return new Response(
      JSON.stringify({
        sentCount,
        total: cards.length,
        startingPending: pendingTotal || 0,
        remainingPending: remainingPending || 0,
        hasMore,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("send-loyalty-whatsapp error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
