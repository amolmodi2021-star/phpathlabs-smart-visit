

# Fix "RENDER FAILED" status during high-concurrency sends

## Why it happens

Every "render failed" message comes from `generateAndUploadCard()` (or its abnormal-card twin in `dripCardSenders.ts`) returning `null`. Three concrete failure modes show up under concurrency 10:

1. **Filename collisions in storage.** Both renderers pick file names like:
   ```
   generated/crm/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg
   ```
   That's a millisecond timestamp + only **4** random base36 chars (~1.7 million combinations). With 10 workers uploading inside the same millisecond, birthday-paradox collisions happen often. Supabase Storage rejects the duplicate (`The resource already exists`), the renderer catches it, returns `null`, and the UI prints "render failed".
2. **Transient storage errors.** Any 5xx, network blip, or rate-limit response from Supabase Storage during `.upload(...)` aborts the render with no retry — single failure = "render failed".
3. **`canvas.toBlob` returning null** under brief memory pressure (many canvases in flight) — also a single-shot failure with no retry.

None of these are "the render is broken" — they're all single transient errors with no retry/backoff.

## What you'll see after the fix

1. "Render failed" disappears from normal operation. You'll only see it for genuine, persistent errors (e.g. malformed template, network down for 10+ seconds).
2. Total throughput at concurrency=10, delay=0 is unchanged or slightly better (failed records no longer waste a slot).
3. Failures that *do* occur are logged with the specific reason (`upload_collision`, `upload_5xx`, `toblob_null`) in `drip_action_log` so they're debuggable instead of opaque.
4. No behaviour change for sequential / low-concurrency sends.

## Technical changes

### 1. Stronger unique filenames (`src/lib/cardRenderer.ts`, `src/lib/dripCardSenders.ts`)

Replace the weak `Date.now() + 4 base36 chars` with a collision-proof name using `crypto.randomUUID()`:

```typescript
const fileName = `generated/crm/${Date.now()}_${crypto.randomUUID()}.jpg`;
```

`crypto.randomUUID()` is available in every modern browser, gives 122 bits of entropy, and makes collisions effectively impossible even at 1000 parallel uploads.

### 2. Bounded retry around `toBlob` + `upload` (both renderers)

Wrap the export + upload in a small retry helper (3 attempts, 250 ms / 750 ms backoff):

```typescript
async function uploadWithRetry(blobFn: () => Promise<Blob>, path: string): Promise<void> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const blob = await blobFn();                         // re-encodes if first toBlob returned null
      const { error } = await supabase.storage
        .from("loyalty-cards")
        .upload(path, blob, { contentType: "image/jpeg" });
      if (!error) return;
      lastErr = error;
      // Collision → mint a new path and retry; transient → just retry same path
      if (String(error.message || "").toLowerCase().includes("exist")) {
        path = path.replace(/[^/]+\.jpg$/, `${Date.now()}_${crypto.randomUUID()}.jpg`);
      }
    } catch (e) { lastErr = e; }
    await new Promise(r => setTimeout(r, 250 * Math.pow(3, attempt)));   // 250ms, 750ms
  }
  throw lastErr ?? new Error("upload_failed");
}
```

Same pattern is used inside `generateAndUploadCard` (ABC) and inside the abnormal-card sender in `src/lib/dripCardSenders.ts`.

### 3. Better failure reasons in the diagnostic log (`src/components/marketing/AutomatedMarketing.tsx`)

Currently every render failure logs the same generic `card_generation_error`. Make `generateAndUploadCard` and the abnormal sender throw / return a tagged reason (`upload_collision`, `upload_5xx`, `toblob_null`, `template_load_error`) so the drip action log captures *why* it failed. The UI status string stays user-friendly ("render failed"), but the underlying log row is now useful for future debugging.

### 4. No changes to

- Worker-pool / pipeline structure in `AutomatedMarketing.tsx` — already correct.
- `marketingDelay.ts`, `useRealtimeSync.ts`, edge functions, DB schema, storage RLS, cron jobs.

### Files changed

- `src/lib/cardRenderer.ts` — UUID filenames, `uploadWithRetry`, tagged error reasons.
- `src/lib/dripCardSenders.ts` — same three changes for the abnormal-card path.
- `src/components/marketing/AutomatedMarketing.tsx` — pass the tagged reason into `logDripAction(filter, r, "failed", reason)` for both ABC and Abnormal branches.

## Verification

1. Send 200 ABC cards at concurrency=10, delay=0 → no "render failed" in the status bar; `drip_action_log` shows 200 `success` rows.
2. Manually point the storage URL at a bad host for 1 second mid-run → those records succeed on retry attempt 2 or 3 instead of failing.
3. Force a duplicate filename (debug toggle) → the helper renames and succeeds; no failure surfaces.
4. Disconnect storage entirely for >2 s → record fails after 3 retries with `upload_5xx` reason in the log; campaign continues with the rest.
5. Concurrency=1, delay=3000 → identical behaviour to today.

