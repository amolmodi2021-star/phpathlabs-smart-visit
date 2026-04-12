

# Fix: Foldable Phone UI Not Updating on Fold/Unfold

## Problem
The `useIsMobile` hook has a rule (line 26) that forces **any device with a mobile User-Agent + touch** to always return `true` (mobile mode), regardless of viewport width. This means foldable phones with wide inner screens (≥768px when unfolded) are stuck in mobile mode. Additionally, when toggling between preview sizes, the detection may not re-fire properly.

## Root Cause
```typescript
// This line forces ALL touch + mobile-UA devices to mobile,
// even when the foldable is unfolded at 900px+ width
if (isCoarsePointer && isMobileUA) return true;
```

## Fix — `src/hooks/use-mobile.tsx`

1. **Remove the blanket mobile-UA override** — only use viewport width as the primary signal. The UA override was added for Chrome "Desktop site" toggle edge cases, but it breaks foldable phones.

2. **Rely purely on viewport width** — `checkMobile` should simply return `vpWidth < MOBILE_BREAKPOINT`. This correctly handles:
   - Folded phone (narrow viewport → mobile) ✓
   - Unfolded phone (wide viewport → tablet/desktop) ✓  
   - Regular phone (narrow → mobile) ✓
   - Tablet (wide → desktop) ✓

3. **Add `screen.orientation` change listener** — some foldable browsers fire this more reliably than `resize` during fold/unfold transitions.

### Updated logic:
```typescript
function checkMobile(): boolean {
  if (typeof window === "undefined") return false;
  const vpWidth = window.visualViewport?.width ?? window.innerWidth;
  return vpWidth < MOBILE_BREAKPOINT;
}
```

And add to the effect:
```typescript
screen.orientation?.addEventListener("change", update);
```

This is a single-file change to `src/hooks/use-mobile.tsx`.

