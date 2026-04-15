import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Upload, Save, Trash2, AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import { toast } from "sonner";

const SETTING_KEYS = [
  "invoice_lab_name",
  "invoice_address",
  "invoice_contact",
  "invoice_tagline",
  "invoice_logo_url",
  "invoice_logo_align",
  "invoice_lab_name_align",
  "invoice_lab_name_visible",
  "invoice_tagline_align",
  "invoice_address_align",
] as const;

const DEFAULTS: Record<string, string> = {
  invoice_lab_name: "PH PathLabs",
  invoice_address: "",
  invoice_contact: "LabLine: 6356 55 66 99",
  invoice_tagline: "Invoice / Sample Receipt",
  invoice_logo_url: "",
  invoice_logo_align: "center",
  invoice_lab_name_align: "center",
  invoice_lab_name_visible: "true",
  invoice_tagline_align: "center",
  invoice_address_align: "center",
};

const AlignToggle = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <div className="flex border rounded overflow-hidden">
    {[
      { v: "left", icon: AlignLeft },
      { v: "center", icon: AlignCenter },
      { v: "right", icon: AlignRight },
    ].map(({ v, icon: Icon }) => (
      <button
        key={v}
        type="button"
        onClick={() => onChange(v)}
        className={`px-2 py-1 ${value === v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}
      >
        <Icon className="h-4 w-4" />
      </button>
    ))}
  </div>
);

const logoMargin = (align: string) =>
  align === "left" ? "0" : align === "right" ? "0 0 0 auto" : "0 auto";

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

  const set = (key: string, val: string) => setSettings((s) => ({ ...s, [key]: val }));

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const key of SETTING_KEYS) {
        await supabase
          .from("app_settings")
          .upsert({ setting_key: key, setting_value: settings[key] || "" }, { onConflict: "setting_key" });
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
    const { error } = await supabase.storage.from("invoice-assets").upload(path, file, { upsert: true });
    if (error) { toast.error("Upload failed"); setUploading(false); return; }
    const { data: urlData } = supabase.storage.from("invoice-assets").getPublicUrl(path);
    set("invoice_logo_url", urlData.publicUrl);
    setUploading(false);
    toast.success("Logo uploaded — click Save to apply");
  };

  if (loading) return <p className="text-sm text-muted-foreground p-4">Loading…</p>;

  const labVisible = settings.invoice_lab_name_visible !== "false";

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Invoice Branding</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {/* Logo */}
          <div>
            <div className="flex items-center justify-between">
              <Label>Logo</Label>
              <AlignToggle value={settings.invoice_logo_align} onChange={(v) => set("invoice_logo_align", v)} />
            </div>
            <div className="flex items-center gap-2 mt-1">
              {settings.invoice_logo_url ? (
                <>
                  <img src={settings.invoice_logo_url} alt="Logo" className="h-10 rounded border" />
                  <Button size="sm" variant="ghost" onClick={() => set("invoice_logo_url", "")}>
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

          {/* Lab Name */}
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label>Lab Name</Label>
                <Switch checked={labVisible} onCheckedChange={(c) => set("invoice_lab_name_visible", c ? "true" : "false")} />
              </div>
              <AlignToggle value={settings.invoice_lab_name_align} onChange={(v) => set("invoice_lab_name_align", v)} />
            </div>
            <Input value={settings.invoice_lab_name} onChange={(e) => set("invoice_lab_name", e.target.value)} className="mt-1" />
          </div>

          {/* Contact */}
          <div>
            <Label>Contact Info</Label>
            <Input value={settings.invoice_contact} onChange={(e) => set("invoice_contact", e.target.value)} placeholder="e.g. LabLine: 6356 55 66 99" />
          </div>

          {/* Tagline */}
          <div>
            <div className="flex items-center justify-between">
              <Label>Tagline</Label>
              <AlignToggle value={settings.invoice_tagline_align} onChange={(v) => set("invoice_tagline_align", v)} />
            </div>
            <Input value={settings.invoice_tagline} onChange={(e) => set("invoice_tagline", e.target.value)} placeholder="e.g. Invoice / Sample Receipt" className="mt-1" />
          </div>

          {/* Address */}
          <div>
            <div className="flex items-center justify-between">
              <Label>Address</Label>
              <AlignToggle value={settings.invoice_address_align} onChange={(v) => set("invoice_address_align", v)} />
            </div>
            <Textarea value={settings.invoice_address} onChange={(e) => set("invoice_address", e.target.value)} placeholder="Lab address (optional)" rows={2} className="mt-1" />
          </div>

          <Separator />
          <Button onClick={handleSave} disabled={saving} className="w-full">
            <Save className="h-4 w-4 mr-2" />{saving ? "Saving…" : "Save Settings"}
          </Button>
        </CardContent>
      </Card>

      {/* Live Preview */}
      <Card>
        <CardHeader><CardTitle className="text-base">Header Preview</CardTitle></CardHeader>
        <CardContent>
          <div className="bg-white text-black p-4 rounded border" style={{ fontFamily: "Arial, sans-serif" }}>
            <div style={{ marginBottom: 10 }}>
              {settings.invoice_logo_url && (
                <div style={{ textAlign: settings.invoice_logo_align as any }}>
                  <img src={settings.invoice_logo_url} alt="Logo" style={{ maxHeight: 50, display: "inline-block", marginBottom: 6 }} />
                </div>
              )}
              {labVisible && (
                <h2 style={{ margin: 0, color: "#0d9488", fontSize: 20, textAlign: settings.invoice_lab_name_align as any }}>
                  {settings.invoice_lab_name || "Lab Name"}
                </h2>
              )}
              {settings.invoice_contact && (
                <p style={{ margin: "2px 0", fontSize: 12, color: "#666", textAlign: settings.invoice_lab_name_align as any }}>{settings.invoice_contact}</p>
              )}
              {settings.invoice_address && (
                <p style={{ margin: "2px 0", fontSize: 11, color: "#888", whiteSpace: "pre-line", textAlign: settings.invoice_address_align as any }}>{settings.invoice_address}</p>
              )}
              <p style={{ margin: "2px 0", fontSize: 11, color: "#888", textAlign: settings.invoice_tagline_align as any }}>
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
