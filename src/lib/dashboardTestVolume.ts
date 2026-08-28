import { supabase } from "@/integrations/supabase/client";

/** One billed occurrence of a leaf test (standalone or from package/profile/combo). */
export type LeafContribution = {
  testId: string;
  testName: string;
  gross: number;
  discount: number;
  net: number;
  registrationId: string;
  invoiceNumber: string;
  patientName: string;
  title: string | null;
  createdAt: string;
};

export type TestVolumeRow = {
  testId: string;
  testName: string;
  qty: number;
  gross: number;
  discount: number;
  net: number;
};

export type ExpansionMaps = {
  catalog: Record<string, { name: string; price: number }>;
  packageLeaves: Record<string, string[]>;
  profileLeaves: Record<string, string[]>;
  comboLeaves: Record<string, string[]>;
  packageIds: Record<string, true>;
  profileIds: Record<string, true>;
  comboIds: Record<string, true>;
};

export const EMPTY_EXPANSION_MAPS: ExpansionMaps = {
  catalog: {},
  packageLeaves: {},
  profileLeaves: {},
  comboLeaves: {},
  packageIds: {},
  profileIds: {},
  comboIds: {},
};

type BookedReg = {
  id: string;
  invoice_number?: string | null;
  patient_name?: string | null;
  title?: string | null;
  created_at?: string | null;
  bill_cancelled?: boolean | null;
  tests?: any;
  cancelled_tests?: any;
};

const MASTER_TTL_MS = 30 * 60_000;
let masterCache: {
  at: number;
  packageIds: Record<string, true>;
  profileIds: Record<string, true>;
  comboIds: Record<string, true>;
} | null = null;

function lineGross(t: any): number {
  return Number(t?.price ?? 0) || 0;
}

function lineNet(t: any): number {
  if (t?.discounted_price != null && t.discounted_price !== "") {
    return Number(t.discounted_price) || 0;
  }
  const disc = Number(t?.discount ?? 0) || 0;
  return Math.max(0, lineGross(t) - disc);
}


function itemTypeOf(
  t: any,
  maps: ExpansionMaps,
): "test" | "package" | "profile" | "combo" {
  const typed = String(t?.item_type || "").toLowerCase();
  if (typed === "package" || typed === "profile" || typed === "combo" || typed === "test") {
    return typed as "test" | "package" | "profile" | "combo";
  }
  const id = String(t?.test_id || "");
  if (id && maps.packageIds[id]) return "package";
  if (id && maps.comboIds[id]) return "combo";
  if (id && maps.profileIds[id]) return "profile";
  return "test";
}

function leavesForContainer(
  type: "package" | "profile" | "combo",
  id: string,
  maps: ExpansionMaps,
): string[] {
  if (type === "package") return maps.packageLeaves[id] || [];
  if (type === "combo") return maps.comboLeaves[id] || [];
  return maps.profileLeaves[id] || [];
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function chunkIds(ids: string[], size = 150): string[][] {
  const u = uniqueIds(ids);
  const chunks: string[][] = [];
  for (let i = 0; i < u.length; i += size) chunks.push(u.slice(i, i + size));
  return chunks;
}

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
  throw new Error(`${label}: ${(last as Error)?.message || String(last)}`);
}

async function selectIn(
  table: string,
  columns: string,
  filterCol: string,
  ids: string[],
): Promise<any[]> {
  if (ids.length === 0) return [];
  const all: any[] = [];
  for (const part of chunkIds(ids)) {
    const rows = await withRetry(`${table}.in(${filterCol})`, async () => {
      const { data, error } = await (supabase as any)
        .from(table)
        .select(columns)
        .in(filterCol, part);
      if (error) throw error;
      return data || [];
    });
    all.push(...rows);
  }
  return all;
}

async function selectAllIds(table: string): Promise<Record<string, true>> {
  const rows = await withRetry(table, async () => {
    const { data, error } = await (supabase as any).from(table).select("id");
    if (error) throw error;
    return data || [];
  });
  const out: Record<string, true> = {};
  for (const r of rows) {
    const id = String(r?.id || "");
    if (id) out[id] = true;
  }
  return out;
}

