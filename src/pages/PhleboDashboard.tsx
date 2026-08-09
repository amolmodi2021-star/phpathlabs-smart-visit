import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { IndianRupee, TrendingUp, Download, Wallet, ChevronDown, ChevronUp, MapPin, Phone } from "lucide-react";
import ExportPasswordDialog from "@/components/ExportPasswordDialog";
import PhleboExportDialog from "@/components/PhleboExportDialog";
import { formatDateDDMMYYYY } from "@/lib/utils";
import { patientDisplayName } from "@/lib/patientDisplayName";

type PeriodKey = "current" | "previous";

const PhleboDashboard = () => {
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [expandedHold, setExpandedHold] = useState<Set<string>>(new Set());
  const [expandedDeducted, setExpandedDeducted] = useState<Set<string>>(new Set());

  const now = new Date();
  const currentMonthStart = format(startOfMonth(now), "yyyy-MM-dd");
  const currentMonthEnd = format(endOfMonth(now), "yyyy-MM-dd");
  const prevMonthStart = format(startOfMonth(subMonths(now, 1)), "yyyy-MM-dd");
  const prevMonthEnd = format(endOfMonth(subMonths(now, 1)), "yyyy-MM-dd");

  const currentMonthLabel = format(now, "MMMM yyyy");
  const prevMonthLabel = format(subMonths(now, 1), "MMMM yyyy");

  const formatTime12hr = (time?: string | null) => {
    if (!time) return "";
    const [h, m] = time.split(":");
    const hour = parseInt(h, 10);
    if (isNaN(hour)) return time;
    const ampm = hour >= 12 ? "PM" : "AM";
    const h12 = hour % 12 || 12;
    return `${h12}:${m} ${ampm}`;
  };

  const togglePanel = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setter(next);
  };

  // Fetch all phlebotomists
  const { data: phlebotomists = [] } = useQuery({
    queryKey: ["phlebotomists_dashboard"],
    queryFn: async () => {
      const { data } = await supabase.from("phlebotomists").select("id, name").order("name");
      return data || [];
    },
  });

  // Fetch Registered home visits for current and previous month
  const { data: visits = [], isLoading: visitsLoading } = useQuery({
    queryKey: ["phlebo_dashboard_visits", prevMonthStart, currentMonthEnd],
    queryFn: async () => {
      const { data } = await supabase
        .from("home_visits")
        .select("id, estimate_id, phlebotomist_id, visit_date, visit_time, address, status")
        .eq("status", "Registered")
        .gte("visit_date", prevMonthStart)
        .lte("visit_date", currentMonthEnd);
      return data || [];
    },
  });

  const estimateIds = useMemo(() => [...new Set(visits.map((v) => v.estimate_id))], [visits]);
  const visitIds = useMemo(() => visits.map((v) => v.id), [visits]);

  const { data: estimates = [], isLoading: estimatesLoading } = useQuery({
    queryKey: ["phlebo_dashboard_estimates", estimateIds],
    queryFn: async () => {
      if (estimateIds.length === 0) return [];
      const { data } = await supabase
        .from("estimates")
        .select("id, home_visit_charges, patient_name, title, gender, whatsapp_number, umr_number")
        .in("id", estimateIds);
      return data || [];
    },
    enabled: estimateIds.length > 0,
  });

  const { data: estimateTests = [], isLoading: testsLoading } = useQuery({
    queryKey: ["phlebo_dashboard_estimate_tests", estimateIds],
    queryFn: async () => {
      if (estimateIds.length === 0) return [];
      const { data } = await supabase
        .from("estimate_tests")
        .select("estimate_id, test_id")
        .in("estimate_id", estimateIds);
      return data || [];
    },
    enabled: estimateIds.length > 0,
  });

  const { data: tests = [] } = useQuery({
    queryKey: ["phlebo_dashboard_tests"],
    queryFn: async () => {
      const { data } = await supabase
        .from("tests")
        .select("id, incentive_allowed, incentive_amount");
      return data || [];
    },
  });

  // Fetch matching patient_registrations (live state — bill_cancelled, due, current HVC)
  const { data: registrations = [], isLoading: regsLoading } = useQuery({
    queryKey: ["phlebo_dashboard_registrations", visitIds],
    queryFn: async () => {
      if (visitIds.length === 0) return [];
      const { data } = await supabase
        .from("patient_registrations")
        .select("id, home_visit_id, home_visit_charges, due_amount, final_amount, paid_amount, bill_cancelled, refund_amount, patient_name, title, gender, mobile_number, umr_number, invoice_number, tests, status")
        .in("home_visit_id", visitIds);
      return data || [];
    },
    enabled: visitIds.length > 0,
  });

  const isLoading = visitsLoading || estimatesLoading || testsLoading || regsLoading;

  // Lookup maps
  const estimateMap = useMemo(() => {
    const m: Record<string, any> = {};
    estimates.forEach((e: any) => (m[e.id] = e));
    return m;
  }, [estimates]);

  const regByVisitId = useMemo(() => {
    const m: Record<string, any> = {};
    registrations.forEach((r: any) => { if (r.home_visit_id) m[r.home_visit_id] = r; });
    return m;
  }, [registrations]);

  const testIncentiveMap = useMemo(() => {
    const m: Record<string, number> = {};
    tests.forEach((t: any) => { if (t.incentive_allowed) m[t.id] = Number(t.incentive_amount) || 0; });
    return m;
  }, [tests]);

  const estimateIncentiveMap = useMemo(() => {
    const m: Record<string, number> = {};
    estimateTests.forEach((et: any) => {
      const inc = testIncentiveMap[et.test_id];
      if (inc !== undefined) m[et.estimate_id] = (m[et.estimate_id] || 0) + inc;
    });
    return m;
  }, [estimateTests, testIncentiveMap]);

  // Aggregate per phlebotomist per month — visit charges (gross), incentives, payout buckets
  const { amountData, incentiveData, payoutData, holdDetails, deductedDetails } = useMemo(() => {
    const amounts: Record<string, { current: number; previous: number }> = {};
    const incentives: Record<string, { current: number; previous: number }> = {};
    const payouts: Record<string, { current: { earned: number; hold: number; deducted: number }; previous: { earned: number; hold: number; deducted: number } }> = {};
    const holdRows: Record<string, { current: any[]; previous: any[] }> = {};
    const deductedRows: Record<string, { current: any[]; previous: any[] }> = {};

    phlebotomists.forEach((p: any) => {
      amounts[p.id] = { current: 0, previous: 0 };
      incentives[p.id] = { current: 0, previous: 0 };
      payouts[p.id] = { current: { earned: 0, hold: 0, deducted: 0 }, previous: { earned: 0, hold: 0, deducted: 0 } };
      holdRows[p.id] = { current: [], previous: [] };
      deductedRows[p.id] = { current: [], previous: [] };
    });

    visits.forEach((v: any) => {
      if (!v.phlebotomist_id) return;
      const isCurrent = v.visit_date >= currentMonthStart && v.visit_date <= currentMonthEnd;
      const isPrev = v.visit_date >= prevMonthStart && v.visit_date <= prevMonthEnd;
      const period: PeriodKey | null = isCurrent ? "current" : isPrev ? "previous" : null;
      if (!period) return;

      const pid = v.phlebotomist_id;
      if (!amounts[pid]) amounts[pid] = { current: 0, previous: 0 };
      if (!incentives[pid]) incentives[pid] = { current: 0, previous: 0 };
      if (!payouts[pid]) payouts[pid] = { current: { earned: 0, hold: 0, deducted: 0 }, previous: { earned: 0, hold: 0, deducted: 0 } };
      if (!holdRows[pid]) holdRows[pid] = { current: [], previous: [] };
      if (!deductedRows[pid]) deductedRows[pid] = { current: [], previous: [] };

      const est = estimateMap[v.estimate_id];
      const originalHvc = Number(est?.home_visit_charges || 0);

      // Gross charges (informational — what the phlebo brought in)
      amounts[pid][period] += originalHvc;
      incentives[pid][period] += estimateIncentiveMap[v.estimate_id] || 0;

      // Payout bucket — based on linked registration
      const reg = regByVisitId[v.id];
      if (!reg) {
        // Registered visit but no patient_registration row found — treat as earned (defensive)
        if (originalHvc > 0) payouts[pid][period].earned += originalHvc;
        return;
      }

      const billCancelled = !!reg.bill_cancelled;
      const currentHvc = Number(reg.home_visit_charges || 0);
      const dueAmount = Number(reg.due_amount || 0);

      const detailRow = {
        visit: v,
        registration: reg,
        estimate: est,
        originalHvc,
        currentHvc,
        dueAmount,
      };

      if (billCancelled) {
        // Whole bill cancelled — phlebo loses the original HVC
        payouts[pid][period].deducted += originalHvc;
        deductedRows[pid][period].push({ ...detailRow, reason: "Bill cancelled" });
      } else if (originalHvc > 0 && currentHvc === 0) {
        // HVC was explicitly refunded later — phlebo loses the original HVC
        payouts[pid][period].deducted += originalHvc;
        deductedRows[pid][period].push({ ...detailRow, reason: "Home visit charge refunded" });
      } else if (currentHvc > 0 && dueAmount > 0) {
        // Patient still owes money — hold the HVC until due is cleared
        payouts[pid][period].hold += currentHvc;
        holdRows[pid][period].push(detailRow);
      } else if (currentHvc > 0) {
        // Fully paid (or zero-due) and HVC retained — phlebo earns
        payouts[pid][period].earned += currentHvc;
      }
    });

    return { amountData: amounts, incentiveData: incentives, payoutData: payouts, holdDetails: holdRows, deductedDetails: deductedRows };
  }, [visits, phlebotomists, estimateMap, regByVisitId, estimateIncentiveMap, currentMonthStart, currentMonthEnd, prevMonthStart, prevMonthEnd]);

  const phleboMap = useMemo(() => {
    const m: Record<string, string> = {};
    phlebotomists.forEach((p: any) => (m[p.id] = p.name));
    return m;
  }, [phlebotomists]);

  const activePhleboIds = useMemo(() => {
    const ids = new Set<string>();
    visits.forEach((v: any) => { if (v.phlebotomist_id) ids.add(v.phlebotomist_id); });
    return [...ids].sort((a, b) => (phleboMap[a] || "").localeCompare(phleboMap[b] || ""));
  }, [visits, phleboMap]);

  const renderDetailRow = (row: any) => {
    const e = row.estimate || {};
    const reg = row.registration || {};
    const v = row.visit || {};
    const testList: any[] = Array.isArray(reg.tests) ? reg.tests : [];
    return (
      <div className="bg-background border rounded-md p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">{patientDisplayName(reg?.patient_name ? reg : e)}</div>
            <div className="text-xs text-muted-foreground space-x-2">
              {reg.umr_number && <span>UMR: {reg.umr_number}</span>}
              {reg.invoice_number && <span>• Inv: {reg.invoice_number}</span>}
            </div>
          </div>
          <Badge variant="outline" className="text-[10px]">
            {formatDateDDMMYYYY(v.visit_date)} {v.visit_time ? `• ${formatTime12hr(v.visit_time)}` : ""}
          </Badge>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs text-muted-foreground">
          {(reg.mobile_number || e.whatsapp_number) && (
            <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{reg.mobile_number || e.whatsapp_number}</span>
          )}
          {v.address && (
            <span className="flex items-start gap-1"><MapPin className="h-3 w-3 mt-0.5 shrink-0" /><span className="break-words">{v.address}</span></span>
          )}
        </div>
        {testList.length > 0 && (
          <div className="text-xs">
            <span className="text-muted-foreground">Tests ({testList.length}): </span>
            <span>{testList.map((t: any) => t.test_name).filter(Boolean).join(", ")}</span>
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-xs pt-1 border-t">
          <div>
            <span className="text-muted-foreground">HVC: </span>
            <span className="font-semibold text-primary">₹{Number(row.currentHvc || row.originalHvc || 0).toLocaleString("en-IN")}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Final: </span>
            <span className="font-medium">₹{Number(reg.final_amount || 0).toLocaleString("en-IN")}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Paid: </span>
            <span className="font-medium">₹{Number(reg.paid_amount || 0).toLocaleString("en-IN")}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Due: </span>
            <span className={`font-semibold ${Number(reg.due_amount || 0) > 0 ? "text-destructive" : "text-success"}`}>
              ₹{Number(reg.due_amount || 0).toLocaleString("en-IN")}
            </span>
          </div>
        </div>
        {row.reason && (
          <div className="text-[11px] text-destructive italic">{row.reason}</div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Phlebo Dashboard</h1>
        <Button variant="outline" size="sm" onClick={() => setShowPasswordDialog(true)}>
          <Download className="h-4 w-4 mr-1" /> Export Report
        </Button>
      </div>

      <ExportPasswordDialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog} onSuccess={() => setShowExportDialog(true)} />
      <PhleboExportDialog open={showExportDialog} onOpenChange={setShowExportDialog} />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : activePhleboIds.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No registered visits found for current or previous month.</p>
      ) : (
        <>
          {/* Section 1: Visit Amounts (gross) */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <IndianRupee className="h-5 w-5 text-primary" />
              Home Visit Charges (Registered)
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {activePhleboIds.map((id) => (
                <Card key={id}>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-semibold">{phleboMap[id] || "Unknown"}</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{currentMonthLabel}</span>
                      <span className="font-medium">₹{(amountData[id]?.current || 0).toLocaleString("en-IN")}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{prevMonthLabel}</span>
                      <span className="font-medium">₹{(amountData[id]?.previous || 0).toLocaleString("en-IN")}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Section 2: Incentives */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Incentive Earnings
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {activePhleboIds.map((id) => (
                <Card key={id}>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-semibold">{phleboMap[id] || "Unknown"}</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{currentMonthLabel}</span>
                      <span className="font-medium text-primary">₹{(incentiveData[id]?.current || 0).toLocaleString("en-IN")}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{prevMonthLabel}</span>
                      <span className="font-medium text-primary">₹{(incentiveData[id]?.previous || 0).toLocaleString("en-IN")}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Section 3: Payout Summary (Earned / Hold / Deducted / Net Payable) */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Wallet className="h-5 w-5 text-primary" />
              Home Visit Payout Summary
            </h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {activePhleboIds.map((id) => {
                const cur = payoutData[id]?.current || { earned: 0, hold: 0, deducted: 0 };
                const prv = payoutData[id]?.previous || { earned: 0, hold: 0, deducted: 0 };
                const curNet = cur.earned - cur.deducted;
                const prvNet = prv.earned - prv.deducted;

                const renderPeriod = (label: string, period: PeriodKey, vals: { earned: number; hold: number; deducted: number }, net: number) => {
                  const holdKey = `${id}-${period}-hold`;
                  const dedKey = `${id}-${period}-ded`;
                  const holdRows = holdDetails[id]?.[period] || [];
                  const dedRows = deductedDetails[id]?.[period] || [];
                  const isHoldOpen = expandedHold.has(holdKey);
                  const isDedOpen = expandedDeducted.has(dedKey);

                  return (
                    <div className="border rounded-md p-3 space-y-2 bg-muted/20">
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                        <div className="flex justify-between col-span-2">
                          <span className="text-muted-foreground">Earned</span>
                          <span className="font-medium text-success">₹{vals.earned.toLocaleString("en-IN")}</span>
                        </div>
                        <div className="col-span-2">
                          <button
                            type="button"
                            onClick={() => holdRows.length > 0 && togglePanel(expandedHold, setExpandedHold, holdKey)}
                            className={`w-full flex justify-between items-center text-left ${holdRows.length > 0 ? "cursor-pointer hover:bg-muted/40 rounded px-1 -mx-1" : ""}`}
                          >
                            <span className="text-muted-foreground flex items-center gap-1">
                              On Hold
                              {holdRows.length > 0 && (
                                <>
                                  <Badge variant="outline" className="h-4 text-[10px] px-1">{holdRows.length}</Badge>
                                  {isHoldOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                </>
                              )}
                            </span>
                            <span className="font-medium text-amber-600 dark:text-amber-400">₹{vals.hold.toLocaleString("en-IN")}</span>
                          </button>
                        </div>
                        {isHoldOpen && holdRows.length > 0 && (
                          <div className="col-span-2 space-y-2 mt-1">
                            {holdRows.map((row: any, i: number) => (
                              <div key={`${row.visit?.id || i}-h`}>{renderDetailRow(row)}</div>
                            ))}
                          </div>
                        )}
                        <div className="col-span-2">
                          <button
                            type="button"
                            onClick={() => dedRows.length > 0 && togglePanel(expandedDeducted, setExpandedDeducted, dedKey)}
                            className={`w-full flex justify-between items-center text-left ${dedRows.length > 0 ? "cursor-pointer hover:bg-muted/40 rounded px-1 -mx-1" : ""}`}
                          >
                            <span className="text-muted-foreground flex items-center gap-1">
                              Deducted
                              {dedRows.length > 0 && (
                                <>
                                  <Badge variant="outline" className="h-4 text-[10px] px-1">{dedRows.length}</Badge>
                                  {isDedOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                </>
                              )}
                            </span>
                            <span className="font-medium text-destructive">−₹{vals.deducted.toLocaleString("en-IN")}</span>
                          </button>
                        </div>
                        {isDedOpen && dedRows.length > 0 && (
                          <div className="col-span-2 space-y-2 mt-1">
                            {dedRows.map((row: any, i: number) => (
                              <div key={`${row.visit?.id || i}-d`}>{renderDetailRow(row)}</div>
                            ))}
                          </div>
                        )}
                        <div className="flex justify-between col-span-2 border-t pt-2 mt-1">
                          <span className="font-semibold">Net Payable</span>
                          <span className="font-bold text-primary">₹{net.toLocaleString("en-IN")}</span>
                        </div>
                      </div>
                    </div>
                  );
                };

                return (
                  <Card key={id}>
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="text-sm font-semibold">{phleboMap[id] || "Unknown"}</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 space-y-3">
                      {renderPeriod(currentMonthLabel, "current", cur, curNet)}
                      {renderPeriod(prevMonthLabel, "previous", prv, prvNet)}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default PhleboDashboard;
