import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAllowedSections } from "@/lib/auth";
import CRMContacts from "@/components/crm/CRMContacts";
import CRMImport from "@/components/crm/CRMImport";
import CRMImportReview from "@/components/crm/CRMImportReview";
import CRMAbnormalTests from "@/components/crm/CRMAbnormalTests";
import CRMBlacklist from "@/components/crm/CRMBlacklist";
import CRMSequences from "@/components/crm/CRMSequences";
import CRMSettings from "@/components/crm/CRMSettings";
import AbnormalCardDesigner from "@/components/crm/AbnormalCardDesigner";

const allCrmTabs = [
  { key: "contacts", label: "Contacts" },
  { key: "import", label: "Import Data" },
  { key: "review", label: "Review & Approve" },
  { key: "abnormal", label: "Abnormal Tests" },
  { key: "card-designer", label: "Card Designer" },
  { key: "blacklist", label: "Blacklist" },
  { key: "sequences", label: "Sequences" },
  { key: "settings", label: "Settings" },
];

const CRM = () => {
  const allowed = getAllowedSections("/crm");
  const visibleTabs = allowed ? allCrmTabs.filter((t) => allowed.includes(t.key)) : allCrmTabs;
  const [activeTab, setActiveTab] = useState(visibleTabs[0]?.key || "contacts");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">CRM — Patient & Prospect Management</h1>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          {visibleTabs.map((t) => <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="contacts">{activeTab === "contacts" && <CRMContacts />}</TabsContent>
        <TabsContent value="import">{activeTab === "import" && <CRMImport />}</TabsContent>
        <TabsContent value="review">{activeTab === "review" && <CRMImportReview />}</TabsContent>
        <TabsContent value="abnormal">{activeTab === "abnormal" && <CRMAbnormalTests />}</TabsContent>
        <TabsContent value="card-designer">{activeTab === "card-designer" && <AbnormalCardDesigner />}</TabsContent>
        <TabsContent value="blacklist">{activeTab === "blacklist" && <CRMBlacklist />}</TabsContent>
        <TabsContent value="sequences">{activeTab === "sequences" && <CRMSequences />}</TabsContent>
        <TabsContent value="settings">{activeTab === "settings" && <CRMSettings />}</TabsContent>
      </Tabs>
    </div>
  );
};

export default CRM;
