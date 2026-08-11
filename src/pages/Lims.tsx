import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAllowedSections } from "@/lib/auth";
import PatientRegistration from "@/components/lims/PatientRegistration";
import RegisteredPatients from "@/components/lims/RegisteredPatients";
import CompletedHomeVisits from "@/components/lims/CompletedHomeVisits";
import DuePayments from "@/components/lims/DuePayments";
import BadDebts from "@/components/lims/BadDebts";
import SampleCollection from "@/components/lims/SampleCollection";
import SampleAcceptance from "@/components/lims/SampleAcceptance";
import ResultsEntry from "@/components/lims/ResultsEntry";
import ResultVerification from "@/components/lims/ResultVerification";
import DoctorApproval from "@/components/lims/DoctorApproval";
import Dispatch from "@/components/lims/Dispatch";
import LimsSettings from "@/components/lims/LimsSettings";
import DailyReport from "@/components/lims/DailyReport";
import Billing from "@/components/lims/Billing";

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

const Lims = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const allowed = getAllowedSections("/lims");
  const visibleTabs = allowed ? allLimsTabs.filter((t) => allowed.includes(t.key)) : allLimsTabs;
  const activeTab = searchParams.get("tab") || (visibleTabs[0]?.key ?? "register");
  const safeTab = visibleTabs.some((t) => t.key === activeTab)
    ? activeTab
    : (visibleTabs[0]?.key ?? "register");

  // Keep each visited tab mounted (hidden when inactive) so lists/UI state
  // are not torn down and re-fetched on every tab switch.
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
              className="data-[state=inactive]:hidden"
            >
              <Comp />
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
};

export default Lims;
