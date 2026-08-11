---
name: pipeline-audit
description: >-
  Run a LIMS pipeline audit on PHPL cloud: register one patient with many tests,
  leave work pending at every stage (collection, acceptance, results, verify,
  approve), assert the same registration is visible in each pipeline tab with
  the expected tests, then clean up leftovers. Never send WhatsApp. Use when the
  user says "pipeline audit" or asks to sanity-check the full LIMS pipeline flow.
---

# Pipeline audit

## When to run

Whenever the user says **pipeline audit** (or clearly asks for this same end-to-end partial-stage sanity check).

## Hard rules

- Target **PHPL cloud** (`gqpqnfvihjjkmbcdzate` / `.env` `VITE_SUPABASE_URL`) unless the user names another project.
- **Never send WhatsApp** (no templates, outbox send, CRM WA, drip, report WA).
- Always **clean up** audit leftovers (success or failure).
- Prefer script: `node scripts/cloud-pipeline-audit.mjs`
- Report: `data-export/cloud-pipeline-audit-report.json`

## What the audit must do

1. **Register** one lab patient with **many tests** (≥8 in-house with parameters, on **≥4 distinct tubes** when masters allow).
2. **Partial collect** — leave ≥1 tube `pending` (visible in Sample Collection).
3. **Partial accept** — of collected tubes, accept only some; leave ≥1 `collected` (visible in Sample Acceptance).
4. **Partial results** — enter results for only some accepted tests; leave ≥1 accepted test unentered (Results Entry).
5. **Partial verify** — verify only some entered tests; leave ≥1 entered (Verification).
6. **Partial approve** — approve only some verified tests; leave ≥1 verified (Doctor Approval). Optionally approve ≥1 so Dispatch can see the patient.
7. **Freeze** in that multi-pending state — do **not** finish remaining collection/accept/entry before the tab audit.
8. **Tab audit** (same `registration_id` must appear where expected):
   - Sample Collection: pending/deferred tubes for this reg
   - Sample Acceptance: collected tubes for this reg
   - Results Entry: `lims_results_entry_candidate_ids` includes reg + unentered accepted tests exist
   - Verification: `lims_verification_candidate_ids` includes reg + entered rows exist
   - Doctor Approval: `lims_doctor_approval_candidate_ids` includes reg + verified rows exist
   - Dispatch (if any approved): `lims_dispatch_candidate_ids` includes reg
9. Recalc registration status after each stage (mirror `recalculateRegistrationStatus`).
10. **Cleanup** all `PIPELINEAUDIT%` registrations, tubes, results, snips, orders, payments, master rows.

## Pass / fail

- Pass only if every expected tab visibility check is OK and cleanup leaves zero `PIPELINEAUDIT%` regs.
- Summarize for the user: invoice, status, per-tab pending test counts, flaws, cleaned yes/no.
- Do not claim UI is fine if only DB/RPC checks passed — say it audited **queue membership / tube+result state** (same filters the tabs use).

## Script

```bash
node scripts/cloud-pipeline-audit.mjs
```

Env: `.env` + `supabase/.env.cloud-phpl-secrets` (service role). Marker prefix: `PIPELINEAUDIT`.
