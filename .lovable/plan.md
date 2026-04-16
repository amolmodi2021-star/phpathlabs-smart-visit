
## Plan: Aggregate Only Across Tubes With Identical Sample ID

### Behaviour
- Query `sample_id = "2604160004"` → fetch ALL `lims_test_orders` rows where `sample_id = "2604160004"` exactly (could be 2+ tubes sharing the same ID for different sample types like Plasma/Serum). Merge their pending tests.
- Query `sample_id = "2604160004A"` → fetch ALL rows where `sample_id = "2604160004A"` exactly. Merge if multiple.
- NEVER cross between `2604160004` and `2604160004A` — they are different sample IDs.
- Machine ID filter unchanged.

### Fix — `supabase/functions/lims-interface/index.ts` (GET handler)

Replace the current suffix-detection + LIKE-pattern block with a single exact-match query. The downstream loop already iterates over multiple orders and merges their tests, so multi-tube aggregation for identical sample IDs continues to work naturally.

```ts
const { data: orders, error: orderErr } = await supabase
  .from("lims_test_orders")
  .select("*")
  .eq("sample_id", sampleId)
  .in("status", ["pending", "in_progress"])
  .order("created_at", { ascending: false });
if (orderErr) throw orderErr;
```

Remove:
- `hasSuffix` regex detection
- `.or(...)` LIKE patterns (`sampleId_`, `sampleId__`)
- post-filter that retained base + letter-suffix variants

Keep unchanged:
- Merge loop across `orders` (handles 2+ tubes with same sample_id)
- `pending` → `in_progress` status update per order
- Enrichment via `lims_code_mapping`
- Machine ID filter (case-insensitive; universal tests included)
- Response shape (primary order metadata + merged tests)

### POST flow
Unchanged.

### File
- `supabase/functions/lims-interface/index.ts` — GET handler only

### No DB / schema / other changes
