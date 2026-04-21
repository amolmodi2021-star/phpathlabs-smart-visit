import { supabase } from "@/integrations/supabase/client";

/**
 * Returns the global inter-message delay (ms) used by all marketing/WhatsApp
 * bulk send loops (Send Messages, Automated/Drip, Retry). Configured in
 * WhatsApp Settings → API Settings. `0` means back-to-back sends.
 */
export async function getMarketingSendDelayMs(): Promise<number> {
  const { data } = await supabase
    .from("app_settings")
    .select("setting_value")
    .eq("setting_key", "wa_global_delayMs")
    .maybeSingle();
  const n = Number(data?.setting_value ?? 3000);
  return Number.isFinite(n) && n >= 0 ? n : 3000;
}

/**
 * Returns the global concurrency (parallel-sends) for the Automated Marketing
 * worker pool. Configured in WhatsApp Settings → API Settings. Clamped to 1–10.
 * Setting `1` reproduces the legacy strictly-sequential behaviour.
 */
export async function getMarketingConcurrency(): Promise<number> {
  const { data } = await supabase
    .from("app_settings")
    .select("setting_value")
    .eq("setting_key", "wa_global_concurrency")
    .maybeSingle();
  const n = Number(data?.setting_value ?? 5);
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(10, Math.floor(n)));
}

/**
 * Tab-throttle-resilient sleep. Browsers throttle setTimeout to ≥1s in
 * background tabs, which would stretch a 3000ms wait into many seconds and
 * freeze the marketing worker pool. By anchoring on Date.now() and polling
 * in short slices we ensure the sleep finishes on time even when backgrounded.
 */
export async function sleepResilient(ms: number): Promise<void> {
  if (ms <= 0) return;
  const target = Date.now() + ms;
  while (Date.now() < target) {
    const remaining = target - Date.now();
    await new Promise((r) => setTimeout(r, Math.min(250, remaining)));
  }
}

/**
 * @deprecated Use `makeTokenBucket` for the marketing worker pool. This serial
 * gate funnels every parallel worker through one cursor, which causes the
 * "burst then freeze" stutter when combined with concurrency > 1.
 *
 * In-memory rate gate: ensures successive `acquire()` calls are spaced at
 * least `minIntervalMs` apart globally. With `minIntervalMs = 0` the gate is
 * a no-op (back-to-back parallel sends). Still exported for legacy callers.
 */
export function makeRateGate(minIntervalMs: number) {
  let nextAvailable = 0;
  return {
    async acquire() {
      if (minIntervalMs <= 0) return;
      const now = Date.now();
      const wait = Math.max(0, nextAvailable - now);
      nextAvailable = Math.max(now, nextAvailable) + minIntervalMs;
      if (wait > 0) await sleepResilient(wait);
    },
  };
}

/**
 * Token-bucket pacer for the parallel marketing worker pool.
 *
 * - `refillIntervalMs` = `delayMs` — one token is added every interval.
 * - `capacity` = `concurrency` — up to N workers may burst in parallel
 *   without waiting, but the long-run average rate is capped at
 *   1 send per `refillIntervalMs`.
 *
 * This eliminates the per-call serial wait of `makeRateGate` while still
 * honouring the user-configured average throughput. A hung individual call
 * no longer blocks other workers — they simply consume their own tokens.
 */
export function makeTokenBucket(refillIntervalMs: number, capacity: number) {
  const cap = Math.max(1, Math.floor(capacity || 1));
  let tokens = cap;
  let lastRefill = Date.now();
  return {
    async take() {
      if (refillIntervalMs <= 0) return;
      while (true) {
        const now = Date.now();
        const elapsed = now - lastRefill;
        if (elapsed >= refillIntervalMs) {
          const refill = Math.floor(elapsed / refillIntervalMs);
          tokens = Math.min(cap, tokens + refill);
          lastRefill += refill * refillIntervalMs;
        }
        if (tokens > 0) {
          tokens--;
          return;
        }
        const waitMs = refillIntervalMs - (Date.now() - lastRefill);
        await sleepResilient(Math.max(50, waitMs));
      }
    },
  };
}
