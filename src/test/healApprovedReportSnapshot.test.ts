// @vitest-environment node
import { describe, expect, it } from "vitest";
import { healApprovedReportSnapshotFromLive } from "@/lib/patientResultLookup";

function mockSupabase(opts: {
  liveRows: any[];
  reg?: any;
  sigs?: any[];
}) {
  const calls: { insert: any; update: any } = { insert: null, update: null };
  const supabase = {
    from(table: string) {
      if (table === "patient_results") {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({ data: opts.liveRows, error: null }),
            }),
          }),
        };
      }
      if (table === "patient_registrations") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.reg || null, error: null }),
            }),
          }),
        };
      }
      if (table === "pathologist_signatures") {
        return {
          select: async () => ({ data: opts.sigs || [], error: null }),
        };
      }
      if (table === "approved_reports") {
        return {
          insert: (row: any) => {
            calls.insert = row;
            return {
              select: () => ({
                maybeSingle: async () => ({ data: { id: "ar-1", ...row }, error: null }),
              }),
            };
          },
          update: (row: any) => {
            calls.update = row;
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      throw new Error("unexpected table " + table);
    },
  };
  return { supabase, calls };
}

describe("healApprovedReportSnapshotFromLive", () => {
  it("creates a snapshot from live approved rows when none exists", async () => {
    const { supabase, calls } = mockSupabase({
      liveRows: [
        {
          test_id: "t-cbc",
          parameter_id: "p-hb",
          param_code: "HB",
          parameter_name: "Haemoglobin",
          result_value: "13.2",
          unit: "g/dL",
          reference_range: "12-15",
          normal_range_low: 12,
          normal_range_high: 15,
          flag: null,
          is_calculated: false,
          note: null,
          test_note: null,
          approved_by: "Dr. HEMANG JADAWALA",
          approved_at: "2026-09-23T08:00:00.000Z",
        },
      ],
      reg: {
        id: "reg-1",
        invoice_number: "2609230028",
        patient_name: "SIMRAN DHINGRA",
        title: "MS",
        gender: "Female",
        visit_type: "lab",
        is_stat: false,
        created_at: "2026-09-23T07:30:00.000Z",
      },
      sigs: [
        {
          pathologist_name: "Dr. HEMANG JADAWALA",
          doctor_code: "DR001",
          qualification: "MD",
          designation: "Pathologist",
        },
      ],
    });

    const healed = await healApprovedReportSnapshotFromLive(
      supabase as any,
      "reg-1",
      [],
      { "t-cbc": "CBC" },
    );

    expect(healed.added).toBe(1);
    expect(calls.insert).toBeTruthy();
    expect(calls.insert.invoice_number).toBe("2609230028");
    expect(calls.insert.test_results).toHaveLength(1);
    expect(calls.insert.test_results[0].test_name).toBe("CBC");
    expect(calls.insert.test_results[0].approved_by_doctor_code).toBe("DR001");
    expect(healed.reportsArr[0].test_results[0].parameter_id).toBe("p-hb");
  });

  it("returns empty when there is no snapshot and no live approved rows", async () => {
    const { supabase, calls } = mockSupabase({ liveRows: [] });
    const healed = await healApprovedReportSnapshotFromLive(supabase as any, "reg-1", []);
    expect(healed.added).toBe(0);
    expect(healed.reportsArr).toEqual([]);
    expect(calls.insert).toBeNull();
  });

  it("appends a missing approved test onto a partial snapshot", async () => {
    const { supabase, calls } = mockSupabase({
      liveRows: [
        {
          test_id: "t-cbc",
          parameter_id: "p-hb",
          parameter_name: "Haemoglobin",
          result_value: "13.2",
          approved_by: "Dr. HEMANG JADAWALA",
        },
        {
          test_id: "t-crp",
          parameter_id: "p-crp",
          parameter_name: "CRP",
          result_value: "6.1",
          approved_by: "Dr. HEMANG JADAWALA",
        },
      ],
    });

    const healed = await healApprovedReportSnapshotFromLive(
      supabase as any,
      "reg-1",
      [{
        registration_id: "reg-1",
        invoice_number: "2609230028",
        test_results: [
          {
            test_id: "t-cbc",
            test_name: "CBC",
            parameter_id: "p-hb",
            parameter_name: "Haemoglobin",
            result_value: "13.2",
            approved_by: "Dr. HEMANG JADAWALA",
          },
        ],
      }],
      { "t-cbc": "CBC", "t-crp": "CRP" },
    );

    expect(healed.added).toBe(1);
    expect(calls.insert).toBeNull();
    expect(calls.update.test_results).toHaveLength(2);
    expect(calls.update.test_results.map((r: any) => r.test_name)).toEqual(["CBC", "CRP"]);
  });

  it("appends missing parameters onto a test that is only partly in the snapshot", async () => {
    const { supabase, calls } = mockSupabase({
      liveRows: [
        { test_id: "t-cbc", parameter_id: "p-hb", parameter_name: "Haemoglobin", result_value: "11.2" },
        { test_id: "t-cbc", parameter_id: "p-wbc", parameter_name: "WBC", result_value: "6500" },
        { test_id: "t-cbc", parameter_id: "p-plt", parameter_name: "Platelet", result_value: "360000" },
      ],
    });

    const healed = await healApprovedReportSnapshotFromLive(
      supabase as any,
      "reg-1",
      [{
        registration_id: "reg-1",
        test_results: [
          { test_id: "T-CBC", test_name: "CBC", parameter_id: "P-HB", parameter_name: "Haemoglobin", result_value: "11.2" },
        ],
      }],
      { "t-cbc": "CBC" },
    );

    expect(healed.added).toBe(2);
    expect(calls.update.test_results.map((r: any) => r.parameter_id)).toEqual(["P-HB", "p-wbc", "p-plt"]);
    expect(healed.reportsArr[0].test_results).toHaveLength(3);
  });
});