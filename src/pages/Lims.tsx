import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { getAllowedSections } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { fetchWorkflowPendingCount } from "@/lib/workflowFetch";
import { addDaysToDayString, localDayString } from "@/lib/workflowWorksheet";

const PatientRegistration = lazy(() => import("@/components/lims/PatientRegistration"));
const RegisteredPatients = lazy(() => import("@/components/lims/RegisteredPatients"));
const CompletedHomeVisits = lazy(() => import("@/components/lims/CompletedHomeVisits"));
const DuePayments = lazy(() => import("@/components/lims/DuePayments"));
const BadDebts = lazy(() => import("@/components/lims/BadDebts"));
const SampleCollection = lazy(() => import("@/components/lims/SampleCollection"));
const SampleAcceptance = lazy(() => import("@/components/lims/SampleAcceptance"));
const Workflow = lazy(() => import("@/components/lims/Workflow"));
const ResultsEntry = lazy(() => import("@/components/lims/ResultsEntry"));
const ResultVerification = lazy(() => import("@/components/lims/ResultVerification"));
const DoctorApproval = lazy(() => import("@/components/lims/DoctorApproval"));
const Dispatch = lazy(() => import("@/components/lims/Dispatch"));
const LimsSettings = lazy(() => import("@/components/lims/LimsSettings"));
const DailyReport = lazy(() => import("@/components/lims/DailyReport"));
const Billing = lazy(() => import("@/components/lims/Billing"));

const allLimsTabs = [
  { key: "register", label: "New Registration", component: PatientRegistration },
  { key: "patients", label: "Registered Patients", component: RegisteredPatients },
  { key: "sample_collection", label: "Sample Collection", component: SampleCollection },
  { key: "sample_acceptance", label: "Sample Acceptance", component: SampleAcceptance },
  { key: "workflow", label: "Workflow", component: Workflow },
  { key: "results", label: "Results", component: ResultsEntry },
  { key: "verification", label: "Result Verification", component: ResultVerification },
  { key: "doctor_approval", label: "Doctor Approval", component: DoctorApproval },
  { key: "dispatch", label: "Dispatch", component: Dispatch },
  { key: "due_payments", label: "Due Payments", component: DuePayments },
  { key: "bad_debts", label: "Bad Debts", component: BadDebts },
  { key: "billing", label: "Billing", component: Billing },
  { key: "daily_report", label: "Daily Report", component: DailyReport },
  { key: "completed_hv", label: "Completed Home Visits", component: CompletedHomeVisits },
  { key: "settings", label: "Settings", component: LimsSettings },
];

const TabFallback = () => (
  <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
    <Loader2 className="h-4 w-4 animate-spin" />
    Loading…
  </div>
);

/** Catch render/chunk errors so a failed tab doesn't leave a blank panel. */
class TabErrorBoundary extends Component<
  { tabKey: string; children: ReactNode },
  { error: Error | null; resetKey: number }
> {
  state = { error: null as Error | null, resetKey: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[LIMS tab ${this.props.tabKey}]`, error);
  }

  componentDidUpdate(prevProps: { tabKey: string }) {
    if (prevProps.tabKey !== this.props.tabKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-sm">
          <p className="text-muted-foreground">This tab failed to load.</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }))}
            >
              Retry
            </Button>
            <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
              Refresh page
            </Button>
          </div>
        </div>
      );
    }
    return <div key={this.state.resetKey}>{this.props.children}</div>;
  }
}

const Lims = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const allowed = getAllowedSections("/lims");
  const visibleTabs = allowed ? allLimsTabs.filter((t) => allowed.includes(t.key)) : allLimsTabs;
  const activeTab = searchParams.get("tab") || (visibleTabs[0]?.key ?? "register");
  const safeTab = visibleTabs.some((t) => t.key === activeTab)
    ? activeTab
    : (visibleTabs[0]?.key ?? "register");
  const workflowTabVisible = visibleTabs.some((t) => t.key === "workflow");

  const { data: workflowBadgeCount } = useQuery({
    queryKey: ["workflow_badge_count"],
    queryFn: () => {
      const today = localDayString();
      return fetchWorkflowPendingCount({
        acceptedFromDay: addDaysToDayString(today, -1),
        acceptedToDay: today,
      });
    },
    enabled: workflowTabVisible,
    staleTime: 60_000,
  });

  // Keep visited panels mounted so RQ cache + UI state survive tab switches.
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(() => new Set([safeTab]));

  // Mount the active tab during render (not in useEffect) so the first paint after a
  // tab click already has TabsContent — avoids intermittent blank panels after login.
  if (!mountedTabs.has(safeTab)) {
    setMountedTabs((prev) => {
      if (prev.has(safeTab)) return prev;
      const next = new Set(prev);
      next.add(safeTab);
      return next;
    });
  }

  const switchTab = (v: string) => {
    setMountedTabs((prev) => {
      if (prev.has(v)) return prev;
      const next = new Set(prev);
      next.add(v);
      return next;
    });
    // Preserve Results deep-link `q` only while staying on / returning to Results.
    const next: Record<string, string> = { tab: v };
    if (v === "results") {
      const q = searchParams.get("q");
      if (q) next.q = q;
    }
    setSearchParams(next, { replace: true });
  };

  if (visibleTabs.length === 0) {
    return (
      <div className="space-y-4 animate-fade-in">
        <h1 className="text-xl font-bold">LIMS</h1>
        <p className="text-sm text-muted-foreground">No LIMS sections are enabled for your role.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-xl font-bold">LIMS</h1>
      <Tabs value={safeTab} onValueChange={switchTab} className="w-full">
        <TabsList className="w-full justify-start flex-wrap h-auto gap-1">
          {visibleTabs.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="gap-1.5">
              {t.label}
              {t.key === "workflow" && typeof workflowBadgeCount === "number" && workflowBadgeCount > 0 && (
                <Badge variant="secondary" className="h-5 min-w-5 px-1.5 text-[10px] font-mono">
                  {workflowBadgeCount > 999 ? "999+" : workflowBadgeCount}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {visibleTabs.map((t) => {
          if (!mountedTabs.has(t.key)) return null;
          const Comp = t.component;
          return (
            <TabsContent
              key={t.key}
              value={t.key}
              forceMount
              className="data-[state=inactive]:hidden mt-3"
            >
              <TabErrorBoundary tabKey={t.key}>
                <Suspense fallback={<TabFallback />}>
                  <Comp />
                </Suspense>
              </TabErrorBoundary>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
};

export default Lims;
