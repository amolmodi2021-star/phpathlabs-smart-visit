

# Fix CRM export dropping rows due to non-unique pagination key

## Root cause

`crm_contacts` has 35,288 rows sharing a `created_at` value with at least one sibling (one cluster has 112 rows on the same timestamp). The export edge function paginates with:

```ts
.order("created_at", { ascending: true }).range(from, from + 999)
```

Postgres does not guarantee stable order for ties, so rows with identical `created_at` get reshuffled between page fetches. Some rows are returned on two consecutive pages, others on none. The total `staged` count looks fine because duplicates compensate for misses, but specific primary keys (e.g. `UMR0021281|9354210076`) silently vanish.

The fix is to add a **unique tiebreaker** (`id`) to the order clause and switch to **keyset pagination**, which is both correct and faster than `range()` on large tables.

## Files to change

### 1. `supabase/functions/export-crm-contacts/index.ts` — primary fix

Replace the `range()` loop with keyset pagination on `(created_at, id)`:

```ts
let lastCreatedAt: string | null = null;
let lastId: string | null = null;

while (true) {
  let q = supabase
    .from("crm_contacts")
    .select(SELECT_COLS + ",id")          // need id for keyset
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })     // unique tiebreaker
    .limit(BATCH);

  // filters (location / tag / search) unchanged

  if (lastCreatedAt && lastId) {
    // rows strictly after the last (created_at, id) pair
    q = q.or(
      `created_at.gt.${lastCreatedAt},and(created_at.eq.${lastCreatedAt},id.gt.${lastId})`
    );
  }

  const { data, error } = await q;
  if (error) throw error;
  if (!data || data.length === 0) break;

  for (const row of data) {
    controller.enqueue(encoder.encode(
      COLUMNS.map((c) => csvEscape((row as any)[c.key])).join(",") + "\n"
    ));
  }

  total += data.length;
  if (data.length < BATCH) break;
  const last = data[data.length - 1] as any;
  lastCreatedAt = last.created_at;
  lastId = last.id;
}
```

Notes:
- `created_at` is already in `SELECT_COLS` indirectly? No — it's not. Add `created_at` and `id` to the select list (they're needed for the cursor) but exclude them from the CSV output (the existing `COLUMNS` array drives output, so they're naturally ignored).
- BATCH stays at 1000.
- No DB index change needed; `(created_at, id)` is well-indexable and the pattern works on the existing primary-key index for tiebreaking.

### 2. `src/components/crm/CRMImport.tsx` — same bug, same fix

The "fetch ALL existing contacts" loop (lines ~118–135) uses identical `.order("created_at").range()` pagination. With 35K+ rows containing duplicate timestamps, the existing-records map is incomplete, so:
- Some real updates are misclassified as new inserts
- `is_update` flag in staging is wrong for affected rows
- Bill-number "newer than existing" check silently passes when it shouldn't

Apply the same keyset-pagination fix to that loop. Select adds `id` alongside `primary_key, bill_number, created_at`.

### 3. (Optional, no-op) Verification query for the user

After deploy, the user can re-run the export and confirm:
```sql
SELECT COUNT(DISTINCT primary_key) FROM crm_contacts;  -- should match CSV row count
```

## Why the row count looked right (35,293) before

Each duplicate-timestamp cluster causes an equal number of double-counted rows and skipped rows on average, so `total` in the streamer hits ~35K and the "complete" toast fires. The bug is **silent data loss**, not a count mismatch.

## Risk

Low. Keyset pagination is a strict superset of correctness vs. `range()` on tied keys. No schema change, no migration, two file edits, fully reversible.

## Verification after deploy

1. Export CSV from CRM → Contacts.
2. Open CSV, search for `UMR0021281|9354210076` → must be present.
3. `wc -l export.csv` should equal `35293 + 1` (header).
4. `cut -d',' -f1 export.csv | sort -u | wc -l` should equal `35294` (all primary keys unique + header).
5. Run a fresh CRM Import on a small file → verify `is_update` count matches expectations for known-existing records.

