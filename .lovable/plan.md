

## Issue
The Marketing tab definition in `src/pages/UserManagement.tsx` (lines 31-39) lists 4 sections — `send`, `automated`, `log`, `new` — but the actual Marketing page (`src/pages/Marketing.tsx`) has 5 tabs including **Retry**. Because Retry is missing from this sections array, it never appears as a togglable permission in the Users → Roles screen.

## Fix — single one-line change in `src/pages/UserManagement.tsx`

Add the Retry section between Automated and Message Log, matching the order shown in the Marketing page:

```ts
sections: [
  { key: "send", label: "Send Messages" },
  { key: "automated", label: "Automated" },
  { key: "retry", label: "Retry" },        // ← add this
  { key: "log", label: "Message Log" },
  { key: "new", label: "New Numbers" },
],
```

The `key: "retry"` matches the value already used in `Marketing.tsx` (`allMarketingTabs` and `<TabsContent value="retry">`), and `getAllowedSections("/marketing")` in that file will now correctly include/exclude it based on each role's permissions.

## Out of scope
- No change to Marketing page logic, MarketingRetry component, or auth library.
- Existing roles will not auto-grant Retry — admins toggle it on per role after this fix (same behavior as any newly added section).

## Expected outcome
- Users → edit role → Marketing now shows a "Retry" checkbox alongside the other four sections.
- Toggling it controls visibility of the Retry tab inside Marketing.

