import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { IndianRupee, TrendingUp, Download, Wallet, ChevronDown, ChevronUp, MapPin, Phone, Trophy } from "lucide-react";
import ExportPasswordDialog from "@/components/ExportPasswordDialog";
import PhleboExportDialog from "@/components/PhleboExportDialog";
import { formatDateDDMMYYYY } from "@/lib/utils";
import { patientDisplayName } from "@/lib/patientDisplayName";
import {
  buildIncentiveMap,
  payoutBucketNet,
  registrationHvc,
  registrationIncentiveAmount,
  registrationPayoutBucket,
  type PhleboPayoutBucketTotals,
} from "@/lib/phleboPayout";

type PeriodKey = "current" | "previous";

type BucketTotals = PhleboPayoutBucketTotals;

const emptyBucket = (): BucketTotals => ({ earned: 0, hold: 0, deducted: 0 });

const money = (n: number) => {
  const v = Number(n) || 0;
  const abs = Math.abs(v).toLocaleString("en-IN");
  return v < 0 ? `-₹${abs}` : `₹${abs}`;
};

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
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };

  const { data: phlebotomists = [] } = useQuery({
    queryKey: ["phlebotomists_dashboard"],
    queryFn: async () => {
      const { data } = await supabase.from("phlebotomists").select("id, name").order("name");
      return data || [];
    },
  });

  const { data: visits = [], isLoading: visitsLoading } = useQuery({
    queryKey: ["phlebo_dashboard_visits", prevMonthStart, currentMonthEnd],
    queryFn: async () => {
      const { data } = await supabase
        .from("home_visits")
        .select("id, estimate_id, phlebotomist_id, visit_date, visit_time, address, status")
        .in("status", ["Completed", "Registered"])
        .gte("visit_date", prevMonthStart)
        .lte("visit_date", currentMonthEnd);
      return data || [];
    },
  });

  const visitIds = useMemo(() => visits.map((v) => v.id), [visits]);

  const { data: registrations = [], isLoading: regsLoading } = useQuery({
    queryKey: ["phlebo_dashboard_registrations", visitIds],
    queryFn: async () => {
      if (visitIds.length === 0) return [];
      const { data } = await supabase
        .from("patient_registrations")
        .select(
          "id, home_visit_id, home_visit_charges, due_amount, final_amount, paid_amount, bill_cancelled, refund_amount, patient_name, title, gender, mobile_number, umr_number, invoice_number, tests, cancelled_tests, status, completing_phlebo_name",
        )
        .in("home_visit_id", visitIds);
      return data || [];
    },
    enabled: visitIds.length > 0,
  });

  const { data: incentiveSources, isLoading: incentivesLoading } = useQuery({
    queryKey: ["phlebo_dashboard_incentive_catalog"],
    queryFn: async () => {
      const [tests, checkups, profiles, combos] = await Promise.all([
        supabase.from("tests").select("id, incentive_allowed, incentive_amount"),
        supabase.from("health_checkups").select("id, incentive_allowed, incentive_amount"),
        supabase.from("billing_profiles").select("id, incentive_allowed, incentive_amount"),
        (supabase as any).from("combos").select("id, incentive_allowed, incentive_amount"),
      ]);
      return {
        tests: tests.data || [],
        checkups: checkups.data || [],
        profiles: profiles.data || [],
        combos: combos.data || [],
      };
    },
  });

  const isLoading = visitsLoading || regsLoading || incentivesLoading;

  const visitMap = useMemo(() => {
    const m: Record<string, any> = {};
    visits.forEach((v: any) => {
      m[v.id] = v;
    });
    return m;
  }, [visits]);

  const incentiveById = useMemo(
    () =>
      buildIncentiveMap([
        incentiveSources?.tests || [],
        incentiveSources?.checkups || [],
        incentiveSources?.profiles || [],
        incentiveSources?.combos || [],
      ]),
    [incentiveSources],
  );

  const {
    payoutHvc,
    payoutInc,
    holdDetails,
    deductedDetails,
  } = useMemo(() => {
    const hvcPay: Record<string, { current: BucketTotals; previous: BucketTotals }> = {};
    const incPay: Record<string, { current: BucketTotals; previous: BucketTotals }> = {};
    const holdRows: Record<string, { current: any[]; previous: any[] }> = {};
    const deductedRows: Record<string, { current: any[]; previous: any[] }> = {};

    const ensure = (pid: string) => {
      if (!hvcPay[pid]) hvcPay[pid] = { current: emptyBucket(), previous: emptyBucket() };
      if (!incPay[pid]) incPay[pid] = { current: emptyBucket(), previous: emptyBucket() };
      if (!holdRows[pid]) holdRows[pid] = { current: [], previous: [] };
      if (!deductedRows[pid]) deductedRows[pid] = { current: [], previous: [] };
    };

    phlebotomists.forEach((p: any) => ensure(p.id));

    // One row per registration (all family members on a visit), attributed to visit phlebo.
    // Keep earned / hold / deducted in separate buckets — net = earned − hold − deducted once.
    registrations.forEach((reg: any) => {
      const visit = visitMap[reg.home_visit_id];
      if (!visit?.phlebotomist_id) return;

      const isCurrent = visit.visit_date >= currentMonthStart && visit.visit_date <= currentMonthEnd;
      const isPrev = visit.visit_date >= prevMonthStart && visit.visit_date <= prevMonthEnd;
      const period: PeriodKey | null = isCurrent ? "current" : isPrev ? "previous" : null;
      if (!period) return;

      const pid = visit.phlebotomist_id;
      ensure(pid);

      const hvc = registrationHvc(reg);
      const incentive = registrationIncentiveAmount(reg, incentiveById);
      const bucket = registrationPayoutBucket(reg);

      if (bucket === "earned") {
        hvcPay[pid][period].earned += hvc;
        incPay[pid][period].earned += incentive;
      } else if (bucket === "hold") {
        hvcPay[pid][period].hold += hvc;
        incPay[pid][period].hold += incentive;
        if (hvc > 0 || incentive > 0) {
          holdRows[pid][period].push({
            visit,
            registration: reg,
            hvc,
            incentive,
            reason: "Payment due - held until collected",
          });
        }
      } else if (bucket === "deducted") {
        hvcPay[pid][period].deducted += hvc;
        incPay[pid][period].deducted += incentive;
        if (hvc > 0 || incentive > 0) {
          deductedRows[pid][period].push({
            visit,
            registration: reg,
            hvc,
            incentive,
            reason: "Bill cancelled - not payable",
          });
        }
      }
    });

    return {
      payoutHvc: hvcPay,
      payoutInc: incPay,
      holdDetails: holdRows,
      deductedDetails: deductedRows,
    };
  }, [
    registrations,
    visitMap,
    phlebotomists,
    incentiveById,
    currentMonthStart,
    currentMonthEnd,
    prevMonthStart,
    prevMonthEnd,
  ]);

  const phleboMap = useMemo(() => {
    const m: Record<string, string> = {};
    phlebotomists.forEach((p: any) => {
      m[p.id] = p.name;
    });
    return m;
  }, [phlebotomists]);

  const activePhleboIds = useMemo(() => {
    const ids = new Set<string>();
    visits.forEach((v: any) => {
      if (v.phlebotomist_id) ids.add(v.phlebotomist_id);
    });
    return [...ids].sort((a, b) => (phleboMap[a] || "").localeCompare(phleboMap[b] || ""));
  }, [visits, phleboMap]);

  const leaderboard = useMemo(() => {
    return activePhleboIds
      .map((id) => {
        const hvc = payoutHvc[id]?.current || emptyBucket();
        const inc = payoutInc[id]?.current || emptyBucket();
        // HVC / Incentive = earned only. Hold / Deducted are informational (not subtracted again).
        const earned = hvc.earned + inc.earned;
        const hold = hvc.hold + inc.hold;
        const deducted = hvc.deducted + inc.deducted;
        return {
          id,
          name: phleboMap[id] || "Unknown",
          hvcEarned: hvc.earned,
          incentiveEarned: inc.earned,
          hold,
          deducted,
          net: earned,
        };
      })
      .sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));
  }, [activePhleboIds, payoutHvc, payoutInc, phleboMap]);

  const renderDetailRow = (row: any) => {
    const reg = row.registration || {};
    const v = row.visit || {};
    const testList: any[] = Array.isArray(reg.tests) ? reg.tests : [];
    return (
      <div className="bg-background border rounded-md p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">{patientDisplayName(reg)}</div>
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
          {reg.mobile_number && (
            <span className="flex items-center gap-1">
              <Phone className="h-3 w-3" />
              {reg.mobile_number}
            </span>
          )}
          {v.address && (
            <span className="flex items-start gap-1">
              <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
              <span className="break-words">{v.address}</span>
            </span>
          )}
        </div>
        {testList.length > 0 && (
          <div className="text-xs">
            <span className="text-muted-foreground">Tests ({testList.length}): </span>
            <span>{testList.map((t: any) => t.test_name).filter(Boolean).join(", ")}</span>
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-1 text-xs pt-1 border-t">
          <div>
            <span className="text-muted-foreground">HVC: </span>
            <span className="font-semibold text-primary">{money(row.hvc || 0)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Incentive: </span>
            <span className="font-semibold text-primary">{money(row.incentive || 0)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Final: </span>
            <span className="font-medium">{money(Number(reg.final_amount || 0))}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Paid: </span>
            <span className="font-medium">{money(Number(reg.paid_amount || 0))}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Due: </span>
            <span className={`font-semibold ${Number(reg.due_amount || 0) > 0 ? "text-destructive" : "text-success"}`}>
              {money(Number(reg.due_amount || 0))}
            </span>
          </div>
        </div>
        {row.reason && <div className="text-[11px] text-destructive italic">{row.reason}</div>}
      </div>
    );
  };

  const renderPayoutPeriod = (
    id: string,
    label: string,
    period: PeriodKey,
    hvc: BucketTotals,
    inc: BucketTotals,
  ) => {
    const holdKey = `${id}-${period}-hold`;
    const dedKey = `${id}-${period}-ded`;
    const holdRows = holdDetails[id]?.[period] || [];
    const dedRows = deductedDetails[id]?.[period] || [];
    const isHoldOpen = expandedHold.has(holdKey);
    const isDedOpen = expandedDeducted.has(dedKey);
    const earned = hvc.earned + inc.earned;
    const hold = hvc.hold + inc.hold;
    const deducted = hvc.deducted + inc.deducted;
    // Payable = earned only; hold/deducted listed below for audit (not subtracted again).
    const net = earned;

    return (
      <div className="border rounded-md p-3 space-y-2 bg-muted/20">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <div className="flex justify-between col-span-2">
            <span className="text-muted-foreground">Earned (HVC + Incentive)</span>
            <span className="font-medium text-success">{money(earned)}</span>
          </div>
          <div className="flex justify-between col-span-2 text-xs text-muted-foreground pl-1">
            <span>HVC {money(hvc.earned)} · Incentive {money(inc.earned)}</span>
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
                    <Badge variant="outline" className="h-4 text-[10px] px-1">
                      {holdRows.length}
                    </Badge>
                    {isHoldOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </>
                )}
              </span>
              <span className="font-medium text-amber-600 dark:text-amber-400">{money(-hold)}</span>
            </button>
          </div>
          {isHoldOpen && holdRows.length > 0 && (
            <div className="col-span-2 space-y-2 mt-1">
              {holdRows.map((row: any, i: number) => (
                <div key={`${row.registration?.id || i}-h`}>{renderDetailRow(row)}</div>
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
                Deducted (cancelled bills)
                {dedRows.length > 0 && (
                  <>
                    <Badge variant="outline" className="h-4 text-[10px] px-1">
                      {dedRows.length}
                    </Badge>
                    {isDedOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </>
                )}
              </span>
              <span className="font-medium text-destructive">{money(-deducted)}</span>
            </button>
          </div>
          {isDedOpen && dedRows.length > 0 && (
            <div className="col-span-2 space-y-2 mt-1">
              {dedRows.map((row: any, i: number) => (
                <div key={`${row.registration?.id || i}-d`}>{renderDetailRow(row)}</div>
              ))}
            </div>
          )}
          <div className="flex justify-between col-span-2 border-t pt-2 mt-1">
            <span className="font-semibold">Net Payable</span>
            <span className="font-bold text-primary">{money(net)}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Phlebo Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Month-end home visit charges + test incentives by phlebo. Cancelled bills are deducted.
          </p>
        </div>
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
          {/* Competition leaderboard */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Trophy className="h-5 w-5 text-primary" />
              Leaderboard — {currentMonthLabel}
            </h2>
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-left">
                        <th className="px-4 py-2 font-medium w-12">#</th>
                        <th className="px-4 py-2 font-medium">Phlebo</th>
                        <th className="px-4 py-2 font-medium text-right">HVC Earned</th>
                        <th className="px-4 py-2 font-medium text-right">Incentive Earned</th>
                        <th className="px-4 py-2 font-medium text-right">On Hold</th>
                        <th className="px-4 py-2 font-medium text-right">Deducted</th>
                        <th className="px-4 py-2 font-medium text-right">Net Payable</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.map((row, idx) => (
                        <tr key={row.id} className="border-b last:border-0">
                          <td className="px-4 py-2 tabular-nums text-muted-foreground">{idx + 1}</td>
                          <td className="px-4 py-2 font-medium">{row.name}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{money(row.hvcEarned)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{money(row.incentiveEarned)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-amber-600">{money(-row.hold)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-destructive">{money(-row.deducted)}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-semibold text-primary">{money(row.net)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* HVC — earned payable (hold/cancelled excluded, not subtracted again) */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <IndianRupee className="h-5 w-5 text-primary" />
              Home Visit Charges (payable)
            </h2>
            <p className="text-xs text-muted-foreground -mt-1">
              Only earned visits. Cancelled and unpaid (hold) are listed separately — not subtracted from this total.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {activePhleboIds.map((id) => (
                <Card key={id}>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-semibold">{phleboMap[id] || "Unknown"}</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{currentMonthLabel}</span>
                      <span className="font-medium">{money(payoutBucketNet(payoutHvc[id]?.current || emptyBucket()))}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{prevMonthLabel}</span>
                      <span className="font-medium">{money(payoutBucketNet(payoutHvc[id]?.previous || emptyBucket()))}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Incentives — earned payable */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Incentive Earnings (payable)
            </h2>
            <p className="text-xs text-muted-foreground -mt-1">
              Tests / packages / combos on earned visits only. Hold and cancelled listed separately.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {activePhleboIds.map((id) => (
                <Card key={id}>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-semibold">{phleboMap[id] || "Unknown"}</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{currentMonthLabel}</span>
                      <span className="font-medium text-primary">{money(payoutBucketNet(payoutInc[id]?.current || emptyBucket()))}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{prevMonthLabel}</span>
                      <span className="font-medium text-primary">{money(payoutBucketNet(payoutInc[id]?.previous || emptyBucket()))}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Payout summary */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Wallet className="h-5 w-5 text-primary" />
              Month-end Payout (HVC + Incentive)
            </h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {activePhleboIds.map((id) => (
                <Card key={id}>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-semibold">{phleboMap[id] || "Unknown"}</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-3">
                    {renderPayoutPeriod(
                      id,
                      currentMonthLabel,
                      "current",
                      payoutHvc[id]?.current || emptyBucket(),
                      payoutInc[id]?.current || emptyBucket(),
                    )}
                    {renderPayoutPeriod(
                      id,
                      prevMonthLabel,
                      "previous",
                      payoutHvc[id]?.previous || emptyBucket(),
                      payoutInc[id]?.previous || emptyBucket(),
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default PhleboDashboard;