
Add **Result Verification** to the same sort treatment.

## Change
`src/components/lims/ResultVerification.tsx` — update the Supabase query order to:
- `is_stat` desc (primary)
- `invoice_number` desc (secondary)

Replacing whatever the current secondary key is (likely `updated_at`).

## Updated file list
- `src/components/lims/SampleCollection.tsx`
- `src/components/lims/SampleAcceptance.tsx`
- `src/components/lims/ResultsEntry.tsx`
- `src/components/lims/ResultVerification.tsx` ← added
- `src/components/lims/DoctorApproval.tsx`
- `src/components/lims/Dispatch.tsx`

All six tabs will then show: STAT patients on top (newest invoice first), followed by non-STAT patients (newest invoice first). Consistent across the LIMS workflow.
