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
