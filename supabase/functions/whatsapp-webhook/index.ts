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

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // GET = webhook verification (some providers send a GET to verify the endpoint)
  if (req.method === "GET") {
    const url = new URL(req.url);
    // Echo back any challenge token for verification
    const challenge = url.searchParams.get("hub.challenge") || url.searchParams.get("challenge") || "ok";
    return new Response(challenge, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  }

  try {
    const body = await req.json();
    console.log("Webhook received:", JSON.stringify(body));

    // Skip message_status events (delivery receipts) — only process actual messages
    if (body.event === "message_status" || body.statuses) {
      return new Response(JSON.stringify({ success: true, skipped: "status_event" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load settings from app_settings
    const { data: settings } = await supabase
      .from("app_settings")
      .select("setting_key, setting_value")
      .in("setting_key", [
        "webhook_auto_reply_message",
        "webhook_auto_reply_enabled",
        "loyalty_wa_baseUrl",
        "loyalty_wa_apiKey",
        "loyalty_wa_authHeaderName",
        "loyalty_wa_authHeaderPrefix",
        "loyalty_wa_fromNumber",
      ]);

    const settingsMap: Record<string, string> = {};
    (settings || []).forEach((s) => {
      settingsMap[s.setting_key] = s.setting_value;
    });

    const autoReplyEnabled = settingsMap["webhook_auto_reply_enabled"] !== "false";
    const autoReplyMessage = settingsMap["webhook_auto_reply_message"] || "Thank you for your message. We will get back to you shortly.";
    const apiBaseUrl = settingsMap["loyalty_wa_baseUrl"] || "";
    const apiKey = settingsMap["loyalty_wa_apiKey"] || "";
    const authHeaderName = settingsMap["loyalty_wa_authHeaderName"] || "apikey";
    const authHeaderPrefix = settingsMap["loyalty_wa_authHeaderPrefix"] || "";
    const fromNumber = settingsMap["loyalty_wa_fromNumber"] || "";

    // Extract sender info from inbound payload
    // Support AOC Portal structure (messages is an object, not array)
    let senderNumber = "";
    let inboundMessage = "";
    let senderName = "";

    // Sender number: AOC uses contacts.recipient (the customer who sent the message)
    // body.from is the business number in AOC Portal
    if (body.contacts?.recipient) {
      senderNumber = body.contacts.recipient;
      // Ensure it has + prefix
      if (!senderNumber.startsWith("+")) {
        senderNumber = `+${senderNumber}`;
      }
    } else if (body.payload?.sender?.phone) {
      senderNumber = body.payload.sender.phone;
    } else if (body.from) {
      senderNumber = body.from;
    }

    // Message text: AOC uses messages.text.body (object) not messages[0]
    if (body.messages?.text?.body) {
      inboundMessage = body.messages.text.body;
    } else if (body.text?.body) {
      inboundMessage = body.text.body;
    } else if (body.payload?.text) {
      inboundMessage = body.payload.text;
    } else if (Array.isArray(body.messages) && body.messages[0]?.text?.body) {
      inboundMessage = body.messages[0].text.body;
    } else if (body.message) {
      inboundMessage = typeof body.message === "string" ? body.message : JSON.stringify(body.message);
    }

    // Sender name: AOC uses contacts.profileName (object, not array)
    if (body.contacts?.profileName) {
      senderName = body.contacts.profileName;
    } else if (body.senderName) {
      senderName = body.senderName;
    } else if (body.payload?.sender?.name) {
      senderName = body.payload.sender.name;
    } else if (Array.isArray(body.contacts) && body.contacts[0]?.profile?.name) {
      senderName = body.contacts[0].profile.name;
    }

    // Log inbound message to database
    await supabase.from("webhook_messages").insert({
      sender_number: senderNumber,
      sender_name: senderName,
      message: inboundMessage,
      direction: "inbound",
      raw_payload: body,
    });

    // Send auto-reply if enabled
    if (autoReplyEnabled && senderNumber && apiBaseUrl && apiKey) {
      const authHeaderValue = authHeaderPrefix ? `${authHeaderPrefix} ${apiKey}` : apiKey;

      const replyPayload = {
        recipient_type: "individual",
        from: fromNumber,
        to: senderNumber,
        type: "text",
        text: { body: autoReplyMessage },
      };

      console.log("Sending auto-reply:", JSON.stringify(replyPayload));

      try {
        const res = await fetch(apiBaseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [authHeaderName]: authHeaderValue,
          },
          body: JSON.stringify(replyPayload),
        });

        const resText = await res.text();
        console.log("Auto-reply response:", res.status, resText);

        // Log outbound reply
        await supabase.from("webhook_messages").insert({
          sender_number: senderNumber,
          sender_name: senderName,
          message: autoReplyMessage,
          direction: "outbound",
          status: res.ok ? "sent" : "failed",
          raw_payload: { response: resText, statusCode: res.status },
        });
      } catch (replyErr) {
        console.error("Auto-reply failed:", replyErr);
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Webhook error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
