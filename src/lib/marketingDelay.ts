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
 * In-memory rate gate: ensures that successive `acquire()` calls are spaced
 * at least `minIntervalMs` apart globally across N parallel workers. With
 * `minIntervalMs = 0` the gate is a no-op (back-to-back parallel sends).
 *
 * Usage:
 *   const gate = makeRateGate(3000);
 *   // inside each worker, immediately before the WhatsApp API call:
 *   await gate.acquire();
 */
export function makeRateGate(minIntervalMs: number) {
  let nextAvailable = 0;
  return {
    async acquire() {
      if (minIntervalMs <= 0) return;
      const now = Date.now();
      const wait = Math.max(0, nextAvailable - now);
      nextAvailable = Math.max(now, nextAvailable) + minIntervalMs;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    },
  };
}
