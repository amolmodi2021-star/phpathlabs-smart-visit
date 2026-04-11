import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Simple password hashing using Web Crypto (SHA-256 + salt)
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, "0")).join("");
  const data = new TextEncoder().encode(saltHex + password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
  return `sha256:${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored.startsWith("sha256:")) return false;
  const parts = stored.split(":");
  if (parts.length !== 3) return false;
  const salt = parts[1];
  const data = new TextEncoder().encode(salt + password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
  return hashHex === parts[2];
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, ...params } = await req.json();

    if (action === "login") return await handleLogin(params, req);
    if (action === "reset_password") return await handleResetPassword(params);
    if (action === "create_user") return await handleCreateUser(params);
    if (action === "update_user") return await handleUpdateUser(params);
    if (action === "init_admin_password") return await handleInitAdminPassword(params);
    return json({ error: "Unknown action" }, 400);
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
});

async function handleLogin(
  { username, password }: { username: string; password: string },
  req: Request
) {
  if (!username || !password) return json({ error: "Username and password required" }, 400);

  const { data: user, error } = await supabase
    .from("app_users")
    .select("id, username, password_hash, display_name, is_active, role_id")
    .eq("username", username.toUpperCase())
    .maybeSingle();

  if (error || !user) return json({ error: "Invalid credentials" }, 401);
  if (!user.is_active) return json({ error: "Account is inactive. Contact administrator." }, 403);

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return json({ error: "Invalid credentials" }, 401);

  let permissions = {};
  if (user.role_id) {
    const { data: role } = await supabase
      .from("app_roles")
      .select("role_name, permissions")
      .eq("id", user.role_id)
      .maybeSingle();
    if (role) permissions = role.permissions;
  }

  await supabase.from("app_users").update({ last_login_at: new Date().toISOString() }).eq("id", user.id);

  const ip = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown";
  const ua = req.headers.get("user-agent") || "unknown";
  await supabase.from("app_user_login_history").insert({ user_id: user.id, ip_address: ip, user_agent: ua });

  return json({
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role_id: user.role_id,
      permissions,
    },
  });
}

async function handleResetPassword({ user_id, new_password }: { user_id: string; new_password: string }) {
  if (!user_id || !new_password) return json({ error: "user_id and new_password required" }, 400);
  if (new_password.length < 4) return json({ error: "Password must be at least 4 characters" }, 400);

  const hash = await hashPassword(new_password);
  const { error } = await supabase.from("app_users").update({ password_hash: hash }).eq("id", user_id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

async function handleCreateUser(params: {
  username: string;
  password: string;
  display_name?: string;
  role_id?: string;
  is_active?: boolean;
}) {
  if (!params.username || !params.password) return json({ error: "Username and password required" }, 400);

  const hash = await hashPassword(params.password);
  const { data, error } = await supabase
    .from("app_users")
    .insert({
      username: params.username.toUpperCase(),
      password_hash: hash,
      display_name: params.display_name || params.username,
      role_id: params.role_id || null,
      is_active: params.is_active !== false,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return json({ error: "Username already exists" }, 409);
    return json({ error: error.message }, 500);
  }
  return json({ user: data });
}

async function handleUpdateUser(params: {
  user_id: string;
  display_name?: string;
  role_id?: string;
  is_active?: boolean;
}) {
  if (!params.user_id) return json({ error: "user_id required" }, 400);

  const updates: Record<string, any> = {};
  if (params.display_name !== undefined) updates.display_name = params.display_name;
  if (params.role_id !== undefined) updates.role_id = params.role_id || null;
  if (params.is_active !== undefined) updates.is_active = params.is_active;

  const { error } = await supabase.from("app_users").update(updates).eq("id", params.user_id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

async function handleInitAdminPassword({ password }: { password: string }) {
  if (!password) return json({ error: "password required" }, 400);

  const hash = await hashPassword(password);
  const { error } = await supabase
    .from("app_users")
    .update({ password_hash: hash })
    .eq("username", "PHPATHLABS");

  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
