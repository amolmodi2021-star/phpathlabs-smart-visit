

# Speed up Automated Marketing sending (ABC + Abnormal PNG)

Today the Automated Marketing loop sends **strictly one card at a time**, end-to-end: fetch abnormal tests → render canvas → upload PNG to storage → invoke `whatsapp-proxy` → write log → update CRM → wait `delayMs` → next. With the default 3-second inter-message delay and ~3-5 s of work per card, 500 cards take ~2-3 hours. We will keep the loop client-side (so pause/abort/trial-mode all keep working) but let multiple cards process **in parallel**, while still respecting the WhatsApp API rate limit globally.

## What changes for the user

1. New "Parallel sends" control in **WhatsApp Settings → API Settings**, default `5`, range `1-10`.
2. The existing "Inter-message delay (ms)" (default 3000) becomes a **shared rate-limit gate** instead of an idle wait — the slowest WhatsApp call still happens at most once every `delayMs`, but card rendering, storage upload, fetches, and logging for the **next** records run in parallel during that gap.
3. Estimated speedup with the defaults (delay 3000ms, concurrency 5): **500 cards drop from ~3 hours to ~5–8 minutes.** Setting concurrency to 1 reproduces today's exact sequential behaviour (escape hatch).
4. Pause / Stop, progress %, current-record phase indicator, trial mode (3-message cap), and execution log all keep working unchanged.

## How it works (technical)

### 1. New setting

`app_settings` row:
- key = `wa_global_concurrency`, value = `"5"` (string, like other wa_global_* keys).

Read alongside `wa_global_delayMs` in `loadSettings()` of `WhatsAppSettings.tsx` and shown as a numeric input next to the existing "Inter-message delay" field with helper text:
> *Number of WhatsApp messages processed in parallel. Higher = faster, but check your provider's rate limit. Default 5.*

No DB migration needed — `app_settings` is a free-form key/value store already.

### 2. Replace the sequential `for` loop with a bounded worker pool

In `src/components/marketing/AutomatedMarketing.tsx`, both the **abc_card** branch (lines ~1243-1298) and the **abnormal_card** branch (lines ~1323-1370) get refactored to use a small worker pool:

```text
records  →  queue
                ↓
       ┌────────┴────────┐
   worker1 worker2 ... workerN     (N = concurrency, default 5)
       │       │          │
       ↓       ↓          ↓
  sendOne(r) sendOne(r) sendOne(r)
       │
       ↓
  rateGate.acquire()  ── ensures ≥ delayMs between WhatsApp API calls globally
       ↓
  proxy invoke + log + CRM update
       ↓
  progress++
```

Implementation sketch (replaces the `for (let i ...)` block per branch):

```typescript
const concurrency = Math.max(1, Math.min(10, Number(cfg["wa_global_concurrency"]) || 5));
const rateGate = makeRateGate(delayMs);   // global-to-this-campaign

const queue = [...preview.records];
let nextIdx = 0;
const total = preview.records.length;

const worker = async () => {
  while (true) {
    if (_checkAbort()) return;
    await _waitWhilePaused();
    if (_checkAbort()) return;
    const i = nextIdx++;
    if (i >= total) return;
    const r = queue[i];
    try {
      // ALL the existing per-record work (fetch tests, render card, build payload)
      // runs in parallel here — only the API call goes through the gate.
      const payload = await buildPayloadForRecord(r);
      await rateGate.acquire();
      const ok = await callProxyAndLog(payload, ...);
      if (ok) totalSent++; else totalFailed++;
    } catch (e) { totalFailed++; await logDiagnostic(filter, r, "record_error", String(e)); }
    processedCount++;
    _setSendProgress(Math.round((processedCount / totalMessages) * 100));
    _setSendPhase(`Filter ${filterIndex}/${totalFilters}: ${filter.name} — ${processedCount}/${totalMessages}`);
  }
};

await Promise.all(Array.from({ length: concurrency }, () => worker()));
```

`makeRateGate(ms)` is a tiny in-memory helper (added to the same file or to `src/lib/marketingDelay.ts`):

```typescript
export function makeRateGate(minIntervalMs: number) {
  let nextAvailable = 0;
  return {
    async acquire() {
      const now = Date.now();
      const wait = Math.max(0, nextAvailable - now);
      nextAvailable = Math.max(now, nextAvailable) + minIntervalMs;
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    },
  };
}
```

This guarantees the WhatsApp provider sees calls spaced ≥ `delayMs` apart even with N parallel workers. Setting `delayMs = 0` removes the gate entirely (back-to-back parallel sends).

### 3. Trial mode

The trial branches (lines ~982-1018 and ~1040-1069) keep their existing serial `for` loops — trial sends are capped at 3 messages so concurrency offers nothing there. No changes.

### 4. Promotion branch

Promotion sending (lines ~1395-1435) gets the **same** worker-pool + rate-gate refactor. Promotions don't render cards but still benefit from parallel proxy calls (today they also wait `delayMs` between each).

### 5. Files changed

- `src/components/marketing/AutomatedMarketing.tsx` — replace 3 sequential `for` loops with the worker-pool pattern; read `wa_global_concurrency` from `cfg`.
- `src/lib/marketingDelay.ts` — add and export `makeRateGate(ms)` and a `getMarketingConcurrency()` helper.
- `src/components/WhatsAppSettings.tsx` — add the "Parallel sends" numeric input in the API Settings card; persist to `app_settings` key `wa_global_concurrency`.

No DB migrations, no edge function changes, no schema changes.

## Why not move it to an edge function?

Edge functions hit CPU/wall-clock limits well before 500 cards finish (each card includes a canvas render + storage upload). The current client-side architecture is the right place for this work; the only real defect is that it's serial. A bounded worker pool fixes that without the operational cost of an async job system.

## Verification after deploy

1. WhatsApp Settings → API Settings shows new "Parallel sends" input with default 5; saving persists it.
2. Set concurrency = 1, delay = 3000 → behaviour is byte-identical to today (one send every 3s).
3. Set concurrency = 5, delay = 3000, run a campaign of 50 ABC cards on a test number → 50 cards complete in ~30-40 s (vs ~2.5 min today). Provider logs show calls spaced ~3s apart.
4. Set concurrency = 5, delay = 0 → 50 cards complete in ~10-15 s, calls back-to-back.
5. Pause mid-run with concurrency 5 → all 5 workers stop at their next pause check; resume continues correctly; total sent count matches eligible count.
6. Stop mid-run → workers exit, no orphan log rows, success toast shows "campaign stopped".
7. Trial mode (3-message cap) still sends only 3 messages and stops, regardless of concurrency setting.
8. Execution Log still shows one row per record with correct sent/failed/skip status.

