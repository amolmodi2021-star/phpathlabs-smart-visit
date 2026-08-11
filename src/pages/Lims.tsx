import { lazy, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAllowedSections } from "@/lib/auth";
import { Loader2 } from "lucide-react";

const PatientRegistration = lazy(() => import("@/components/lims/PatientRegistration"));
const RegisteredPatients = lazy(() => import("@/components/lims/RegisteredPatients"));
const CompletedHomeVisits = lazy(() => import("@/components/lims/CompletedHomeVisits"));
const DuePayments = lazy(() => import("@/components/lims/DuePayments"));
const BadDebts = lazy(() => import("@/components/lims/BadDebts"));
const SampleCollection = lazy(() => import("@/components/lims/SampleCollection"));
const SampleAcceptance = lazy(() => import("@/components/lims/SampleAcceptance"));
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

const Lims = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const allowed = getAllowedSections("/lims");
  const visibleTabs = allowed ? allLimsTabs.filter((t) => allowed.includes(t.key)) : allLimsTabs;
  const activeTab = searchParams.get("tab") || (visibleTabs[0]?.key ?? "register");
  const safeTab = visibleTabs.some((t) => t.key === activeTab)
    ? activeTab
    : (visibleTabs[0]?.key ?? "register");

  // First click mounts + loads; later visits reuse the same mounted panel (cached UI + RQ data).
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(() => new Set([safeTab]));

  useEffect(() => {
    setMountedTabs((prev) => {
      if (prev.has(safeTab)) return prev;
      const next = new Set(prev);
      next.add(safeTab);
      return next;
    });
  }, [safeTab]);

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
      <Tabs value={safeTab} onValueChange={(v) => setSearchParams({ tab: v }, { replace: true })} className="w-full">
        <TabsList className="w-full justify-start flex-wrap h-auto gap-1">
          {visibleTabs.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
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
              <Suspense fallback={<TabFallback />}>
                <Comp />
              </Suspense>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
};

export default Lims;
