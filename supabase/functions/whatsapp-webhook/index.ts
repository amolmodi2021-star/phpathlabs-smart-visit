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

  // GET = webhook verification
  if (req.method === "GET") {
    const url = new URL(req.url);
    const challenge = url.searchParams.get("hub.challenge") || url.searchParams.get("challenge") || "ok";
    return new Response(challenge, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  }

  try {
    const body = await req.json();
    console.log("Webhook received:", JSON.stringify(body));

    // Handle message_status events — update delivery status
    if (body.event === "message_status" || body.statuses) {
      const statusData = body.statuses || {};
      const messageId = body.messageId || "";
      const status = statusData.status || "";
      const errorInfo = statusData.error || null;

      if (messageId && status) {
        const updatePayload: Record<string, any> = { delivery_status: status };
        if (errorInfo) updatePayload.error_info = errorInfo;

        // message_send_log table dropped — only update webhook_messages.
        const aocSuffixPattern = /^[0-9a-f-]{36}:\d+$/;
        const baseId = aocSuffixPattern.test(messageId) ? messageId.split(":")[0] : null;

        const exactWm = await supabase
          .from("webhook_messages")
          .update(updatePayload)
          .eq("message_id", messageId)
          .select("id");

        if (baseId && (!exactWm.data || exactWm.data.length === 0)) {
          await supabase
            .from("webhook_messages")
            .update(updatePayload)
            .eq("message_id", baseId);
        }

        console.log(`Status update: ${messageId} (base: ${baseId}) → ${status}`);
      }

      return new Response(JSON.stringify({ success: true, status_updated: status }), {
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
        "webhook_wa_me_url",
        "webhook_max_auto_replies_24h",
        "webhook_auto_reply_delay_seconds",
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
    const baseReplyMessage = settingsMap["webhook_auto_reply_message"] || "Thank you for your message. We will get back to you shortly.";
    const waMeUrl = settingsMap["webhook_wa_me_url"] || "";
    const maxAutoReplies = Number(settingsMap["webhook_max_auto_replies_24h"] || "0");
    const autoReplyDelaySec = Math.max(0, Math.min(60, Number(settingsMap["webhook_auto_reply_delay_seconds"] || "0")));
    const autoReplyMessage = waMeUrl ? `${baseReplyMessage}\n\n${waMeUrl}` : baseReplyMessage;
    const apiBaseUrl = settingsMap["loyalty_wa_baseUrl"] || "";
    const apiKey = settingsMap["loyalty_wa_apiKey"] || "";
    const authHeaderName = settingsMap["loyalty_wa_authHeaderName"] || "apikey";
    const authHeaderPrefix = settingsMap["loyalty_wa_authHeaderPrefix"] || "";
    const fromNumber = settingsMap["loyalty_wa_fromNumber"] || "";

    // Extract sender info
    let senderNumber = "";
    let inboundMessage = "";
    let senderName = "";
    let messageType = "text";
    let mediaUrl: string | null = null;
    let locationLat: number | null = null;
    let locationLng: number | null = null;
    const messageId = body.messageId || "";

    // Sender number
    if (body.contacts?.recipient) {
      senderNumber = body.contacts.recipient;
      if (!senderNumber.startsWith("+")) senderNumber = `+${senderNumber}`;
    } else if (body.payload?.sender?.phone) {
      senderNumber = body.payload.sender.phone;
    } else if (body.from) {
      senderNumber = body.from;
    }

    // Determine message type and extract content
    const messages = body.messages || {};
    const msgType = messages.type || body.type || "text";
    messageType = msgType;

    if (msgType === "text") {
      if (messages.text?.body) {
        inboundMessage = messages.text.body;
      } else if (body.text?.body) {
        inboundMessage = body.text.body;
      } else if (body.payload?.text) {
        inboundMessage = body.payload.text;
      } else if (Array.isArray(body.messages) && body.messages[0]?.text?.body) {
        inboundMessage = body.messages[0].text.body;
      } else if (body.message) {
        inboundMessage = typeof body.message === "string" ? body.message : JSON.stringify(body.message);
      }
    } else if (msgType === "image") {
      mediaUrl = messages.image?.url || null;
      inboundMessage = "[Image]";
    } else if (msgType === "location") {
      const loc = messages.location?.text || messages.location || {};
      locationLat = loc.latitude || null;
      locationLng = loc.longitude || null;
      inboundMessage = `[Location: ${locationLat}, ${locationLng}]`;
    } else if (msgType === "button") {
      inboundMessage = messages.button?.text || messages.button?.payload || "[Button Reply]";
    } else if (msgType === "interactive") {
      const interactive = messages.interactive?.text || messages.interactive || {};
      if (interactive.list_reply) {
        inboundMessage = interactive.list_reply.title || "[List Reply]";
      } else if (interactive.button_reply) {
        inboundMessage = interactive.button_reply.title || "[Button Reply]";
      } else {
        inboundMessage = "[Interactive Reply]";
      }
    }

    // Sender name
    if (body.contacts?.profileName) {
      senderName = body.contacts.profileName;
    } else if (body.senderName) {
      senderName = body.senderName;
    } else if (body.payload?.sender?.name) {
      senderName = body.payload.sender.name;
    } else if (Array.isArray(body.contacts) && body.contacts[0]?.profile?.name) {
      senderName = body.contacts[0].profile.name;
    }

    // Log inbound message
    await supabase.from("webhook_messages").insert({
      sender_number: senderNumber,
      sender_name: senderName,
      message: inboundMessage,
      direction: "inbound",
      raw_payload: body,
      message_type: messageType,
      media_url: mediaUrl,
      message_id: messageId || null,
      location_lat: locationLat,
      location_lng: locationLng,
      delivery_status: "received",
    });

    // Send auto-reply if enabled
    if (autoReplyEnabled && senderNumber && apiBaseUrl && apiKey) {
      // Check rate limit
      let rateLimited = false;
      if (maxAutoReplies > 0) {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count } = await supabase
          .from("webhook_messages")
          .select("id", { count: "exact", head: true })
          .eq("sender_number", senderNumber)
          .eq("direction", "outbound")
          .gte("created_at", since);
        if ((count ?? 0) >= maxAutoReplies) {
          rateLimited = true;
          console.log(`Rate limited: ${senderNumber} has ${count} auto-replies in 24h (max: ${maxAutoReplies})`);
        }
      }

      if (!rateLimited) {
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

        // Try to extract messageId from auto-reply response
        let replyMessageId: string | null = null;
        try {
          const parsed = JSON.parse(resText);
          replyMessageId = parsed?.messageId
            || parsed?.message_id
            || parsed?.id
            || parsed?.data?.[0]?.messageId
            || parsed?.data?.[0]?.id
            || parsed?.messages?.[0]?.id
            || null;
          console.log("Extracted auto-reply messageId:", replyMessageId);
        } catch {}

        await supabase.from("webhook_messages").insert({
          sender_number: senderNumber,
          sender_name: senderName,
          message: autoReplyMessage,
          direction: "outbound",
          status: res.ok ? "sent" : "failed",
          raw_payload: { response: resText, statusCode: res.status },
          message_type: "text",
          delivery_status: res.ok ? "sent" : "failed",
          message_id: replyMessageId,
        });
      } catch (replyErr) {
        console.error("Auto-reply failed:", replyErr);
      }
      } // end if (!rateLimited)
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
