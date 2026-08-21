// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  isDilutionToken,
  machineIdAliases,
  normalizeInterfaceResultCode,
  orderTestsMatchMachine,
} from "../../supabase/functions/lims-interface/interfaceResultCode";

describe("normalizeInterfaceResultCode", () => {
  it("keeps a normal Indiko assay code", () => {
    expect(normalizeInterfaceResultCode("008", "C-REACTIVE PROTEIN (CRP)")).toBe("008");
  });

  it("keeps Sysmex parameter codes", () => {
    expect(normalizeInterfaceResultCode("WBC", "WBC")).toBe("WBC");
    expect(normalizeInterfaceResultCode("LYM%", "LYM%")).toBe("LYM%");
    expect(normalizeInterfaceResultCode("RDW-SD", "RDW-SD")).toBe("RDW-SD");
  });

  it("recovers Indiko assay code from ASTM name when code is dilution 0.0", () => {
    expect(normalizeInterfaceResultCode("0.0", "^^^008^0.0")).toBe("008");
    expect(normalizeInterfaceResultCode("0.0", "^^^022^0.0")).toBe("022");
    expect(normalizeInterfaceResultCode("0.0", "^^^001^0.0")).toBe("001");
  });

  it("strips ASTM carets from the code field", () => {
    expect(normalizeInterfaceResultCode("^^^008^0.0", "")).toBe("008");
    expect(normalizeInterfaceResultCode("008^0.0", "CRP")).toBe("008");
  });

  it("leaves an unmatched dilution code unchanged", () => {
    expect(normalizeInterfaceResultCode("0.0", "dilution")).toBe("0.0");
    expect(normalizeInterfaceResultCode("0.0", "")).toBe("0.0");
  });
});

describe("isDilutionToken", () => {
  it("treats 0.0 as dilution and 008 as assay", () => {
    expect(isDilutionToken("0.0")).toBe(true);
    expect(isDilutionToken("008")).toBe(false);
    expect(isDilutionToken("WBC")).toBe(false);
  });
});

describe("machineIdAliases / orderTestsMatchMachine", () => {
  it("matches XP-300 posts to Sysmex orders", () => {
    expect(machineIdAliases("XP-300").has("sysmex")).toBe(true);
    expect(orderTestsMatchMachine([{ machine_id: "Sysmex" }], "XP-300")).toBe(true);
    expect(orderTestsMatchMachine([{ machine_id: "Indiko" }], "XP-300")).toBe(false);
    expect(orderTestsMatchMachine([{ machine_id: "Indiko" }], "Indiko")).toBe(true);
  });
});
