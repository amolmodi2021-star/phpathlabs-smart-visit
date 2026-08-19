import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ChevronDown,
  Loader2,
  Printer,
  Search,
  ExternalLink,
  CheckCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { getCurrentUserName } from "@/lib/auth";
import {
  fetchResultsEntryCandidateIds,
  fetchFilteredSortedIds,
} from "@/lib/limsPendingCandidates";
import {
  fetchWorkflowWorksheetForIds,
  WORKFLOW_CANDIDATE_CAP,
} from "@/lib/workflowFetch";
import {
  addDaysToDayString,
  buildWorkflowPrintHtml,
  isPatientPrintedToday,
  loadPrintedKeys,
  localDayString,
  markPatientsPrinted,
  openWorkflowPrintWindow,
  type WorkflowMachineSection,
  type WorkflowWorksheet,
} from "@/lib/workflowWorksheet";

const Workflow = () => {
  const [, setSearchParams] = useSearchParams();
  const today = localDayString();
  const [fromDay, setFromDay] = useState(() => addDaysToDayString(today, -1));
  const [toDay, setToDay] = useState(today);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [machineFilter, setMachineFilter] = useState<string>("all");
  const [includeRepeat, setIncludeRepeat] = useState(false);
  const [hidePrintedToday, setHidePrintedToday] = useState(false);
  const [printedTick, setPrintedTick] = useState(0);
  const [openMachines, setOpenMachines] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data: candidateIds = [], isLoading: loadingIds } = useQuery({
    queryKey: ["workflow_candidate_ids", debouncedSearch],
    queryFn: async () => {
      const candidates = await fetchResultsEntryCandidateIds();
      return fetchFilteredSortedIds(candidates, debouncedSearch);
    },
    staleTime: 60_000,
  });

  const {
    data: worksheetPayload,
    isLoading: loadingSheet,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: [
      "workflow_worksheet",
      candidateIds.join(","),
      fromDay,
      toDay,
      includeRepeat,
    ],
    enabled: true,
    queryFn: () =>
      fetchWorkflowWorksheetForIds(candidateIds, {
        acceptedFromDay: fromDay || null,
        acceptedToDay: toDay || null,
        includeRepeat,
      }),
    staleTime: 30_000,
  });

  const printedMap = useMemo(() => {
    void printedTick;
    return loadPrintedKeys();
  }, [printedTick]);

  const sheet: WorkflowWorksheet = worksheetPayload?.sheet ?? {
    machines: [],
    outsourced: [],
    totalPendingParams: 0,
    totalPatients: 0,
  };

  const machineNames = useMemo(
    () => sheet.machines.map((m) => m.machineName),
    [sheet.machines],
  );

  const filteredMachines: WorkflowMachineSection[] = useMemo(() => {
    let list = sheet.machines;
    if (machineFilter !== "all") {
      list = list.filter((m) => m.machineName === machineFilter);
    }
    if (!hidePrintedToday) return list;
    return list
      .map((m) => ({
        ...m,
        patients: m.patients.filter(
          (p) => !isPatientPrintedToday(m.machineName, p.registrationId, printedMap),
        ),
      }))
      .filter((m) => m.patients.length > 0)
      .map((m) => {
        const interfaceCount = m.patients.reduce((s, p) => s + p.interfaceParams.length, 0);
        const manualCount = m.patients.reduce((s, p) => s + p.manualParams.length, 0);
        const sampleIds = new Set<string>();
        m.patients.forEach((p) => {
          [...p.interfaceParams, ...p.manualParams].forEach((l) => sampleIds.add(l.sampleId));
        });
        return {
          ...m,
          interfaceCount,
          manualCount,
          sampleCount: sampleIds.size,
        };
      });
  }, [sheet.machines, machineFilter, hidePrintedToday, printedMap]);

  const filteredOutsourced = useMemo(() => {
    if (machineFilter !== "all" && machineFilter !== "OUTSOURCED") return [];
    if (!hidePrintedToday) return sheet.outsourced;
    return sheet.outsourced.filter(
      (o) => !isPatientPrintedToday("OUTSOURCED", o.registrationId, printedMap),
    );
  }, [sheet.outsourced, machineFilter, hidePrintedToday, printedMap]);

  const openResults = (invoice: string) => {
    setSearchParams({ tab: "results", q: invoice }, { replace: true });
  };

  const printMachines = (machines: WorkflowMachineSection[], label: string) => {
    try {
      const html = buildWorkflowPrintHtml({
        title: "PH PathLabs — Bench Workflow Worksheet",
        batchLabel: label,
        machines,
        outsourced: machineFilter === "all" || machineFilter === "OUTSOURCED" ? filteredOutsourced : [],
        printedBy: getCurrentUserName() || undefined,
      });
      openWorkflowPrintWindow(html);
    } catch (err: any) {
      toast.error(err?.message || "Print failed");
    }
  };

  const markMachinePrinted = (machineName: string, registrationIds: string[]) => {
    markPatientsPrinted(machineName, registrationIds);
    setPrintedTick((n) => n + 1);
    toast.success(`Marked ${registrationIds.length} patient(s) printed for ${machineName}`);
  };

  const toggleSelect = (key: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const markBatchPrinted = () => {
    if (selected.size === 0) {
      toast.message("Select patients first");
      return;
    }
    const byMachine = new Map<string, string[]>();
    for (const key of selected) {
      const [machineName, regId] = key.split("||");
      if (!machineName || !regId) continue;
      const list = byMachine.get(machineName) || [];
      list.push(regId);
      byMachine.set(machineName, list);
    }
    for (const [machineName, ids] of byMachine) {
      markPatientsPrinted(machineName, ids);
    }
    setSelected(new Set());
    setPrintedTick((n) => n + 1);
    toast.success("Marked selected patients as printed today");
  };

  const loading = loadingIds || loadingSheet;
  const capped = !!worksheetPayload?.capped;
  const totalCandidates = worksheetPayload?.totalCandidates ?? candidateIds.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Accepted from</Label>
          <Input
            type="date"
            className="h-8 w-[150px]"
            value={fromDay}
            onChange={(e) => setFromDay(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Accepted to</Label>
          <Input
            type="date"
            className="h-8 w-[150px]"
            value={toDay}
            onChange={(e) => setToDay(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Machine</Label>
          <Select value={machineFilter} onValueChange={setMachineFilter}>
            <SelectTrigger className="h-8 w-[180px]">
              <SelectValue placeholder="All machines" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All machines</SelectItem>
              {machineNames.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
              {sheet.outsourced.length > 0 && (
                <SelectItem value="OUTSOURCED">Outsourced</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="h-8 pl-8"
            placeholder="Search bill / name / mobile…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 h-8">
          <Switch id="wf-repeat" checked={includeRepeat} onCheckedChange={setIncludeRepeat} />
          <Label htmlFor="wf-repeat" className="text-xs cursor-pointer">
            Include repeats
          </Label>
        </div>
        <div className="flex items-center gap-2 h-8">
          <Switch
            id="wf-hide-printed"
            checked={hidePrintedToday}
            onCheckedChange={setHidePrintedToday}
          />
          <Label htmlFor="wf-hide-printed" className="text-xs cursor-pointer">
            Hide printed today
          </Label>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Refresh"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary">{sheet.totalPendingParams} pending params</Badge>
        <Badge variant="outline">{sheet.totalPatients} patients</Badge>
        <Badge variant="outline">{filteredMachines.length} machines</Badge>
        {capped && (
          <span className="text-xs text-amber-700">
            Showing first {WORKFLOW_CANDIDATE_CAP} of {totalCandidates} candidates
          </span>
        )}
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1"
          disabled={filteredMachines.length === 0 && filteredOutsourced.length === 0}
          onClick={() =>
            printMachines(
              filteredMachines,
              `Accepted ${fromDay || "…"} → ${toDay || "…"} · All visible`,
            )
          }
        >
          <Printer className="h-3.5 w-3.5" />
          Print all visible
        </Button>
        <Button size="sm" variant="secondary" className="h-8 gap-1" onClick={markBatchPrinted}>
          <CheckCheck className="h-3.5 w-3.5" />
          Mark batch printed
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading workflow…
        </div>
      ) : filteredMachines.length === 0 && filteredOutsourced.length === 0 ? (
        <p className="text-sm text-muted-foreground py-10 text-center">
          No pending worksheet items for this filter.
        </p>
      ) : (
        <div className="space-y-3">
          {filteredMachines.map((machine) => {
            const open = openMachines[machine.machineName] ?? true;
            return (
              <Collapsible
                key={machine.machineName}
                open={open}
                onOpenChange={(v) =>
                  setOpenMachines((prev) => ({ ...prev, [machine.machineName]: v }))
                }
                className="border rounded-lg bg-background"
              >
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b bg-muted/30">
                  <CollapsibleTrigger className="flex items-center gap-2 text-left font-medium text-sm group">
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${open ? "" : "-rotate-90"}`}
                    />
                    {machine.machineName}
                  </CollapsibleTrigger>
                  <Badge variant="secondary" className="text-[10px]">
                    I {machine.interfaceCount}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    M {machine.manualCount}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {machine.sampleCount} samples
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {machine.patients.length} patients
                  </Badge>
                  <div className="flex-1" />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    onClick={() =>
                      printMachines(
                        [machine],
                        `${machine.machineName} · Accepted ${fromDay} → ${toDay}`,
                      )
                    }
                  >
                    <Printer className="h-3 w-3" />
                    Print this machine
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() =>
                      markMachinePrinted(
                        machine.machineName,
                        machine.patients.map((p) => p.registrationId),
                      )
                    }
                  >
                    Mark printed
                  </Button>
                </div>
                <CollapsibleContent>
                  <div className="divide-y">
                    {machine.patients.map((patient) => {
                      const selKey = `${machine.machineName}||${patient.registrationId}`;
                      const printed = isPatientPrintedToday(
                        machine.machineName,
                        patient.registrationId,
                        printedMap,
                      );
                      return (
                        <div
                          key={selKey}
                          className={`px-3 py-3 space-y-2 ${printed ? "opacity-60" : ""}`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Checkbox
                              checked={selected.has(selKey)}
                              onCheckedChange={(c) => toggleSelect(selKey, !!c)}
                            />
                            <span className="font-mono text-sm font-semibold">
                              {patient.invoiceNumber}
                            </span>
                            <span className="text-sm">{patient.patientLabel}</span>
                            <Badge variant="outline" className="text-[10px] font-mono">
                              {patient.ageGender}
                            </Badge>
                            {patient.isRepeat && (
                              <Badge className="text-[10px] bg-amber-200 text-amber-900 hover:bg-amber-200">
                                REPEAT
                              </Badge>
                            )}
                            {printed && (
                              <Badge variant="secondary" className="text-[10px]">
                                Printed today
                              </Badge>
                            )}
                            <div className="flex-1" />
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 text-xs"
                              onClick={() => openResults(patient.invoiceNumber)}
                            >
                              <ExternalLink className="h-3 w-3" />
                              Open in Results
                            </Button>
                          </div>
                          {patient.tubeHints.length > 0 && (
                            <p className="text-[11px] text-muted-foreground pl-6">
                              {patient.tubeHints.join(" · ")}
                            </p>
                          )}
                          <div className="pl-6 grid gap-3 md:grid-cols-2">
                            {patient.interfaceParams.length > 0 && (
                              <div>
                                <p className="text-[11px] font-medium text-muted-foreground mb-1">
                                  Interface ({patient.interfaceParams.length})
                                </p>
                                <ul className="text-xs space-y-0.5">
                                  {patient.interfaceParams.map((line) => (
                                    <li key={`${line.testId}-${line.parameterId}-${line.sampleId}`}>
                                      <span className="font-medium">{line.parameterName}</span>
                                      <span className="text-muted-foreground">
                                        {" "}
                                        · {line.testName}
                                        {line.unit ? ` · ${line.unit}` : ""}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {patient.manualParams.length > 0 && (
                              <div>
                                <p className="text-[11px] font-medium text-muted-foreground mb-1">
                                  Manual ({patient.manualParams.length})
                                </p>
                                <ul className="text-xs space-y-0.5">
                                  {patient.manualParams.map((line) => (
                                    <li key={`${line.testId}-${line.parameterId}-${line.sampleId}`}>
                                      <span className="font-medium">{line.parameterName}</span>
                                      {line.isDependencyForCalc && (
                                        <Badge
                                          variant="outline"
                                          className="ml-1 text-[9px] px-1 py-0"
                                        >
                                          calc-in
                                        </Badge>
                                      )}
                                      <span className="text-muted-foreground">
                                        {" "}
                                        · {line.testName}
                                        {line.unit ? ` · ${line.unit}` : ""}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}

          {filteredOutsourced.length > 0 && (
            <div className="border rounded-lg bg-background">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b bg-muted/30">
                <span className="font-medium text-sm">Outsourced</span>
                <Badge variant="outline" className="text-[10px]">
                  {filteredOutsourced.length} tests
                </Badge>
              </div>
              <div className="divide-y">
                {filteredOutsourced.map((o) => (
                  <div
                    key={`${o.registrationId}-${o.testId}-${o.sampleId}`}
                    className="px-3 py-2 flex flex-wrap items-center gap-2 text-sm"
                  >
                    <span className="font-mono font-semibold">{o.invoiceNumber}</span>
                    <span>{o.patientLabel}</span>
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {o.ageGender}
                    </Badge>
                    <span className="text-muted-foreground">{o.testName}</span>
                    <span className="text-xs text-muted-foreground">
                      {o.sampleId} · {o.sampleType}
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      {o.labName}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {o.outsourceStatus}
                    </Badge>
                    {o.isRepeat && (
                      <Badge className="text-[10px] bg-amber-200 text-amber-900 hover:bg-amber-200">
                        REPEAT
                      </Badge>
                    )}
                    <div className="flex-1" />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-xs"
                      onClick={() => openResults(o.invoiceNumber)}
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open in Results
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Workflow;
