import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PasswordGate from "@/components/PasswordGate";
import MarketingSender from "@/components/marketing/MarketingSender";
import AutomatedMarketing from "@/components/marketing/AutomatedMarketing";

const Marketing = () => {
  return (
    <PasswordGate title="Marketing">
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Marketing</h1>
        <Tabs defaultValue="send" className="w-full">
          <TabsList>
            <TabsTrigger value="send">Send Messages</TabsTrigger>
            <TabsTrigger value="automated">Automated</TabsTrigger>
          </TabsList>
          <TabsContent value="send">
            <MarketingSender />
          </TabsContent>
          <TabsContent value="automated">
            <AutomatedMarketing />
          </TabsContent>
        </Tabs>
      </div>
    </PasswordGate>
  );
};

export default Marketing;
