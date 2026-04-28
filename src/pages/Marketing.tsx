import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import MarketingSender from "@/components/marketing/MarketingSender";
import MarketingTemplates from "@/components/marketing/MarketingTemplates";

const Marketing = () => {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Marketing</h1>
      <Tabs defaultValue="send" className="w-full">
        <TabsList>
          <TabsTrigger value="send">Send Messages</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>
        <TabsContent value="send"><MarketingSender /></TabsContent>
        <TabsContent value="templates"><MarketingTemplates /></TabsContent>
      </Tabs>
    </div>
  );
};

export default Marketing;
