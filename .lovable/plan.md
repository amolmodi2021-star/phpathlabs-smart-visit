

## Goal
Revert Automated/Drip sending to **client-side only** (as it was before the server-side migration). Add a browser-close warning when a send is in progress so the user doesn't accidentally interrupt it.

## Changes

### 1. `src/components/marketing/AutomatedMarketing.tsx`
- **Remove** the server-side handoff: no more `drip_runs` insert, no `supabase.functions.invoke("run-drip-campaign", …)`.
- **Remove** the persistent progress card driven by `drip_runs` realtime subscription, the resume-on-mount query, and the Cancel-via-DB flag.
- **Restore** the original client-side send loop (the version that existed before the previous server-side change), keeping:
  - Global delay via `getMarketingSendDelayMs()`.
  - CRM `last_sent_type`/`last_sent_date` written **only on successful proxy response** (preserve the correctness fix from the previous round so failures don't get marked sent).
  - Existing trial-mode path unchanged.
  - Logging to `message_send_log` (sent/failed) unchanged.
- **Local progress UI** comes back: React state drives the progress bar, sent/failed/skipped counters, current phase, and Cancel button (sets a local `cancelRef.current = true` checked each iteration).

### 2. Browser-close warning (in-progress guard)
- Add a `useEffect` in `AutomatedMarketing.tsx` that, while `isSending === true`, attaches a `beforeunload` listener:
  ```ts
  const handler = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = "Sending is in progress. Closing this tab will stop the campaign. Are you sure?";
    return e.returnValue;
  };
  window.addEventListener("beforeunload", handler);
  return () => window.removeEventListener("beforeunload", handler);
  ```
- Browsers display their native confirmation dialog (custom text is ignored by modern browsers, but the prompt still appears). This covers tab close, window close, refresh, and navigation away.
- Listener is removed automatically when sending completes or is cancelled.

### 3. Cleanup
- **Delete** edge function `supabase/functions/run-drip-campaign/` (no longer needed) — call `supabase--delete_edge_functions` to remove the deployed copy.
- **Drop** the `drip_runs` table via a new migration (it's only used by the now-removed code; safe to drop). Also remove from `supabase_realtime` publication.
- Remove any `drip_runs` block from `supabase/config.toml` if present.

### 4. Out of scope
- Marketing → Send Messages tab and Retry tab (already client-side; unchanged).
- Trial mode (already client-side; unchanged).
- Global `wa_global_delayMs` setting (kept; still used).

## Expected outcome
- Click **Send** in Automated tab → sending runs in the browser tab as before, with live progress.
- If the user tries to close the tab / refresh / navigate away while sending, the browser shows a native "Leave site?" warning.
- If the user confirms leaving, sending stops (same as the original client-side behavior).
- No `drip_runs` row written; edge function gone.

