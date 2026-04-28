import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAllowedSections } from "@/lib/auth";
import MarketingSender from "@/components/marketing/MarketingSender";
import NewNumbers from "@/components/marketing/NewNumbers";

// COST OPTIMIZATION (2026-04-28): Automated, Retry and Message Log tabs disabled
// — they were the top scanners on drip_campaign_log / drip_mobile_cycles /
// message_send_log. Files are kept in the repo for future re-enable.
const allMarketingTabs = [
  { key: "send", label: "Send Messages" },
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
        <TabsContent value="new"><NewNumbers /></TabsContent>
      </Tabs>
    </div>
  );
};

export default Marketing;
