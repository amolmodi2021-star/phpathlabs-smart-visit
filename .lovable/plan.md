
This is a question, not a change request — answering directly.

**Applies to ALL parameters, not just PRM0101.**

The `applyUnitConversion` helper is generic — it reads each parameter's own settings from `report_test_parameters`:
- `unit_conversion_enabled` (toggle ON/OFF)
- `unit_conversion_operator` (`*` or `/`)
- `unit_conversion_value` (the factor)

For every machine result coming through the LIMS interface, the bridge looks up that parameter's row and:

| Parameter state | What happens |
|---|---|
| Toggle ON + valid factor | Conversion applied (e.g. PRM0101 × 1000) |
| Toggle OFF | Raw value stored as-is |
| Non-numeric value (e.g. "POSITIVE") | Stored as-is, even if toggle ON |
| Invalid/missing factor | Raw value stored as-is (safe fallback) |

So PRM0101 was just the example — any parameter you configure in Test Management → Parameters with the unit conversion toggle ON (e.g. WBC × 1000, RBC × 10⁶, etc.) will be auto-converted on every interface result going forward. No per-parameter code changes needed; just configure the toggle + formula in the UI.
