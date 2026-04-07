type DatedAbnormalTest = {
  test_date?: string | null;
  created_at?: string | null;
};

const parseDayFirstDate = (value: string): number | null => {
  const match = value.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!match) return null;

  const [, dayRaw, monthRaw, yearRaw] = match;
  const day = Number(dayRaw);
  const month = Number(monthRaw);
  const shortYear = Number(yearRaw);
  const year = yearRaw.length === 2 ? (shortYear >= 70 ? 1900 + shortYear : 2000 + shortYear) : shortYear;
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed.getTime();
};

export const getAbnormalTestDateSortValue = (value?: string | null): number => {
  if (!value) return Number.NEGATIVE_INFINITY;

  const normalized = value.trim();
  if (!normalized) return Number.NEGATIVE_INFINITY;

  const dayFirstTimestamp = parseDayFirstDate(normalized);
  if (dayFirstTimestamp !== null) return dayFirstTimestamp;

  const fallbackTimestamp = Date.parse(normalized);
  return Number.isNaN(fallbackTimestamp) ? Number.NEGATIVE_INFINITY : fallbackTimestamp;
};

export const sortAbnormalTestsByDateDesc = <T extends DatedAbnormalTest>(tests: T[]): T[] =>
  [...tests].sort((a, b) => {
    const timestampDiff = getAbnormalTestDateSortValue(b.test_date) - getAbnormalTestDateSortValue(a.test_date);
    if (timestampDiff !== 0) return timestampDiff;
    return (b.created_at || "").localeCompare(a.created_at || "");
  });