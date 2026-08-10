import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-ph-access-token",
};

function b64url(bytes: ArrayBuffer | Uint8Array | string): string {
  const u8 =
    typeof bytes === "string"
      ? new TextEncoder().encode(bytes)
      : bytes instanceof Uint8Array
        ? bytes
        : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(str: string): Uint8Array {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function resolveJwtSecret(): string {
  let secretRaw =
    Deno.env.get("JWT_SECRET") ||
    Deno.env.get("SUPABASE_JWT_SECRET") ||
    Deno.env.get("SUPABASE_INTERNAL_JWT_SECRET") ||
    "";

  // Local edge isolates often lack JWT_SECRET. Detect the well-known local demo
  // service_role key and use the matching local JWT secret.
  if (!secretRaw) {
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const url = Deno.env.get("SUPABASE_URL") || "";
    const isLocalDemo =
      svc.includes('"iss":"supabase-demo"') ||
      svc.includes("supabase-demo") ||
      svc.startsWith("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1v") ||
      /127\.0\.0\.1|localhost/i.test(url);
    if (isLocalDemo) {
      secretRaw = "super-secret-jwt-token-with-at-least-32-characters-long";
    }
  }
  return secretRaw;
}

async function issueStaffAccessToken(user: {
  id: string;
  username: string;
  role_id: string | null;
}): Promise<string> {
  const secretRaw = resolveJwtSecret();
  if (!secretRaw) throw new Error("JWT_SECRET is not configured");

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    role: "authenticated",
    app_role: "staff",
    username: user.username,
    role_id: user.role_id,
    sub: user.id,
    aud: "authenticated",
    iss: "supabase",
    iat: now,
    exp: now + 12 * 60 * 60,
  };
  const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretRaw),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${b64url(sig)}`;
}

type StaffClaims = {
  sub: string;
  username?: string;
  role_id?: string | null;
  app_role?: string;
  exp?: number;
};

function extractStaffToken(req: Request, bodyToken?: string | null): string | null {
  // Preferred: custom staff JWT header (PostgREST Authorization stays as anon key).
  const ph = req.headers.get("x-ph-access-token")?.trim();
  if (ph) return ph;
  const auth = req.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) {
    const bearer = m[1].trim();
    // Ignore anon/publishable API keys — only treat JWT-shaped values as staff tokens.
    if (bearer.split(".").length === 3) return bearer;
  }
  if (typeof bodyToken === "string" && bodyToken.trim()) {
    const t = bodyToken.trim();
    if (t.split(".").length === 3) return t;
  }
  return null;
}

async function verifyStaffJwt(req: Request, bodyToken?: string | null): Promise<StaffClaims | null> {
  const token = extractStaffToken(req, bodyToken);
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const secretRaw = resolveJwtSecret();
  if (!secretRaw) return null;

  const body = `${parts[0]}.${parts[1]}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretRaw),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const sig = b64urlDecode(parts[2]);
  const ok = await crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(body));
  if (!ok) return null;

  let payload: StaffClaims;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  } catch {
    return null;
  }
  if (!payload?.sub) return null;
  if (payload.app_role && payload.app_role !== "staff") return null;
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function isUsersTabAllowed(permissions: any): boolean {
  const tabs = permissions?.tabs || {};
  const perm = tabs["/users"];
  if (perm === true) return true;
  if (perm && typeof perm === "object" && perm.enabled === true) return true;
  return false;
}

async function requireStaff(req: Request, bodyToken?: string | null): Promise<StaffClaims | Response> {
  const claims = await verifyStaffJwt(req, bodyToken);
  if (!claims) return json({ error: "Unauthorized — please log out and sign in again" }, 401);
  return claims;
}

/** User-management actions require the /users tab on the caller's role (or super-admin username). */
async function requireUsersAdmin(req: Request, bodyToken?: string | null): Promise<StaffClaims | Response> {
  const claims = await requireStaff(req, bodyToken);
  if (claims instanceof Response) return claims;

  // Super-admin account always allowed to manage users.
  if (String(claims.username || "").toUpperCase() === "PHPATHLABS") return claims;

  const { data: user } = await supabase
    .from("app_users")
    .select("id, is_active, role_id, username")
    .eq("id", claims.sub)
    .maybeSingle();
  if (!user || user.is_active === false) return json({ error: "Forbidden" }, 403);
  if (String(user.username || "").toUpperCase() === "PHPATHLABS") return claims;

  let permissions: any = {};
  if (user.role_id) {
    const { data: role } = await supabase
      .from("app_roles")
      .select("permissions")
      .eq("id", user.role_id)
      .maybeSingle();
    permissions = role?.permissions || {};
  }
  if (!isUsersTabAllowed(permissions)) {
    return json({ error: "Forbidden: Users management not allowed for this role" }, 403);
  }
  return claims;
}

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
    if (action === "change_password") return await handleChangePassword(params, req);
    if (action === "reset_password") return await handleResetPassword(params, req);
    if (action === "create_user") return await handleCreateUser(params, req);
    if (action === "update_user") return await handleUpdateUser(params, req);
    if (action === "list_users") return await handleListUsers(params, req);
    if (action === "init_admin_password") return await handleInitAdminPassword(params, req);
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
    .select("id, username, password_hash, display_name, is_active, role_id, can_approve_as_doctor")
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

  const access_token = await issueStaffAccessToken({
    id: user.id,
    username: user.username,
    role_id: user.role_id,
  });

  return json({
    access_token,
    token_type: "bearer",
    expires_in: 12 * 60 * 60,
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role_id: user.role_id,
      can_approve_as_doctor: user.can_approve_as_doctor === true,
      permissions,
    },
  });
}

