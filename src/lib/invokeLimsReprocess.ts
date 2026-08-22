import { supabase, getStoredAccessToken } from "@/integrations/supabase/client";

type ReprocessBody = {
  action: "reprocess";
  registration_id?: string;
};

/**
 * Call lims-interface reprocess with the staff JWT explicitly attached.
 * Relies on x-ph-access-token (not PostgREST Authorization) so anon-key
 * Bearer JWTs are not mistaken for staff sessions.
 */
export async function invokeLimsReprocess(registrationId?: string): Promise<{
  data: any;
  errorMessage: string | null;
}> {
  const token = getStoredAccessToken();
  if (!token) {
    return {
      data: null,
      errorMessage: "Session expired — please log out and sign in again, then retry Refresh.",
    };
  }

  const body: ReprocessBody = { action: "reprocess" };
  if (registrationId) body.registration_id = registrationId;

  const { data, error } = await supabase.functions.invoke("lims-interface", {
    body,
    headers: { "x-ph-access-token": token },
  });

  if (!error) return { data, errorMessage: null };

  let detail = "";
  try {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const parsed = await ctx.json();
      detail = String(parsed?.error || parsed?.message || "").trim();
    }
  } catch {
    /* ignore body parse */
  }

  const raw = detail || error.message || "Failed to refresh from LIMS";
  if (/unauthor/i.test(raw) || /non-2xx/i.test(raw)) {
    return {
      data: null,
      errorMessage: "Session expired — please log out and sign in again, then retry Refresh.",
    };
  }
  return { data: null, errorMessage: raw };
}
