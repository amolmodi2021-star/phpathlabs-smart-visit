// Package included-test lines on invoices.
// Revert: delete this file and the package-tests usage in InvoicePreview.tsx
import { supabase } from "@/integrations/supabase/client";

export function isInvoicePackageItem(item: { item_type?: string } | null | undefined): boolean {
  return String(item?.item_type || "").toLowerCase() === "package";
}

export function formatPackageIncludedTests(names: string[] | undefined): string {
  return (names || [])
    .map((n) => String(n || "").trim())
    .filter(Boolean)
    .join(", ");
}

function normName(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function leafName(row: { display_name?: string | null; test_name?: string | null } | null | undefined): string {
  return String(row?.display_name || row?.test_name || "").trim();
}

function byOrder(a: { display_order?: number }, b: { display_order?: number }) {
  return Number(a.display_order || 0) - Number(b.display_order || 0);
}

async function namesForPackageIds(packageIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const ids = [...new Set(packageIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (ids.length === 0) return map;

  const [pkgTestsRes, pkgProfilesRes] = await Promise.all([
    supabase
      .from("health_checkup_tests")
      .select("health_checkup_id, test_id, display_order, tests(test_name, display_name)")
      .in("health_checkup_id", ids),
    supabase
      .from("health_checkup_profiles")
      .select("health_checkup_id, profile_id, display_order")
      .in("health_checkup_id", ids),
  ]);

  const profileIds = [
    ...new Set((pkgProfilesRes.data || []).map((r: any) => r.profile_id).filter(Boolean)),
  ];

  let profileTests: Array<{ profile_id: string; test_id: string; display_order?: number; tests?: any }> = [];
  if (profileIds.length > 0) {
    const { data } = await supabase
      .from("billing_profile_tests")
      .select("profile_id, test_id, display_order, tests(test_name, display_name)")
      .in("profile_id", profileIds);
    profileTests = (data || []) as typeof profileTests;
  }

  const missingNameIds = new Set<string>();
  for (const r of pkgTestsRes.data || []) {
    if (r.test_id && !leafName((r as any).tests)) missingNameIds.add(r.test_id);
  }
  for (const r of profileTests) {
    if (r.test_id && !leafName(r.tests)) missingNameIds.add(r.test_id);
  }

  const nameById = new Map<string, string>();
  if (missingNameIds.size > 0) {
    const { data: tests } = await supabase
      .from("tests")
      .select("id, test_name, display_name")
      .in("id", [...missingNameIds]);
    (tests || []).forEach((t: any) => {
      const name = leafName(t);
      if (t.id && name) nameById.set(t.id, name);
    });
  }

  for (const pkgId of ids) {
    const ordered: string[] = [];
    const seen = new Set<string>();
    const add = (testId: string | undefined, joined: string) => {
      if (!testId || seen.has(testId)) return;
      const name = joined || nameById.get(testId) || "";
      if (!name) return;
      seen.add(testId);
      ordered.push(name);
    };

    (pkgTestsRes.data || [])
      .filter((r: any) => r.health_checkup_id === pkgId)
      .sort(byOrder)
      .forEach((r: any) => add(r.test_id, leafName(r.tests)));

    (pkgProfilesRes.data || [])
      .filter((r: any) => r.health_checkup_id === pkgId)
      .sort(byOrder)
      .forEach((p: any) => {
        profileTests
          .filter((r) => r.profile_id === p.profile_id)
          .sort(byOrder)
          .forEach((r) => add(r.test_id, leafName(r.tests)));
      });

    if (ordered.length) map.set(pkgId, ordered);
  }

  return map;
}

export async function fetchPackageIncludedTestNames(
  packageIds: string[],
): Promise<Map<string, string[]>> {
  return namesForPackageIds(packageIds);
}

/** Resolve packages from health_checkups even when saved invoice rows omit item_type. */
export async function fetchPackageIncludedTestNamesFromLines(
  lines: Array<{ test_id?: string; test_name?: string; item_type?: string } | null | undefined>,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const rows = (lines || []).filter(Boolean) as Array<{
    test_id?: string;
    test_name?: string;
    item_type?: string;
  }>;
  if (rows.length === 0) return result;

  const ids = [...new Set(rows.map((r) => String(r.test_id || "").trim()).filter(Boolean))];
  const packageIdSet = new Set<string>();

  if (ids.length > 0) {
    const { data: pkgs } = await supabase.from("health_checkups").select("id").in("id", ids);
    (pkgs || []).forEach((p: any) => p.id && packageIdSet.add(p.id));
  }

  rows.forEach((r) => {
    if (isInvoicePackageItem(r) && r.test_id) packageIdSet.add(String(r.test_id));
  });

  const unmatched = rows.filter((r) => {
    const id = String(r.test_id || "").trim();
    return r.test_name && (!id || !packageIdSet.has(id));
  });

  const nameToPkgId = new Map<string, string>();
  if (unmatched.length > 0) {
    const { data: allPkgs } = await supabase
      .from("health_checkups")
      .select("id, health_checkup_name, display_name");
    (allPkgs || []).forEach((p: any) => {
      const id = String(p.id || "");
      if (!id) return;
      const names = [p.health_checkup_name, p.display_name].map(normName).filter(Boolean);
      names.forEach((n) => {
        if (!nameToPkgId.has(n)) nameToPkgId.set(n, id);
      });
    });
    unmatched.forEach((r) => {
      const pkgId = nameToPkgId.get(normName(r.test_name));
      if (pkgId) packageIdSet.add(pkgId);
    });
  }

  const namesByPkg = await namesForPackageIds([...packageIdSet]);

  const attach = (key: string | undefined, names: string[] | undefined) => {
    if (!key || !names?.length) return;
    result.set(key, names);
  };

  for (const row of rows) {
    const lineId = String(row.test_id || "").trim();
    const pkgId = (lineId && namesByPkg.has(lineId) ? lineId : "")
      || (lineId && packageIdSet.has(lineId) ? lineId : "")
      || nameToPkgId.get(normName(row.test_name))
      || "";
    const names = namesByPkg.get(pkgId);
    attach(lineId, names);
    attach(pkgId, names);
    attach(normName(row.test_name), names);
  }

  return result;
}