async function handleResetPassword(
  { user_id, new_password, access_token }: { user_id: string; new_password: string; access_token?: string },
  req: Request,
) {
  const auth = await requireUsersAdmin(req, access_token);
  if (auth instanceof Response) return await asLegacyError(auth);

  if (!user_id || !new_password) return json({ error: "user_id and new_password required" }, 400);
  if (new_password.length < 4) return json({ error: "Password must be at least 4 characters" }, 400);

  const hash = await hashPassword(new_password);
  const { error } = await supabase.from("app_users").update({ password_hash: hash }).eq("id", user_id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

async function handleListUsers(
  params: { access_token?: string },
  req: Request,
) {
  const auth = await requireUsersAdmin(req, params?.access_token);
  if (auth instanceof Response) return await asLegacyError(auth);

  const { data, error } = await supabase
    .from("app_users")
    .select("id, username, display_name, role_id, is_active, last_login_at, created_at, can_approve_as_doctor")
    .order("created_at", { ascending: true });
  if (error) return json({ error: error.message }, 500);
  return json({ users: data || [] });
}

async function handleCreateUser(
  params: {
    username: string;
    password: string;
    display_name?: string;
    role_id?: string;
    is_active?: boolean;
    can_approve_as_doctor?: boolean;
    access_token?: string;
  },
  req: Request,
) {
  const auth = await requireUsersAdmin(req, params?.access_token);
  if (auth instanceof Response) return await asLegacyError(auth);

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
      can_approve_as_doctor: params.can_approve_as_doctor === true,
    })
    .select("id, username, display_name, role_id, is_active, last_login_at, created_at, can_approve_as_doctor")
    .single();

  if (error) {
    if (error.code === "23505") return json({ error: "Username already exists" }, 409);
    return json({ error: error.message }, 500);
  }
  return json({ user: data });
}

async function handleUpdateUser(
  params: {
    user_id: string;
    display_name?: string;
    role_id?: string;
    is_active?: boolean;
    can_approve_as_doctor?: boolean;
    access_token?: string;
  },
  req: Request,
) {
  const auth = await requireUsersAdmin(req, params?.access_token);
  if (auth instanceof Response) return await asLegacyError(auth);

  if (!params.user_id) return json({ error: "user_id required" }, 400);

  const updates: Record<string, any> = {};
  if (params.display_name !== undefined) updates.display_name = params.display_name;
  if (params.role_id !== undefined) updates.role_id = params.role_id || null;
  if (params.is_active !== undefined) updates.is_active = params.is_active;
  if (params.can_approve_as_doctor !== undefined) updates.can_approve_as_doctor = params.can_approve_as_doctor;

  const { error } = await supabase.from("app_users").update(updates).eq("id", params.user_id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

async function handleChangePassword(
  { user_id, current_password, new_password, access_token }: {
    user_id: string;
    current_password: string;
    new_password: string;
    access_token?: string;
  },
  req: Request,
) {
  const auth = await requireStaff(req, access_token);
  if (auth instanceof Response) return auth;
  if (auth.sub !== user_id) return json({ error: "Forbidden" }, 403);

  if (!user_id || !current_password || !new_password) return json({ error: "user_id, current_password, and new_password required" }, 400);
  if (new_password.length < 4) return json({ error: "New password must be at least 4 characters" }, 400);

  const { data: user, error } = await supabase
    .from("app_users")
    .select("id, password_hash")
    .eq("id", user_id)
    .maybeSingle();

  if (error || !user) return json({ error: "User not found" }, 404);

  const valid = await verifyPassword(current_password, user.password_hash);
  if (!valid) return json({ error: "Current password is incorrect" }, 401);

  const hash = await hashPassword(new_password);
  const { error: updateErr } = await supabase.from("app_users").update({ password_hash: hash }).eq("id", user_id);
  if (updateErr) return json({ error: updateErr.message }, 500);
  return json({ success: true });
}

async function handleInitAdminPassword(
  { password, init_secret }: { password: string; init_secret?: string },
  req: Request,
) {
  // Locked down: require INIT_ADMIN_SECRET env match (one-time bootstrap), not open to anon.
  const expected = Deno.env.get("INIT_ADMIN_SECRET") || "";
  if (!expected || !init_secret || init_secret !== expected) {
    return json({ error: "Forbidden" }, 403);
  }
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

/** Legacy Users UI only checked `data.error`, not HTTP status — always surface auth failures in JSON body with 200. */
async function asLegacyError(res: Response): Promise<Response> {
  try {
    const body = await res.json();
    return json({ error: body?.error || "Unauthorized" }, 200);
  } catch {
    return json({ error: "Unauthorized" }, 200);
  }
}
