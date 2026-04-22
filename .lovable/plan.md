

# Show barcode IDs (with suffix) in Sample Collection + add print confirmation

## Two changes, both in `src/components/lims/SampleCollection.tsx`

### 1. Display barcode value instead of internal sample UID

Today every tube row shows the internal `sample_uid` (e.g. `S26042200020`). The user-facing scan value is actually `invoice_number + suffix` (e.g. `2604220001`, `2604220001-F`, `2604220001-2`) — that's exactly what `barcodePrint.ts` prints on the sticker.

Replace the three `{tube.sample_uid}` usages with a small helper:

```ts
const getBarcodeLabel = (reg: any, tube: SampleTubeRow) => {
  const suffix = tube.suffix?.trim();
  return suffix ? `${reg.invoice_number}${suffix}` : String(reg.invoice_number);
};
```

Replace at:
- **Line 470** — pending/collected tube card.
- **Line 501** — toast "Reprinted barcode for …".
- **Line 669** — Reprint dialog row.
- **Line 701** — Cancel Collection confirmation message.

Internal `sample_uid` stays in the database and in all backend logic (acceptance, results entry, reconcile) — nothing else changes. Only the visible label switches to what's actually printed on the sticker.

### 2. Confirmation dialog before any print action

Today four print actions fire instantly (no confirmation):
- Single tube Print (line 494) — `handleSinglePrintAndCollect`
- Print & Collect bulk (line 439) — `handlePrintAndCollect`
- Print All collected (line 446)
- Single tube reprint from collected list (line 501)
- Row-level Print All button (line 591)

Add one shared `printConfirmDialog` state holding `{ open, reg, tubes, action: () => void }`. Each of the five buttons above will, instead of printing immediately, open the dialog. The dialog body shows:

```
Patient Name:  HARSHADA MODI
Age / Gender:  45 / Female
Tubes to print: 8
  • 2604220001-F   (Fluoride)
  • 2604220001-2   (Fluoride)
  …
```

Buttons: **Cancel** | **Print**. Clicking Print runs the stored action (which calls the existing `doPrintBarcodes` + collection logic) and closes the dialog.

Use the existing `calcAge(reg.dob)` helper (already in file) and `reg.gender`.

The **Reprint dialog** (the one with reason text) already serves as a confirmation, so it does not need an additional confirmation step — its existing Reprint button stays as-is.

## Files changing

| File | Change |
|---|---|
| `src/components/lims/SampleCollection.tsx` | Add `getBarcodeLabel` helper; replace 4 visible `sample_uid` displays with it; add shared print-confirmation `Dialog`; route the 5 instant-print buttons through it |

## What stays untouched

- `barcodePrint.ts`, `sampleTubeGrouping.ts`, database, acceptance/results modules.
- Internal `sample_uid` is still the canonical key for all backend operations.
- Reprint-with-reason dialog flow is unchanged.

## Verification

1. Open `/lims?tab=sample_collection`, expand invoice 2604220001 — tube rows show `2604220001-F`, `2604220001-2`, `2604220001-3`, `2604220001-4`, `2604220001-5`, `2604220001-F`, `2604220001-2`, `2604220001-3` (instead of `S260422xxxx`).
2. Click any **Print**, **Print & Collect**, or **Print All** button → confirmation dialog appears showing patient name, age, gender and the tube list. Cancel aborts; Print proceeds with existing behavior.
3. Open the Collected tab → labels and Reprint dialog also show barcode IDs.
4. Reprint-with-reason dialog still works without a second confirmation popup.

## Risk

Very low. Pure UI relabeling + a thin confirmation wrapper around existing handlers. No data or backend logic touched.

