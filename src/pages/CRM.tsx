import { useState } from "react";
import PasswordGate from "@/components/PasswordGate";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CRMContacts from "@/components/crm/CRMContacts";
import CRMImport from "@/components/crm/CRMImport";
import CRMImportReview from "@/components/crm/CRMImportReview";
import CRMAbnormalTests from "@/components/crm/CRMAbnormalTests";
import CRMBlacklist from "@/components/crm/CRMBlacklist";
import CRMSequences from "@/components/crm/CRMSequences";
import CRMSettings from "@/components/crm/CRMSettings";
import AbnormalCardDesigner from "@/components/crm/AbnormalCardDesigner";

const CRM = () => {
  const [activeTab, setActiveTab] = useState("contacts");

  return (
    <PasswordGate title="CRM Access">
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">CRM — Patient & Prospect Management</h1>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex flex-wrap h-auto gap-1">
            <TabsTrigger value="contacts">Contacts</TabsTrigger>
            <TabsTrigger value="import">Import Data</TabsTrigger>
            <TabsTrigger value="review">Review & Approve</TabsTrigger>
            <TabsTrigger value="abnormal">Abnormal Tests</TabsTrigger>
            <TabsTrigger value="card-designer">Card Designer</TabsTrigger>
            <TabsTrigger value="blacklist">Blacklist</TabsTrigger>
            <TabsTrigger value="sequences">Sequences</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
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
    </PasswordGate>
  );
};

export default CRM;
