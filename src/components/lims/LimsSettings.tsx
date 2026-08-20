import { useSyncExternalStore } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PickupPointManager from "@/components/lims/PickupPointManager";
import ChannelManager from "@/components/lims/ChannelManager";
import InvoiceDesigner from "@/components/lims/InvoiceDesigner";
import LegacyPatientImport from "@/components/lims/LegacyPatientImport";
import CloudinaryAccountsPanel from "@/components/lims/CloudinaryAccountsPanel";
import { getLegacyImportJob, subscribeLegacyImportJob } from "@/lib/legacyImportJob";

const LimsSettings = () => {
  const job = useSyncExternalStore(subscribeLegacyImportJob, getLegacyImportJob, getLegacyImportJob);
  return (
    <Tabs defaultValue="invoice_designer" className="w-full">
      <TabsList className="w-full justify-start flex-wrap h-auto gap-1">
        <TabsTrigger value="invoice_designer">Invoice Designer</TabsTrigger>
        <TabsTrigger value="pickup">Pickup Points</TabsTrigger>
        <TabsTrigger value="channels">Channels</TabsTrigger>
        <TabsTrigger value="cloudinary">Cloudinary</TabsTrigger>
        <TabsTrigger value="legacy_import">Legacy Patient Import</TabsTrigger>
      </TabsList>
      {job.importing && (
        <div className="mt-3 rounded-md border-2 border-primary bg-primary/5 px-3 py-2 text-sm font-medium">
          Legacy import running
          {job.progress?.total
            ? `: ${job.progress.processed.toLocaleString()} / ${job.progress.total.toLocaleString()}`
            : " — reading Excel…"}
          . Open the Legacy Patient Import tab for the full bar.
        </div>
      )}
      <TabsContent value="invoice_designer" forceMount className="data-[state=inactive]:hidden">
        <InvoiceDesigner />
      </TabsContent>
      <TabsContent value="pickup" forceMount className="data-[state=inactive]:hidden">
        <PickupPointManager />
      </TabsContent>
      <TabsContent value="channels" forceMount className="data-[state=inactive]:hidden">
        <ChannelManager />
      </TabsContent>
      <TabsContent value="cloudinary" forceMount className="data-[state=inactive]:hidden">
        <div className="space-y-4">
          <CloudinaryAccountsPanel
            purpose="outsourced_pdf"
            title="Outsourced Lab PDF Cloudinary"
            description="Separate Cloudinary account for uploading lab PDFs and storing composed letterhead PDFs. Use an unsigned upload preset that allows PDF/raw uploads. Only one account can be active for this purpose."
          />
          <CloudinaryAccountsPanel
            purpose="whatsapp"
            title="WhatsApp / Cards Cloudinary (reference)"
            description="Same accounts as WhatsApp Settings. Shown here so you can confirm the WA account stays separate from outsourced PDFs. Prefer managing WA accounts under WhatsApp Settings."
          />
        </div>
      </TabsContent>
      <TabsContent value="legacy_import" forceMount className="data-[state=inactive]:hidden">
        <LegacyPatientImport />
      </TabsContent>
    </Tabs>
  );
};

export default LimsSettings;
