/**
 * Normalize analyzer result codes before LIMS mapping.
 *
 * Indiko sends two shapes for the same assay:
 *   1) Proper mapped code: { code: "008", name: "C-REACTIVE PROTEIN (CRP)" }
 *   2) ASTM dilution leftover: { code: "0.0", name: "^^^008^0.0" }
 *
 * `0.0` is on lims_no_map_required. We MUST recover the assay code from the
 * ASTM name *before* mapping / ignore-list, otherwise the row is dropped.
 * When both shapes arrive in one payload, keep the proper mapped code.
 *
 * Keep this file isomorphic (no Deno / DOM) so vitest can import it.
 */
export function normalizeInterfaceResultCode(
  rawCode: string | null | undefined,
  rawName: string | null | undefined,
): string {
  const code = String(rawCode ?? "").trim();
  const name = String(rawName ?? "").trim();
  const fromCode = astmLocalAssayCode(code);
  if (fromCode) return fromCode;
  if (name.includes("^")) {
    const fromName = astmLocalAssayCode(name);
    if (fromName) return fromName;
  }
  return code;
}

export function interfaceResultCodeFromRow(row: {
  code?: string | null;
  test_code?: string | null;
  name?: string | null;
  test_name?: string | null;
} | null | undefined): string {
  if (!row) return "";
  return normalizeInterfaceResultCode(
    row.code || row.test_code || "",
    row.name || row.test_name || "",
  );
}

/**
 * One row per assay code.
 * Prefer a proper mapped code (008) over a 0.0 / ASTM fallback for the same assay.
 * If only 0.0 arrived, keep the recovered assay (^^^008^0.0 → 008).
 */
export function collapseInterfaceResultRows<T extends {
  code?: string | null;
  test_code?: string | null;
  name?: string | null;
  test_name?: string | null;
}>(results: T[] | null | undefined): Array<T & { code: string }> {
  type Slot = { row: T & { code: string }; fromDilution: boolean };
  const slots = new Map<string, Slot>();
  for (const r of results || []) {
    const original = String(r?.code ?? r?.test_code ?? "").trim();
    const code = interfaceResultCodeFromRow(r);
    if (!code) continue;
    const fromDilution = isDilutionToken(original) || original.includes("^");
    const next = { row: { ...r, code }, fromDilution };
    const prev = slots.get(code);
    if (!prev) {
      slots.set(code, next);
      continue;
    }
    if (prev.fromDilution && !fromDilution) {
      slots.set(code, next);
    }
  }
  return Array.from(slots.values()).map((s) => s.row);
}

/** True when the token is a dilution / sequence like 0.0, 1.0 — not assay 008. */
export function isDilutionToken(token: string): boolean {
  return /^\d+\.\d+$/.test(token.trim());
}

function astmLocalAssayCode(raw: string): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (!s.includes("^") && !isDilutionToken(s)) return s;
  const parts = s.split("^").map((p) => p.trim()).filter(Boolean);
  const assay = parts.find((p) => p.length > 0 && !isDilutionToken(p));
  return assay || null;
}

/** XP-300 posts as machine_id XP-300 while orders store Sysmex. */
export function machineIdAliases(machineId: string): Set<string> {
  const s = String(machineId || "").trim().toLowerCase();
  const out = new Set<string>();
  if (!s) return out;
  out.add(s);
  if (s === "xp-300" || s === "xp300" || s === "sysmex") {
    out.add("xp-300");
    out.add("xp300");
    out.add("sysmex");
  }
  return out;
}

export function orderTestsMatchMachine(tests: Array<{ machine_id?: string }> | null | undefined, machineId: string): boolean {
  const aliases = machineIdAliases(machineId);
  if (aliases.size === 0) return false;
  for (const t of tests || []) {
    const tm = String(t?.machine_id || "").trim().toLowerCase();
    if (tm && aliases.has(tm)) return true;
  }
  return false;
}
