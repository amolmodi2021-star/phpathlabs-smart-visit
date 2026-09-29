import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  DEFAULT_GOOGLE_REVIEW_TEMPLATE,
  GOOGLE_REVIEW_TEMPLATE_KEY,
  buildGoogleReviewMessage,
} from "@/lib/googleReviewRequest";

const GoogleReviewSettings = () => {
  const [value, setValue] = useState(DEFAULT_GOOGLE_REVIEW_TEMPLATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("message_templates")
        .select("template_value")
        .eq("template_key", GOOGLE_REVIEW_TEMPLATE_KEY)
        .maybeSingle();
      if (error) toast.error(error.message);
      else if (data?.template_value) setValue(String(data.template_value));
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const { data: existing } = await supabase
        .from("message_templates")
        .select("id")
        .eq("template_key", GOOGLE_REVIEW_TEMPLATE_KEY)
        .maybeSingle();
      if (existing) {
        const { error } = await supabase
          .from("message_templates")
          .update({ template_value: value })
          .eq("template_key", GOOGLE_REVIEW_TEMPLATE_KEY);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("message_templates").insert({
          template_key: GOOGLE_REVIEW_TEMPLATE_KEY,
          template_value: value,
        });
        if (error) throw error;
      }
      toast.success("Google review message saved");
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const preview = buildGoogleReviewMessage({
    template: value,
    title: "Mrs.",
    patientName: "Simran Dhingra",
    invoiceNumber: "2609230028",
    umrNumber: "UMR0019209",
    mobile: "9909194947",
  });

  if (loading) return <p className="text-sm text-muted-foreground p-2">Loading…</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Google Review WhatsApp</CardTitle>
        <CardDescription>
          Sent automatically 5 minutes after Dispatch All, only when every report for that visit is dispatched on the same day the patient was registered. Pickup point patients are skipped. One message per visit.
          Placeholders: {"{title}"}, {"{patient_name}"}, {"{patient_full_name}"}, {"{invoice_number}"}, {"{umr_number}"}, {"{mobile}"}. Paste your Google review link in the message.
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
        </div>
        <div className="flex gap-2">
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          <Button type="button" variant="outline" onClick={() => setValue(DEFAULT_GOOGLE_REVIEW_TEMPLATE)}>
            Reset to default
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default GoogleReviewSettings;