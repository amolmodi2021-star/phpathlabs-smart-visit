/**
 * Bench Workflow worksheet: accepted samples with pending result entry,
 * grouped machine → patient → parameters (interface first, then manual).
 */

import { sampleIdForTube } from "@/lib/limsOrderGeneration";
import { isResultPastPending, resolveResultForResultsEntry } from "@/lib/patientResultLookup";
import { formatAgeGender } from "@/lib/ageGender";
import { patientDisplayName } from "@/lib/patientDisplayName";

export type FormulaToken = {
  type?: string;
  parameter_id?: string | null;
  parameter_name?: string | null;
};

export type WorkflowParamLine = {
  testId: string;
  testName: string;
  parameterId: string;
  parameterName: string;
  unit: string;
  sampleType: string;
  sampleId: string;
  tubeSuffix: string;
  sendForInterface: boolean;
  isDependencyForCalc: boolean;
  acceptedAt: string | null;
};

export type WorkflowPatientBlock = {
  registrationId: string;
  invoiceNumber: string;
  patientLabel: string;
  ageGender: string;
  isRepeat: boolean;
  acceptedAt: string | null;
  tubeHints: string[];
  interfaceParams: WorkflowParamLine[];
  manualParams: WorkflowParamLine[];
};

export type WorkflowMachineSection = {
  machineName: string;
  patients: WorkflowPatientBlock[];
  interfaceCount: number;
  manualCount: number;
  sampleCount: number;
};

export type WorkflowOutsourcedLine = {
  registrationId: string;
  invoiceNumber: string;
  patientLabel: string;
  ageGender: string;
  testId: string;
  testName: string;
  sampleType: string;
  sampleId: string;
  labName: string;
  outsourceStatus: string;
  isRepeat: boolean;
  acceptedAt: string | null;
};

export type WorkflowWorksheet = {
  machines: WorkflowMachineSection[];
  outsourced: WorkflowOutsourcedLine[];
  totalPendingParams: number;
  totalPatients: number;
};

export function extractFormulaDependencyIds(formula: unknown): string[] {
  if (!Array.isArray(formula)) return [];
  const ids: string[] = [];
  for (const token of formula as FormulaToken[]) {
    if (!token || typeof token !== "object") continue;
    if (String(token.type || "") === "parameter" && token.parameter_id) {
      ids.push(String(token.parameter_id));
    }
  }
  return ids;
}

/** Walk formula deps so nested calc inputs are also considered. */
export function collectCalcDependencyIds(
  parameterId: string,
  formulaByParamId: Record<string, unknown>,
  isCalculatedByParamId: Record<string, boolean>,
  depth = 0,
  seen = new Set<string>(),
): string[] {
  if (depth > 6 || seen.has(parameterId)) return [];
  seen.add(parameterId);
  const direct = extractFormulaDependencyIds(formulaByParamId[parameterId]);
  const out: string[] = [];
  for (const depId of direct) {
    out.push(depId);
    if (isCalculatedByParamId[depId]) {
      out.push(
        ...collectCalcDependencyIds(depId, formulaByParamId, isCalculatedByParamId, depth + 1, seen),
      );
    }
  }
  return out;
}

export type WorkflowBuildInput = {
  registrations: any[];
  tubes: any[];
  patientResults: any[];
  testsMap: Record<string, any>;
  testParamsMap: Record<string, any[]>;
  snips?: any[];
  acceptedFromDay?: string | null;
  acceptedToDay?: string | null;
  includeRepeat?: boolean;
};

function dayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function inAcceptedRange(
  acceptedAt: string | null | undefined,
  fromDay?: string | null,
  toDay?: string | null,
): boolean {
  if (!fromDay && !toDay) return true;
  const key = dayKey(acceptedAt);
  if (!key) return !fromDay && !toDay;
  if (fromDay && key < fromDay) return false;
  if (toDay && key > toDay) return false;
  return true;
}

function machineLabel(testsMap: Record<string, any>, testId: string): string {
  const name = String(testsMap[testId]?.instrument_name || "").trim();
  return name || "Others";
}

function sampleTypeFor(
  tube: any,
  testsMap: Record<string, any>,
  testId: string,
  param: any,
): string {
  return (
    String(tube?.sample_type || "").trim() ||
    String(param?.sample_type || "").trim() ||
    String(testsMap[testId]?.sample_type || "").trim() ||
    "—"
  );
}

function snipPastEntry(status: string | null | undefined): boolean {
  return ["results_entered", "verified", "approved", "dispatched"].includes(String(status || ""));
}

