/**
 * Helpers for the "time" range type (minutes + seconds).
 *
 * Storage conventions:
 *   - parameter_normal_ranges.normal_range_low / normal_range_high  → total seconds
 *   - patient_results.result_value                                  → canonical "M:SS" string
 *
 * Display conventions (PDF + UI):
 *   - "2 mins 30 secs", "3 mins", "45 secs"
 *   - Range: "2 mins – 7 mins" / "1 min 30 secs – 7 mins"
 */

export const TIME_RESULT_PATTERN = /^(\d{1,3}):([0-5]?\d)$/;

export function secondsToMinSec(total: number | null | undefined): { min: number; sec: number } {
  if (total == null || isNaN(Number(total))) return { min: 0, sec: 0 };
  const t = Math.max(0, Math.round(Number(total)));
  return { min: Math.floor(t / 60), sec: t % 60 };
}

export function minSecToSeconds(min: number | string | null | undefined, sec: number | string | null | undefined): number {
  const m = Math.max(0, Math.floor(Number(min) || 0));
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  // allow seconds > 59 → roll over
  return m * 60 + s;
}

/** "2:30" → "2 mins 30 secs".  "0:45" → "45 secs".  "3:00" → "3 mins". */
export function formatTimeResult(value: string | null | undefined): string {
  if (!value) return "";
  const v = String(value).trim();
  const m = v.match(TIME_RESULT_PATTERN);
  if (!m) return v; // not in canonical form — return as-is
  const min = parseInt(m[1], 10);
  const sec = parseInt(m[2], 10);
  if (min === 0 && sec === 0) return "";
  if (min === 0) return `${sec} secs`;
  if (sec === 0) return `${min} mins`;
  return `${min} mins ${sec} secs`;
}

export function isCanonicalTimeValue(value: string | null | undefined): boolean {
  if (!value) return false;
  return TIME_RESULT_PATTERN.test(String(value).trim());
}

/** total seconds → "2 mins 30 secs" piece (used inside a range). */
function formatSecondsPiece(total: number | null | undefined): string {
  if (total == null) return "";
  const { min, sec } = secondsToMinSec(total);
  if (min === 0 && sec === 0) return "0 secs";
  if (min === 0) return `${sec} secs`;
  if (sec === 0) return `${min} mins`;
  return `${min} mins ${sec} secs`;
}

export function formatTimeRange(lowSec: number | null | undefined, highSec: number | null | undefined): string {
  const hasLow = lowSec != null;
  const hasHigh = highSec != null;
  if (!hasLow && !hasHigh) return "";
  if (hasLow && hasHigh) return `${formatSecondsPiece(lowSec)} – ${formatSecondsPiece(highSec)}`;
  if (hasLow) return `≥ ${formatSecondsPiece(lowSec)}`;
  return `≤ ${formatSecondsPiece(highSec)}`;
}

/** Parse a stored result ("2:30" or legacy "2 min 30 sec") into total seconds; returns null if invalid. */
export function parseTimeResultToSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const v = String(value).trim();
  const m = v.match(TIME_RESULT_PATTERN);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);

  const lower = v.toLowerCase();
  const minMatch = lower.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/);
  const secMatch = lower.match(/(\d+)\s*(?:s|sec|secs|second|seconds)\b/);
  if (minMatch || secMatch) {
    return (minMatch ? parseInt(minMatch[1], 10) * 60 : 0) + (secMatch ? parseInt(secMatch[1], 10) : 0);
  }
  return null;
}

export function toCanonicalTimeResult(value: string | null | undefined): string {
  const total = parseTimeResultToSeconds(value);
  if (total == null) return "";
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Build canonical "M:SS" from raw min/sec inputs (handles sec rollover). */
export function buildCanonicalTime(min: number | string | null | undefined, sec: number | string | null | undefined): string {
  const total = minSecToSeconds(min, sec);
  if (total === 0 && (min === "" || min == null) && (sec === "" || sec == null)) return "";
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
