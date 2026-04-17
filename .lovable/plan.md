
## Question 1: Auto-transfer for future results

**Yes, fully automatic.** The fix I deployed is in the edge function (`lims-interface`) which runs server-side every time the middleware POSTs results. Future results for `2604170001-F` / `-P` / `-R` (or any hyphenated suffix) will:

1. Hit the edge function
2. Strip the suffix correctly → resolve invoice → write to `patient_results`
3. Appear in Results Entry the moment that screen polls/refreshes its data

**No manual refresh button needed.** Results Entry already auto-refreshes via the realtime sync hook (`useRealtimeSync` subscribes to `patient_results` table changes). New rows pop in live.

The only "manual" step was for the **3 already-failed historical results** (PRM0025/26/27) — those landed before the fix existed, so they need a one-time reprocess. From here on, zero manual action.

## Question 2: Numeric suffixes (`2604170001-1`, `-2`, etc.)

**Current regex `/-?[A-Za-z]+$/` does NOT handle numeric suffixes.** For `2604170001-1` it would strip nothing (no trailing letters), leaving `invoiceNumber = "2604170001-1"` → no match → same bug all over again.

Need to broaden the regex to strip any hyphen + alphanumeric suffix.

## Fix

**`supabase/functions/lims-interface/index.ts`** — change regex in 2 places (lines 68 and 507):

```ts
// Before (only handles letters)
const invoiceNumber = sample_id.replace(/-?[A-Za-z]+$/, "");

// After (handles letters, digits, or mixed after hyphen)
const invoiceNumber = sample_id.replace(/-[A-Za-z0-9]+$/, "");
```

### Behavior matrix after fix
| Sample ID | Stripped to | Notes |
|---|---|---|
| `2604170001` | `2604170001` | No suffix, untouched ✓ |
| `2604170001-F` | `2604170001` | Letter suffix ✓ |
| `2604170001-P` | `2604170001` | Letter suffix ✓ |
| `2604170001-1` | `2604170001` | Numeric suffix ✓ (new) |
| `2604170001-12` | `2604170001` | Multi-digit ✓ (new) |
| `2604170001-F1` | `2604170001` | Mixed alphanumeric ✓ (new) |

### Why require the hyphen now (not optional)?
Invoice numbers themselves are pure 10-digit numerics (`YYMMDDXXXX` per memory). If we left the hyphen optional and allowed digits, a bare invoice like `2604170001` could get its trailing digits chewed off. **Requiring the literal `-` as the suffix delimiter** keeps un-suffixed invoices safe while handling every middleware suffix scheme (letter, digit, mixed).

## Out of scope
- No DB changes.
- No UI changes — Results Entry continues to auto-refresh as before.
- No changes to `query` (GET) path — still uses exact `sample_id` match, suffix preserved.

## Files
- `supabase/functions/lims-interface/index.ts` — 2-character regex tweak on lines 68 and 507.
