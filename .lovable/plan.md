

## Goal
Remove all edge functions and supporting code for the abandoned **AI report-extraction** pipeline and other unused functions. Keep only what's wired into the current sidebar.

## What I checked
Searched every `supabase.functions.invoke(...)` call in `src/`, cross-referenced with `App.tsx` routes and the sidebar in `AppLayout.tsx`. Routes for the old AI flow (`/upload-report`, `/review-report`, `/extraction-corrections`, `/direct-ai`, `/reports`) are **not even registered in `App.tsx`** anymore — the page files are dead code. Cron jobs were also audited: only 3 remain (all legitimate cleanup), so no cron cleanup needed.

## Functions to DELETE (6)
| Function | Why it goes |
|---|---|
| `process-report-queue` | AI PDF extraction queue worker |
| `extract-report` | AI extraction (single PDF) |
| `direct-ai-extract` | AI extraction (DirectAI page) |
| `reverify-abnormals` | AI re-verification on ReviewReport |
| `tests-crud` | No invocations anywhere in `src/` |
| `backfill-message-content` | No invocations anywhere — one-off backfill, already done |

## Functions to KEEP (12)
`user-auth`, `whatsapp-proxy`, `whatsapp-webhook`, `send-marketing-message`, `send-loyalty-whatsapp`, `generate-loyalty-card`, `abnormal-tests-import`, `parse-prescription`, `lims-interface`, `cleanup-card-images`, `cleanup-outsourced-snips`, `prune-old-logs`.

## Frontend cleanup (delete dead pages + helpers)
These pages call only the removed functions and aren't routed in `App.tsx` or shown in the sidebar:
- `src/pages/UploadReport.tsx`
- `src/pages/ReviewReport.tsx`
- `src/pages/ViewReport.tsx`
- `src/pages/ExtractionCorrections.tsx`
- `src/pages/DirectAI.tsx`
- `src/pages/ReportsDashboard.tsx`
- `src/lib/reportQueue.ts` (helper for the deleted queue function)

Also remove the now-orphan imports in `src/App.tsx` (the imports exist but no `<Route>` uses them).

## Files

### Delete (edge functions)
- `supabase/functions/process-report-queue/`
- `supabase/functions/extract-report/`
- `supabase/functions/direct-ai-extract/`
- `supabase/functions/reverify-abnormals/`
- `supabase/functions/tests-crud/`
- `supabase/functions/backfill-message-content/`

Then call `supabase--delete_edge_functions` to actually un-deploy them so they stop counting toward credits.

### Delete (frontend)
- `src/pages/UploadReport.tsx`
- `src/pages/ReviewReport.tsx`
- `src/pages/ViewReport.tsx`
- `src/pages/ExtractionCorrections.tsx`
- `src/pages/DirectAI.tsx`
- `src/pages/ReportsDashboard.tsx`
- `src/lib/reportQueue.ts`

### Edit
- `src/App.tsx` — remove the 6 orphan page imports (`UploadReport`, `ReviewReport`, `ViewReport`, `ExtractionCorrections`, `DirectAI`, `ReportsDashboard`).
- `supabase/config.toml` — remove `[functions.tests-crud]`, `[functions.extract-report]`, `[functions.reverify-abnormals]`, `[functions.process-report-queue]`, `[functions.direct-ai-extract]` blocks.

## Verify after
- App still compiles and the sidebar features (Estimates, Home Visits, LIMS, CRM, Marketing, Loyalty Cards, WhatsApp) all load.
- Run `supabase--read_query` to confirm no remaining cron job references the deleted functions (already verified — none do).

## Expected impact
- 6 fewer deployed edge functions = zero cold-start / invocation cost from those.
- `process-report-queue` (highest-traffic of the deleted set) was already cron-disabled last round; removing it eliminates any future accidental invocation.
- Frontend bundle slightly smaller (6 page modules + helper removed).

## Out of scope
- Anything that's actively used by the sidebar (all 12 retained functions).
- Cron schedule changes — only legitimate cleanup crons remain.
- Building the Cloud Usage dashboard (still deferred per your earlier scope).

