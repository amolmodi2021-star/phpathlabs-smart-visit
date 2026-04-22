

# Add an editable test-level note (default "Kindly correlate clinically") shown above Interpretation

## What you'll get

In **Results, Result Verification, and Doctor Approval**, every test card (the row that today reads e.g. *"FBS  0/1   Transfer to Outsourced  Save & Verify"*) gets a small **📝 sticky-note icon** next to the test name — exactly like the per-parameter note today, but for the whole test.

- Click → an inline editor appears, pre-filled with **"Kindly correlate clinically"**.
- Editable to any text. A small trash icon clears it (so it doesn't appear on the report).
- Once entered/edited, it's saved with the test's results.

In the **report**, when present, the note renders as a small bold/italic line **directly above the Interpretation block** for that test. If no Interpretation exists, the note still renders at the same spot (right under the parameter table). Empty/cleared note → renders nothing.

## Storage

Add column **`patient_results.test_note text NULL`**. Whenever results for a given (registration, test) are saved, the same `test_note` value is written to every row of that test (cheap, denormalised, mirrors how `entered_by` etc. is already replicated).

On read, the test-level note for a test = first non-null `test_note` among that test's `patient_results` rows. (`patient_results` is the existing source for both Results, Verification, Approval, and the report's parameter list.)

## Changes per file

### Database — one additive migration
- `ALTER TABLE public.patient_results ADD COLUMN test_note text;` (nullable, no default — absence = no note shown).

### `src/components/lims/ResultsEntry.tsx`
1. Hydrate per-test note in the loader (line ~648 area): for each test group, set `testNote = first patient_results row's test_note for that (reg, test)`. Carry it on the `tg`/test-level structure (or in a `Record<testKey, string>` map).
2. Add `testNotesEdited: Record<testKey, string>` state and `activeTestNoteKey` (mirrors existing `editedNotes`/`activeNoteKey` per-parameter pattern).
3. In the test-row header (line ~1380, where `{tg.testName}` and `{filledCount}/{tg.params.length}` render), insert a **StickyNote** icon (same component/pattern as parameter note at line 1063), with the same default-fill-on-click behavior ("Kindly correlate clinically") and inline edit + Trash2 to clear. Show the saved note as a small `📝 …` line below the row when present and not editing (mirrors lines 1081–1088).
4. In `saveMutation` (line ~814 upserts), include `test_note: testNotesEdited[testKey] ?? loadedTestNote[testKey] ?? null` on every upsert row of that test.

### `src/components/lims/ResultVerification.tsx`
- Repeat the same three-piece treatment: hydrate `testNote` per (reg,test), render the StickyNote next to the test name in the test-row card (same place as line 786 pattern, but at the test header), include `test_note` in the verify upsert (lines 599, 648, 695).

### `src/components/lims/DoctorApproval.tsx`
- Same as Verification (lines 623 pattern).
- In the approval archive merge (`mergedResults` at lines ~408 and ~488), tag each archived row with the current `test_note` value so approved reports stay self-contained (matches the per-parameter `note` snapshotting already done).

### `src/pages/LimsReportView.tsx`
- In `tpData` / per-test load, also read `test_note` (first non-null among that test's rows; or from the approved snapshot when reading from `approved_reports`).
- Extend `TestBlock` with `testNote?: string`.
- In `buildProfileMetaMap`, attach `test_note: block.testNote` onto each `ProfileMeta`.

### `src/components/report/ReportResultsSection.tsx`
- Extend `ProfileMeta` with `test_note?: string`.
- In the profile rendering block (line 368, just before `{hasInterpretation && …}`), add:
  ```tsx
  {profMeta?.test_note?.trim() && (
    <div className="px-3 py-1 italic font-semibold text-gray-700 border-t border-gray-100"
         style={{ fontSize: metaFontSize }}>
      {profMeta.test_note}
    </div>
  )}
  ```
- Render order is now: parameters table → **test_note** → Interpretation → Outsourced caption.

## What stays untouched

- Per-parameter notes (`patient_results.note`) — unchanged.
- Test-level **Interpretation** field in Test Management — unchanged; test note is a separate, lighter clinical hint that lives above it.
- `approved_reports` schema — only the JSONB row gets an extra `test_note` key per test entry (additive, safe).
- Sample collection, billing, dispatch, single-parameter overrides.

## Verification

1. Open `/lims?tab=results` → expand any patient → click the new 📝 next to a test name (e.g. **FBS**) → field appears pre-filled with "Kindly correlate clinically" → Save & Verify.
2. Repeat the click in **Result Verification** and **Doctor Approval** to edit/clear before approval.
3. View the approved report → the note appears as a small italic line **above** the test's Interpretation block (and above where Interpretation would be even if absent).
4. Clear the note (trash icon) → reload report → line disappears.
5. Tests where the note was never touched continue to render exactly as today (no default text leaks into reports — only an explicit save persists "Kindly correlate clinically").

## Risk

Low. Additive column, no existing-row backfill needed (NULL = unchanged behavior). UI mirrors the well-tested per-parameter note pattern. Render addition is presentational and gated on non-empty value.

