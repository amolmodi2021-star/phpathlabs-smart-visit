import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PickupPointManager from "@/components/lims/PickupPointManager";
import ChannelManager from "@/components/lims/ChannelManager";
import InvoiceDesigner from "@/components/lims/InvoiceDesigner";

const LimsSettings = () => {
  return (
    <Tabs defaultValue="invoice_designer" className="w-full">
      <TabsList className="w-full justify-start flex-wrap h-auto gap-1">
        <TabsTrigger value="invoice_designer">Invoice Designer</TabsTrigger>
        <TabsTrigger value="pickup">Pickup Points</TabsTrigger>
        <TabsTrigger value="channels">Channels</TabsTrigger>
      </TabsList>
      <TabsContent value="invoice_designer">
        <InvoiceDesigner />
      </TabsContent>
      <TabsContent value="pickup">
        <PickupPointManager />
      </TabsContent>
      <TabsContent value="channels">
        <ChannelManager />
      </TabsContent>
    </Tabs>
  );
};

export default LimsSettings;
