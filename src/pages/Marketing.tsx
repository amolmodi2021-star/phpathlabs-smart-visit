import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PasswordGate from "@/components/PasswordGate";
import MarketingSender from "@/components/marketing/MarketingSender";
import AutomatedMarketing from "@/components/marketing/AutomatedMarketing";
import MessageLog from "@/components/marketing/MessageLog";
import NewNumbers from "@/components/marketing/NewNumbers";

const Marketing = () => {
  return (
    <PasswordGate title="Marketing">
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Marketing</h1>
        <Tabs defaultValue="send" className="w-full">
          <TabsList>
            <TabsTrigger value="send">Send Messages</TabsTrigger>
            <TabsTrigger value="automated">Automated</TabsTrigger>
            <TabsTrigger value="log">Message Log</TabsTrigger>
            <TabsTrigger value="new">New Numbers</TabsTrigger>
          </TabsList>
          <TabsContent value="send">
            <MarketingSender />
          </TabsContent>
          <TabsContent value="automated">
            <AutomatedMarketing />
          </TabsContent>
          <TabsContent value="log">
            <MessageLog />
          </TabsContent>
          <TabsContent value="new">
            <NewNumbers />
          </TabsContent>
        </Tabs>
      </div>
    </PasswordGate>
  );
};

export default Marketing;