async function loadMasterIdMaps(): Promise<{
  packageIds: Record<string, true>;
  profileIds: Record<string, true>;
  comboIds: Record<string, true>;
}> {
  if (masterCache && Date.now() - masterCache.at < MASTER_TTL_MS) {
    return masterCache;
  }
  const [packageIds, profileIds, comboIds] = await Promise.all([
    selectAllIds("health_checkups"),
    selectAllIds("billing_profiles"),
    selectAllIds("combos"),
  ]);
  masterCache = { at: Date.now(), packageIds, profileIds, comboIds };
  return masterCache;
}

/**
 * Expand registration billed lines into leaf-test contributions.
 * Packages / profiles / combos are not counted -- only their leaf tests.
 */
export function expandRegistrationToLeafContributions(
  reg: BookedReg,
  maps: ExpansionMaps,
): LeafContribution[] {
  if (reg.bill_cancelled) return [];

  const cancelled = new Set(
    (Array.isArray(reg.cancelled_tests) ? reg.cancelled_tests : [])
      .map((c: any) => String(c?.test_id || c || "").trim())
      .filter(Boolean),
  );

  const lines = Array.isArray(reg.tests) ? reg.tests : [];
  const out: LeafContribution[] = [];
  const base = {
    registrationId: reg.id,
    invoiceNumber: String(reg.invoice_number || "-"),
    patientName: String(reg.patient_name || "-"),
    title: reg.title || null,
    createdAt: String(reg.created_at || ""),
  };

  for (const line of lines) {
    const lineId = String(line?.test_id || "").trim();
    if (!lineId) continue;
    if (cancelled.has(lineId)) continue;

    const type = itemTypeOf(line, maps);

    if (type === "package" || type === "profile" || type === "combo") {
      // Gross = leaf catalog price. Net = share of container sold amount by catalog weight.
      // Discount = catalog gross - allocated net (e.g. FBS 50 - 13.51 = 36.49 inside SEHAT).
      const leafIds = leavesForContainer(type, lineId, maps).filter((id) => !cancelled.has(id));
      if (leafIds.length === 0) continue;
      const packageNet = lineNet(line);
      const weights = leafIds.map((id) => Number(maps.catalog[id]?.price ?? 0) || 0);
      const sumW = weights.reduce((a, b) => a + b, 0);
      let allocatedNet = 0;
      leafIds.forEach((leafId, i) => {
        const isLast = i === leafIds.length - 1;
        const w = sumW > 0 ? weights[i] / sumW : 1 / leafIds.length;
        const cat = maps.catalog[leafId];
        const gross = Math.round((weights[i] + Number.EPSILON) * 100) / 100;
        const net = isLast
          ? Math.round((packageNet - allocatedNet + Number.EPSILON) * 100) / 100
          : Math.round((packageNet * w + Number.EPSILON) * 100) / 100;
        allocatedNet += net;
        const discount = Math.max(0, Math.round((gross - net + Number.EPSILON) * 100) / 100);
        out.push({
          ...base,
          testId: leafId,
          testName: cat?.name || String(line?.test_name || "Test"),
          gross,
          discount,
          net,
        });
      });
      continue;
    }

    const gross = lineGross(line);
    const net = lineNet(line);
    const discount = Math.max(0, Math.round((gross - net + Number.EPSILON) * 100) / 100);
    out.push({
      ...base,
      testId: lineId,
      testName: maps.catalog[lineId]?.name || String(line?.test_name || "Test"),
      gross,
      discount,
      net: Math.round((net + Number.EPSILON) * 100) / 100,
    });
  }

  return out;
}

