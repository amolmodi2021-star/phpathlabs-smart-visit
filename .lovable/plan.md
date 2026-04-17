

## Goal
Restructure the **Code Mapping** tab in `/lims-demo` into 4 sections, adding a new **No Map Required** ignore-list with two-way transfer to **Unmapped Results**. The edge function must respect this ignore list so flagged machine codes are silently dropped (not re-inserted into `lims_unmapped_results`) on every future submission.

## 4 sections (in order, on Code Mapping tab)
1. **Unmapped Results** — existing card, but excludes any row whose `machine_code` exists in the ignore list. Adds a new per-row button: **"No Map Required"** → moves that machine code to section 4.
2. **Add Mapping Manually** — unchanged.
3. **Code Mappings** (the existing "Mapped Codes") — unchanged.
4. **No Map Required** (NEW) — table of ignored machine codes with columns: Machine Code, Machine ID, Added At, Action. Action = **"Move to Unmapped Results"** button (vice versa).

## DB — new table
New migration creates `lims_no_map_required`:
- `id uuid pk default gen_random_uuid()`
- `machine_code text not null`
- `machine_id text default ''` (kept for parity with code-mapping rows; matching is by `machine_code` only — same convention as the mapping reverse-lookup which already ignores machine_id)
- `created_at timestamptz default now()`
- Unique constraint on `machine_code` (one ignore entry per code, applies to all machines)
- RLS: enable, plus "Anyone can view/insert/delete" policies (matches existing permissive policies on `lims_code_mapping` / `lims_unmapped_results`)

## Behavior
**Mark as No Map Required (from Unmapped Results row):**
1. Insert `{machine_code, machine_id}` into `lims_no_map_required` (ignore conflict on duplicate).
2. Soft-resolve every existing unmapped row with the same `machine_code` by setting `is_resolved = true` (so they disappear from the section).
3. Toast: "Code <X> marked as No Map Required".

**Move back to Unmapped Results (from No Map Required row):**
1. Delete the row from `lims_no_map_required`.
2. Toast: "Code <X> moved back. Future submissions of this code will appear in Unmapped Results."
3. Note: historical rows already soft-resolved are not resurrected — only future submissions reappear. (Acceptable & consistent with how dispatch-removed orders work.)

**Edge function (`supabase/functions/lims-interface/index.ts`) — POST `results`:**
- After classifying mapped vs unmapped, fetch `lims_no_map_required.machine_code` for the incoming codes once.
- Drop any `unmappedRows` whose `machine_code` is in the ignore set **before** inserting into `lims_unmapped_results`.
- Response counters: add `ignored: N` alongside existing `mapped` / `unmapped`.
- Mapped rows are unaffected (if a code is later mapped, mapping wins).

**Frontend filter (defense in depth):**
- The `unmappedResults` query also excludes any row whose `machine_code` is present in the loaded `noMapRequired` list, so the section is clean even if a stale row exists.

## Files
- New migration — create `lims_no_map_required` + RLS policies.
- `src/pages/LimsDemo.tsx` — new query `noMapRequired`, new realtime channel, two new mutations (`markNoMapRequired`, `unmarkNoMapRequired`), per-row "No Map Required" button in Unmapped Results, new 4th `<Card>` for the ignore list, client-side filter on `unmappedResults`.
- `supabase/functions/lims-interface/index.ts` — fetch ignore list, skip ignored codes from `unmappedRows` insert, return `ignored` count.

## Out of scope
- Logs, Orders & Results, API Reference tabs — untouched.
- Existing mapping logic (1:N machine_code → param mappings, auto-resolve siblings) — untouched.
- No password gate on these toggles (mirrors existing free-form mapping add/delete on the same page).

