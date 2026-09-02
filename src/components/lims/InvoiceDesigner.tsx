import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Upload, Save, Trash2, AlignLeft, AlignCenter, AlignRight, Bold, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { invalidateInvoiceBrandCache } from "@/lib/invoiceBrandCache";

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
  "invoice_lab_name_size",
  "invoice_lab_name_bold",
  "invoice_lab_name_color",
  "invoice_contact_size",
  "invoice_contact_bold",
  "invoice_contact_color",
  "invoice_address_size",
  "invoice_address_bold",
  "invoice_address_color",
  "invoice_tagline_size",
  "invoice_tagline_bold",
  "invoice_tagline_color",
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
  invoice_lab_name_size: "16",
  invoice_lab_name_bold: "true",
  invoice_lab_name_color: "#2E3192",
  invoice_contact_size: "10",
  invoice_contact_bold: "false",
  invoice_contact_color: "#6b7280",
  invoice_address_size: "9",
  invoice_address_bold: "false",
  invoice_address_color: "#6b7280",
  invoice_tagline_size: "9",
  invoice_tagline_bold: "false",
  invoice_tagline_color: "#6b7280",
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

const FontStyleControls = ({
  size,
  bold,
  color,
  onSize,
  onBold,
  onColor,
  min = 8,
  max = 36,
}: {
  size: string;
  bold: string;
  color: string;
  onSize: (v: string) => void;
  onBold: (v: string) => void;
  onColor: (v: string) => void;
  min?: number;
  max?: number;
}) => {
  const n = Math.min(max, Math.max(min, Number(size) || min));
  const isBold = bold !== "false";
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <div className="flex border rounded overflow-hidden">
        <button
          type="button"
          className="px-2 py-1 bg-muted text-muted-foreground hover:bg-accent"
          onClick={() => onSize(String(Math.max(min, n - 1)))}
          title="Decrease font size"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="px-2 py-1 text-xs tabular-nums min-w-[2.5rem] text-center border-x bg-background">{n}px</span>
        <button
          type="button"
          className="px-2 py-1 bg-muted text-muted-foreground hover:bg-accent"
          onClick={() => onSize(String(Math.min(max, n + 1)))}
          title="Increase font size"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <button
        type="button"
        onClick={() => onBold(isBold ? "false" : "true")}
        className={`px-2 py-1 border rounded ${isBold ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}
        title="Bold"
      >
        <Bold className="h-3.5 w-3.5" />
      </button>
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#000000"}
        onChange={(e) => onColor(e.target.value)}
        className="h-8 w-8 cursor-pointer rounded border bg-transparent p-0.5"
        title="Font color"
      />
    </div>
  );
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

  const set = (key: string, val: string) => setSettings((s) => ({ ...s, [key]: val }));

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const key of SETTING_KEYS) {
        await supabase
          .from("app_settings")
          .upsert({ setting_key: key, setting_value: settings[key] || "" }, { onConflict: "setting_key" });
      }
      invalidateInvoiceBrandCache();
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
  const styleOf = (prefix: string, fallbackSize: string, fallbackColor: string) => ({
    fontSize: Number(settings[`${prefix}_size`] || fallbackSize),
    fontWeight: (settings[`${prefix}_bold`] !== "false" ? "bold" : "normal") as "bold" | "normal",
    color: settings[`${prefix}_color`] || fallbackColor,
  });

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
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Label>Lab Name</Label>
                <Switch checked={labVisible} onCheckedChange={(c) => set("invoice_lab_name_visible", c ? "true" : "false")} />
              </div>
              <AlignToggle value={settings.invoice_lab_name_align} onChange={(v) => set("invoice_lab_name_align", v)} />
            </div>
            <FontStyleControls
              size={settings.invoice_lab_name_size}
              bold={settings.invoice_lab_name_bold}
              color={settings.invoice_lab_name_color}
              onSize={(v) => set("invoice_lab_name_size", v)}
              onBold={(v) => set("invoice_lab_name_bold", v)}
              onColor={(v) => set("invoice_lab_name_color", v)}
            />
            <Input value={settings.invoice_lab_name} onChange={(e) => set("invoice_lab_name", e.target.value)} />
          </div>

          {/* Contact */}
          <div className="space-y-1.5">
            <Label>Contact Info</Label>
            <FontStyleControls
              size={settings.invoice_contact_size}
              bold={settings.invoice_contact_bold}
              color={settings.invoice_contact_color}
              onSize={(v) => set("invoice_contact_size", v)}
              onBold={(v) => set("invoice_contact_bold", v)}
              onColor={(v) => set("invoice_contact_color", v)}
            />
            <Input value={settings.invoice_contact} onChange={(e) => set("invoice_contact", e.target.value)} placeholder="e.g. LabLine: 6356 55 66 99" />
          </div>

          {/* Tagline */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label>Tagline</Label>
              <AlignToggle value={settings.invoice_tagline_align} onChange={(v) => set("invoice_tagline_align", v)} />
            </div>
            <FontStyleControls
              size={settings.invoice_tagline_size}
              bold={settings.invoice_tagline_bold}
              color={settings.invoice_tagline_color}
              onSize={(v) => set("invoice_tagline_size", v)}
              onBold={(v) => set("invoice_tagline_bold", v)}
              onColor={(v) => set("invoice_tagline_color", v)}
            />
            <Input value={settings.invoice_tagline} onChange={(e) => set("invoice_tagline", e.target.value)} placeholder="e.g. Invoice / Sample Receipt" />
          </div>

          {/* Address */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label>Address</Label>
              <AlignToggle value={settings.invoice_address_align} onChange={(v) => set("invoice_address_align", v)} />
            </div>
            <FontStyleControls
              size={settings.invoice_address_size}
              bold={settings.invoice_address_bold}
              color={settings.invoice_address_color}
              onSize={(v) => set("invoice_address_size", v)}
              onBold={(v) => set("invoice_address_bold", v)}
              onColor={(v) => set("invoice_address_color", v)}
            />
            <Textarea value={settings.invoice_address} onChange={(e) => set("invoice_address", e.target.value)} placeholder="Lab address (optional)" rows={2} />
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
          <div className="bg-white text-black p-4 rounded border overflow-hidden" style={{ fontFamily: '"Segoe UI", system-ui, Arial, sans-serif' }}>
            <div style={{ borderBottom: "2px solid #E41E26", padding: "20px 0 4px", marginBottom: 6 }}>
              {settings.invoice_logo_url && (
                <div style={{ textAlign: settings.invoice_logo_align as any, lineHeight: 0 }}>
                  <img src={settings.invoice_logo_url} alt="Logo" style={{ maxHeight: 40, display: "inline-block" }} />
                </div>
              )}
              {labVisible && (
                <h2 style={{ margin: "6px 0 0", textAlign: settings.invoice_lab_name_align as any, ...styleOf("invoice_lab_name", "18", "#2E3192") }}>
                  {settings.invoice_lab_name || "Lab Name"}
                </h2>
              )}
              {settings.invoice_contact && (
                <p style={{ margin: "4px 0 0", textAlign: settings.invoice_lab_name_align as any, ...styleOf("invoice_contact", "10", "#6b7280") }}>{settings.invoice_contact}</p>
              )}
              {settings.invoice_address && (
                <p style={{ margin: "2px 0 0", whiteSpace: "pre-line", textAlign: settings.invoice_address_align as any, ...styleOf("invoice_address", "9", "#6b7280") }}>{settings.invoice_address}</p>
              )}
            </div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#2E3192", marginBottom: 4 }}>
              {settings.invoice_tagline || "Receipt Memo"}
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#111827" }}>#2608120001</div>
            <div style={{ marginTop: 10, background: "#F0F1FA", border: "1px solid #D8DBF0", borderRadius: 8, padding: 10, fontSize: 11 }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#2E3192", marginBottom: 4 }}>Patient</div>
              Sample patient card preview
            </div>
            <div style={{ marginTop: 8, fontSize: 12, fontWeight: 800, color: "#111827", display: "flex", justifyContent: "space-between" }}>
              <span>Final Amount</span><span>₹0</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default InvoiceDesigner;
