import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import DailyCollectionReport from "@/components/lims/accounts/DailyCollectionReport";

/**
 * Accounts (main sidebar).
 * Shell for accountant tools. Add more sub-tabs here later (e.g. dues summary, GST).
 */
const Accounts = () => {
  const [subTab, setSubTab] = useState("daily_collection");

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Accounts</h2>
        <p className="text-sm text-muted-foreground">Simple collection reports for the accountant.</p>
      </div>

      <Tabs value={subTab} onValueChange={setSubTab} className="w-full">
        <TabsList className="h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="daily_collection">Daily Collection</TabsTrigger>
        </TabsList>

        <TabsContent value="daily_collection" className="mt-3">
          <DailyCollectionReport />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Accounts;