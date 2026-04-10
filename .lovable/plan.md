

# Fix: Back Button Should Return to Correct LIMS Tab

## Problem
The LIMS page uses `defaultValue="register"` for its tabs. When you navigate from Dispatch → View Report → Back, the browser correctly goes back to `/lims`, but the Tabs component always resets to "New Registration" because the active tab is not persisted in the URL.

## Solution
Store the active LIMS tab in a URL search parameter (e.g., `/lims?tab=dispatch`). This way, when `navigate(-1)` returns to `/lims?tab=dispatch`, the correct tab is restored.

### Changes

**`src/pages/Lims.tsx`**
- Read `tab` from URL search params using `useSearchParams`
- Use it as the controlled `value` for the `Tabs` component instead of `defaultValue`
- On tab change, update the search param (using `replace` to avoid polluting history)

**`src/components/lims/Dispatch.tsx`**
- No change needed — it already navigates to `/lims/report/:id` and the browser history will preserve the `?tab=dispatch` on the previous entry

**`src/pages/LimsReportView.tsx`**
- No change needed — already uses `navigate(-1)`

### Technical Detail
```typescript
// Lims.tsx
const [searchParams, setSearchParams] = useSearchParams();
const activeTab = searchParams.get("tab") || "register";

<Tabs value={activeTab} onValueChange={(v) => setSearchParams({ tab: v }, { replace: true })}>
```

Using `{ replace: true }` ensures switching tabs doesn't create extra history entries — only the final tab before leaving the page is remembered.

## Files
- `src/pages/Lims.tsx`

