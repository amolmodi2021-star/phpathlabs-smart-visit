/**
 * CBC smear AI helpers: target param codes, image compress/upload, approve -> verification.
 */
import { supabase } from "@/integrations/supabase/client";
import { DIFFERENTIAL_PARAM_CODES, checkDifferentialSum } from "@/lib/differentialCount";
import { uploadBlobToCloudinary } from "@/lib/cardStorageCloudinary";

/** Cloudinary folder under the active WhatsApp account (not outsourced_pdf). */
export const CBC_SMEARS_FOLDER = "cbc-smears";
export const CBC_MAX_IMAGES = 15;
export const CBC_MIN_IMAGES_RECOMMENDED = 5;

export const CBC_DC_PARAM_CODES = [...DIFFERENTIAL_PARAM_CODES] as string[];

export const CBC_MORPHOLOGY_PARAM_CODES = [
  "PRM0157",
  "PRM0115",
  "PRM0102",
] as const;

export const CBC_MP_PARAM_CODE = "PRM0082";

/** Immature cells ? leave blank unless case is critical */
export const CBC_CRITICAL_ONLY_PARAM_CODES = [
  "PRM0331", // Blasts
  "PRM0332", // Promyelocytes
  "PRM0333", // Myelocytes
  "PRM0334", // Metamyelocyte
  "PRM0335", // Band Cells
  "PRM0336", // Normoblast
] as const;

export const CBC_CRITICAL_ONLY_DRAFT_KEYS = [
  "blasts",
  "promyelocytes",
  "myelocytes",
  "metamyelocyte",
  "band_cells",
  "normoblast",
] as const;

const CBC_CRITICAL_ONLY_CODE_SET = new Set<string>(CBC_CRITICAL_ONLY_PARAM_CODES);

export function isCbcCriticalOnlyParamCode(code?: string | null): boolean {
  return !!code && CBC_CRITICAL_ONLY_CODE_SET.has(String(code).toUpperCase());
}

export function hasCbcParamResultValue(value?: string | null): boolean {
  return !!(value && String(value).trim());
}

/**
 * Split CBC immature-cell params: filled ones stay in the main grid;
 * blank ones stay behind the optional dropdown until the user opens it.
 */
export function partitionCbcCriticalParams<T extends { paramCode?: string | null }>(
  params: T[],
  getValue: (p: T) => string | null | undefined,
): { mainParams: T[]; optionalVisible: T[]; optionalHidden: T[] } {
  const mainParams: T[] = [];
  const optionalVisible: T[] = [];
  const optionalHidden: T[] = [];
  for (const p of params) {
    if (!isCbcCriticalOnlyParamCode(p.paramCode)) {
      mainParams.push(p);
      continue;
    }
    if (hasCbcParamResultValue(getValue(p))) optionalVisible.push(p);
    else optionalHidden.push(p);
  }
  return { mainParams, optionalVisible, optionalHidden };
}


export const CBC_AI_TARGET_CODES = [
  ...CBC_DC_PARAM_CODES,
  ...CBC_MORPHOLOGY_PARAM_CODES,
  CBC_MP_PARAM_CODE,
  "PRM0331",
  "PRM0332",
  "PRM0333",
  "PRM0334",
  "PRM0335",
  "PRM0336",
] as const;

export type CbcAiDraft = {
  neutrophils_pct?: string | null;
  lymphocytes_pct?: string | null;
  monocytes_pct?: string | null;
  eosinophils_pct?: string | null;
  basophils_pct?: string | null;
  wbc_morphology?: string | null;
  rbc_morphology?: string | null;
  platelet_morphology?: string | null;
  malarial_parasites?: string | null;
  blasts?: string | null;
  promyelocytes?: string | null;
  myelocytes?: string | null;
  metamyelocyte?: string | null;
  band_cells?: string | null;
  normoblast?: string | null;
  confidence?: string | null;
  notes?: string | null;
};

export const CBC_DRAFT_TO_CODE: Record<keyof Omit<CbcAiDraft, "confidence" | "notes">, string> = {
  neutrophils_pct: "PRM0090",
  lymphocytes_pct: "PRM0080",
  monocytes_pct: "PRM0086",
  eosinophils_pct: "PRM0048",
  basophils_pct: "PRM0019",
  wbc_morphology: "PRM0157",
  rbc_morphology: "PRM0115",
  platelet_morphology: "PRM0102",
  malarial_parasites: "PRM0082",
  blasts: "PRM0331",
  promyelocytes: "PRM0332",
  myelocytes: "PRM0333",
  metamyelocyte: "PRM0334",
  band_cells: "PRM0335",
  normoblast: "PRM0336",
};

