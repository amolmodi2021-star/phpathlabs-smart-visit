

## Goal
Move the global marketing send delay setting into the existing **WhatsApp Settings** page. No new tab/page in Marketing. All campaigns (Send, Drip/Automated, Retry) read this single value.

## Changes

### 1. `src/pages/WhatsAppSettingsPage.tsx` (or `src/components/WhatsAppSettings.tsx`)
Add one inline control block — "Marketing Send Delay" — alongside existing settings:
- Preset Select: No delay (0) / 1s / 3s (default) / 5s / 10s / Custom
- Custom → numeric input (ms, min 0, step 100)
- Auto-saves to `app_settings` row `marketing_send_delay_ms` (debounced, same pattern as other settings on this page).
- On mount, loads the current value (default 3000 if missing).

### 2. New helper — `src/lib/marketingDelay.ts`
```ts
export async function getMarketingSendDelayMs(): Promise<number> {
  const { data } = await supabase
    .from("app_settings")
    .select("setting_value")
    .eq("setting_key", "marketing_send_delay_ms")
    .maybeSingle();
  const n = Number(data?.setting_value ?? 3000);
  return Number.isFinite(n) && n >= 0 ? n : 3000;
}
```

### 3. Consume the global value, remove local controls

- **`MarketingSender.tsx`** — remove the per-campaign "Delay Between Messages (ms)" input + state; load delay via helper at start of bulk loop; skip `await` when 0.
- **`MarketingRetry.tsx`** — replace hard-coded 3000ms with helper value; update AlertDialog copy to reflect current value (no delay / Xs).
- **`AutomatedMarketing.tsx`** — replace any inter-message sleep with helper value.

### 4. Out of scope
- No new Marketing tab.
- No schema change (`app_settings` already exists).
- No edge-function change (drip + send loops are client-side here).

## Expected outcome
- WhatsApp Settings page has one new "Marketing Send Delay" control; auto-saves.
- Marketing → Send Messages: delay input removed; uses global silently.
- Marketing → Retry: confirmation copy + spacing both reflect global value.
- Automated/Drip respects the same global value.
- `0` = back-to-back sends across all campaigns.

