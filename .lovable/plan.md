

# Stagger worker startup by 200 ms to prevent progress-bar freeze

## What you're seeing

With **concurrency = 10** and **delay = 0**, all 10 workers spin up at the exact same instant. They each:
1. Fetch their record's data
2. Render the canvas (ABC card or Abnormal PNG)
3. Upload the PNG to storage
4. Call `whatsapp-proxy`

Steps 2 and 3 are CPU/network heavy. Running 10 of them in parallel from t=0 saturates the browser's main thread and the network pipe — the progress bar reads "10 sent" the moment the proxy calls return (which is fast), but then **all 10 workers are simultaneously busy on the next batch's render+upload**, so the UI freezes for several seconds until the next wave of proxy calls completes. The freeze is the renders, not the sends.

## What you'll see after the fix

1. Click Send → workers start one at a time with a **200 ms stagger**: worker #1 at t=0, worker #2 at t=200 ms, … worker #10 at t=1.8 s.
2. Progress bar ticks up smoothly (1, 2, 3, …) instead of jumping to 10 then freezing.
3. Render + upload work is naturally pipelined — when worker #1 is uploading, worker #2 is rendering, worker #3 is fetching, etc. Main thread stays responsive.
4. Long-run throughput is **identical** — once all 10 workers are running they keep pace exactly as before. Only the first ~2 seconds of the campaign change.
5. Pause / Stop / Trial mode / Retry / delay-bucket pacing all behave exactly as today.

## Technical change

### Single change in `src/components/marketing/AutomatedMarketing.tsx`

Inside the worker-pool loop where the N worker promises are spawned, add a 200 ms stagger before each worker starts its first iteration. Pseudocode:

```typescript
const STAGGER_MS = 200;
const workers = Array.from({ length: concurrency }, (_, i) =>
  (async () => {
    if (i > 0) await sleepResilient(i * STAGGER_MS);   // ← new line
    while (queue.length > 0 && !abortRef.current) {
      // existing per-record loop unchanged
    }
  })()
);
await Promise.all(workers);
```

- Uses the existing `sleepResilient` helper so the stagger isn't broken by background-tab throttling.
- Only affects the **first iteration** of each worker — once a worker finishes its first record it immediately picks the next one with no extra delay.
- Applied to all three branches (ABC Cards, Abnormal History, Promotional) since they share the same worker-pool pattern.

### Files changed

- `src/components/marketing/AutomatedMarketing.tsx` — add the per-worker startup stagger in the three worker-pool blocks.

No DB migration. No edge function changes. No UI changes. No new settings.

## Verification

1. Concurrency = 10, delay = 0, send 50 cards → progress increments smoothly from 1 upward; no "10 in a flash then freeze" pattern.
2. Concurrency = 5, delay = 3000 → behaves the same as today (token bucket dominates the pacing; 200 ms stagger is invisible).
3. Concurrency = 1 → stagger is skipped (only worker #0); behaviour identical to today.
4. Total time for a 100-card campaign at concurrency=10, delay=0 is essentially unchanged (~2 s longer at most due to startup ramp).
5. Pause/Stop mid-ramp works correctly — workers that haven't started yet exit immediately when they finish their stagger sleep and see the abort flag.