export function isCbcLikeTest(testName?: string | null, testCode?: string | null): boolean {
  const code = String(testCode || "").toUpperCase();
  if (code === "TST0068" || code === "TST0069") return true;
  const lower = String(testName || "").toLowerCase();
  return lower.includes("cbc") || lower.includes("complete blood count");
}

export async function compressImageForCbcAi(
  file: Blob,
  maxDim = 1600,
  quality = 0.82,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
  );
  if (!blob) throw new Error("Image compress failed");
  return blob;
}

/**
 * Upload a compressed smear JPEG to the active WhatsApp Cloudinary account.
 * Avoids Supabase Storage egress for microscope photos / AI fetches.
 */
export async function uploadCbcSmearImage(
  registrationId: string,
  testId: string,
  file: Blob,
  index: number,
): Promise<string> {
  const uploaded = await uploadBlobToCloudinary(file, {
    resourceType: "image",
    purpose: "whatsapp", // WhatsApp Cloudinary ? not outsourced_pdf
    folder: CBC_SMEARS_FOLDER,
    publicId: `${registrationId}_${testId}_${Date.now()}_${index}`,
    filename: `cbc_${index}.jpg`,
  });
  return uploaded.secure_url;
}


const CRITICAL_EMPTY_TOKENS = new Set(
  ["", "0", "0.0", "-", "nil", "none", "n/a", "na", "not seen", "absent", "adequate", "nad"],
);

/** Clear non-critical filler values from immature-cell draft fields. */
export function scrubCriticalOnlyDraftFields(draft: CbcAiDraft): CbcAiDraft {
  const next = { ...draft };
  for (const key of CBC_CRITICAL_ONLY_DRAFT_KEYS) {
    const raw = String(next[key] ?? "").trim();
    if (!raw || CRITICAL_EMPTY_TOKENS.has(raw.toLowerCase())) {
      next[key] = "";
    }
  }
  return next;
}

export function normalizeDifferentialDraft(
  draft: CbcAiDraft,
  keepFields: Array<keyof CbcAiDraft> = [],
): CbcAiDraft {
  const keys = [
    "neutrophils_pct",
    "lymphocytes_pct",
    "monocytes_pct",
    "eosinophils_pct",
    "basophils_pct",
  ] as const;
  const keep = new Set(keepFields);

  const nums = keys.map((k) => {
    const raw = String(draft[k] ?? "").trim();
    const m = raw.match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : NaN;
  });
  if (nums.some((n) => !Number.isFinite(n))) return draft;

  // Whole numbers only ? round UP (ceil), then fix so sum is exactly 100
  const ints = nums.map((n) => Math.max(0, Math.ceil(n)));
  const next = { ...draft };
  keys.forEach((k, i) => {
    next[k] = String(ints[i]);
  });

  let sum = ints.reduce((a, b) => a + b, 0);
  if (sum === 100) return next;

  const adjustableIdx = keys
    .map((k, i) => i)
    .filter((i) => !keep.has(keys[i]));
  // Prefer adjusting monocytes ? eosinophils ? basophils ? lymphocytes ? neutrophils
  const preferOrder = ["monocytes_pct", "eosinophils_pct", "basophils_pct", "lymphocytes_pct", "neutrophils_pct"];
  const rank = (i: number) => {
    const pos = preferOrder.indexOf(keys[i]);
    return pos >= 0 ? pos : 99;
  };
  const pool = (adjustableIdx.length > 0 ? adjustableIdx : keys.map((_, i) => i)).slice().sort((a, b) => rank(a) - rank(b));

  // Too high after ceil: decrement preferred adjustable cells (not below 0)
  let guard = 0;
  while (sum > 100 && guard++ < 50) {
    let changed = false;
    for (const i of pool) {
      const cur = parseInt(String(next[keys[i]]), 10) || 0;
      if (cur <= 0) continue;
      // Do not reduce locked machine fields unless no other choice (pool already prefers unlocked)
      if (keep.has(keys[i]) && adjustableIdx.length > 0) continue;
      next[keys[i]] = String(cur - 1);
      sum -= 1;
      changed = true;
      break;
    }
    if (!changed) break;
  }

  // Too low: increment preferred adjustable cells
  guard = 0;
  while (sum < 100 && guard++ < 50) {
    let changed = false;
    for (const i of pool) {
      if (keep.has(keys[i]) && adjustableIdx.length > 0) continue;
      const cur = parseInt(String(next[keys[i]]), 10) || 0;
      next[keys[i]] = String(cur + 1);
      sum += 1;
      changed = true;
      break;
    }
    if (!changed) break;
  }

  return next;
}

