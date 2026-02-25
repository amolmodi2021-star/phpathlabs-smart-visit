import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Save } from "lucide-react";

const templateFields = [
  { key: "estimate_header", label: "Estimate Header" },
  { key: "visit_confirmation_header", label: "Visit Confirmation Header" },
  { key: "fasting_instructions", label: "Fasting Instructions" },
  { key: "home_visit_disclaimer", label: "Home Visit Disclaimer" },
  { key: "footer_text", label: "Footer Text" },
];

const MessageTemplates = () => {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["message_templates"],
    queryFn: async () => {
      const { data } = await supabase.from("message_templates").select("*");
      const map: Record<string, string> = {};
      (data || []).forEach((r: any) => { map[r.template_key] = r.template_value; });
      setValues(map);
      return map;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      for (const [key, value] of Object.entries(values)) {
        await supabase.from("message_templates").update({ template_value: value }).eq("template_key", key);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["message_templates"] }); toast.success("Templates saved"); },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Loading...</p>;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Message Templates</h1>
        <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}><Save className="h-4 w-4 mr-1" />Save All</Button>
      </div>

      <div className="grid gap-3">
        {templateFields.map((f) => (
          <Card key={f.key} className="glass-card">
            <CardContent className="p-4 space-y-2">
              <Label className="font-medium">{f.label}</Label>
              {f.key === "footer_text" || f.key === "home_visit_disclaimer" ? (
                <Textarea value={values[f.key] || ""} onChange={(e) => setValues(p => ({ ...p, [f.key]: e.target.value }))} rows={3} />
              ) : (
                <Input value={values[f.key] || ""} onChange={(e) => setValues(p => ({ ...p, [f.key]: e.target.value }))} />
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default MessageTemplates;
