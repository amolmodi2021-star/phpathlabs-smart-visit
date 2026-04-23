

# Will Cloud cost scale up when you go live with patients?

**Short answer: NO, not significantly — IF the optimizations we already applied stay in place.** Here's why, broken down by what scales and what doesn't.

## What scales linearly with patients (small impact)

| Per real patient visit | DB writes | Realtime broadcast | Storage |
|---|---|---|---|
| 1 registration | ~5 rows (registration, tests, sample tubes, payment) | None (not in publication) | ~2 KB |
| Results entered | ~10-30 result rows | Yes — `patient_results` IS in realtime (your hard requirement for interface) | ~5 KB |
| Report approved | 1 archived snapshot | None | ~30 KB |
| WhatsApp report send | 1 `message_send_log` row | None (we removed it) | ~0.5 KB |
| **Total per patient** | **~40-60 writes** | **~20 broadcasts** | **~40 KB** |

At **50 real patients/day** = ~2,500 writes/day + ~2 MB/day storage. That's **5-10% of current daily activity**. Patients are NOT the cost driver.

## What's actually driving cost (NOT patient count)

Look at your real numbers from the live DB:

| Table | Writes (lifetime) | Driven by |
|---|---|---|
| `crm_contacts` | **333K** | Drip marketing cycles (already fixed today — should drop ~99%) |
| `abnormal_history` | **68K** | Bulk Excel imports + CRM sync |
| `message_send_log` | **58K** | Marketing/drip sends (~2K/day) |
| `crm_abnormal_tests` | **54K** | Bulk Excel imports |
| `drip_campaign_log` | **14K** | Drip engine cycling |
| `patient_results` | **15K total** | Actual patient work — **tiny by comparison** |

**Marketing + CRM activity is ~30x the volume of actual patient work.** That stays roughly constant whether you have 5 patients or 500 patients per day, because it's driven by your existing 35K-contact CRM database, not by new visits.

## Cost components at scale (50 patients/day)

| Component | Today (dev) | Live with 50 patients/day | Change |
|---|---|---|---|
| Compute baseline (24/7 instance) | Fixed | Fixed | **0** |
| DB storage growth | ~250 MB | +1.2 GB/year | Negligible (<$0.05/mo) |
| Realtime egress | High (drip-driven) | High (still drip-driven) | **~0** |
| Edge function invocations | 82/day | ~250/day | Negligible |
| Storage buckets (snips, cards) | 1.7 MB | +50 MB/year | Negligible |
| WhatsApp message log writes | ~2K/day | ~2.1K/day | **~0** |

**Estimated bill at 50 patients/day:** ~$0.85-$1.00/day (vs. today's ~$1.30/day **after** today's fixes settle in). You'd actually be paying **less** than now.

## What WOULD make it spike (avoid these)

1. **Re-adding tables to realtime** — every table in `supabase_realtime` multiplies cost by (writes × connected tabs). Don't add tables back without need.
2. **Looping cron jobs** — any cron faster than every 5 minutes will dominate cost.
3. **Letting the drip engine run continuously without the daily cap** — already capped, just don't disable it.
4. **Subscribing to high-write tables in components that stay open all day** — keep using `refetchInterval: 30_000` instead of realtime where possible.
5. **Unbounded queries (no `.limit()`) on big tables** — counts as egress. The 1000-row guard already protects most reads.
6. **Bigger Cloud instance** — only upsize via Cloud → Overview → Advanced settings if you actually hit timeouts. Don't pre-scale.

## Realistic projection

| Patients/day | Estimated daily Cloud cost |
|---|---|
| 0 (today, dev only) | ~$0.85 (after fixes) |
| 50 (small live ops) | ~$0.95 |
| 200 (busy lab) | ~$1.20 |
| 500+ (multi-branch) | ~$2.00 + may need instance upsize |

You have **$25/month free Cloud balance**. At 200 patients/day you'd use ~$36/month → ~$11/month out of pocket. Not significant.

## Bottom line

Patient volume is **not** what was burning credits. **Marketing automation** and **realtime fan-out** were. Both are now controlled. Going live with patients will add **~10-15%** to your daily Cloud cost, not multiply it. You can confidently launch without expecting a cost explosion — just don't undo today's optimizations.

