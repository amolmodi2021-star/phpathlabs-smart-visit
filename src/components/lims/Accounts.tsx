import { useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAllowedSections } from "@/lib/auth";
import DailyCollectionReport from "@/components/lims/accounts/DailyCollectionReport";
import PurchaseInvoices from "@/components/lims/accounts/PurchaseInvoices";
import PurchaseOrders from "@/components/lims/accounts/PurchaseOrders";
import AccountsSettings from "@/components/lims/accounts/AccountsSettings";

const ALL_ACCOUNT_TABS = [
  { key: "daily_collection", label: "Daily Collection" },
  { key: "purchase", label: "Purchase" },
  { key: "po", label: "PO Generator" },
  { key: "settings", label: "Settings" },
] as const;

type AccountTabKey = (typeof ALL_ACCOUNT_TABS)[number]["key"];

/**
 * Accounts (main sidebar).
 * Sub-tabs gated by Users → role sections for /accounts.
 */
const Accounts = () => {
  const allowed = getAllowedSections("/accounts");
  const visibleTabs = useMemo(
    () =>
      allowed
        ? ALL_ACCOUNT_TABS.filter((t) => allowed.includes(t.key))
        : [...ALL_ACCOUNT_TABS],
    [allowed],
  );

  const defaultKey = (visibleTabs[0]?.key ?? "daily_collection") as AccountTabKey;
  const [subTab, setSubTab] = useState<string>(defaultKey);

  const safeTab = visibleTabs.some((t) => t.key === subTab) ? subTab : defaultKey;

  if (visibleTabs.length === 0) {
    return (
      <div className="space-y-2 -mt-1 md:-mt-2">
        <h2 className="text-lg font-semibold tracking-tight leading-none">Accounts</h2>
        <p className="text-sm text-muted-foreground">No Accounts sections are enabled for your role.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 -mt-1 md:-mt-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold tracking-tight leading-none">Accounts</h2>
        <Tabs value={safeTab} onValueChange={setSubTab}>
          <TabsList className="h-8 flex-wrap">
            {visibleTabs.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className="h-7 px-2.5 text-xs">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {safeTab === "daily_collection" && <DailyCollectionReport />}
      {safeTab === "purchase" && <PurchaseInvoices />}
      {safeTab === "po" && <PurchaseOrders />}
      {safeTab === "settings" && <AccountsSettings />}
    </div>
  );
};

export default Accounts;