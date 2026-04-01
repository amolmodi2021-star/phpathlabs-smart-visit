import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { IndianRupee, TrendingUp, Download } from "lucide-react";
import ExportPasswordDialog from "@/components/ExportPasswordDialog";
import PhleboExportDialog from "@/components/PhleboExportDialog";

const PhleboDashboard = () => {
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const now = new Date();
  const currentMonthStart = format(startOfMonth(now), "yyyy-MM-dd");
  const currentMonthEnd = format(endOfMonth(now), "yyyy-MM-dd");
  const prevMonthStart = format(startOfMonth(subMonths(now, 1)), "yyyy-MM-dd");
  const prevMonthEnd = format(endOfMonth(subMonths(now, 1)), "yyyy-MM-dd");

  const currentMonthLabel = format(now, "MMMM yyyy");
  const prevMonthLabel = format(subMonths(now, 1), "MMMM yyyy");

  // Fetch all phlebotomists
  const { data: phlebotomists = [] } = useQuery({
    queryKey: ["phlebotomists_dashboard"],
    queryFn: async () => {
      const { data } = await supabase.from("phlebotomists").select("id, name").order("name");
      return data || [];
    },
  });

  // Fetch completed home visits for current and previous month
  const { data: visits = [], isLoading: visitsLoading } = useQuery({
    queryKey: ["phlebo_dashboard_visits", prevMonthStart, currentMonthEnd],
    queryFn: async () => {
      const { data } = await supabase
        .from("home_visits")
        .select("id, estimate_id, phlebotomist_id, visit_date, status")
        .eq("status", "Completed")
        .gte("visit_date", prevMonthStart)
        .lte("visit_date", currentMonthEnd);
      return data || [];
    },
  });

  // Fetch estimates for completed visits
  const estimateIds = useMemo(() => [...new Set(visits.map((v) => v.estimate_id))], [visits]);

  const { data: estimates = [], isLoading: estimatesLoading } = useQuery({
    queryKey: ["phlebo_dashboard_estimates", estimateIds],
    queryFn: async () => {
      if (estimateIds.length === 0) return [];
      const { data } = await supabase
        .from("estimates")
        .select("id, home_visit_charges")
        .in("id", estimateIds);
      return data || [];
    },
    enabled: estimateIds.length > 0,
  });

  // Fetch estimate_tests for completed visits with incentive info from tests table
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

  // Fetch tests with incentive data
  const { data: tests = [] } = useQuery({
    queryKey: ["phlebo_dashboard_tests"],
    queryFn: async () => {
      const { data } = await supabase
        .from("tests")
        .select("id, incentive_allowed, incentive_amount");
      return data || [];
    },
  });

  const isLoading = visitsLoading || estimatesLoading || testsLoading;

  // Build lookup maps
  const estimateMap = useMemo(() => {
    const m: Record<string, number> = {};
    estimates.forEach((e) => (m[e.id] = Number(e.home_visit_charges) || 0));
    return m;
  }, [estimates]);

  const testIncentiveMap = useMemo(() => {
    const m: Record<string, number> = {};
    tests.forEach((t) => {
      if (t.incentive_allowed) m[t.id] = Number(t.incentive_amount) || 0;
    });
    return m;
  }, [tests]);

  // Map estimate_id -> list of incentive amounts from incentive-eligible tests
  const estimateIncentiveMap = useMemo(() => {
    const m: Record<string, number> = {};
    estimateTests.forEach((et) => {
      const inc = testIncentiveMap[et.test_id];
      if (inc !== undefined) {
        m[et.estimate_id] = (m[et.estimate_id] || 0) + inc;
      }
    });
    return m;
  }, [estimateTests, testIncentiveMap]);

  // Aggregate per phlebotomist per month — deduplicate home visit charges per physical visit
  const { amountData, incentiveData } = useMemo(() => {
    const amounts: Record<string, { current: number; previous: number }> = {};
    const incentives: Record<string, { current: number; previous: number }> = {};

    phlebotomists.forEach((p) => {
      amounts[p.id] = { current: 0, previous: 0 };
      incentives[p.id] = { current: 0, previous: 0 };
    });

    // Track which visit groups already had their home visit charge counted
    const chargeUsed = new Set<string>();
    const getGroupKey = (v: { visit_date: string; phlebotomist_id: string | null }) =>
      `${v.visit_date}||${v.phlebotomist_id || ""}`;

    visits.forEach((v) => {
      if (!v.phlebotomist_id) return;
      const isCurrent = v.visit_date >= currentMonthStart && v.visit_date <= currentMonthEnd;
      const isPrev = v.visit_date >= prevMonthStart && v.visit_date <= prevMonthEnd;
      const period = isCurrent ? "current" : isPrev ? "previous" : null;
      if (!period) return;

      if (!amounts[v.phlebotomist_id]) amounts[v.phlebotomist_id] = { current: 0, previous: 0 };
      if (!incentives[v.phlebotomist_id]) incentives[v.phlebotomist_id] = { current: 0, previous: 0 };

      // Only count home visit charge once per visit group
      let hvCharge = estimateMap[v.estimate_id] || 0;
      const groupKey = `${period}||${getGroupKey(v)}`;
      if (hvCharge > 0) {
        if (chargeUsed.has(groupKey)) {
          hvCharge = 0;
        } else {
          chargeUsed.add(groupKey);
        }
      }
      amounts[v.phlebotomist_id][period] += hvCharge;
      incentives[v.phlebotomist_id][period] += estimateIncentiveMap[v.estimate_id] || 0;
    });

    return { amountData: amounts, incentiveData: incentives };
  }, [visits, phlebotomists, estimateMap, estimateIncentiveMap, currentMonthStart, currentMonthEnd, prevMonthStart, prevMonthEnd]);

  const phleboMap = useMemo(() => {
    const m: Record<string, string> = {};
    phlebotomists.forEach((p) => (m[p.id] = p.name));
    return m;
  }, [phlebotomists]);

  const activePhleboIds = useMemo(() => {
    const ids = new Set<string>();
    visits.forEach((v) => { if (v.phlebotomist_id) ids.add(v.phlebotomist_id); });
    return [...ids].sort((a, b) => (phleboMap[a] || "").localeCompare(phleboMap[b] || ""));
  }, [visits, phleboMap]);

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
        <p className="text-sm text-muted-foreground text-center py-8">No completed visits found for current or previous month.</p>
      ) : (
        <>
          {/* Section 1: Visit Amounts */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <IndianRupee className="h-5 w-5 text-primary" />
              Home Visit Charges (Completed)
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
        </>
      )}
    </div>
  );
};

export default PhleboDashboard;
