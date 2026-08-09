/**
 * Supabase caps every SELECT at 1000 rows by default. For the LIMS technical
 * queues (Results Entry, Verification, Doctor Approval, Dispatch) the joined
 * `patient_results` / `outsourced_test_snips` rowcount across the visible page
 * of registrations can easily exceed that cap — silently dropping result rows.
 *
 * Additionally, a single `.in(col, ids)` with hundreds of UUIDs exceeds the
 * PostgREST URL length limit (HTTP 414). Both ID-batching and row pagination
 * are required.
 */
import { supabase } from "@/integrations/supabase/client";

const PAGE = 1000;
const ID_CHUNK = 100;

export async function fetchAllByIds<T = any>(
  table: string,
  select: string,
  column: string,
  ids: string[],
  filters?: { eq?: Record<string, string | number | boolean | null>; in?: Record<string, (string | number)[]> },
): Promise<T[]> {
  if (!ids || ids.length === 0) return [];
  const out: T[] = [];
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));

  for (let i = 0; i < uniqueIds.length; i += ID_CHUNK) {
    const chunk = uniqueIds.slice(i, i + ID_CHUNK);
    let from = 0;
    while (true) {
      let q = (supabase as any)
        .from(table)
        .select(select)
        .in(column, chunk)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (filters?.eq) {
        for (const [k, v] of Object.entries(filters.eq)) {
          q = q.eq(k, v);
        }
      }
      if (filters?.in) {
        for (const [k, v] of Object.entries(filters.in)) {
          q = q.in(k, v);
        }
      }
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data || []) as T[];
      out.push(...rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  }
  return out;
}
