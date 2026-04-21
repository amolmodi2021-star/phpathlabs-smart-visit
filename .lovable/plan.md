

# Fix intermittent stalls in Automated Marketing sending

The "stops for a while, then resumes" pattern is **not random** — it's caused by three concrete defects in the current parallel sender. This plan removes all three so sending runs at a steady, predictable pace from start to finish.

## Root causes

1. **Global rate-gate is a serial bottleneck.** Every worker funnels through one `rateGate.acquire()` before its WhatsApp call. With `delayMs=3000` and 5 workers, the 5th worker is forced to wait ~12 s before its call is allowed. If a single proxy call is slow, the queue behind the gate piles up — progress freezes, then catches up in a burst. This is what you're seeing.
2. **No timeout on the proxy call.** `supabase.functions.invoke("whatsapp-proxy", …)` can hang for minutes when the AOC provider lags. While it hangs, the worker that already advanced the gate's `nextAvailable` keeps the slot reserved, so the *other* workers stall too.
3. **Background-tab throttling.** When the marketing tab loses focus, browsers throttle `setTimeout` to ≥1 s. The gate's wait timers stretch to many seconds, freezing all workers until the user returns.

## What the user will see after the fix

1. Sending runs at a **steady cadence** instead of "5 sent → 12 s freeze → 5 sent → freeze". 500 cards complete in roughly the time predicted by `concurrency × throughput`, with no unexplained pauses.
2. Sending **continues at full speed when the tab is in the background** (or even minimised).
3. A single slow/hung WhatsApp call **no longer blocks the other workers** — it times out after 45 s, that record is logged as failed, and the worker picks the next record immediately.
4. No UI changes, no new settings, no behaviour change to Pause / Stop / Trial mode / progress bar.

## Technical changes

### 1. Replace the global serial gate with a **per-worker token-bucket pacer** (`src/lib/marketingDelay.ts`)

Today's `makeRateGate` queues every worker through a single `nextAvailable` cursor — that's the bottleneck. Replace it with a **token bucket**: tokens are refilled at a steady rate of `1 / delayMs` per ms, capacity = `concurrency`. Workers consume one token per send and wait only if the bucket is empty.

```typescript
export function makeTokenBucket(refillIntervalMs: number, capacity: number) {
  let tokens = capacity;
  let lastRefill = Date.now();
  return {
    async take() {
      if (refillIntervalMs <= 0) return;
      while (true) {
        const now = Date.now();
        const elapsed = now - lastRefill;
        const refill = Math.floor(elapsed / refillIntervalMs);
        if (refill > 0) {
          tokens = Math.min(capacity, tokens + refill);
          lastRefill += refill * refillIntervalMs;
        }
        if (tokens > 0) { tokens--; return; }
        const waitMs = refillIntervalMs - (now - lastRefill);
        await sleepResilient(Math.max(50, waitMs));
      }
    },
  };
}
```

This preserves the user-configured **average rate** (one send per `delayMs`) while letting bursts of up to `concurrency` calls happen in parallel — eliminating the per-call serial wait that causes today's stutter.

### 2. Add a **tab-throttle-resilient sleep** (same file)

`setTimeout` is throttled in background tabs. Use a `Date.now()`-anchored loop so a 3000 ms sleep actually sleeps 3000 ms regardless of tab state:

```typescript
async function sleepResilient(ms: number) {
  const target = Date.now() + ms;
  while (Date.now() < target) {
    await new Promise(r => setTimeout(r, Math.min(250, target - Date.now())));
  }
}
```

`_waitWhilePaused()` in `AutomatedMarketing.tsx` will use this same helper instead of `setTimeout(300)`, so paused campaigns also resume promptly when the tab is backgrounded.

### 3. Add a **45 s timeout** to every proxy call (`src/components/marketing/AutomatedMarketing.tsx`, `callProxyAndLog`)

A hung AOC call must not stall the entire pool. Wrap the invoke in a `Promise.race`:

```typescript
const proxyRes = await Promise.race([
  supabase.functions.invoke("whatsapp-proxy", { body: { … } }),
  new Promise((_, rej) => setTimeout(() => rej(new Error("proxy_timeout_45s")), 45000)),
]) as any;
```

On timeout the catch branch already logs `wa_exception` and writes a retry-payload row — the record shows up in the Retry tab and the worker grabs the next record. Today these hangs silently freeze the whole pool.

### 4. Wire the new pacer into the three branches

In `AutomatedMarketing.tsx`:
- Replace `const rateGate = makeRateGate(delayMs);` with `const rateGate = makeTokenBucket(delayMs, concurrency);`
- Replace `await rateGate.acquire();` with `await rateGate.take();` inside `callProxyAndLog`.
- No changes to the worker loops themselves — they keep their current pause/abort/progress logic.

### 5. Files changed

- `src/lib/marketingDelay.ts` — add `makeTokenBucket` and `sleepResilient`. Keep `makeRateGate` exported (for any other call sites) but mark its JSDoc as deprecated in favour of `makeTokenBucket`.
- `src/components/marketing/AutomatedMarketing.tsx` — switch to `makeTokenBucket`, add 45 s `Promise.race` timeout in `callProxyAndLog`, swap `_waitWhilePaused` sleep to `sleepResilient`.

No DB migration. No edge function changes. No UI changes. No new settings.

## Verification

1. Set `delayMs = 3000`, `concurrency = 5`, run 50 ABC cards — progress moves smoothly; no multi-second freezes between batches; total time ≈ 50 × (3000/5) ≈ 30 s.
2. Switch to another browser tab during a run — sending continues at full speed; on return, processed count matches what the bucket predicts.
3. Simulate a hung proxy (block `whatsapp-proxy` in DevTools) — that record fails after 45 s with `proxy_timeout_45s` in the Retry tab; other workers keep sending in the meantime.
4. Set `concurrency = 1` — behaviour matches today's strictly sequential mode (one send every `delayMs`).
5. Pause/Stop/Trial mode all behave exactly as today.

