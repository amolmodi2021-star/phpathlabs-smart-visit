// Differential count validation: WBC differential parameters whose sum must equal 100.
export const DIFFERENTIAL_PARAM_CODES = [
  "PRM0090",
  "PRM0080",
  "PRM0086",
  "PRM0048",
  "PRM0019",
] as const;

const DIFF_SET = new Set<string>(DIFFERENTIAL_PARAM_CODES as readonly string[]);

export interface DiffCheckParam {
  paramCode?: string | null;
  value: string | number | null | undefined;
}

export interface DiffCheckResult {
  hasDifferential: boolean;
  sum: number;
  diff: number; // 100 - sum  (positive => less than 100, negative => more than 100)
  isOk: boolean;
  presentCodes: string[];
}

const parseNum = (v: unknown): number => {
  if (v == null) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  // strip non-numeric trailing characters (units etc.)
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return 0;
  const n = parseFloat(m[0]);
  return isFinite(n) ? n : 0;
};

export function checkDifferentialSum(params: DiffCheckParam[]): DiffCheckResult {
  const present = params.filter((p) => p.paramCode && DIFF_SET.has(p.paramCode));
  if (present.length === 0) {
    return { hasDifferential: false, sum: 0, diff: 100, isOk: true, presentCodes: [] };
  }
  let sum = 0;
  for (const p of present) sum += parseNum(p.value);
  const rounded = Math.round(sum * 100) / 100;
  const diff = Math.round((100 - rounded) * 100) / 100;
  return {
    hasDifferential: true,
    sum: rounded,
    diff,
    isOk: Math.abs(diff) < 0.001,
    presentCodes: present.map((p) => p.paramCode!) ,
  };
}
