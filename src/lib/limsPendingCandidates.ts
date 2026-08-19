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

export async function fetchVerificationCandidateIds(): Promise<string[]> {
  return rpcUuidArray("lims_verification_candidate_ids");
}

export async function fetchDoctorApprovalCandidateIds(): Promise<string[]> {
  return rpcUuidArray("lims_doctor_approval_candidate_ids");
}

export async function fetchResultsEntryCandidateIds(): Promise<string[]> {
  return rpcUuidArray("lims_results_entry_candidate_ids");
}

/** Results Machine Wise: pending enterable params for one instrument ("" = Others). */
export async function fetchResultsEntryMachineCandidateIds(instrument: string): Promise<string[]> {
  return rpcUuidArray("lims_results_entry_machine_candidate_ids", {
    p_instrument: instrument || null,
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
