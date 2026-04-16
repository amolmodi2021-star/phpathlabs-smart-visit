
## Plan: Aggregate Tests Across All Sample Tubes for Same Sample ID

### Behaviour
- Query `{sample_id: "2604160004", machine_id: "Indiko"}` → fetch orders for ALL tubes whose `sample_id` matches `2604160004` exactly OR starts with `2604160004` followed by a letter suffix (e.g. `2604160004A`, `2604160004B`, `2604160004F`). Return Indiko-assigned tests merged across all those tubes.
- Query `{sample_id: "2604160004A", machine_id: "Indiko"}` → fetch ONLY orders where `sample_id = "2604160004A"` (exact match, no aggregation).
- `machine_id` filtering rule unchanged: when provided, filter to that machine + universal tests; when absent, return all enriched tests.

### Detection Rule
- "Without suffix" = `sample_id` ends in a digit (no trailing letter). → match `sample_id = X` OR `sample_id LIKE 'X[A-Za-z]'` (where the next char is a letter).
- "With suffix" = `sample_id` ends in a letter. → exact match only.

### Fix — `supabase/functions/lims-interface/index.ts` (GET handler only)

**1. Detect suffix and build query accordingly:**
```ts
const hasSuffix = /[A-Za-z]$/.test(sampleId);

let ordersQuery = supabase
  .from("lims_test_orders")
  .select("*")
  .in("status", ["pending", "in_progress"]);

if (hasSuffix) {
  // Exact match only
  ordersQuery = ordersQuery.eq("sample_id", sampleId);
} else {
  // Match base OR base + single-letter suffix variants
  // Use OR with eq + like pattern that matches a letter after base
  ordersQuery = ordersQuery.or(
    `sample_id.eq.${sampleId},sample_id.like.${sampleId}_,sample_id.like.${sampleId}__`
  );
  // Note: `_` matches any single char in LIKE; we'll filter to letters in JS
}

const { data: ordersRaw, error: orderErr } = await ordersQuery
  .order("created_at", { ascending: false });
if (orderErr) throw orderErr;

// Post-filter for "without suffix" case: keep only exact match or base + letter(s)
const orders = hasSuffix
  ? (ordersRaw || [])
  : (ordersRaw || []).filter((o: any) => {
      const sid = o.sample_id || "";
      if (sid === sampleId) return true;
      const tail = sid.slice(sampleId.length);
      return tail.length > 0 && /^[A-Za-z]+$/.test(tail);
    });
```

**2. Merge pending tests across all matching orders:**
```ts
const allPendingTests: any[] = [];
for (const ord of orders) {
  const tests = (ord.tests as any[]) || [];
  for (const t of tests) {
    if (t.status !== "completed") allPendingTests.push(t);
  }
  if (ord.status === "pending") {
    await supabase.from("lims_test_orders").update({ status: "in_progress" }).eq("id", ord.id);
  }
}
```

**3. Existing enrichment + machine_id filter operates on the merged `allPendingTests`** — no changes to that downstream logic.

**4. Response** — primary `order_id` / `patient_name` taken from the most recent order; `sample_id` echoed as queried. `tests` is the merged + filtered list.

### POST flow
Unchanged. Result submission still targets the exact `sample_id` provided by the analyzer.

### File
- `supabase/functions/lims-interface/index.ts` — GET handler only

### No DB / schema / other changes
