import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import DailyCollectionReport from "@/components/lims/accounts/DailyCollectionReport";

/**
 * Accounts (main sidebar).
 * Shell for accountant tools. Add more sub-tabs here later (e.g. dues summary, GST).
 */
const Accounts = () => {
  const [subTab, setSubTab] = useState("daily_collection");

  return (
    <div className="space-y-2 -mt-1 md:-mt-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold tracking-tight leading-none">Accounts</h2>
        <Tabs value={subTab} onValueChange={setSubTab}>
          <TabsList className="h-8">
            <TabsTrigger value="daily_collection" className="h-7 px-2.5 text-xs">
              Daily Collection
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {subTab === "daily_collection" && <DailyCollectionReport />}
    </div>
  );
};

export default Accounts;