function isSnipOnly(snip: any): boolean {
  if (!snip) return false;
  const mode = String(snip.result_mode || "").toLowerCase();
  if (mode === "snip" || mode === "image") return true;
  return Array.isArray(snip.snip_image_urls) && snip.snip_image_urls.length > 0;
}

/** Build machine → patient → params worksheet from already-fetched rows. */
export function buildWorkflowWorksheet(input: WorkflowBuildInput): WorkflowWorksheet {
  const {
    registrations,
    tubes,
    patientResults,
    testsMap,
    testParamsMap,
    snips = [],
    acceptedFromDay,
    acceptedToDay,
    includeRepeat = false,
  } = input;

  const regsById = new Map(registrations.map((r) => [r.id, r]));
  const tubesByReg = new Map<string, any[]>();
  for (const tube of tubes) {
    if (String(tube.status || "") !== "accepted") continue;
    if (!inAcceptedRange(tube.accepted_at, acceptedFromDay, acceptedToDay)) continue;
    const list = tubesByReg.get(tube.registration_id) || [];
    list.push(tube);
    tubesByReg.set(tube.registration_id, list);
  }

  const snipsByRegTest = new Map<string, any>();
  for (const s of snips) {
    snipsByRegTest.set(`${s.registration_id}||${s.test_id}`, s);
  }

  type AccPatient = {
    registrationId: string;
    invoiceNumber: string;
    patientLabel: string;
    ageGender: string;
    isRepeat: boolean;
    acceptedAt: string | null;
    tubeHintSet: Set<string>;
    lines: WorkflowParamLine[];
  };

  const machineAcc = new Map<string, Map<string, AccPatient>>();
  const outsourced: WorkflowOutsourcedLine[] = [];
  const outsourcedKeys = new Set<string>();

  const ensurePatient = (machine: string, reg: any, isRepeat: boolean, acceptedAt: string | null) => {
    if (!machineAcc.has(machine)) machineAcc.set(machine, new Map());
    const byReg = machineAcc.get(machine)!;
    let block = byReg.get(reg.id);
    if (!block) {
      block = {
        registrationId: reg.id,
        invoiceNumber: String(reg.invoice_number || ""),
        patientLabel: patientDisplayName(reg),
        ageGender: formatAgeGender(reg.dob, reg.gender, reg.age_text),
        isRepeat,
        acceptedAt,
        tubeHintSet: new Set(),
        lines: [],
      };
      byReg.set(reg.id, block);
    } else {
      block.isRepeat = block.isRepeat || isRepeat;
      if (acceptedAt && (!block.acceptedAt || acceptedAt < block.acceptedAt)) {
        block.acceptedAt = acceptedAt;
      }
    }
    return block;
  };

  for (const [regId, regTubes] of tubesByReg) {
    const reg = regsById.get(regId);
    if (!reg || reg.bill_cancelled) continue;

    const cancelledIds = new Set(
      ((reg.cancelled_tests || []) as any[])
        .map((t: any) => (typeof t === "string" ? t : t?.test_id))
        .filter(Boolean),
    );
    const repeatIds = new Set(
      ((reg.repeat_tests || []) as any[])
        .map((t: any) => (typeof t === "string" ? t : t?.test_id))
        .filter(Boolean),
    );
    const regIsRepeat =
      String(reg.status || "") === "repeat_collection" || repeatIds.size > 0;

    const invoice = String(reg.invoice_number || "");

    for (const tube of regTubes) {
      const testIds = (Array.isArray(tube.test_ids) ? tube.test_ids : []).filter(Boolean);
      const sampleId = sampleIdForTube(invoice, tube.suffix);
      const tubeAcceptedAt = tube.accepted_at || null;

      for (const testId of testIds) {
        if (cancelledIds.has(testId)) continue;
        const testIsRepeat = regIsRepeat && (repeatIds.size === 0 || repeatIds.has(testId));
        if (testIsRepeat && !includeRepeat) continue;

        const testInfo = testsMap[testId] || {};
        const testName = String(testInfo.test_name || testId);
        const isOutsourcedTest = !!testInfo.is_outsourced;
        const snip = snipsByRegTest.get(`${regId}||${testId}`);
        const snipKey = `${regId}||${testId}||${sampleId}`;

        if (isOutsourcedTest || snip) {
          const params = (testParamsMap[testId] || []).filter(
            (tp: any) => !tp.is_subheader && tp.report_test_parameters,
          );
          let skip = false;
          if (snip && snipPastEntry(snip.outsource_status) && (isSnipOnly(snip) || params.length === 0)) {
            skip = true;
          } else if (params.length > 0 && !isSnipOnly(snip)) {
            const allDone = params.every((tp: any) => {
              const p = tp.report_test_parameters;
              if (!p || p.is_calculated) return true;
              const { covered, row } = resolveResultForResultsEntry(
                patientResults,
                regId,
                testId,
                p.id,
              );
              return covered || isResultPastPending(row?.status);
            });
            if (allDone) skip = true;
          }
          if (skip) continue;
          if (outsourcedKeys.has(snipKey)) continue;
          outsourcedKeys.add(snipKey);
          outsourced.push({
            registrationId: regId,
            invoiceNumber: invoice,
            patientLabel: patientDisplayName(reg),
            ageGender: formatAgeGender(reg.dob, reg.gender, reg.age_text),
            testId,
            testName,
            sampleType: sampleTypeFor(tube, testsMap, testId, null),
            sampleId,
            labName: String(snip?.outsourced_lab_name || testInfo.outsourced_caption || "Outsourced"),
            outsourceStatus: String(snip?.outsource_status || "pending"),
            isRepeat: testIsRepeat,
            acceptedAt: tubeAcceptedAt,
          });
          continue;
        }

        const params = testParamsMap[testId] || [];
        const formulaByParamId: Record<string, unknown> = {};
        const isCalculatedByParamId: Record<string, boolean> = {};
        const paramMetaById: Record<string, { tp: any; p: any }> = {};

        for (const tp of params) {
          if (tp.is_subheader) continue;
          const p = tp.report_test_parameters;
          if (!p?.id) continue;
          paramMetaById[p.id] = { tp, p };
          isCalculatedByParamId[p.id] = !!p.is_calculated;
          formulaByParamId[p.id] = p.calculation_formula || [];
        }

        const includeIds = new Set<string>();
        const dependencyOnly = new Set<string>();

        for (const [paramId, meta] of Object.entries(paramMetaById)) {
          const { p } = meta;
          const { covered, row } = resolveResultForResultsEntry(
            patientResults,
            regId,
            testId,
            paramId,
          );
          if (covered || isResultPastPending(row?.status)) continue;

          if (p.is_calculated) {
            for (const depId of collectCalcDependencyIds(
              paramId,
              formulaByParamId,
              isCalculatedByParamId,
            )) {
              const depMeta = paramMetaById[depId];
              if (!depMeta || depMeta.p.is_calculated) continue;
              const depResolved = resolveResultForResultsEntry(
                patientResults,
                regId,
                testId,
                depId,
              );
              if (depResolved.covered || isResultPastPending(depResolved.row?.status)) continue;
              includeIds.add(depId);
              dependencyOnly.add(depId);
            }
            continue;
          }

          includeIds.add(paramId);
        }

        if (includeIds.size === 0) continue;

        const machine = machineLabel(testsMap, testId);
        const block = ensurePatient(machine, reg, testIsRepeat, tubeAcceptedAt);
        block.tubeHintSet.add(`${sampleTypeFor(tube, testsMap, testId, null)} · ${sampleId}`);

        const ordered = [...includeIds].sort((a, b) => {
          const oa = paramMetaById[a]?.tp?.display_order ?? 9999;
          const ob = paramMetaById[b]?.tp?.display_order ?? 9999;
          return oa - ob;
        });

        for (const paramId of ordered) {
          if (
            block.lines.some(
              (l) => l.parameterId === paramId && l.testId === testId && l.sampleId === sampleId,
            )
          ) {
            continue;
          }
          const meta = paramMetaById[paramId];
          if (!meta) continue;
          const { p } = meta;
          block.lines.push({
            testId,
            testName,
            parameterId: paramId,
            parameterName: String(p.parameter_name || p.param_code || "Parameter"),
            unit: String(p.unit || ""),
            sampleType: sampleTypeFor(tube, testsMap, testId, p),
            sampleId,
            tubeSuffix: String(tube.suffix || ""),
            sendForInterface: !!p.send_for_interface,
            isDependencyForCalc: dependencyOnly.has(paramId) && !p.send_for_interface,
            acceptedAt: tubeAcceptedAt,
          });
        }
      }
    }
  }

  const machines: WorkflowMachineSection[] = [...machineAcc.entries()]
    .map(([machineName, byReg]) => {
      const patients: WorkflowPatientBlock[] = [...byReg.values()]
        .map((p) => {
          const interfaceParams = p.lines
            .filter((l) => l.sendForInterface)
            .sort((a, b) => a.parameterName.localeCompare(b.parameterName));
          const manualParams = p.lines
            .filter((l) => !l.sendForInterface)
            .sort((a, b) => a.parameterName.localeCompare(b.parameterName));
          return {
            registrationId: p.registrationId,
            invoiceNumber: p.invoiceNumber,
            patientLabel: p.patientLabel,
            ageGender: p.ageGender,
            isRepeat: p.isRepeat,
            acceptedAt: p.acceptedAt,
            tubeHints: [...p.tubeHintSet],
            interfaceParams,
            manualParams,
          };
        })
        .filter((p) => p.interfaceParams.length + p.manualParams.length > 0)
        .sort((a, b) => {
          const aa = a.acceptedAt || "";
          const bb = b.acceptedAt || "";
          if (aa !== bb) return aa.localeCompare(bb);
          return a.invoiceNumber.localeCompare(b.invoiceNumber);
        });

      const interfaceCount = patients.reduce((s, p) => s + p.interfaceParams.length, 0);
      const manualCount = patients.reduce((s, p) => s + p.manualParams.length, 0);
      const sampleIds = new Set<string>();
      patients.forEach((p) => {
        [...p.interfaceParams, ...p.manualParams].forEach((l) => sampleIds.add(l.sampleId));
      });

      return {
        machineName,
        patients,
        interfaceCount,
        manualCount,
        sampleCount: sampleIds.size,
      };
    })
    .filter((m) => m.patients.length > 0)
    .sort((a, b) => {
      if (a.machineName === "Others") return 1;
      if (b.machineName === "Others") return -1;
      return a.machineName.localeCompare(b.machineName);
    });

  outsourced.sort((a, b) => {
    const aa = a.acceptedAt || "";
    const bb = b.acceptedAt || "";
    if (aa !== bb) return aa.localeCompare(bb);
    return a.invoiceNumber.localeCompare(b.invoiceNumber);
  });

  const totalPendingParams = machines.reduce(
    (s, m) => s + m.interfaceCount + m.manualCount,
    0,
  );
  const patientIds = new Set<string>();
  machines.forEach((m) => m.patients.forEach((p) => patientIds.add(p.registrationId)));
  outsourced.forEach((o) => patientIds.add(o.registrationId));

  return {
    machines,
    outsourced,
    totalPendingParams,
    totalPatients: patientIds.size,
  };
}

