

# Make Automated Marketing send continuously (no batched freezes)

## What you're seeing and why

With concurrency=10 + delay=0, the first 10 messages fire in a flash, then the progress bar freezes for several seconds, then 10 more fire, repeat. 50 messages take 3–4 minutes — about 4 seconds per message — which is far too slow for "no delay" mode.

Two concrete defects in the current code cause this:

1. **All ABC-card workers share ONE canvas.** `getTemplateAssets()` builds a single `<canvas>` + `ctx` object and the worker pool re-uses it. When 10 workers try to render at once they overwrite each other's pixels and serialize on `canvas.toBlob()`, so the "parallel" pool is effectively a queue of one. This is also a correctness bug — under load you can ship a card with another patient's data drawn on top.
2. **Render + upload run inside the worker, blocking the next send.** Each worker does fetch tests → draw card → upload to storage → call WhatsApp → repeat. The WhatsApp call is fast; the render+upload is the slow part (~3–4 s combined). So between bursts of API calls, the entire pool is busy on render+upload — that's the freeze.

There is no need for an Edge Function queue or DB-backed background worker — the freezes are pure client-side pipeline issues that can be fixed in the browser.

## What you'll see after the fix

1. Click Send → progress ticks up **smoothly and continuously** (1, 2, 3, …) with no multi-second freezes between batches.
2. With concurrency=10, delay=0: 50 messages complete in roughly **30–60 s** instead of 3–4 minutes (≈10× faster), depending on network speed to storage and the WhatsApp proxy.
3. ABC cards no longer risk cross-patient pixel contamination — each card renders on its own canvas.
4. All other behaviour unchanged: Pause / Stop / Trial mode / Retry / per-record logging / progress bar / phase indicator / 45 s timeout / token-bucket pacing for non-zero delays / abort flag.

## Technical changes

### 1. Per-worker canvas for ABC cards (`src/lib/cardRenderer.ts`)

Stop sharing one canvas across workers. Two small additions:

- Modify `getTemplateAssets()` to return only the **immutable** assets: `bgImg` (already a decoded `HTMLImageElement` — safe to draw from concurrently) and `placeholders`. Drop `canvas`/`ctx` from the return shape.
- Modify `generateAndUploadCard()` to **create its own canvas** internally each call:

```typescript
const canvas = document.createElement("canvas");
canvas.width = bgImg.naturalWidth;
canvas.height = bgImg.naturalHeight;
const ctx = canvas.getContext("2d");
```

This is what the Abnormal-card path already does — no race, no contamination, true parallelism. The CPU cost of one extra `createElement("canvas")` per send is negligible (microseconds vs. the ~100 ms render).

Update the single ABC call-site in `AutomatedMarketing.tsx` to call `generateAndUploadCard(templateId, cardData, bgImg, placeholders)` (drop the `canvas`/`ctx` args). No other call-sites use these args.

### 2. Pipeline: prefetch the next record while the current one's API call is in flight

Inside each worker's loop in `AutomatedMarketing.tsx` (all three branches — ABC, Abnormal, Promotion), separate the work into two phases and overlap them:

```text
Worker iteration N:
  ├─ phase A: render card + upload to storage   (CPU + network-out)
  └─ phase B: callProxyAndLog                    (network-out)

Today:  A → B → A → B → A → B …    (B blocks the next A)
After:  A → B
              ↘
                A (next record starts as soon as previous B is dispatched)
                   → B …
```

Concretely: each worker keeps a `pendingSend: Promise<void>` slot. After kicking off `callProxyAndLog(...)` (which now runs in the background as a promise), the worker **immediately** grabs the next record and starts its render+upload. Only when the *next* record's render is done does the worker `await pendingSend` to keep at most one in-flight API call per worker (so back-pressure still applies and aborts/pauses work). Pseudocode:

```typescript
let pendingSend: Promise<void> | null = null;
while (true) {
  /* abort/pause checks unchanged */
  const i = nextIdx++;
  if (i >= total) break;
  const r = records[i];

  /* phase A: render + upload (sync within the worker) */
  const imageUrl = await generateAndUploadCard(...);

  /* wait for the previous send to finish before launching the next one */
  if (pendingSend) { await pendingSend; pendingSend = null; }

  /* phase B: launch the API call but don't block the next render */
  pendingSend = callProxyAndLog(...).then((ok) => {
    if (ok) totalSent++; else totalFailed++;
    processedCount++;
    _setSendProgress(Math.round((processedCount / totalMessages) * 100));
  });
}
if (pendingSend) await pendingSend;   // drain the last in-flight send
```

This change alone roughly halves wall-clock time per worker because rendering and sending no longer alternate sequentially — they overlap.

The token bucket inside `callProxyAndLog` still enforces the user-configured `delayMs` (so non-zero delays behave exactly as today), and the 45 s `Promise.race` timeout still protects against hung proxy calls.

### 3. No changes to

- `src/lib/marketingDelay.ts` (token bucket and `sleepResilient` already correct)
- `src/pages/WhatsAppSettingsPage.tsx` (no new settings)
- Edge functions, DB schema, RLS, cron jobs — none needed
- Pause / Stop / Trial mode / Retry tab logic
- Abnormal-card and Promotion branches' rendering — already per-call canvases / no canvas

### Files changed

- `src/lib/cardRenderer.ts` — `getTemplateAssets` returns `{ bgImg, placeholders }`; `generateAndUploadCard` creates its own canvas internally.
- `src/components/marketing/AutomatedMarketing.tsx` — update the one ABC call-site to the new signature; introduce the `pendingSend` pipeline pattern in all three worker loops; drain the final in-flight send before the pool exits.

## Verification

1. Concurrency=10, delay=0, send 50 ABC cards on a test number → progress moves smoothly (no 3–4 s freezes between groups of 10); total time drops from 3–4 min to under a minute.
2. Concurrency=5, delay=3000 → behaves like today: ~3 s between sends, smooth ramp, no regression.
3. Concurrency=1, any delay → strictly sequential, identical to today.
4. Pause mid-send → all workers stop after their current render+send completes; resume picks up cleanly.
5. Stop mid-send → all workers exit; no orphaned in-flight send is "lost" (each worker awaits its `pendingSend` on the abort path).
6. Trial mode (3-message cap) → still caps at 3, no behaviour change.
7. Send 20 cards to 20 different real patients → spot-check the uploaded card images in storage; each card shows the correct patient's name/UMR (proves the per-worker canvas fix).
8. Force `whatsapp-proxy` to hang on one record → that record fails after 45 s with `proxy_timeout_45s`; other workers continue rendering+sending.

