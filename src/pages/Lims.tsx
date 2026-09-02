import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { getAllowedSections } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { fetchWorkflowPendingCount } from "@/lib/workflowFetch";
import { addDaysToDayString, localDayString } from "@/lib/workflowWorksheet";
import { LimsTabActiveContext } from "@/lib/limsTabActive";

type TabModule = { default: ComponentType<any> };
type TabLoader = () => Promise<TabModule>;

/**
 * Imperative loaders (not React.lazy). Suspense+lazy inside forceMount hidden
 * panels was intermittently stuck on "Loading…" until another tab switch.
 */
const TAB_LOADERS: Record<string, TabLoader> = {
  register: () => import("@/components/lims/PatientRegistration"),
  patients: () => import("@/components/lims/RegisteredPatients"),
  sample_collection: () => import("@/components/lims/SampleCollection"),
  sample_acceptance: () => import("@/components/lims/SampleAcceptance"),
  results: () => import("@/components/lims/ResultsEntry"),
  verification: () => import("@/components/lims/ResultVerification"),
  doctor_approval: () => import("@/components/lims/DoctorApproval"),
  dispatch: () => import("@/components/lims/Dispatch"),
  workflow: () => import("@/components/lims/Workflow"),
  cbc: () => import("@/components/lims/CbcTab"),
  dr_cbc: () => import("@/components/lims/DrCbcTab"),
  due_payments: () => import("@/components/lims/DuePayments"),
  bad_debts: () => import("@/components/lims/BadDebts"),
  billing: () => import("@/components/lims/Billing"),
  daily_report: () => import("@/components/lims/DailyReport"),
  completed_hv: () => import("@/components/lims/CompletedHomeVisits"),
  settings: () => import("@/components/lims/LimsSettings"),
};

const moduleCache = new Map<string, ComponentType<any>>();
const inflight = new Map<string, Promise<ComponentType<any>>>();

function loadTabModule(key: string): Promise<ComponentType<any>> {
  const cached = moduleCache.get(key);
  if (cached) return Promise.resolve(cached);
  const existing = inflight.get(key);
  if (existing) return existing;
  const loader = TAB_LOADERS[key];
  if (!loader) return Promise.reject(new Error(`Unknown LIMS tab: ${key}`));
  const p = loader()
    .then((m) => {
      moduleCache.set(key, m.default);
      inflight.delete(key);
      return m.default;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });
  inflight.set(key, p);
  return p;
}

function preloadTabModule(key: string) {
  void loadTabModule(key).catch(() => {
    /* ignore preload errors — open will retry */
  });
}

const allLimsTabs = [
  { key: "register", label: "New Registration" },
  { key: "patients", label: "Registered Patients" },
  { key: "sample_collection", label: "Sample Collection" },
  { key: "sample_acceptance", label: "Sample Acceptance" },
  { key: "results", label: "Results" },
  { key: "verification", label: "Result Verification" },
  { key: "doctor_approval", label: "Doctor Approval" },
  { key: "dispatch", label: "Dispatch" },
  { key: "workflow", label: "Workflow" },
  { key: "cbc", label: "CBC" },
  { key: "dr_cbc", label: "Dr. CBC" },
  { key: "due_payments", label: "Due Payments" },
  { key: "bad_debts", label: "Bad Debts" },
  { key: "billing", label: "Billing" },
  { key: "daily_report", label: "Daily Report" },
  { key: "completed_hv", label: "Completed Home Visits" },
  { key: "settings", label: "Settings" },
] as const;

const TabFallback = ({
  onRetry,
  slow,
}: {
  onRetry?: () => void;
  slow?: boolean;
}) => (
  <div className="flex flex-col items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
    <div className="flex items-center gap-2">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading…
    </div>
    {slow && (
      <>
        <p className="text-xs">This is taking longer than usual.</p>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        )}
      </>
    )}
  </div>
);

/** Catch render errors so a failed tab doesn't leave a blank panel. */
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

function LimsTabPanel({ tabKey, active }: { tabKey: string; active: boolean }) {
  const [Comp, setComp] = useState<ComponentType<any> | null>(
    () => moduleCache.get(tabKey) ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const generationRef = useRef(0);

  const startLoad = useCallback(() => {
    if (moduleCache.has(tabKey)) {
      setComp(() => moduleCache.get(tabKey)!);
      setError(null);
      setSlow(false);
      return;
    }
    const gen = ++generationRef.current;
    setError(null);
    setSlow(false);
    const slowTimer = window.setTimeout(() => {
      if (generationRef.current === gen) setSlow(true);
    }, 2500);
    loadTabModule(tabKey)
      .then((mod) => {
        if (generationRef.current !== gen) return;
        setComp(() => mod);
        setSlow(false);
      })
      .catch((e: any) => {
        if (generationRef.current !== gen) return;
        setError(e?.message || "Failed to load tab");
        setSlow(true);
      })
      .finally(() => window.clearTimeout(slowTimer));
  }, [tabKey]);

  useEffect(() => {
    startLoad();
  }, [startLoad]);

  if (error && !Comp) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-sm">
        <p className="text-muted-foreground">{error}</p>
        <Button size="sm" variant="outline" onClick={startLoad}>
          Retry
        </Button>
      </div>
    );
  }

  if (!Comp) {
    return <TabFallback slow={slow} onRetry={startLoad} />;
  }

  return (
    <LimsTabActiveContext.Provider value={active}>
      <TabErrorBoundary tabKey={tabKey}>
        <Comp />
      </TabErrorBoundary>
    </LimsTabActiveContext.Provider>
  );
}

const Lims = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get("tab") === "accounts") {
      navigate("/accounts", { replace: true });
    }
  }, [searchParams, navigate]);

  const allowed = getAllowedSections("/lims");
  const allowedKey = allowed ? allowed.join(",") : "*";
  const visibleTabs = useMemo(() => {
    if (allowedKey === "*") return [...allLimsTabs];
    const keys = new Set(allowedKey.split(",").filter(Boolean));
    return allLimsTabs.filter((t) => keys.has(t.key));
  }, [allowedKey]);
  const visibleTabKeys = useMemo(() => visibleTabs.map((t) => t.key), [visibleTabs]);
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

  // Warm tab chunks in the background (egress: JS chunks only, no API). Active first.
  useEffect(() => {
    preloadTabModule(safeTab);
    const keys = visibleTabKeys.filter((k) => k !== safeTab);
    let i = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled || i >= keys.length) return;
      preloadTabModule(keys[i++]);
      window.setTimeout(tick, 120);
    };
    const start = window.setTimeout(tick, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(start);
    };
  }, [safeTab, visibleTabKeys]);

  const switchTab = (v: string) => {
    preloadTabModule(v);
    setMountedTabs((prev) => {
      if (prev.has(v)) return prev;
      const next = new Set(prev);
      next.add(v);
      return next;
    });
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
            <TabsTrigger
              key={t.key}
              value={t.key}
              className="gap-1.5"
              onMouseEnter={() => preloadTabModule(t.key)}
              onFocus={() => preloadTabModule(t.key)}
            >
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
          return (
            <TabsContent
              key={t.key}
              value={t.key}
              forceMount
              className="data-[state=inactive]:hidden mt-3"
            >
              <LimsTabPanel tabKey={t.key} active={safeTab === t.key} />
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
};

export default Lims;
