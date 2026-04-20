import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const KEYS = [
  "bank_account_name",
  "bank_account_number",
  "bank_name",
  "bank_branch",
  "bank_ifsc",
  "bank_micr",
  "bank_pan",
  "pickup_invoice_default_reminder_days",
  "pickup_invoice_declaration",
];

const LABELS: Record<string, string> = {
  bank_account_name: "Account Name",
  bank_account_number: "Account Number",
  bank_name: "Bank Name",
  bank_branch: "Branch",
  bank_ifsc: "IFSC",
  bank_micr: "MICR",
  bank_pan: "PAN",
  pickup_invoice_default_reminder_days: "Default Reminder Days",
  pickup_invoice_declaration: "Invoice Declaration / Footer Note",
};

const BillingSettings = () => {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("app_settings").select("setting_key, setting_value").in("setting_key", KEYS);
      const m: Record<string, string> = {};
      KEYS.forEach((k) => (m[k] = ""));
      (data || []).forEach((r: any) => (m[r.setting_key] = r.setting_value));
      setVals(m);
      setLoading(false);
    })();
  }, []);

  const set = (k: string, v: string) => setVals((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      for (const k of KEYS) {
        const { data: existing } = await supabase.from("app_settings").select("id").eq("setting_key", k).maybeSingle();
        if (existing) {
          await supabase.from("app_settings").update({ setting_value: vals[k] || "" } as any).eq("setting_key", k);
        } else {
          await supabase.from("app_settings").insert({ setting_key: k, setting_value: vals[k] || "" } as any);
        }
      }
      toast.success("Settings saved");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <Card>
      <CardHeader><CardTitle>Bank & Reminder Settings</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {KEYS.filter((k) => k !== "pickup_invoice_declaration").map((k) => (
            <div key={k}>
              <Label>{LABELS[k]}</Label>
              <Input
                type={k === "pickup_invoice_default_reminder_days" ? "number" : "text"}
                value={vals[k] || ""}
                onChange={(e) => set(k, e.target.value)}
              />
            </div>
          ))}
        </div>
        <div>
          <Label>{LABELS.pickup_invoice_declaration}</Label>
          <Textarea
            rows={3}
            value={vals.pickup_invoice_declaration || ""}
            onChange={(e) => set("pickup_invoice_declaration", e.target.value)}
          />
        </div>
        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </CardContent>
    </Card>
  );
};

export default BillingSettings;