export function aggregateTestVolume(contributions: LeafContribution[]): TestVolumeRow[] {
  const map = new Map<string, TestVolumeRow>();
  for (const c of contributions) {
    const prev = map.get(c.testId) || {
      testId: c.testId,
      testName: c.testName,
      qty: 0,
      gross: 0,
      discount: 0,
      net: 0,
    };
    prev.qty += 1;
    prev.gross += c.gross;
    prev.discount += c.discount;
    prev.net += c.net;
    if (!prev.testName && c.testName) prev.testName = c.testName;
    map.set(c.testId, prev);
  }
  return Array.from(map.values())
    .map((r) => ({
      ...r,
      gross: Math.round((r.gross + Number.EPSILON) * 100) / 100,
      discount: Math.round((r.discount + Number.EPSILON) * 100) / 100,
      net: Math.round((r.net + Number.EPSILON) * 100) / 100,
    }))
    .sort(
      (a, b) =>
        b.qty - a.qty || String(a.testName || "").localeCompare(String(b.testName || "")),
    );
}

/** Fast scoped maps: only containers + leaf prices needed for these registrations. */
export async function fetchExpansionMapsForRegs(regs: BookedReg[]): Promise<ExpansionMaps> {
  const master = await loadMasterIdMaps();
  const maps: ExpansionMaps = {
    catalog: {},
    packageLeaves: {},
    profileLeaves: {},
    comboLeaves: {},
    packageIds: master.packageIds,
    profileIds: master.profileIds,
    comboIds: master.comboIds,
  };

  const neededPackages = new Set<string>();
  const neededProfiles = new Set<string>();
  const neededCombos = new Set<string>();
  const directTests = new Set<string>();

  for (const reg of regs) {
    if (reg.bill_cancelled) continue;
    const lines = Array.isArray(reg.tests) ? reg.tests : [];
    for (const line of lines) {
      const id = String(line?.test_id || "").trim();
      if (!id) continue;
      const type = itemTypeOf(line, maps);
      if (type === "package") neededPackages.add(id);
      else if (type === "profile") neededProfiles.add(id);
      else if (type === "combo") neededCombos.add(id);
      else directTests.add(id);
    }
  }

  const pkgIds = [...neededPackages];
  const comboIds = [...neededCombos];

  const [pkgTests, pkgProfiles, comboTests, comboProfiles] = await Promise.all([
    selectIn("health_checkup_tests", "health_checkup_id, test_id", "health_checkup_id", pkgIds),
    selectIn("health_checkup_profiles", "health_checkup_id, profile_id", "health_checkup_id", pkgIds),
    selectIn("combo_tests", "combo_id, test_id", "combo_id", comboIds),
    selectIn("combo_profiles", "combo_id, profile_id", "combo_id", comboIds),
  ]);

  for (const r of pkgTests) {
    const pkg = String(r.health_checkup_id || "");
    const tid = String(r.test_id || "");
    if (!pkg || !tid) continue;
    if (!maps.packageLeaves[pkg]) maps.packageLeaves[pkg] = [];
    maps.packageLeaves[pkg].push(tid);
  }
  for (const r of pkgProfiles) {
    const pid = String(r.profile_id || "");
    if (pid) neededProfiles.add(pid);
  }
  for (const r of comboTests) {
    const cid = String(r.combo_id || "");
    const tid = String(r.test_id || "");
    if (!cid || !tid) continue;
    if (!maps.comboLeaves[cid]) maps.comboLeaves[cid] = [];
    maps.comboLeaves[cid].push(tid);
  }
  for (const r of comboProfiles) {
    const pid = String(r.profile_id || "");
    if (pid) neededProfiles.add(pid);
  }

  const profileIds = [...neededProfiles];
  const profileTests = await selectIn(
    "billing_profile_tests",
    "profile_id, test_id",
    "profile_id",
    profileIds,
  );
  for (const r of profileTests) {
    const pid = String(r.profile_id || "");
    const tid = String(r.test_id || "");
    if (!pid || !tid) continue;
    if (!maps.profileLeaves[pid]) maps.profileLeaves[pid] = [];
    maps.profileLeaves[pid].push(tid);
  }
  for (const pid of Object.keys(maps.profileLeaves)) {
    maps.profileLeaves[pid] = uniqueIds(maps.profileLeaves[pid]);
  }

  for (const r of pkgProfiles) {
    const pkg = String(r.health_checkup_id || "");
    const pid = String(r.profile_id || "");
    if (!pkg || !pid) continue;
    if (!maps.packageLeaves[pkg]) maps.packageLeaves[pkg] = [];
    maps.packageLeaves[pkg].push(...(maps.profileLeaves[pid] || []));
  }
  for (const pkg of Object.keys(maps.packageLeaves)) {
    maps.packageLeaves[pkg] = uniqueIds(maps.packageLeaves[pkg]);
  }

  for (const r of comboProfiles) {
    const cid = String(r.combo_id || "");
    const pid = String(r.profile_id || "");
    if (!cid || !pid) continue;
    if (!maps.comboLeaves[cid]) maps.comboLeaves[cid] = [];
    maps.comboLeaves[cid].push(...(maps.profileLeaves[pid] || []));
  }
  for (const cid of Object.keys(maps.comboLeaves)) {
    maps.comboLeaves[cid] = uniqueIds(maps.comboLeaves[cid]);
  }

  const leafIds = new Set<string>(directTests);
  for (const leaves of Object.values(maps.packageLeaves)) leaves.forEach((id) => leafIds.add(id));
  for (const leaves of Object.values(maps.profileLeaves)) leaves.forEach((id) => leafIds.add(id));
  for (const leaves of Object.values(maps.comboLeaves)) leaves.forEach((id) => leafIds.add(id));

  const testRows = await selectIn(
    "tests",
    "id, test_name, display_name, price",
    "id",
    [...leafIds],
  );
  for (const t of testRows) {
    const id = String(t.id || "");
    if (!id) continue;
    maps.catalog[id] = {
      name: String(t.display_name || t.test_name || "Test"),
      price: Number(t.price || 0) || 0,
    };
  }

  return maps;
}

