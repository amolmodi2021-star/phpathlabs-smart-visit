// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  extractFormulaDependencyIds,
  collectCalcDependencyIds,
  buildWorkflowWorksheet,
} from "@/lib/workflowWorksheet";

describe("extractFormulaDependencyIds", () => {
  it("collects parameter token ids", () => {
    expect(
      extractFormulaDependencyIds([
        { type: "parameter", parameter_id: "y", operator: null },
        { type: "fixed_value", fixed_value: 2, operator: "*" },
        { type: "parameter", parameter_id: "x", operator: "+" },
      ]),
    ).toEqual(["y", "x"]);
  });

  it("returns empty for non-arrays", () => {
    expect(extractFormulaDependencyIds(null)).toEqual([]);
    expect(extractFormulaDependencyIds({})).toEqual([]);
  });
});

describe("collectCalcDependencyIds", () => {
  it("walks nested calculated dependencies", () => {
    const formulaByParamId: Record<string, unknown> = {
      A: [{ type: "parameter", parameter_id: "B" }],
      B: [{ type: "parameter", parameter_id: "C" }],
      C: [],
    };
    const isCalculatedByParamId = { A: true, B: true, C: false };
    expect(collectCalcDependencyIds("A", formulaByParamId, isCalculatedByParamId)).toEqual([
      "B",
      "C",
    ]);
  });
});

describe("buildWorkflowWorksheet", () => {
  it("skips calculated params, shows pending formula deps, skips entered, groups by machine", () => {
    const regId = "reg-1";
    const testCbc = "test-cbc";
    const testChem = "test-chem";
    const paramX = "param-x"; // entered — skip
    const paramY = "param-y"; // pending dependency of calc Z
    const paramZ = "param-z"; // calculated — skip from worksheet
    const paramM = "param-m"; // pending manual on chem machine

    const sheet = buildWorkflowWorksheet({
      registrations: [
        {
          id: regId,
          invoice_number: "2608190001",
          patient_name: "Test Patient",
          title: "Mr.",
          gender: "Male",
          dob: "1990-01-01",
          age_text: "36 Y",
          status: "sample_accepted",
          bill_cancelled: false,
          cancelled_tests: [],
          repeat_tests: [],
        },
      ],
      tubes: [
        {
          registration_id: regId,
          status: "accepted",
          accepted_at: "2026-08-19T08:00:00.000Z",
          suffix: "",
          sample_type: "EDTA",
          test_ids: [testCbc, testChem],
        },
      ],
      patientResults: [
        {
          registration_id: regId,
          test_id: testCbc,
          parameter_id: paramX,
          status: "entered",
          result_value: "12.5",
        },
      ],
      testsMap: {
        [testCbc]: {
          test_name: "CBC",
          instrument_name: "Sysmex",
          sample_type: "EDTA",
          is_outsourced: false,
        },
        [testChem]: {
          test_name: "Glucose",
          instrument_name: "Cobas",
          sample_type: "Serum",
          is_outsourced: false,
        },
      },
      testParamsMap: {
        [testCbc]: [
          {
            display_order: 1,
            is_subheader: false,
            report_test_parameters: {
              id: paramX,
              parameter_name: "X Entered",
              unit: "g/dL",
              is_calculated: false,
              calculation_formula: [],
              send_for_interface: true,
            },
          },
          {
            display_order: 2,
            is_subheader: false,
            report_test_parameters: {
              id: paramY,
              parameter_name: "Y Dependency",
              unit: "%",
              is_calculated: false,
              calculation_formula: [],
              send_for_interface: false,
            },
          },
          {
            display_order: 3,
            is_subheader: false,
            report_test_parameters: {
              id: paramZ,
              parameter_name: "Z Calculated",
              unit: "",
              is_calculated: true,
              calculation_formula: [{ type: "parameter", parameter_id: paramY }],
              send_for_interface: false,
            },
          },
        ],
        [testChem]: [
          {
            display_order: 1,
            is_subheader: false,
            report_test_parameters: {
              id: paramM,
              parameter_name: "Glucose",
              unit: "mg/dL",
              is_calculated: false,
              calculation_formula: [],
              send_for_interface: true,
            },
          },
        ],
      },
      snips: [],
      includeRepeat: false,
    });

    expect(sheet.machines.map((m) => m.machineName).sort()).toEqual(["Cobas", "Sysmex"]);

    const sysmex = sheet.machines.find((m) => m.machineName === "Sysmex")!;
    expect(sysmex.patients).toHaveLength(1);
    const allSysmex = [...sysmex.patients[0].interfaceParams, ...sysmex.patients[0].manualParams];
    expect(allSysmex.map((p) => p.parameterId).sort()).toEqual([paramY]);
    expect(allSysmex.some((p) => p.parameterId === paramZ)).toBe(false);
    expect(allSysmex.some((p) => p.parameterId === paramX)).toBe(false);
    expect(sysmex.patients[0].manualParams[0].isDependencyForCalc).toBe(true);

    const cobas = sheet.machines.find((m) => m.machineName === "Cobas")!;
    expect(cobas.patients).toHaveLength(1);
    expect(cobas.patients[0].interfaceParams.map((p) => p.parameterId)).toEqual([paramM]);

    // Same patient can appear under multiple machines
    expect(sysmex.patients[0].registrationId).toBe(regId);
    expect(cobas.patients[0].registrationId).toBe(regId);
  });
});
