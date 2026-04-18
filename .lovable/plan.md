
## Goal
Stop Chrome's "Manage addresses…" autofill popup from covering the patient lookup dropdown in LIMS → New Registration.

## Root cause
The Mobile Number `<Input type="tel">` in `src/components/lims/PatientRegistration.tsx` (line 544) has no autocomplete attributes. Chrome detects it as a phone field and overlays its own autofill suggestions on top of our `patientMatches` dropdown.

## Fix
Add browser-autofill suppression attributes to the input:

- `autoComplete="off"` (and a non-standard value like `"one-time-code"` as Chrome ignores plain `"off"` for tel/address fields)
- `name="lims-mobile-search"` (non-semantic name so Chrome doesn't classify it as a phone field)
- `data-form-type="other"` (extra hint to bypass autofill)
- `aria-autocomplete="list"` + `role="combobox"` so it's announced as our own combobox, not a phone entry
- Wrap the input in a `<form autoComplete="off">` shell or add `autoComplete="new-password"` (most reliable Chrome bypass) — we'll use `autoComplete="new-password"` since it's the documented workaround that consistently disables Chrome's address/phone autofill across versions.

Single edit, ~3 lines, in `src/components/lims/PatientRegistration.tsx` around line 544–551.

## Out of scope
- Other mobile inputs (home-visit dialogs etc.) — they don't have a custom dropdown beneath them, so Chrome's popup isn't blocking anything there. Leave untouched.
- Any logic / styling / dropdown behavior.

## Expected outcome
Typing a mobile number in New Registration shows ONLY our patient-match dropdown — no Chrome autofill / "Manage addresses…" popup overlapping it.
