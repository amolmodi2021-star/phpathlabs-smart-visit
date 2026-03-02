

# Plan: AI-Powered Prescription Reader for Create Estimate

## Overview
Add an optional "Scan Prescription" button to the Create Estimate page. Users can upload one or more images/PDFs of a doctor's prescription. An AI model reads the prescription, extracts patient name, phone number, and test names, then auto-matches tests from your test list. Doubtful/unrecognized tests are highlighted for manual review. After confirmation, the user proceeds with discount and home visit charges as usual.

## User Flow

```text
Create Estimate Page
  |
  +-- [Scan Prescription] button (optional, alongside manual flow)
  |     |
  |     +-- File picker opens (accept images + PDFs, multiple files)
  |     |
  |     +-- Files uploaded to a storage bucket
  |     |
  |     +-- Edge function called with file URLs + full test list
  |     |
  |     +-- AI extracts: patient name, phone, test names
  |     |
  |     +-- Results shown in a review dialog:
  |     |     - Patient name & phone auto-filled (editable)
  |     |     - Matched tests (green) -- auto-selected
  |     |     - Doubtful tests (amber) -- AI's best guess, highlighted
  |     |     - Unrecognized tests (red) -- shown as text for manual action
  |     |
  |     +-- User confirms -> tests added to estimate, name/phone filled
  |
  +-- Continue with discount, home visit charges, create & share
```

## Technical Details

### 1. Storage Bucket for Prescriptions
Create a public storage bucket `prescriptions` to temporarily hold uploaded files so the AI edge function can access them via URL.

### 2. Edge Function: `parse-prescription`
- Receives: array of file URLs + the complete test list (names and IDs)
- Calls Lovable AI (google/gemini-2.5-flash -- good at image+text, cost-effective) with the images and a structured prompt
- Uses tool-calling to extract structured output:
  - `patient_name` (string, nullable)
  - `whatsapp_number` (string, nullable)
  - `matched_tests` (array of `{test_id, test_name, confidence: "high"|"low"}`)
  - `unrecognized_tests` (array of strings -- test names AI couldn't match)
- Returns the structured result to the frontend

### 3. Frontend Changes (CreateEstimate.tsx)
- Add a "Scan Prescription" button with a camera/upload icon at the top of the form
- On file selection: upload files to the `prescriptions` bucket, call the edge function
- Show a review dialog with:
  - Extracted patient name and phone (pre-filled, editable)
  - List of matched tests with confidence indicators (high = green check, low = amber warning)
  - Unrecognized test names shown in red as plain text
  - "Confirm" button to apply selections
- On confirm: auto-fill patient name, WhatsApp number, and add matched tests to the selected tests list
- Loading state while AI processes

### 4. New Component: `PrescriptionScanDialog.tsx`
A dialog that shows AI results for review before applying them to the estimate form.

### 5. Config Updates
- Add `[functions.parse-prescription]` with `verify_jwt = false` to `supabase/config.toml`
- Storage bucket migration for `prescriptions`

### Files to Create/Modify
| File | Action |
|------|--------|
| `supabase/migrations/...` | Create `prescriptions` storage bucket |
| `supabase/functions/parse-prescription/index.ts` | New edge function for AI parsing |
| `supabase/config.toml` | Add function config |
| `src/components/PrescriptionScanDialog.tsx` | New review dialog component |
| `src/pages/CreateEstimate.tsx` | Add scan button, upload logic, dialog integration |

