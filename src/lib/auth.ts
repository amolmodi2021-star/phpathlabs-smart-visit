import { supabase } from "@/integrations/supabase/client";

const AUTH_KEY = "ph_pathlabs_auth";
const USER_KEY = "ph_pathlabs_user";

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

export function getUserPermissions(): Record<string, any> {
  const user = getCurrentUser();
  return user?.permissions?.tabs || {};
}

export function isTabAllowed(route: string): boolean {
  const tabs = getUserPermissions();
  if (Object.keys(tabs).length === 0) return true; // no restrictions if no permissions set
  const perm = tabs[route];
  if (perm === undefined) return false;
  if (typeof perm === "boolean") return perm;
  if (typeof perm === "object" && perm !== null) return perm.enabled === true;
  return false;
}

export function getAllowedSections(route: string): string[] | null {
  const tabs = getUserPermissions();
  const perm = tabs[route];
  if (typeof perm === "object" && perm !== null && Array.isArray(perm.sections)) {
    return perm.sections;
  }
  return null; // null means all sections allowed
}

export function isActionAllowed(actionKey: string): boolean {
  const user = getCurrentUser();
  const actions = user?.permissions?.actions || {};
  if (Object.keys(actions).length === 0) return true; // no restrictions if no actions set
  return actions[actionKey] === true;
}

export function getFirstAllowedRoute(): string {
  const tabs = getUserPermissions();
  const allRoutes = ["/", "/dashboard", "/home-visits", "/phlebotomists", "/tests", "/templates",
    "/abnormal-history", "/phlebo-dashboard", "/loyalty-cards", "/marketing", "/crm", "/lims",
    "/whatsapp-webhook", "/whatsapp-settings", "/whatsapp-chat", "/lims-demo", "/report-layout", "/signature-management", "/users"];
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

    localStorage.setItem(AUTH_KEY, "true");
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    return { success: true };
  } catch {
    return { success: false, error: "Network error. Please try again." };
  }
}

export function logout() {
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(USER_KEY);
}
