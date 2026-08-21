/**
 * Normalize analyzer result codes before LIMS mapping.
 *
 * Indiko ASTM Universal Test ID often arrives as:
 *   code: "0.0"          (dilution / last caret field)
 *   name: "^^^008^0.0"   (real assay code 008)
 * `0.0` is on lims_no_map_required, so those rows were ignored and never
 * reached Results / Verification even though the interface log showed them.
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
