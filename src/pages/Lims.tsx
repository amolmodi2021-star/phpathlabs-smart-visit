import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAllowedSections } from "@/lib/auth";
import PatientRegistration from "@/components/lims/PatientRegistration";
import RegisteredPatients from "@/components/lims/RegisteredPatients";
import PickupPointManager from "@/components/lims/PickupPointManager";
import ChannelManager from "@/components/lims/ChannelManager";
import CompletedHomeVisits from "@/components/lims/CompletedHomeVisits";
import DuePayments from "@/components/lims/DuePayments";
import BadDebts from "@/components/lims/BadDebts";
import SampleCollection from "@/components/lims/SampleCollection";
import SampleAcceptance from "@/components/lims/SampleAcceptance";
import ResultsEntry from "@/components/lims/ResultsEntry";
import ResultVerification from "@/components/lims/ResultVerification";
import DoctorApproval from "@/components/lims/DoctorApproval";
import Dispatch from "@/components/lims/Dispatch";

const allLimsTabs = [
  { key: "register", label: "New Registration" },
  { key: "patients", label: "Registered Patients" },
  { key: "sample_collection", label: "Sample Collection" },
  { key: "sample_acceptance", label: "Sample Acceptance" },
  { key: "results", label: "Results" },
  { key: "verification", label: "Result Verification" },
  { key: "doctor_approval", label: "Doctor Approval" },
  { key: "dispatch", label: "Dispatch" },
  { key: "completed_hv", label: "Completed Home Visits" },
  { key: "pickup", label: "Pickup Points" },
  { key: "channels", label: "Channels" },
];

const Lims = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const allowed = getAllowedSections("/lims");
  const visibleTabs = allowed ? allLimsTabs.filter((t) => allowed.includes(t.key)) : allLimsTabs;
  const activeTab = searchParams.get("tab") || (visibleTabs[0]?.key ?? "register");

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-xl font-bold">LIMS</h1>
      <Tabs value={activeTab} onValueChange={(v) => setSearchParams({ tab: v }, { replace: true })} className="w-full">
        <TabsList className="w-full justify-start flex-wrap h-auto gap-1">
          {visibleTabs.map((t) => <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="register">
          <PatientRegistration />
        </TabsContent>
        <TabsContent value="patients">
          <RegisteredPatients />
        </TabsContent>
        <TabsContent value="sample_collection">
          <SampleCollection />
        </TabsContent>
        <TabsContent value="sample_acceptance">
          <SampleAcceptance />
        </TabsContent>
        <TabsContent value="results">
          <ResultsEntry />
        </TabsContent>
        <TabsContent value="verification">
          <ResultVerification />
        </TabsContent>
        <TabsContent value="doctor_approval">
          <DoctorApproval />
        </TabsContent>
        <TabsContent value="dispatch">
          <Dispatch />
        </TabsContent>
        <TabsContent value="completed_hv">
          <CompletedHomeVisits />
        </TabsContent>
        <TabsContent value="pickup">
          <PickupPointManager />
        </TabsContent>
        <TabsContent value="channels">
          <ChannelManager />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Lims;
