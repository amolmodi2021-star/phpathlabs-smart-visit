import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  DEFAULT_PENDING_SAMPLE_REMINDER_TEMPLATE,
  PENDING_SAMPLE_REMINDER_TEMPLATE_KEY,
  formatPendingTestList,
  buildPendingSampleReminderMessage,
} from "@/lib/pendingSampleReminder";

const SampleCollectionReminderSettings = () => {
  const [value, setValue] = useState(DEFAULT_PENDING_SAMPLE_REMINDER_TEMPLATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("message_templates")
        .select("template_value")
        .eq("template_key", PENDING_SAMPLE_REMINDER_TEMPLATE_KEY)
        .maybeSingle();
      if (error) {
        toast.error(error.message);
      } else if (data?.template_value) {
        setValue(String(data.template_value));
      }
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const { data: existing } = await supabase
        .from("message_templates")
        .select("id")
        .eq("template_key", PENDING_SAMPLE_REMINDER_TEMPLATE_KEY)
        .maybeSingle();
      if (existing) {
        const { error } = await supabase
          .from("message_templates")
          .update({ template_value: value })
          .eq("template_key", PENDING_SAMPLE_REMINDER_TEMPLATE_KEY);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("message_templates").insert({
          template_key: PENDING_SAMPLE_REMINDER_TEMPLATE_KEY,
          template_value: value,
        });
        if (error) throw error;
      }
      toast.success("Sample collection reminder template saved");
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const preview = buildPendingSampleReminderMessage({
    template: value,
    patientName: "Rahul Sharma",
    invoiceNumber: "2609100001",
    mobile: "9876543210",
    testNames: ["Complete Blood Count", "Lipid Profile", "Fasting Blood Sugar"],
  });

  if (loading) return <p className="text-sm text-muted-foreground p-2">Loading…</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending Sample Collection WhatsApp</CardTitle>
        <CardDescription>
          Plain-text message queued to WhatsApp Console (same outbox as invoices/reports, no media). Max 2 sends per patient with a 3-day gap between sends. Patients registered today are never included.
          Use placeholders: {"{patient_name}"}, {"{invoice_number}"}, {"{mobile}"}, {"{test_list}"}, {"{test_count}"}.
          {"{test_list}"} is replaced with line-separated tests formatted as{" "}
          <code className="text-xs">- Test name</code> so WhatsApp shows bullets.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Message template</Label>
          <Textarea
            rows={12}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="font-mono text-sm"
          />
        </div>
        <div className="space-y-2">
          <Label>Preview</Label>
          <pre className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap font-sans">
            {preview || "(empty)"}
          </pre>
          <p className="text-xs text-muted-foreground">
            Example test list block:{" "}
            <code className="whitespace-pre-wrap">{formatPendingTestList(["CBC", "LFT"])}</code>
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setValue(DEFAULT_PENDING_SAMPLE_REMINDER_TEMPLATE)}
          >
            Reset to default
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default SampleCollectionReminderSettings;