export async function applyCbcDraftToVerification(input: {
  registrationId: string;
  testId: string;
  draft: CbcAiDraft;
  paramByCode: Record<string, { parameterId: string; parameterName?: string; paramCode?: string }>;
  /** Skip forcing N+L+M+E+B = 100 (used when sending to doctor for DC entry). */
  skipDifferentialNormalize?: boolean;
}): Promise<void> {
  const draft = input.skipDifferentialNormalize
    ? input.draft
    : normalizeDifferentialDraft(input.draft);
  const updates: Array<{ parameterId: string; value: string }> = [];
  for (const [field, code] of Object.entries(CBC_DRAFT_TO_CODE) as Array<[
    keyof typeof CBC_DRAFT_TO_CODE,
    string
  ]>) {
    const raw = draft[field];
    if (raw == null || String(raw).trim() === "") continue;
    const meta = input.paramByCode[code];
    if (!meta?.parameterId) continue;
    updates.push({ parameterId: meta.parameterId, value: String(raw).trim() });
  }
  if (updates.length === 0) throw new Error("No CBC fields to transfer");

  for (const u of updates) {
    const { data: updated, error } = await supabase
      .from("patient_results")
      .update({ result_value: u.value } as any)
      .eq("registration_id", input.registrationId)
      .eq("test_id", input.testId)
      .eq("parameter_id", u.parameterId)
      .in("status", ["pending", "entered", "results_entered"])
      .select("id");
    if (error) throw error;
    if (updated && updated.length > 0) continue;

    const codeEntry = Object.entries(CBC_DRAFT_TO_CODE).find(
      ([, c]) => input.paramByCode[c]?.parameterId === u.parameterId,
    );
    const code = codeEntry?.[1] || null;
    const meta = code ? input.paramByCode[code] : undefined;
    const { error: insErr } = await supabase.from("patient_results").insert({
      registration_id: input.registrationId,
      test_id: input.testId,
      parameter_id: u.parameterId,
      param_code: code || meta?.paramCode || null,
      parameter_name: meta?.parameterName || null,
      result_value: u.value,
      status: "entered",
      entered_at: new Date().toISOString(),
    } as any);
    if (insErr) throw insErr;
  }
}


/** Mark smear review as sent to Dr. CBC (leaves CBC tech queue). */
export async function sendCbcToDoctor(input: {
  reviewId: string;
  registrationId: string;
  testId: string;
  draft: CbcAiDraft;
  paramByCode: Record<string, { parameterId: string; parameterName?: string; paramCode?: string }>;
  by: string;
  /** When true (CBC → Dr. CBC), do not force differential sum to 100 — doctor will enter DC. */
  skipDifferentialNormalize?: boolean;
}): Promise<void> {
  const scrubbed = scrubCriticalOnlyDraftFields(input.draft);
  const finalDraft = input.skipDifferentialNormalize
    ? scrubbed
    : scrubCriticalOnlyDraftFields(normalizeDifferentialDraft(scrubbed));
  // Apply AI/manual draft when present; allow image-only send if analyzer values already entered.
  const hasDraftValues = Object.entries(CBC_DRAFT_TO_CODE).some(([field]) => {
    const raw = finalDraft[field as keyof typeof CBC_DRAFT_TO_CODE];
    return raw != null && String(raw).trim() !== "";
  });
  if (hasDraftValues) {
    await applyCbcDraftToVerification({
      registrationId: input.registrationId,
      testId: input.testId,
      draft: finalDraft,
      paramByCode: input.paramByCode,
      skipDifferentialNormalize: input.skipDifferentialNormalize,
    });
  }
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("cbc_smear_reviews")
    .update({
      status: "sent_to_doctor",
      draft_result: finalDraft,
      sent_to_doctor_at: now,
      sent_to_doctor_by: input.by,
      updated_at: now,
    } as any)
    .eq("id", input.reviewId);
  if (error) throw error;
}