export async function fetchBookedRegistrations(
  fromIso: string,
  toIso: string,
  opts?: { lean?: boolean },
): Promise<BookedReg[]> {
  const lean = !!opts?.lean;
  const selectCols = lean
    ? "id, bill_cancelled, tests, cancelled_tests"
    : "id, invoice_number, patient_name, title, created_at, bill_cancelled, tests, cancelled_tests";
  const pageSize = 500;
  const all: BookedReg[] = [];
  let fromIdx = 0;
  for (;;) {
    const rows = await withRetry("patient_registrations", async () => {
      const { data, error } = await supabase
        .from("patient_registrations")
        .select(selectCols)
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: false })
        .range(fromIdx, fromIdx + pageSize - 1);
      if (error) throw error;
      return (data || []) as BookedReg[];
    });
    all.push(...rows);
    if (rows.length < pageSize) break;
    fromIdx += pageSize;
  }
  return all;
}

/**
 * Background-friendly pipeline: load date-range regs, then only the package/profile/combo
 * leaf maps + catalog prices needed for those lines, then aggregate.
 */
export async function fetchDashboardTestVolume(
  fromIso: string,
  toIso: string,
): Promise<TestVolumeRow[]> {
  // Lean list: skip patient identity columns; no per-patient rows in response.
  const regs = await fetchBookedRegistrations(fromIso, toIso, { lean: true });
  const maps = await fetchExpansionMapsForRegs(regs);
  const contributions = regs.flatMap((r) => expandRegistrationToLeafContributions(r, maps));
  return aggregateTestVolume(contributions);
}

/** On-demand drill-down: patient rows for one leaf test in the date range. */
export async function fetchTestVolumePatients(
  fromIso: string,
  toIso: string,
  testId: string,
): Promise<LeafContribution[]> {
  const tid = String(testId || "").trim();
  if (!tid) return [];
  const regs = await fetchBookedRegistrations(fromIso, toIso, { lean: false });
  const maps = await fetchExpansionMapsForRegs(regs);
  return regs
    .flatMap((r) => expandRegistrationToLeafContributions(r, maps))
    .filter((c) => c.testId === tid)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** @deprecated Prefer fetchExpansionMapsForRegs / fetchDashboardTestVolume */
export async function fetchDashboardExpansionMaps(): Promise<ExpansionMaps> {
  const master = await loadMasterIdMaps();
  return {
    ...EMPTY_EXPANSION_MAPS,
    packageIds: master.packageIds,
    profileIds: master.profileIds,
    comboIds: master.comboIds,
  };
}
