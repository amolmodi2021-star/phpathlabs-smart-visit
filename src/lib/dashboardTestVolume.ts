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
  patients: LeafContribution[];
};

export type ExpansionMaps = {
  catalog: Record<string, { name: string; price: number }>;
  packageLeaves: Record<string, string[]>;
  profileLeaves: Record<string, string[]>;
  comboLeaves: Record<string, string[]>;
  /** Plain lookup maps (not Set) so React Query structural sharing stays safe. */
  packageIds: Record<string, true>;
  profileIds: Record<string, true>;
  comboIds: Record<string, true>;
};

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

/** Discount fraction on a package / profile / combo line (0-1). */
function containerDiscountPct(t: any): number {
  const gross = lineGross(t);
  if (gross <= 0) return 0;
  const net = lineNet(t);
  return Math.min(1, Math.max(0, (gross - net) / gross));
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

/**
 * Expand registration billed lines into leaf-test contributions.
 * Packages / profiles / combos are not counted -- only their leaf tests.
 * Cancelled bills and cancelled line/leaf ids are skipped.
 */
export function expandRegistrationToLeafContributions(
  reg: {
    id: string;
    invoice_number?: string | null;
    patient_name?: string | null;
    title?: string | null;
    created_at?: string | null;
    bill_cancelled?: boolean | null;
    tests?: any;
    cancelled_tests?: any;
  },
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
      const pct = containerDiscountPct(line);
      for (const leafId of leavesForContainer(type, lineId, maps)) {
        if (cancelled.has(leafId)) continue;
        const cat = maps.catalog[leafId];
        const gross = Number(cat?.price ?? 0) || 0;
        const net = Math.round((gross * (1 - pct) + Number.EPSILON) * 100) / 100;
        const discount = Math.round((gross - net + Number.EPSILON) * 100) / 100;
        out.push({
          ...base,
          testId: leafId,
          testName: cat?.name || String(line?.test_name || "Test"),
          gross,
          discount,
          net,
        });
      }
      continue;
    }

    const gross = lineGross(line);
    const net = lineNet(line);
    const discount = Math.max(0, Math.round((gross - net + Number.EPSILON) * 100) / 100);
    out.push({
      ...base,
      testId: leafId,
      testName: maps.catalog[leafId]?.name || String(line?.test_name || "Test"),
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
      patients: [],
    };
    prev.qty += 1;
    prev.gross += c.gross;
    prev.discount += c.discount;
    prev.net += c.net;
    if (!prev.testName && c.testName) prev.testName = c.testName;
    prev.patients.push(c);
    map.set(c.testId, prev);
  }
  return Array.from(map.values())
    .map((r) => ({
      ...r,
      gross: Math.round((r.gross + Number.EPSILON) * 100) / 100,
      discount: Math.round((r.discount + Number.EPSILON) * 100) / 100,
      net: Math.round((r.net + Number.EPSILON) * 100) / 100,
      patients: r.patients.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    }))
    .sort((a, b) => b.qty - a.qty || String(a.testName || "").localeCompare(String(b.testName || "")));
}

async function fetchAllIds(table: string, columns: string): Promise<any[]> {
  const pageSize = 1000;
  const all: any[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await (supabase as any)
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);
    if (error) {
      console.warn(`[dashboardTestVolume] ${table}:`, error.message);
      return all;
    }
    const rows = data || [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

export const EMPTY_EXPANSION_MAPS: ExpansionMaps = {
  catalog: {},
  packageLeaves: {},
  profileLeaves: {},
  comboLeaves: {},
  packageIds: {},
  profileIds: {},
  comboIds: {},
};

function toIdMap(rows: any[]): Record<string, true> {
  const out: Record<string, true> = {};
  for (const r of rows) {
    const id = String(r?.id || "");
    if (id) out[id] = true;
  }
  return out;
}

/** Load catalog prices + package/profile/combo -> leaf test maps (once per dashboard load). */
export async function fetchDashboardExpansionMaps(): Promise<ExpansionMaps> {
  const [
    tests,
    packages,
    profiles,
    combos,
    pkgTests,
    pkgProfiles,
    profileTests,
    comboTests,
    comboProfiles,
  ] = await Promise.all([
    fetchAllIds("tests", "id, test_name, display_name, price"),
    fetchAllIds("health_checkups", "id"),
    fetchAllIds("billing_profiles", "id"),
    fetchAllIds("combos", "id"),
    fetchAllIds("health_checkup_tests", "health_checkup_id, test_id"),
    fetchAllIds("health_checkup_profiles", "health_checkup_id, profile_id"),
    fetchAllIds("billing_profile_tests", "profile_id, test_id"),
    fetchAllIds("combo_tests", "combo_id, test_id"),
    fetchAllIds("combo_profiles", "combo_id, profile_id"),
  ]);

  const catalog: Record<string, { name: string; price: number }> = {};
  for (const t of tests) {
    const id = String(t.id || "");
    if (!id) continue;
    catalog[id] = {
      name: String(t.display_name || t.test_name || "Test"),
      price: Number(t.price || 0) || 0,
    };
  }

  const profileLeaves: Record<string, string[]> = {};
  for (const r of profileTests) {
    const pid = String(r.profile_id || "");
    const tid = String(r.test_id || "");
    if (!pid || !tid) continue;
    if (!profileLeaves[pid]) profileLeaves[pid] = [];
    profileLeaves[pid].push(tid);
  }
  for (const pid of Object.keys(profileLeaves)) {
    profileLeaves[pid] = uniqueIds(profileLeaves[pid]);
  }

  const packageLeaves: Record<string, string[]> = {};
  for (const r of pkgTests) {
    const pkg = String(r.health_checkup_id || "");
    const tid = String(r.test_id || "");
    if (!pkg || !tid) continue;
    if (!packageLeaves[pkg]) packageLeaves[pkg] = [];
    packageLeaves[pkg].push(tid);
  }
  for (const r of pkgProfiles) {
    const pkg = String(r.health_checkup_id || "");
    const pid = String(r.profile_id || "");
    if (!pkg || !pid) continue;
    if (!packageLeaves[pkg]) packageLeaves[pkg] = [];
    packageLeaves[pkg].push(...(profileLeaves[pid] || []));
  }
  for (const pkg of Object.keys(packageLeaves)) {
    packageLeaves[pkg] = uniqueIds(packageLeaves[pkg]);
  }

  const comboLeaves: Record<string, string[]> = {};
  for (const r of comboTests) {
    const cid = String(r.combo_id || "");
    const tid = String(r.test_id || "");
    if (!cid || !tid) continue;
    if (!comboLeaves[cid]) comboLeaves[cid] = [];
    comboLeaves[cid].push(tid);
  }
  for (const r of comboProfiles) {
    const cid = String(r.combo_id || "");
    const pid = String(r.profile_id || "");
    if (!cid || !pid) continue;
    if (!comboLeaves[cid]) comboLeaves[cid] = [];
    comboLeaves[cid].push(...(profileLeaves[pid] || []));
  }
  for (const cid of Object.keys(comboLeaves)) {
    comboLeaves[cid] = uniqueIds(comboLeaves[cid]);
  }

  return {
    catalog,
    packageLeaves,
    profileLeaves,
    comboLeaves,
    packageIds: toIdMap(packages),
    profileIds: toIdMap(profiles),
    comboIds: toIdMap(combos),
  };
}
