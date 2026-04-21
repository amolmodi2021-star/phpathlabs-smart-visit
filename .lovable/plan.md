

# Patient Portal — Auto-Download + Share on WhatsApp

Refines the patient-facing report view (`/lims/report/:id?public=<token>`) so download is instant and easy to share. Internal staff view (no `?public` param) stays unchanged.

## Behaviour changes (public mode only — gated by `?public=<token>`)

1. **Auto-trigger download** on page load:
   - Once the report is fully loaded and pages rendered, `handleDownloadPdf` runs automatically.
   - Button shows **"Downloading…"** with spinner during generation.
   - When the PDF is ready, it is **saved to the device AND opened in a new tab** (using `URL.createObjectURL(blob)` → `window.open`) so the patient sees it immediately.

2. **Toolbar cleanup (public mode):**
   - Hide **"With Letterhead"** switch (always render with letterhead).
   - Hide **"Print"** button.
   - Hide **"Back"** button (no `/lims?tab=dispatch` for patients).
   - Replace current toolbar with a clean header: lab title + **Download / Re-download** button + **Share on WhatsApp** button (appears once PDF is ready).

3. **Share on WhatsApp button (visible after first successful PDF generation):**
   - Cached PDF blob kept in memory for the session.
   - Tap → opens `https://wa.me/?text=<message>` with text:
     ```
     My PH PathLabs report — Invoice <inv>
     <portal short URL>
     ```
   - Uses Web Share API with file attachment when available (`navigator.canShare({ files })`) so the actual PDF is attached. Fallback: `wa.me` text link with the portal URL (since uploading PDFs to storage is forbidden by your earlier rule).
   - Logs analytics event `shared_whatsapp` (new event type, additive — no schema change needed since `event_type` is text).

4. **Downloading-state UX:**
   - Single primary button cycles through:
     `Preparing report…` → `Downloading…` (spinner) → `Re-download PDF` (after success).
   - "Share on WhatsApp" button slides in next to it after success.

## Internal staff mode (no `?public` param) — UNCHANGED

- Letterhead toggle, Print, Back button all remain.
- No auto-download.
- No Share on WhatsApp button.

## Files

**Modified**
- `src/pages/LimsReportView.tsx`
  - Detect public mode: `const isPublic = !!searchParams.get("public");`
  - Conditionally render toolbar items.
  - Add `useEffect` that triggers `handleDownloadPdf` once when `isPublic && !loading && pages.length > 0` (run-once via ref guard).
  - Refactor `handleDownloadPdf` to also produce a blob, store it in a ref, and `window.open(blobUrl)` after `pdf.save()` in public mode.
  - Add `handleShareWhatsApp` using Web Share API with file when supported, else `wa.me` text fallback.
  - Add a small `logShareEvent` helper that POSTs to `report_link_events` with `event_type='shared_whatsapp'` (reuses existing public RLS insert policy).

**No DB changes.** `report_link_events.event_type` is free text — `shared_whatsapp` slots in alongside existing types.

## Verification after deploy

1. Open patient portal → tap "Download Approved Reports" → new tab opens at `/lims/report/:id?public=…`.
2. PDF auto-downloads to the device AND opens in a new tab — no manual click needed.
3. Toolbar shows only the lab title + a disabled "Downloading…" button initially; no Letterhead toggle, no Print, no Back.
4. After download succeeds, toolbar shows **Re-download PDF** + **Share on WhatsApp**.
5. Tap Share → on mobile Chrome/Safari with share-files support → WhatsApp picker shows the PDF attached. On desktop → `wa.me` opens with text + portal URL.
6. Open the same report URL WITHOUT `?public=` (staff mode) → all original buttons (Letterhead, Print, Back) still present, no auto-download.
7. Report Analytics shows the new `shared_whatsapp` events grouped in the per-token timeline.

