import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAllowedSections } from "@/lib/auth";
import MarketingSender from "@/components/marketing/MarketingSender";
import AutomatedMarketing from "@/components/marketing/AutomatedMarketing";
import MessageLog from "@/components/marketing/MessageLog";
import NewNumbers from "@/components/marketing/NewNumbers";

const allMarketingTabs = [
  { key: "send", label: "Send Messages" },
  { key: "automated", label: "Automated" },
  { key: "log", label: "Message Log" },
  { key: "new", label: "New Numbers" },
];

const Marketing = () => {
  const allowed = getAllowedSections("/marketing");
  const visibleTabs = allowed ? allMarketingTabs.filter((t) => allowed.includes(t.key)) : allMarketingTabs;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Marketing</h1>
      <Tabs defaultValue={visibleTabs[0]?.key || "send"} className="w-full">
        <TabsList>
          {visibleTabs.map((t) => <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="send"><MarketingSender /></TabsContent>
        <TabsContent value="automated"><AutomatedMarketing /></TabsContent>
        <TabsContent value="log"><MessageLog /></TabsContent>
        <TabsContent value="new"><NewNumbers /></TabsContent>
      </Tabs>
    </div>
  );
};

export default Marketing;
