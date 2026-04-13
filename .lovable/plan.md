

# Block Dispatch Actions for Patients with Due Payments

## Problem
Patients with outstanding dues can still have their reports viewed, downloaded, shared via WhatsApp, and dispatched. The system should block all dispatch actions and clearly show the due amount.

## Solution

### Changes in `src/components/lims/Dispatch.tsx`

1. **Fetch `due_amount`**: Add `due_amount` to the select query (line 89) so each registration carries its due balance.

2. **Left panel — DUE indicator on patient card** (lines 454-457 area): When `reg.due_amount > 0`, show a red `DUE ₹{amount}` badge below the invoice number line.

3. **Right panel header — Disable all action buttons** (lines 507-523): Wrap the View Report, WhatsApp, and Dispatch All buttons in a condition: if `due_amount > 0`, disable all buttons and show a prominent "DUE ₹{amount}" badge instead.

4. **Per-test row — Disable View Snip, WhatsApp, Dispatch buttons** (lines 557-596): When `due_amount > 0`, disable the View Snip button, WhatsApp button, and individual Dispatch button. Keep status and TAT badges visible but make action buttons non-functional.

5. **Report select dialog** (line 674): Disable the Generate Report button if the selected entry has a due amount.

This is a UI-only enforcement — the `due_amount` column already exists in `patient_registrations`.

