import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import LoyaltyCardDesigner from "@/components/LoyaltyCardDesigner";
import LoyaltyCardSender from "@/components/LoyaltyCardSender";
import LoyaltyCardHistory from "@/components/LoyaltyCardHistory";

const LoyaltyCards = () => {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">ABC Loyalty Cards</h1>
      <Tabs defaultValue="designer" className="w-full">
        <TabsList>
          <TabsTrigger value="designer">Card Designer</TabsTrigger>
          <TabsTrigger value="send">Send Cards</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="designer">
          <LoyaltyCardDesigner />
        </TabsContent>
        <TabsContent value="send">
          <LoyaltyCardSender />
        </TabsContent>
        <TabsContent value="history">
          <LoyaltyCardHistory />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default LoyaltyCards;
