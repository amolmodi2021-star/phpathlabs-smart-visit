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

/**
 * Server-side summary via Postgres RPC (lean rows only — no tests JSONB egress).
 */
export async function fetchDashboardTestVolume(
  fromIso: string,
  toIso: string,
): Promise<TestVolumeRow[]> {
  const { data, error } = await (supabase as any).rpc("dashboard_tests_booked_summary", {
    p_from: fromIso,
    p_to: toIso,
  });
  if (error) throw error;
  return ((data || []) as any[]).map((r) => ({
    testId: String(r.test_id || ""),
    testName: String(r.test_name || "Test"),
    qty: Number(r.qty || 0) || 0,
    gross: Number(r.gross || 0) || 0,
    discount: Number(r.discount || 0) || 0,
    net: Number(r.net || 0) || 0,
  }));
}

/**
 * Server-side patient drill-down for one leaf test.
 */
export async function fetchTestVolumePatients(
  fromIso: string,
  toIso: string,
  testId: string,
): Promise<LeafContribution[]> {
  const id = String(testId || "").trim();
  if (!id) return [];
  const { data, error } = await (supabase as any).rpc("dashboard_tests_booked_patients", {
    p_from: fromIso,
    p_to: toIso,
    p_test_id: id,
  });
  if (error) throw error;
  return ((data || []) as any[]).map((r) => ({
    testId: String(r.test_id || id),
    testName: String(r.test_name || "Test"),
    gross: Number(r.gross || 0) || 0,
    discount: Number(r.discount || 0) || 0,
    net: Number(r.net || 0) || 0,
    registrationId: String(r.registration_id || ""),
    invoiceNumber: String(r.invoice_number || "-"),
    patientName: String(r.patient_name || "-"),
    title: r.title ?? null,
    createdAt: String(r.created_at || ""),
  }));
}
