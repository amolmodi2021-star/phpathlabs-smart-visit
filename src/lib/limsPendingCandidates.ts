/**
 * LIMS pending-candidate id resolvers (server-side RPCs).
 * See supabase/migrations/20260808153000_reliability_hardening.sql
 */
import { supabase } from "@/integrations/supabase/client";

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

export async function fetchDispatchCandidateIds(): Promise<string[]> {
  return rpcUuidArray("lims_dispatch_candidate_ids");
}

/** Full Dispatch status board (includes pending + cancelled bills in date range). */
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
