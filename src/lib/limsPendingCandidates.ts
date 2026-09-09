/**
 * LIMS pending-candidate id resolvers (server-side RPCs).
 * See supabase/migrations/20260808153000_reliability_hardening.sql
 * Dispatch filters: 20260815010000_dispatch_list_filter_modes.sql
 */
import { supabase } from "@/integrations/supabase/client";

export type DispatchListMode = "all" | "pending_dispatch" | "all_approved" | "partially_approved";

async function rpcUuidArray(fn: string, args: Record<string, any> = {}): Promise<string[]> {
  const { data, error } = await (supabase as any).rpc(fn, args);
  if (error) throw error;
  if (!data) return [];
  if (Array.isArray(data)) return data.map(String);
  return [];
}

export async function fetchVerificationCandidateIds(includeOlder = false): Promise<string[]> {
  return rpcUuidArray("lims_verification_candidate_ids", { p_include_older: includeOlder });
}

/** Verification Machine Wise: pending verifyable work for one instrument ("" = Others). */
export async function fetchVerificationMachineCandidateIds(
  instrument: string,
  includeOlder = false,
): Promise<string[]> {
  try {
    return await rpcUuidArray("lims_verification_machine_candidate_ids", {
      p_instrument: instrument || null,
      p_include_older: includeOlder,
    });
  } catch (err: any) {
    // RPC not deployed yet (PGRST202) — fall back to client filter so Machine Wise still works.
    const msg = String(err?.message || err || "");
    if (!/PGRST202|does not exist|not find|schema cache/i.test(msg)) throw err;
    return fetchVerificationMachineCandidateIdsClient(instrument, includeOlder);
  }
}

/** Client fallback: same instrument match as the RPC, scoped to verification-pending rows. */
async function fetchVerificationMachineCandidateIdsClient(
  instrument: string,
  includeOlder = false,
): Promise<string[]> {
  const want = String(instrument || "").trim();
  const { data: tests, error: testsErr } = await supabase.from("tests").select("id, instrument_name");
  if (testsErr) throw testsErr;
  const machineTestIds = new Set(
    (tests || [])
      .filter((t: any) => {
        const inst = String(t.instrument_name || "").trim();
        return want === "" ? inst === "" : inst === want;
      })
      .map((t: any) => String(t.id)),
  );
  if (machineTestIds.size === 0) return [];

  const candidates = await fetchVerificationCandidateIds(includeOlder);
  if (candidates.length === 0) return [];

  const allow = new Set<string>();
  const chunk = 80;
  for (let i = 0; i < candidates.length; i += chunk) {
    const ids = candidates.slice(i, i + chunk);
    const [{ data: results, error: rErr }, { data: snips, error: sErr }] = await Promise.all([
      supabase
        .from("patient_results")
        .select("registration_id, test_id")
        .in("registration_id", ids)
        .in("status", ["entered", "results_entered"]),
      supabase
        .from("outsourced_test_snips")
        .select("registration_id, test_id")
        .in("registration_id", ids)
        .in("outsource_status", ["entered", "results_entered"]),
    ]);
    if (rErr) throw rErr;
    if (sErr) throw sErr;
    for (const row of results || []) {
      if (machineTestIds.has(String((row as any).test_id))) allow.add(String((row as any).registration_id));
    }
    for (const row of snips || []) {
      if (machineTestIds.has(String((row as any).test_id))) allow.add(String((row as any).registration_id));
    }
  }
  return candidates.filter((id) => allow.has(id));
}

export async function fetchDoctorApprovalCandidateIds(includeOlder = false): Promise<string[]> {
  return rpcUuidArray("lims_doctor_approval_candidate_ids", { p_include_older: includeOlder });
}

export async function fetchResultsEntryCandidateIds(includeOlder = false): Promise<string[]> {
  return rpcUuidArray("lims_results_entry_candidate_ids", { p_include_older: includeOlder });
}

/** Results Machine Wise: pending enterable params for one instrument ("" = Others). */
export async function fetchResultsEntryMachineCandidateIds(
  instrument: string,
  includeOlder = false,
): Promise<string[]> {
  return rpcUuidArray("lims_results_entry_machine_candidate_ids", {
    p_instrument: instrument || null,
    p_include_older: includeOlder,
  });
}

export async function fetchDispatchCandidateIds(): Promise<string[]> {
  return rpcUuidArray("lims_dispatch_candidate_ids");
}

/** Full Dispatch date-range board (lean list). */
export async function fetchDispatchStatusIds(
  search: string,
  opts: { dateFromIso?: string; dateToIso?: string } = {},
): Promise<string[]> {
  return rpcUuidArray("lims_dispatch_status_ids", {
    p_search: search || null,
    p_date_from: opts.dateFromIso || null,
    p_date_to: opts.dateToIso || null,
  });
}

/** Dispatch list filter modes (pending / all-approved / partially-approved / all). */
export async function fetchDispatchFilterIds(
  mode: DispatchListMode,
  search: string,
  opts: { dateFromIso?: string; dateToIso?: string } = {},
): Promise<string[]> {
  return rpcUuidArray("lims_dispatch_filter_ids", {
    p_mode: mode,
    p_search: search || null,
    p_date_from: opts.dateFromIso || null,
    p_date_to: opts.dateToIso || null,
  });
}

/** @deprecated Prefer fetchDispatchFilterIds('pending_dispatch', ...) */
export async function fetchDispatchPendingDispatchIds(
  search: string,
  opts: {
    dateFromIso?: string;
    dateToIso?: string;
    includeOlder?: boolean;
  } = {},
): Promise<string[]> {
  return fetchDispatchFilterIds("pending_dispatch", search, {
    dateFromIso: opts.includeOlder ? undefined : opts.dateFromIso,
    dateToIso: opts.dateToIso,
  });
}

export async function fetchOutsourcedCandidateIds(): Promise<string[]> {
  return rpcUuidArray("lims_outsourced_candidate_ids");
}

export async function fetchFilteredSortedIds(
  candidateIds: string[],
  search: string,
  opts: { dateFromIso?: string; dateToIso?: string } = {},
): Promise<string[]> {
  if (!candidateIds.length) return [];
  return rpcUuidArray("lims_filter_sort_registration_ids", {
    p_ids: candidateIds,
    p_search: search || null,
    p_date_from: opts.dateFromIso || null,
    p_date_to: opts.dateToIso || null,
  });
}
