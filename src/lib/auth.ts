import { supabase, setStoredAccessToken } from "@/integrations/supabase/client";

const AUTH_KEY = "ph_pathlabs_auth";
const USER_KEY = "ph_pathlabs_user";
const EPOCH_KEY = "ph_pathlabs_auth_epoch";
const EPOCH_SETTING_KEY = "auth_epoch";

export interface AppUser {
  id: string;
  username: string;
  display_name: string;
  role_id: string | null;
  permissions: Record<string, any>;
}

export function isAuthenticated(): boolean {
  return localStorage.getItem(AUTH_KEY) === "true";
}

export function getCurrentUser(): AppUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getCurrentUserName(): string | null {
  const user = getCurrentUser();
  return user?.display_name || user?.username || null;
}

export function getUserPermissions(): Record<string, any> {
  const user = getCurrentUser();
  return user?.permissions?.tabs || {};
}

export function isTabAllowed(route: string): boolean {
  const tabs = getUserPermissions();
  // Default-deny: empty permissions means no tabs (roles must grant explicitly)
  if (Object.keys(tabs).length === 0) return false;
  const perm = tabs[route];
  if (perm === undefined) return false;
  if (typeof perm === "boolean") return perm;
  if (typeof perm === "object" && perm !== null) return perm.enabled === true;
  return false;
}

export function getAllowedSections(route: string): string[] | null {
  const tabs = getUserPermissions();
  if (Object.keys(tabs).length === 0) return [];
  if (!isTabAllowed(route)) return [];
  const perm = tabs[route];
  if (typeof perm === "object" && perm !== null && Array.isArray(perm.sections)) {
    return perm.sections;
  }
  return null; // null means all sections allowed for an enabled tab
}

export function isActionAllowed(actionKey: string): boolean {
  const user = getCurrentUser();
  const actions = user?.permissions?.actions || {};
  // Default-deny: empty actions means none allowed
  if (Object.keys(actions).length === 0) return false;
  return actions[actionKey] === true;
}

export function getFirstAllowedRoute(): string {
  const tabs = getUserPermissions();
    const allRoutes = ["/", "/dashboard", "/home-visits", "/phlebotomists", "/tests", "/templates",
      "/abnormal-history", "/phlebo-dashboard", "/loyalty-cards", "/marketing", "/crm", "/lims",
      "/whatsapp-webhook", "/whatsapp-settings", "/whatsapp-chat", "/lims-demo", "/report-layout", "/signature-management", "/users", "/cloud-usage", "/report-analytics"];
  for (const r of allRoutes) {
    if (isTabAllowed(r)) return r;
  }
  return "/";
}

export async function login(userId: string, password: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("user-auth", {
      body: { action: "login", username: userId, password },
    });

    if (error) return { success: false, error: "Login failed. Please try again." };
    if (data?.error) return { success: false, error: data.error };
    if (!data?.user) return { success: false, error: "Invalid credentials." };
    if (!data?.access_token) {
      return { success: false, error: "Login succeeded but no access token was issued. Contact admin." };
    }

    setStoredAccessToken(data.access_token);
    localStorage.setItem(AUTH_KEY, "true");
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    // Stamp this session with the current global auth epoch so it survives global logouts issued before now.
    try {
      const epoch = await fetchAuthEpoch();
      localStorage.setItem(EPOCH_KEY, epoch);
    } catch {}
    return { success: true };
  } catch {
    return { success: false, error: "Network error. Please try again." };
  }
}

export function logout() {
  setStoredAccessToken(null);
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(EPOCH_KEY);
}

// ===================== Global "force everyone out" =====================
// All sessions store the current value of app_settings.auth_epoch. Bumping it
// invalidates every active session on every device on the next epoch check.

async function fetchAuthEpoch(): Promise<string> {
  const { data } = await supabase
    .from("app_settings")
    .select("setting_value")
    .eq("setting_key", EPOCH_SETTING_KEY)
    .maybeSingle();
  return (data?.setting_value as string) || "0";
}

export async function bumpAuthEpoch(): Promise<void> {
  const newEpoch = String(Date.now());
  // Try update first, fall back to insert if the row doesn't exist yet.
  const { data: existing } = await supabase
    .from("app_settings")
    .select("id")
    .eq("setting_key", EPOCH_SETTING_KEY)
    .maybeSingle();
  if (existing?.id) {
    await supabase
      .from("app_settings")
      .update({ setting_value: newEpoch, updated_at: new Date().toISOString() })
      .eq("setting_key", EPOCH_SETTING_KEY);
  } else {
    await supabase
      .from("app_settings")
      .insert({ setting_key: EPOCH_SETTING_KEY, setting_value: newEpoch });
  }
}

/**
 * Compares the locally-stamped epoch against the server. If they differ, this
 * session was invalidated by an admin "Logout All Users" action — clear local
 * auth and resolve with `true` so the caller can redirect to /login.
 */
export async function checkAuthEpochAndLogoutIfStale(): Promise<boolean> {
  if (!isAuthenticated()) return false;
  try {
    const serverEpoch = await fetchAuthEpoch();
    const localEpoch = localStorage.getItem(EPOCH_KEY) || "0";
    if (serverEpoch !== localEpoch) {
      logout();
      return true;
    }
  } catch {
    // Network issue — don't kick the user out on transient failure.
  }
  return false;
}

export const PERMISSIONS_UPDATED_EVENT = "ph:permissions-updated";

let refreshInFlight: Promise<AppUser | null> | null = null;

export async function refreshCurrentUserPermissions(): Promise<AppUser | null> {
  const current = getCurrentUser();
  if (!current?.id) return null;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const { data: userRow, error: uErr } = await supabase
        .from("app_users")
        .select("id, username, display_name, role_id, is_active")
        .eq("id", current.id)
        .maybeSingle();
      if (uErr || !userRow || userRow.is_active === false) return current;

      let permissions: Record<string, any> = {};
      if (userRow.role_id) {
        const { data: roleRow } = await supabase
          .from("app_roles")
          .select("permissions")
          .eq("id", userRow.role_id)
          .maybeSingle();
        permissions = (roleRow?.permissions as any) || {};
      }

      const refreshed: AppUser = {
        id: userRow.id,
        username: userRow.username,
        display_name: userRow.display_name || userRow.username,
        role_id: userRow.role_id,
        permissions,
      };

      const prevJson = JSON.stringify(current);
      const nextJson = JSON.stringify(refreshed);
      if (prevJson !== nextJson) {
        localStorage.setItem(USER_KEY, nextJson);
        try {
          window.dispatchEvent(new CustomEvent(PERMISSIONS_UPDATED_EVENT));
        } catch {}
      }
      return refreshed;
    } catch {
      return current;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}
