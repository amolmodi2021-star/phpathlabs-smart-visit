/**
 * LIMS pending-candidate id resolvers.
 *
 * Each technical-queue tab (Results Entry, Result Verification, Doctor Approval)
 * shows registrations where work is actually pending at that stage. The page
 * row in patient_registrations cannot tell us this on its own — its `status`
 * column is a coarse rollup that includes plenty of "partial_*" rows where the
 * remaining pending tests live in another stage. So the queue's pagination must
 * be computed from the downstream tables.
 *
 * Each helper returns a deduped array of registration_ids that have at least
 * one pending row at the given stage. Callers then intersect with the search
 * filter and slice the result for the visible page.
 */
import { supabase } from "@/integrations/supabase/client";

const PAGE = 1000;

async function fetchAllRows<T = any>(
  builderFactory: () => any,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await builderFactory()
      .order("registration_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

/** Verification: entered patient_results or results_entered/entered outsourced snips. */
export async function fetchVerificationCandidateIds(): Promise<string[]> {
  const ids = new Set<string>();
  const r1 = await fetchAllRows<any>(() =>
    supabase.from("patient_results").select("registration_id").eq("status", "entered"),
  );
  r1.forEach((x) => x?.registration_id && ids.add(x.registration_id));
  const r2 = await fetchAllRows<any>(() =>
    supabase
      .from("outsourced_test_snips")
      .select("registration_id")
      .in("outsource_status", ["results_entered", "entered"]),
  );
  r2.forEach((x) => x?.registration_id && ids.add(x.registration_id));
  return Array.from(ids);
}

/** Doctor Approval: verified patient_results or verified outsourced snips. */
export async function fetchDoctorApprovalCandidateIds(): Promise<string[]> {
  const ids = new Set<string>();
  const r1 = await fetchAllRows<any>(() =>
    supabase.from("patient_results").select("registration_id").eq("status", "verified"),
  );
  r1.forEach((x) => x?.registration_id && ids.add(x.registration_id));
  const r2 = await fetchAllRows<any>(() =>
    supabase
      .from("outsourced_test_snips")
      .select("registration_id")
      .eq("outsource_status", "verified"),
  );
  r2.forEach((x) => x?.registration_id && ids.add(x.registration_id));
  return Array.from(ids);
}

/**
 * Results Entry: registrations where at least one accepted-tube test_id has no
 * tracked patient_results row (with a non-empty value or status past 'pending')
 * AND no outsourced snip past 'pending'/'sent'. Mirrors the GUARD in
 * recalculateRegistrationStatus.
 */
export async function fetchResultsEntryCandidateIds(): Promise<string[]> {
  // 1. Pull all accepted tubes (registration_id, test_ids[]).
  const tubes = await fetchAllRows<any>(() =>
    supabase
      .from("sample_tubes" as any)
      .select("registration_id, test_ids")
      .eq("status", "accepted"),
  );
  const acceptedByReg: Record<string, Set<string>> = {};
  tubes.forEach((t: any) => {
    const rid = t?.registration_id;
    if (!rid) return;
    const ids = Array.isArray(t.test_ids) ? t.test_ids : [];
    if (!acceptedByReg[rid]) acceptedByReg[rid] = new Set();
    ids.forEach((id: string) => id && acceptedByReg[rid].add(id));
  });
  const candidateRegIds = Object.keys(acceptedByReg);
  if (candidateRegIds.length === 0) return [];

  // 2. For those regs, pull "tracked" patient_results (test_id with value or
  //    status past 'pending').
  const trackedByReg: Record<string, Set<string>> = {};
  const PASSED = ["entered", "results_entered", "verified", "approved", "dispatched"];
  // Chunk the .in() since candidateRegIds may exceed the 1000-row cap.
  const chunkSize = 500;
  for (let i = 0; i < candidateRegIds.length; i += chunkSize) {
    const chunk = candidateRegIds.slice(i, i + chunkSize);
    const rs = await fetchAllRows<any>(() =>
      supabase
        .from("patient_results")
        .select("registration_id, test_id, status, result_value")
        .in("registration_id", chunk),
    );
    rs.forEach((r: any) => {
      const rid = r?.registration_id;
      const tid = r?.test_id;
      if (!rid || !tid) return;
      // IMPORTANT: do NOT treat hasValue alone as "tracked". Machine-interface /
      // calculated rows arrive with result_value populated but status='pending' —
      // they still require manual Results Entry confirmation. Only rows whose
      // status has actually progressed past 'pending' count as tracked; otherwise
      // the registration silently disappears from every queue (Entry, Verification,
      // Doctor Approval) while CBC etc. sit unsubmitted forever.
      if (PASSED.includes(r.status)) {
        if (!trackedByReg[rid]) trackedByReg[rid] = new Set();
        trackedByReg[rid].add(tid);
      }
    });
    const ss = await fetchAllRows<any>(() =>
      supabase
        .from("outsourced_test_snips")
        .select("registration_id, test_id, outsource_status")
        .in("registration_id", chunk),
    );
    ss.forEach((s: any) => {
      const rid = s?.registration_id;
      const tid = s?.test_id;
      if (!rid || !tid) return;
      if (PASSED.includes(s.outsource_status)) {
        if (!trackedByReg[rid]) trackedByReg[rid] = new Set();
        trackedByReg[rid].add(tid);
      }
    });
  }

  // 3. Keep regs that have at least one accepted-tube test not yet tracked.
  const pending: string[] = [];
  for (const rid of candidateRegIds) {
    const acc = acceptedByReg[rid];
    const tracked = trackedByReg[rid] || new Set<string>();
    let hasUntracked = false;
    for (const tid of acc) {
      if (!tracked.has(tid)) { hasUntracked = true; break; }
    }
    if (hasUntracked) pending.push(rid);
  }
  return pending;
}

/**
 * Dispatch: regs with at least one approved-but-not-yet-dispatched test
 * (patient_results.status='approved' OR outsourced_test_snips.outsource_status='approved').
 * This guarantees partially-dispatched regs stay visible until every approved test
 * is dispatched — they would otherwise hide behind the date+pagination window.
 */
export async function fetchDispatchCandidateIds(): Promise<string[]> {
  const ids = new Set<string>();
  const r1 = await fetchAllRows<any>(() =>
    supabase.from("patient_results").select("registration_id").eq("status", "approved"),
  );
  r1.forEach((x) => x?.registration_id && ids.add(x.registration_id));
  const r2 = await fetchAllRows<any>(() =>
    supabase
      .from("outsourced_test_snips")
      .select("registration_id")
      .eq("outsource_status", "approved"),
  );
  r2.forEach((x) => x?.registration_id && ids.add(x.registration_id));
  return Array.from(ids);
}

/**
 * Given a candidate id set, fetch the subset that matches the search filter
 * and is not bill_cancelled, returning ids sorted by (is_stat desc, invoice_number desc).
 * Chunks the .in() lookup to avoid PostgREST URL/row limits.
 *
 * Optional date range filters by created_at.
 */
export async function fetchFilteredSortedIds(
  candidateIds: string[],
  search: string,
  opts: { dateFromIso?: string; dateToIso?: string } = {},
): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  const chunkSize = 500;
  const rows: { id: string; is_stat: boolean; invoice_number: string }[] = [];
  for (let i = 0; i < candidateIds.length; i += chunkSize) {
    const chunk = candidateIds.slice(i, i + chunkSize);
    let q: any = supabase
      .from("patient_registrations")
      .select("id, is_stat, invoice_number")
      .in("id", chunk)
      .eq("bill_cancelled", false);
    if (opts.dateFromIso) q = q.gte("created_at", opts.dateFromIso);
    if (opts.dateToIso) q = q.lte("created_at", opts.dateToIso);
    if (search) {
      q = q.or(
        `patient_name.ilike.%${search}%,mobile_number.ilike.%${search}%,invoice_number.ilike.%${search}%,umr_number.ilike.%${search}%`,
      );
    }
    const { data, error } = await q;
    if (error) throw error;
    (data || []).forEach((r: any) => rows.push(r));
  }
  rows.sort((a, b) => {
    if (!!b.is_stat !== !!a.is_stat) return b.is_stat ? 1 : -1;
    return (b.invoice_number || "").localeCompare(a.invoice_number || "");
  });
  return rows.map((r) => r.id);
}
