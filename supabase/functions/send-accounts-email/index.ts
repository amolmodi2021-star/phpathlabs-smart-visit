import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-ph-access-token",
};

type EmailBody = {
  to?: string;
  subject?: string;
  html?: string;
  pdfBase64?: string;
  filename?: string;
};

async function resolveResendApiKey(): Promise<string | null> {
  const envKey = Deno.env.get("RESEND_API_KEY")?.trim();
  if (envKey) return envKey;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return null;

  const admin = createClient(supabaseUrl, serviceKey);
  const { data, error } = await admin
    .from("accounts_module_settings")
    .select("resend_api_key, email_from, email_from_name, email_reply_to")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.error("accounts_module_settings lookup failed:", error.message);
    return null;
  }

  return data?.resend_api_key?.trim() || null;
}

async function resolveFromFields(): Promise<{
  from: string;
  replyTo?: string;
}> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const fallbackFrom =
    Deno.env.get("ACCOUNTS_EMAIL_FROM")?.trim() || "accounts@phpathlabs.com";

  if (!supabaseUrl || !serviceKey) {
    return { from: fallbackFrom };
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { data } = await admin
    .from("accounts_module_settings")
    .select("email_from, email_from_name, email_reply_to")
    .eq("id", 1)
    .maybeSingle();

  const addr = data?.email_from?.trim() || fallbackFrom;
  const name = data?.email_from_name?.trim();
  const from = name ? `${name} <${addr}>` : addr;
  const replyTo = data?.email_reply_to?.trim() || undefined;
  return { from, replyTo };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as EmailBody;
    const to = body.to?.trim();
    const subject = body.subject?.trim() || "Purchase Order";
    const html = body.html?.trim() || "<p>Please find the attached purchase order.</p>";

    if (!to) {
      return new Response(JSON.stringify({ error: "Missing recipient email (to)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = await resolveResendApiKey();
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error:
            "Email not configured: set RESEND_API_KEY edge secret or accounts_module_settings.resend_api_key",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { from, replyTo } = await resolveFromFields();

    const payload: Record<string, unknown> = {
      from,
      to: [to],
      subject,
      html,
    };
    if (replyTo) payload.reply_to = replyTo;

    if (body.pdfBase64) {
      payload.attachments = [
        {
          filename: body.filename?.trim() || "purchase-order.pdf",
          content: body.pdfBase64.replace(/^data:application\/pdf;base64,/, ""),
        },
      ];
    }

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!resp.ok) {
      return new Response(
        JSON.stringify({ error: "Resend API failed", status: resp.status, data }),
        {
          status: resp.status >= 400 && resp.status < 500 ? resp.status : 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(JSON.stringify({ ok: true, data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
