

# Add media upload to Marketing → Send Messages

## What changes

In the **Send Messages** tab (`MarketingSender.tsx`), add an optional media attachment that is sent as the template **header** for every recipient in the uploaded Excel. Same media → all numbers.

## How it works

1. **New "Header Media" section** appears above "Upload Excel File":
   - File input accepting `image/*`, `video/mp4`, `application/pdf`
   - Media-type dropdown auto-detected from file (Image / Video / Document) — user can override
   - "Remove" button to clear selection
   - Small thumbnail/filename preview after upload
   - Note: "Optional — leave empty if your template has no media header."

2. **On file select**: upload immediately to the existing public `chat-attachments` bucket using `supabase.storage.from("chat-attachments").upload(...)`. Store the resulting public URL + chosen media type in component state. Show a tiny "Uploading…" spinner while in flight.

3. **At send time** (`sendMessages` loop): if a media URL is set, attach it to every payload as:
   ```
   payload.components.header = {
     type: <image|video|document>,
     [<image|video|document>]: { link: <publicUrl> }
   }
   ```
   This is identical to the header shape already used by the loyalty-card and abnormal-history senders, so no edge-function or AOC-proxy change is needed.

4. **Same media for all numbers**: the URL is uploaded once, then reused inside the per-row loop — zero extra storage cost per recipient.

5. **Validation**:
   - Max file size 16 MB (WhatsApp Cloud limit; toast error if exceeded)
   - Allowed MIME types only
   - If template has no header variable, sending still works — the API will reject; we surface the failure as it does today
   - Mobile column + template selection rules unchanged

6. **State reset**: clearing the Excel file or changing template does **not** clear the media (user often re-uploads Excel for the same campaign). A dedicated "Remove media" button does.

## Files touched

- `src/components/marketing/MarketingSender.tsx` — single-file change
  - Add `mediaUrl`, `mediaType`, `mediaFileName`, `uploadingMedia` state
  - Add `handleMediaUpload` (uploads to `chat-attachments`, derives type)
  - Add UI block (Label + Input + type Select + Remove button + preview line)
  - In `sendMessages`, before building each `payload`, attach `components.header` if `mediaUrl` present

No DB migration. No edge-function change. No new bucket (reuses `chat-attachments`, already public with open RLS — same one used by WhatsApp Chat).

## Out of scope

- Per-row media (different image per number) — current request is "same media to all"
- Media library / reuse of past uploads — fresh upload each campaign
- Auto-cleanup of uploaded marketing media — files persist in `chat-attachments` like chat uploads do today (can be added later as a cron prune if needed)

## Risk

Very low. Self-contained UI addition; send path only gains an optional header object that matches the proven shape used elsewhere.

