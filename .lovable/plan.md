
Goal: make the app reliably switch back to mobile layout on real phones after Chrome’s “Desktop site” is turned off, even when the browser keeps a stale desktop-sized viewport.

What I found
- `index.html` already has a correct viewport meta tag, so this is not caused by a missing viewport setting.
- The app currently decides “mobile vs desktop” mainly from viewport width:
  - `src/hooks/use-mobile.tsx` uses `window.innerWidth < 768`
  - layout classes like `md:hidden` / `hidden md:flex` in `src/components/AppLayout.tsx` also depend on viewport width
- The Dispatch page also uses that `useIsMobile()` hook, so if Chrome keeps reporting a wide viewport after desktop mode was toggled, the app stays in desktop layout.

Likely root cause
- On some Android/Chrome flows, turning off “Desktop site” does not immediately restore the expected viewport width for the tab.
- Because both CSS breakpoints and the hook rely on width alone, the UI can remain stuck in desktop mode.

Implementation plan
1. Strengthen device detection
- Update `src/hooks/use-mobile.tsx` so it does not rely only on `window.innerWidth`.
- Use a more resilient mobile heuristic combining:
  - `matchMedia("(max-width: 767px)")`
  - touch/coarse pointer checks such as `(pointer: coarse)`
  - a mobile user-agent fallback
  - `visualViewport?.width` when available
- Recompute on:
  - `resize`
  - `orientationchange`
  - `visualViewport.resize`

2. Add a “real mobile device” signal
- Return a stable result that treats phones as mobile even if Chrome temporarily reports a desktop-like width after toggling desktop mode.
- Keep desktop/laptop behavior unchanged.

3. Make the main app shell follow the same logic
- Refactor `src/components/AppLayout.tsx` so the mobile menu and desktop sidebar are controlled with `isMobile` instead of only `md:hidden` / `hidden md:flex`.
- This prevents the shell from being stuck in desktop mode when CSS breakpoints still think the viewport is wide.

4. Align Dispatch page with the improved detection
- Keep the existing mobile detail/list flow in `src/components/lims/Dispatch.tsx`.
- Ensure it reacts correctly once the stronger hook reports mobile again.

5. Add a recovery safeguard
- On mount and on visibility/orientation changes, force a fresh detection pass so returning to the tab after browser setting changes updates the layout quickly.

Technical notes
- Files likely to update:
  - `src/hooks/use-mobile.tsx`
  - `src/components/AppLayout.tsx`
  - possibly small follow-up adjustments in `src/components/lims/Dispatch.tsx`
- I will avoid changing backend/data logic; this is a frontend responsive-state fix.
- I’ll keep the behavior conservative so tablets/desktops do not accidentally collapse into mobile layout.

Expected result
- If a user disables Chrome desktop mode on a phone, the app should return to mobile layout without staying stuck in desktop view.
- The mobile hamburger/menu shell should reappear correctly.
- The Dispatch page should again show the mobile single-panel experience.

Validation after implementation
- Check on a phone-sized viewport that:
  - header shows the mobile menu button
  - desktop sidebar is hidden
  - Dispatch opens patient detail in the mobile single-panel flow
- Specifically verify the recovery flow:
  - emulate/use desktop mode
  - disable desktop mode
  - return to the app and confirm it switches back to mobile layout

<lov-actions>
<lov-suggestion message="Test the mobile layout end-to-end after disabling Chrome desktop mode and confirm the Dispatch page returns to the single-panel mobile view.">Verify that it works</lov-suggestion>
<lov-suggestion message="Implement the responsive detection fix now by updating the mobile hook and AppLayout so real phones are not stuck in desktop view after Chrome desktop mode is turned off.">Implement responsive fix</lov-suggestion>
<lov-suggestion message="Add a small in-app 'Refresh mobile layout' fallback action for users in case their browser keeps a stale viewport after changing Chrome desktop mode.">Add recovery button</lov-suggestion>
</lov-actions>
