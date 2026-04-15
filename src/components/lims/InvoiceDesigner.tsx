import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Upload, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

const SETTING_KEYS = [
  "invoice_lab_name",
  "invoice_address",
  "invoice_contact",
  "invoice_tagline",
  "invoice_logo_url",
] as const;

const DEFAULTS: Record<string, string> = {
  invoice_lab_name: "PH PathLabs",
  invoice_address: "",
  invoice_contact: "LabLine: 6356 55 66 99",
  invoice_tagline: "Invoice / Sample Receipt",
  invoice_logo_url: "",
};

const InvoiceDesigner = () => {
  const [settings, setSettings] = useState<Record<string, string>>({ ...DEFAULTS });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("setting_key, setting_value")
        .in("setting_key", [...SETTING_KEYS]);
      if (data) {
        const merged = { ...DEFAULTS };
        data.forEach((r) => { merged[r.setting_key] = r.setting_value; });
        setSettings(merged);
      }
      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const key of SETTING_KEYS) {
        await supabase
          .from("app_settings")
          .upsert(
            { setting_key: key, setting_value: settings[key] || "" },
            { onConflict: "setting_key" }
          );
      }
      toast.success("Invoice settings saved");
    } catch {
      toast.error("Failed to save settings");
    }
    setSaving(false);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `logo_${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("invoice-assets")
      .upload(path, file, { upsert: true });
    if (error) {
      toast.error("Upload failed");
      setUploading(false);
      return;
    }
    const { data: urlData } = supabase.storage
      .from("invoice-assets")
      .getPublicUrl(path);
    setSettings((s) => ({ ...s, invoice_logo_url: urlData.publicUrl }));
    setUploading(false);
    toast.success("Logo uploaded — click Save to apply");
  };

  const removeLogo = () => {
    setSettings((s) => ({ ...s, invoice_logo_url: "" }));
  };

  if (loading) return <p className="text-sm text-muted-foreground p-4">Loading…</p>;

  return (
    <div className="grid md:grid-cols-2 gap-6">
      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoice Branding</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Lab Name</Label>
            <Input
              value={settings.invoice_lab_name}
              onChange={(e) => setSettings((s) => ({ ...s, invoice_lab_name: e.target.value }))}
            />
          </div>
          <div>
            <Label>Contact Info</Label>
            <Input
              value={settings.invoice_contact}
              onChange={(e) => setSettings((s) => ({ ...s, invoice_contact: e.target.value }))}
              placeholder="e.g. LabLine: 6356 55 66 99"
            />
          </div>
          <div>
            <Label>Tagline</Label>
            <Input
              value={settings.invoice_tagline}
              onChange={(e) => setSettings((s) => ({ ...s, invoice_tagline: e.target.value }))}
              placeholder="e.g. Invoice / Sample Receipt"
            />
          </div>
          <div>
            <Label>Address</Label>
            <Textarea
              value={settings.invoice_address}
              onChange={(e) => setSettings((s) => ({ ...s, invoice_address: e.target.value }))}
              placeholder="Lab address (optional)"
              rows={2}
            />
          </div>
          <div>
            <Label>Logo</Label>
            <div className="flex items-center gap-2 mt-1">
              {settings.invoice_logo_url ? (
                <>
                  <img src={settings.invoice_logo_url} alt="Logo" className="h-10 rounded border" />
                  <Button size="sm" variant="ghost" onClick={removeLogo}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  <Upload className="h-4 w-4 mr-1" />{uploading ? "Uploading…" : "Upload Logo"}
                </Button>
              )}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
            </div>
          </div>
          <Separator />
          <Button onClick={handleSave} disabled={saving} className="w-full">
            <Save className="h-4 w-4 mr-2" />{saving ? "Saving…" : "Save Settings"}
          </Button>
        </CardContent>
      </Card>

      {/* Live Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Header Preview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-white text-black p-4 rounded border" style={{ fontFamily: "Arial, sans-serif" }}>
            <div style={{ textAlign: "center", marginBottom: 10 }}>
              {settings.invoice_logo_url && (
                <img src={settings.invoice_logo_url} alt="Logo" style={{ maxHeight: 50, margin: "0 auto 6px" }} />
              )}
              <h2 style={{ margin: 0, color: "#0d9488", fontSize: 20 }}>
                {settings.invoice_lab_name || "Lab Name"}
              </h2>
              {settings.invoice_contact && (
                <p style={{ margin: "2px 0", fontSize: 12, color: "#666" }}>{settings.invoice_contact}</p>
              )}
              {settings.invoice_address && (
                <p style={{ margin: "2px 0", fontSize: 11, color: "#888", whiteSpace: "pre-line" }}>{settings.invoice_address}</p>
              )}
              <p style={{ margin: "2px 0", fontSize: 11, color: "#888" }}>
                {settings.invoice_tagline || "Invoice / Sample Receipt"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default InvoiceDesigner;
