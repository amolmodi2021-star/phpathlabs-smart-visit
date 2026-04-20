import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BillingGenerate from "./BillingGenerate";
import BillingDashboard from "./BillingDashboard";
import BillingSettings from "./BillingSettings";

const Billing = () => {
  return (
    <Tabs defaultValue="dashboard" className="w-full">
      <TabsList className="w-full justify-start flex-wrap h-auto gap-1">
        <TabsTrigger value="dashboard">Invoices Dashboard</TabsTrigger>
        <TabsTrigger value="generate">Generate Invoices</TabsTrigger>
        <TabsTrigger value="settings">Bank & Reminder Settings</TabsTrigger>
      </TabsList>
      <TabsContent value="dashboard"><BillingDashboard /></TabsContent>
      <TabsContent value="generate"><BillingGenerate /></TabsContent>
      <TabsContent value="settings"><BillingSettings /></TabsContent>
    </Tabs>
  );
};

export default Billing;
