/**
 * Drip card senders / abnormal card generation helpers.
 *
 * The drip-campaign engine has been disabled for cost reasons. The remaining
 * export here, `generateAbnormalCardForDrip`, is still used by the manual
 * `AbnormalBulkSender` (Loyalty Cards → Abnormal Cards tab). It returns null
 * to signal that automatic card generation is unavailable; the bulk sender
 * surfaces this as a "Card generation failed" row error.
 *
 * If you want the manual abnormal-card flow back, wire it up to render via
 * `src/lib/cardRenderer.ts` and upload via `src/lib/cardStorageCloudinary.ts`.
 */
export async function generateAbnormalCardForDrip(
  _patient: { patient_name: string; mobile_number: string; umr_number: string },
  _tests: Array<{ test_name: string; test_date: string; result_value: string; normal_range: string }>,
  _cardTemplate: unknown,
  _footerText: string,
): Promise<string | null> {
  return null;
}
