/**
 * Supabase caps every SELECT at 1000 rows by default. For the LIMS technical
 * queues (Results Entry, Verification, Doctor Approval, Dispatch) the joined
 * `patient_results` / `outsourced_test_snips` rowcount across the visible page
 * of registrations can easily exceed that cap — silently dropping result rows
 * for the oldest registrations on the page and making whole tests appear
 * "Registered / no entry" when in fact they're already approved.
 *
 * `fetchAllByIds` runs the same `.in("<col>", ids)` query in chunks of 1000
 * rows using `.range()`, so we are guaranteed to get every row regardless of
 * how many results that page of registrations has.
 */
import { supabase } from "@/integrations/supabase/client";

const PAGE = 1000;

export async function fetchAllByIds<T = any>(
  table: string,
  select: string,
  column: string,
  ids: string[],
): Promise<T[]> {
  if (!ids || ids.length === 0) return [];
  const out: T[] = [];
  let from = 0;
  // Loop until a page returns less than PAGE rows.
  while (true) {
    const { data, error } = await (supabase as any)
      .from(table)
      .select(select)
      .in(column, ids)
      // Stable ordering is mandatory with offset/range pagination. Without it,
      // PostgREST may return rows in a different physical order on each page,
      // causing intermittent skipped/duplicated rows in Dispatch/Results queues.
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}
