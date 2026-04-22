

# Add note editing (parameter + test level) in Modified Approval

## What you'll get

In **Modified Approval**, every test card and every parameter row gets the same 📝 sticky-note icon already used in Results, Verification, and Doctor Approval:

- **Test-level note** (📝 next to test name) — defaults to "Kindly correlate clinically" on first click; editable; trash-icon to clear. Renders above Interpretation in the report.
- **Parameter-level note** (📝 next to parameter name) — same pattern; renders as italic line under the parameter name in the report.

Edits save together with the existing Result/Unit/Ref-range/Flag edits via the existing **Save Changes** button. The re-saved snapshot in `approved_reports` carries both notes, so report rendering picks them up immediately (live `patient_results` AND the JSONB snapshot are both updated).

## Single-file change — `src/components/lims/ModifiedApproval.tsx`

### 1. New state
```ts
const [editedNotes, setEditedNotes] = useState<Record<string, string>>({});           // key: regId||parameterId
const [activeNoteKey, setActiveNoteKey] = useState<string | null>(null);
const [editedTestNotes, setEditedTestNotes] = useState<Record<string, string>>({});   // key: regId||testId
const [activeTestNoteKey, setActiveTestNoteKey] = useState<string | null>(null);
```
Add `StickyNote, Trash2` to the `lucide-react` import.

### 2. Pull `note` and `test_note` from `patient_results`
The existing `approvedResults` query already does `select("*")` so both fields arrive. Build a `loadedTestNotes` map (first non-null `test_note` per `regId||testId`) inside `entries` memo, just like `ResultVerification.tsx` lines 414–421.

### 3. UI additions
- **Test header (line 327, next to `{tg.testName}`)**: insert `<StickyNote>` icon + inline edit row + saved-note display row, mirroring `ResultVerification.tsx` lines 976–1009.
- **Parameter cell (line 369, next to `{p.parameterName}`)**: insert `<StickyNote>` icon + inline edit row + saved-note display row, mirroring `ResultVerification.tsx` lines 805–821. Key = `${report.registration_id}||${p.parameter_id}`.

### 4. Persist on save (`saveChanges`, lines 185–247)
For each parameter, extend the `patient_results` UPDATE and the JSONB snapshot row:
```ts
const noteKey = `${regId}||${p.parameter_id}`;
const testNoteKey = `${regId}||${tg.testId}`;
const newNote = editedNotes[noteKey] !== undefined ? (editedNotes[noteKey] || null) : (p.note ?? null);
const newTestNote = editedTestNotes[testNoteKey] !== undefined
  ? (editedTestNotes[testNoteKey] || null)
  : (loadedTestNotes[testNoteKey] || null);

await supabase.from("patient_results").update({
  result_value: newValue || null,
  unit: newUnit || null,
  reference_range: newRefRange || null,
  flag: newFlag || null,
  note: newNote,
  test_note: newTestNote,
}).eq("id", p.id);

allTestResults.push({
  // …existing fields…
  note: newNote,
  test_note: newTestNote,
});
```
For snip-only test rows (no params), still push `test_note: newTestNote` so the test-level note survives in the snapshot.

### 5. Hook into `hasEdits` and the post-save reset
Add `editedNotes` and `editedTestNotes` to both `hasEdits` (line 249) and the per-prefix clear loop (lines 239–242) so the Save button enables/disables correctly and edits clear after saving.

## What stays untouched

- `LimsReportView.tsx` — already reads `note` (rendered as `remark` → small italic line) and `test_note` (rendered above Interpretation) from both live `patient_results` and the `approved_reports.test_results` JSONB snapshot. No change needed.
- `ReportResultsSection.tsx` — already renders both notes.
- `DoctorApproval.tsx`, `ResultsEntry.tsx`, `ResultVerification.tsx` — unchanged.
- DB schema — `patient_results.note` and `patient_results.test_note` already exist.

## Verification

1. `/lims?tab=modified` → expand any approved report.
2. Click 📝 next to a parameter name → edits to "Kindly correlate clinically" → tweak text → Save Changes.
3. Click 📝 next to the test name → edit/clear → Save Changes.
4. Open the report (View Report from Dispatch or Modified Approval) → parameter note shows as italic line under parameter name; test note shows above Interpretation.
5. Clear a note (trash icon) → Save → reload report → note disappears.
6. Existing reports with no notes render unchanged.

## Risk

Low. Single-file UI addition, mirrors well-tested pattern from `ResultVerification.tsx`. Schema unchanged. The save path already re-writes both `patient_results` rows and the `approved_reports` JSONB, so adding two more columns to those writes is safe.

