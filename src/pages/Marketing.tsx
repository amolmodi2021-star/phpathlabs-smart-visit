import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAllowedSections } from "@/lib/auth";
import MarketingSender from "@/components/marketing/MarketingSender";
import MarketingTemplates from "@/components/marketing/MarketingTemplates";

const allMarketingTabs = [
  { key: "send", label: "Send Messages", component: MarketingSender },
  { key: "templates", label: "Templates", component: MarketingTemplates },
];

const Marketing = () => {
  const allowed = getAllowedSections("/marketing");
  const visible = allowed
    ? allMarketingTabs.filter((t) => allowed.includes(t.key) || allowed.includes(t.key === "send" ? "sender" : t.key))
    : allMarketingTabs;

  if (visible.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Marketing</h1>
        <p className="text-sm text-muted-foreground">No Marketing sections are enabled for your role.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Marketing</h1>
      <Tabs defaultValue={visible[0].key} className="w-full">
        <TabsList>
          {visible.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
        {visible.map((t) => {
          const Comp = t.component;
          return (
            <TabsContent key={t.key} value={t.key}><Comp /></TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
};

export default Marketing;