const PRINT_LS_KEY = "lims_workflow_printed_v1";

export function printedStorageKey(day: string, machineName: string, registrationId: string): string {
  return `${day}|${machineName}|${registrationId}`;
}

export function loadPrintedKeys(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PRINT_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function markPatientsPrinted(
  machineName: string,
  registrationIds: string[],
  at = new Date(),
): void {
  const day = dayKey(at.toISOString()) || "";
  const map = loadPrintedKeys();
  const iso = at.toISOString();
  for (const id of registrationIds) {
    map[printedStorageKey(day, machineName, id)] = iso;
  }
  try {
    localStorage.setItem(PRINT_LS_KEY, JSON.stringify(map));
  } catch {
    // ignore quota
  }
}

export function isPatientPrintedToday(
  machineName: string,
  registrationId: string,
  printed: Record<string, string>,
  now = new Date(),
): boolean {
  const day = dayKey(now.toISOString()) || "";
  return !!printed[printedStorageKey(day, machineName, registrationId)];
}

export function buildWorkflowPrintHtml(opts: {
  title: string;
  batchLabel: string;
  machines: WorkflowMachineSection[];
  outsourced?: WorkflowOutsourcedLine[];
  printedBy?: string;
}): string {
  const { title, batchLabel, machines, outsourced = [], printedBy } = opts;
  const esc = (s: string) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const paramRow = (line: WorkflowParamLine, kind: "I" | "M") => `
    <tr>
      <td class="kind">${kind}</td>
      <td class="pname">${esc(line.parameterName)}${line.isDependencyForCalc ? ' <span class="dep">calc-in</span>' : ""}</td>
      <td class="tname">${esc(line.testName)}</td>
      <td class="stype">${esc(line.sampleType)}</td>
      <td class="unit">${esc(line.unit)}</td>
      <td class="write"><div class="line"></div></td>
    </tr>`;

  let body = "";
  for (const machine of machines) {
    body += `<section class="machine">
      <h2>${esc(machine.machineName)}
        <span class="meta">${machine.sampleCount} samples · ${machine.interfaceCount} interface · ${machine.manualCount} manual</span>
      </h2>`;
    for (const patient of machine.patients) {
      body += `<div class="patient">
        <div class="phead">
          <strong>${esc(patient.invoiceNumber)}</strong>
          · ${esc(patient.patientLabel)}
          · <span class="ag">${esc(patient.ageGender)}</span>
          ${patient.isRepeat ? '<span class="repeat">REPEAT</span>' : ""}
        </div>
        <div class="tubes">${patient.tubeHints.map((h) => esc(h)).join(" &nbsp;|&nbsp; ")}</div>
        <table>
          <thead>
            <tr>
              <th style="width:18px"></th>
              <th>Parameter</th>
              <th>Test</th>
              <th>Sample</th>
              <th>Unit</th>
              <th class="write-h">Value</th>
            </tr>
          </thead>
          <tbody>
            ${patient.interfaceParams.map((l) => paramRow(l, "I")).join("")}
            ${patient.manualParams.map((l) => paramRow(l, "M")).join("")}
          </tbody>
        </table>
      </div>`;
    }
    body += `</section>`;
  }

  if (outsourced.length > 0) {
    body += `<section class="machine outsourced">
      <h2>OUTSOURCED <span class="meta">${outsourced.length} tests</span></h2>
      <table>
        <thead>
          <tr>
            <th>Bill</th>
            <th>Patient</th>
            <th>Test</th>
            <th>Sample ID</th>
            <th>Type</th>
            <th>Lab</th>
            <th>Status</th>
            <th class="write-h">Notes</th>
          </tr>
        </thead>
        <tbody>
          ${outsourced
            .map(
              (o) => `<tr>
            <td>${esc(o.invoiceNumber)}</td>
            <td>${esc(o.patientLabel)} <span class="ag">${esc(o.ageGender)}</span>${o.isRepeat ? ' <span class="repeat">REPEAT</span>' : ""}</td>
            <td>${esc(o.testName)}</td>
            <td>${esc(o.sampleId)}</td>
            <td>${esc(o.sampleType)}</td>
            <td>${esc(o.labName)}</td>
            <td>${esc(o.outsourceStatus)}</td>
            <td class="write"><div class="line"></div></td>
          </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </section>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(title)}</title>
  <style>
    @page { size: A4 landscape; margin: 8mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #111; }
    h1 { font-size: 14px; margin: 0 0 2px; }
    .sub { color: #444; margin-bottom: 8px; }
    .machine { page-break-inside: avoid; margin-bottom: 10px; border-top: 2px solid #222; padding-top: 4px; }
    .machine h2 { font-size: 12px; margin: 0 0 6px; }
    .machine h2 .meta { font-weight: normal; font-size: 9px; color: #555; margin-left: 8px; }
    .patient { margin: 0 0 8px; padding: 4px 0; border-bottom: 1px dashed #ccc; page-break-inside: avoid; }
    .phead { font-size: 11px; }
    .tubes { color: #444; margin: 2px 0 4px; font-size: 9px; }
    .ag { font-family: monospace; }
    .repeat { background: #fde68a; padding: 0 4px; font-size: 8px; font-weight: bold; }
    .dep { font-size: 8px; color: #666; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #bbb; padding: 2px 4px; vertical-align: middle; }
    th { background: #f3f3f3; text-align: left; font-size: 9px; }
    td.kind { width: 18px; text-align: center; font-weight: bold; }
    td.write, th.write-h { width: 28%; }
    .line { border-bottom: 1px solid #333; min-height: 14px; height: 14px; }
    .legend { margin-top: 6px; font-size: 9px; color: #555; }
    @media print {
      .machine { break-inside: avoid; }
      .patient { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <h1>${esc(title)}</h1>
  <div class="sub">${esc(batchLabel)}${printedBy ? ` · Printed by ${esc(printedBy)}` : ""}</div>
  <div class="legend">I = Interface (analyzer) · M = Manual entry · Write values in the Value column · Process one machine batch per print</div>
  ${body || "<p>No pending items.</p>"}
</body>
</html>`;
}

export function openWorkflowPrintWindow(html: string): void {
  // Hidden iframe — window.open(..., "noopener") opens a blank tab we cannot write to.
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "Workflow print");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc || !iframe.contentWindow) {
    document.body.removeChild(iframe);
    throw new Error("Print failed — could not create print frame");
  }

  doc.open();
  doc.write(html);
  doc.close();

  const cleanup = () => {
    try {
      if (iframe.parentNode) document.body.removeChild(iframe);
    } catch {
      // ignore
    }
  };

  const runPrint = () => {
    try {
      iframe.contentWindow!.focus();
      iframe.contentWindow!.print();
    } catch (e) {
      cleanup();
      throw e;
    }
    setTimeout(cleanup, 60_000);
  };

  setTimeout(runPrint, 100);
}

/** Local calendar day YYYY-MM-DD */
export function localDayString(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysToDayString(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return localDayString(dt);
}
