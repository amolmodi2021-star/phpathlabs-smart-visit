import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import LoyaltyCardDesigner from "@/components/LoyaltyCardDesigner";
import LoyaltyCardSender from "@/components/LoyaltyCardSender";
import LoyaltyCardHistory from "@/components/LoyaltyCardHistory";
import PasswordGate from "@/components/PasswordGate";

const LoyaltyCards = () => {
  return (
    <PasswordGate title="ABC Loyalty Cards">
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">ABC Loyalty Cards</h1>
      <Tabs defaultValue="send" className="w-full">
        <TabsList>
          <TabsTrigger value="send">Send Cards</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="designer">Card Designer</TabsTrigger>
        </TabsList>
        <TabsContent value="send">
          <LoyaltyCardSender />
        </TabsContent>
        <TabsContent value="history">
          <LoyaltyCardHistory />
        </TabsContent>
        <TabsContent value="designer">
          <LoyaltyCardDesigner />
        </TabsContent>
      </Tabs>
    </div>
    </PasswordGate>
  );
};

export default LoyaltyCards;
