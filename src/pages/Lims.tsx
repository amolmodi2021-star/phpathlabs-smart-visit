import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PatientRegistration from "@/components/lims/PatientRegistration";
import RegisteredPatients from "@/components/lims/RegisteredPatients";
import PickupPointManager from "@/components/lims/PickupPointManager";
import ChannelManager from "@/components/lims/ChannelManager";
import CompletedHomeVisits from "@/components/lims/CompletedHomeVisits";
import SampleCollection from "@/components/lims/SampleCollection";

const Lims = () => {
  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-xl font-bold">LIMS</h1>
      <Tabs defaultValue="register" className="w-full">
        <TabsList className="w-full justify-start flex-wrap h-auto gap-1">
          <TabsTrigger value="register">New Registration</TabsTrigger>
          <TabsTrigger value="patients">Registered Patients</TabsTrigger>
          <TabsTrigger value="sample_collection">Sample Collection</TabsTrigger>
          <TabsTrigger value="completed_hv">Completed Home Visits</TabsTrigger>
          <TabsTrigger value="pickup">Pickup Points</TabsTrigger>
          <TabsTrigger value="channels">Channels</TabsTrigger>
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
