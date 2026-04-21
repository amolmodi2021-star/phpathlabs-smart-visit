

## Where your Lovable Cloud credits are going

I audited your database, edge functions, storage, and cron jobs. Here's the breakdown:

### 1. Storage — **1.5 GB and growing fast** (THE BIG ONE)
| Bucket | Files | Size |
|---|---|---|
| **loyalty-cards** | 3,010 | **1,507 MB** |
| report-uploads | 89 | 50 MB |
| Everything else | ~40 | <5 MB |

- **2,887 of those files (1,453 MB) are in `generated/crm/`** — drip-campaign WhatsApp card PNGs that should be auto-deleted daily.
- 2,621 files were created on **2026-04-20 alone** (1,319 MB in one day).
- Storage cost dominates everything else. At Supabase rates this is roughly **$0.03/GB/day egress + $0.021/GB/month at-rest** — small per-day, but the bucket is growing ~1.3 GB/day and never shrinking.

### 2. Cleanup cron is broken — root cause of #1
- `cleanup-card-images-midnight` runs daily but `supabase.storage.list()` is called with `{ limit: 1000 }`. With 2,887+ files in `generated/crm`, it can only delete 1,000 per run while drips create 1,300+/day → **the bucket grows ~300 files/day permanently.**
- Cron logs show **0 invocations of cleanup-card-images in the last 14 days** in edge logs — either the cron http call is failing silently, or logs are routed elsewhere. Needs verification.

### 3. Database — 246 MB, healthy but bloated tables
| Table | Rows | Size |
|---|---|---|
| crm_contacts | 35,270 | 24 MB |
| crm_abnormal_tests | 54,269 | 17 MB |
| message_send_log | 16,933 | 9.4 MB |
| abnormal_history | 9,711 | 8.8 MB |
| drip_campaign_log | 9,425 | 2.8 MB |

No old rows (>90/180 days) yet because the project is young — but `message_send_log` and `drip_campaign_log` will keep compounding. Worth setting retention now before they balloon.

### 4. Edge functions — negligible
- 13 invocations / 13 seconds total CPU in 7 days. Not a cost driver.

### 5. Realtime / queries — no anomalies detected
- DB size 246 MB total, well within free instance.

---

## Optimization plan

### A. Fix the storage leak (highest impact)
1. **Rewrite `cleanup-card-images`** to paginate `storage.list()` properly:
   - Loop with `{ limit: 1000, offset: i*1000 }` until empty, OR use the storage API's `search` with pagination.
   - Add an age filter: only delete files older than 24 hours so drips in flight aren't broken.
   - Delete in batches of 100 (Supabase remove() limit).
2. **One-time bulk purge**: run the fixed function 3–4 times to clear the existing 2,887-file backlog (~1.45 GB freed immediately).
3. **Verify the cron is actually firing**: check `cron.job_run_details` for the last 14 days. If failing, reschedule with the correct service-role auth header.
4. **Tighten retention**: shorten card lifetime from "delete daily" to "delete after 6 hours" — the WhatsApp message has already been delivered; the public URL is no longer needed.

### B. Add automated DB retention (preventive)
1. New nightly cron `prune-old-logs`:
   - `message_send_log` → delete rows >180 days
   - `drip_campaign_log` → delete rows >90 days
   - `lims_interface_logs` → delete rows >90 days
   - `app_user_login_history` → delete rows >365 days
2. `VACUUM FULL` after the first run to reclaim disk.

### C. Reduce per-card storage size
- The avg card is **~500 KB PNG**. Switch `generate-loyalty-card` output to **JPEG quality 0.85** → expected ~80 KB/card (6× smaller). At 1,300 cards/day that's 1.6 GB/month avoided even if cleanup fails.
- Same trick we just applied to the pickup invoice PDF.

### D. Right-size monitoring
- Add a tiny **Cloud Usage** widget to the dashboard (Storage GB, DB MB, edge function minutes) pulled from Supabase admin API or a daily snapshot table — so you can see drift in real time instead of finding out from the bill.

---

## Files I'll change

- **EDIT** `supabase/functions/cleanup-card-images/index.ts` — pagination loop, age filter, batched removes.
- **EDIT** `supabase/functions/generate-loyalty-card/index.ts` — output JPEG (quality 0.85) instead of PNG.
- **NEW** `supabase/functions/prune-old-logs/index.ts` — nightly retention purger.
- **NEW migration** — schedule `prune-old-logs` cron at 19:00 UTC daily; verify existing cleanup cron auth header.
- **NEW migration** — one-time backlog purge call (or manual trigger after deploy).
- *(optional)* **NEW** `src/components/admin/CloudUsageWidget.tsx` — at-a-glance usage panel.

## Expected impact

| Action | Savings |
|---|---|
| Fix cleanup + clear backlog | **~1.45 GB storage freed immediately** |
| JPEG cards | ~83% smaller per card (~1.6 GB/mo avoided) |
| DB log retention | Caps growth at ~50 MB instead of unbounded |
| Net | Storage stays under 100 MB instead of 1.5+ GB |

## Out of scope
- Migrating older approved-report PDFs out of the DB (already lean at 264 KB).
- Switching report rendering to vector PDFs (separate, larger refactor).
- Moving cold storage to a cheaper provider (S3/R2) — premature for this scale.

