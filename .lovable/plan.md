

# Convert PH PathLabs to a PWA with Mobile-Friendly Improvements

## What This Achieves
- App becomes **installable** on phones/tablets (Add to Home Screen) with full-screen standalone display
- Login persists across sessions (already works via localStorage — no change needed)
- Key mobile UX improvements across all modules

## Changes

### 1. Update `index.html` — PWA meta tags
- Add `<link rel="manifest" href="/manifest.json">`
- Add `<meta name="apple-mobile-web-app-capable" content="yes">`
- Add `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`
- Add `<meta name="theme-color" content="#3d8c7e">`
- Add apple-touch-icon link
- Update title to "PH PathLabs"

### 2. Update `public/manifest.json` — proper PWA manifest
- Add multiple icon sizes (192x192, 512x512) using generated SVG-based PNG icons
- Set `"display": "standalone"`, `"scope": "/"`, `"theme_color": "#3d8c7e"`
- Add `"orientation": "any"` to support both portrait and landscape

### 3. Generate PWA icons
- Create `public/icon-192.png` and `public/icon-512.png` using the existing FlaskConical teal branding via a simple canvas script

### 4. Add service worker registration guard in `src/main.tsx`
- Only register in production (not in Lovable preview iframe)
- Simple offline-capable caching for app shell

### 5. Mobile-friendly CSS improvements in `src/index.css`
- Add `env(safe-area-inset-*)` padding for notched phones
- Ensure tables scroll horizontally on mobile (`overflow-x-auto` wrappers)
- Add touch-friendly tap targets (min 44px)
- Prevent zoom on input focus with `font-size: 16px` minimum

### 6. Update `src/components/AppLayout.tsx` — mobile standalone adjustments
- Add safe-area padding for standalone mode (status bar overlap)
- Ensure the mobile drawer works well in full-screen PWA mode

### 7. No service worker plugin needed
Since the user doesn't need offline-first functionality, a simple `manifest.json` with standalone display is sufficient for installability. No `vite-plugin-pwa` required — avoiding all the iframe/preview complications.

## Files to modify
- `index.html`
- `public/manifest.json`
- `src/index.css`
- `src/main.tsx`
- `src/components/AppLayout.tsx`

## Files to create
- `public/icon-192.png` and `public/icon-512.png` (generated via script)

## Auth persistence
Already handled — localStorage keeps users logged in across sessions. No changes needed.

