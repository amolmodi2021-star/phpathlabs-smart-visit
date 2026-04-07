import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

const SETTINGS_KEYS = ["crm_daily_quota", "crm_automation_enabled"];

const CRMSettings = () => {
  const [quota, setQuota] = useState("100");
  const [automationEnabled, setAutomationEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("app_settings").select("setting_key, setting_value").in("setting_key", SETTINGS_KEYS);
      (data || []).forEach((s: any) => {
        if (s.setting_key === "crm_daily_quota") setQuota(s.setting_value || "100");
        if (s.setting_key === "crm_automation_enabled") setAutomationEnabled(s.setting_value === "true");
      });
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    for (const [key, val] of [
      ["crm_daily_quota", quota],
      ["crm_automation_enabled", String(automationEnabled)],
      ["crm_abc_static_expiry_date", staticExpiryDate],
    ]) {
      await supabase.from("app_settings").upsert({ setting_key: key, setting_value: val }, { onConflict: "setting_key" });
    }
    setSaving(false);
    toast.success("Settings saved");
  };

  return (
    <Card>
      <CardHeader><CardTitle>CRM Settings</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Daily Message Quota</Label>
          <Input type="number" min={1} value={quota} onChange={(e) => setQuota(e.target.value)} className="w-32" />
          <p className="text-xs text-muted-foreground mt-1">Maximum WhatsApp messages per day via automation</p>
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={automationEnabled} onCheckedChange={setAutomationEnabled} />
          <Label>Enable Marketing Automation</Label>
        </div>
        <div>
          <Label>ABC Card — Static Expiry Date</Label>
          <Input
            placeholder="e.g. 31-12-2026"
            value={staticExpiryDate}
            onChange={(e) => setStaticExpiryDate(e.target.value)}
            className="w-48"
          />
          <p className="text-xs text-muted-foreground mt-1">This expiry date will be printed on all ABC cards sent from CRM (Review & Contacts)</p>
        </div>
        <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save Settings"}</Button>
      </CardContent>
    </Card>
  );
};

export default CRMSettings;
