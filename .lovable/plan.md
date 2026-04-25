## Plan: Add User-Wise PDF Print to Daily Report

Add a third toolbar action: **"Print User-wise PDF"** with a small dropdown letting the operator choose:
- **All Users** — single PDF containing one section per user with that user's grand totals, plus a final consolidated summary.
- A specific user (each entry from `uniqueUsers`) — single PDF containing only that user's transactions and grand totals.

Existing **Export Excel** and **Print PDF (Compact)** stay unchanged.

### UI changes (`src/components/lims/DailyReport.tsx`)

Replace the standalone `Print PDF` button with two adjacent controls:
- `Print PDF` (existing — flat compact list).
- **`Print User-wise`** — `DropdownMenu` (already used elsewhere via `@/components/ui/dropdown-menu`) trigger button:
  ```
  [ Print User-wise ▾ ]
    ├─ All Users (one PDF, sectioned)
    ├─ ─────────
    ├─ ravi
    ├─ priya
    └─ ...   (from uniqueUsers)
  ```
  Disabled when `filtered.length === 0` or `uniqueUsers.length === 0`.

### `printUserwisePdf(targetUser: "ALL" | string)` function

Reuses the same compact A4 landscape layout, column widths, helpers (`fmtAmt`, `truncate`, `visitShort`), header drawing, and page-break logic from existing `printPdf`. Refactor shared bits into local helpers inside the new function (no exported module — keep the file self-contained).

**Behavior:**

1. **Group rows by `performed_by`** from `filtered` (treating empty/null as `"(Unassigned)"`).
2. **Determine user list**:
   - If `targetUser === "ALL"`: iterate every user with rows, in alphabetical order.
   - Else: only that one user (skip if no rows → show toast / silently no-op).
3. **For each user section**:
   - Force `doc.addPage()` between users (first user starts on page 1).
   - Title band: `"User: <name>"` + transaction count + date range, on a colored bar.
   - Compact table identical to existing PDF (21 columns, 6.5pt rows).
   - **Per-user grand totals row** at end of section (Gross/Disc/Final/Paid/Due/Cash/GPay/Paytm/NEFT/CC/Refund + Net = In−Out).
4. **For `ALL`**:
   - **Final consolidated summary page** appended at the end:
     - Title: "User-wise Collection Summary"
     - Compact table with columns: `User`, `Txns`, `Cash`, `GPay`, `Paytm`, `NEFT`, `CC`, `Total In`, `Refund/Out`, `Due`, `Net Collection`.
     - One row per user, sorted by Net Collection desc.
     - Final totals row (matches the report-wide totals already computed).
5. **Footer & page numbering**: existing pattern (`Page X of Y`, brand line on left).
6. **Filename**:
   - All Users: `Daily_Report_Userwise_{from}_to_{to}.pdf`
   - Single user: `Daily_Report_{username}_{from}_to_{to}.pdf`
   - When `isSearching`: replace date portion with `search_{term}`.

### Files Changed
- `src/components/lims/DailyReport.tsx` — add `DropdownMenu` import, add `printUserwisePdf` function, add user-wise dropdown button next to existing PDF button. No DB changes, no new dependencies.