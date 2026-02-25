import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { format } from "date-fns";
import { Download, Trash2, Calendar, MapPin } from "lucide-react";
import { exportToExcel } from "@/lib/excel";
import { useMessageTemplates } from "@/hooks/useMessageTemplates";
import { buildVisitMessage, shareOnWhatsApp } from "@/lib/whatsapp";
import ExportPasswordDialog from "@/components/ExportPasswordDialog";

const EstimateDashboard = () => {
  const qc = useQueryClient();
  const { data: templates } = useMessageTemplates();
  const [selected, setSelected] = useState<string[]>([]);
  const [bookingEstimate, setBookingEstimate] = useState<any>(null);
  const [visitForm, setVisitForm] = useState({ visit_date: "", visit_time: "", address: "", phlebotomist_id: "" });
  const [exportDialog, setExportDialog] = useState(false);

  const { data: estimates = [], isLoading } = useQuery({
    queryKey: ["estimates", "dashboard"],
    queryFn: async () => {
      const { data } = await supabase.from("estimates").select("*, estimate_tests(*)").eq("status", "Estimate Created").order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: phlebotomists = [] } = useQuery({
    queryKey: ["phlebotomists", "active"],
    queryFn: async () => { const { data } = await supabase.from("phlebotomists").select("*").eq("status", "Active"); return data || []; },
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => { const { error } = await supabase.from("estimates").delete().in("id", ids); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["estimates"] }); setSelected([]); toast.success("Deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const bookVisitMutation = useMutation({
    mutationFn: async () => {
      if (!visitForm.visit_date || !visitForm.visit_time || !visitForm.address) throw new Error("Fill all required fields");
      const est = bookingEstimate;

      const { error: visitError } = await supabase.from("home_visits").insert({
        estimate_id: est.id,
        visit_date: visitForm.visit_date,
        visit_time: visitForm.visit_time,
        address: visitForm.address,
        phlebotomist_id: visitForm.phlebotomist_id || null,
      });
      if (visitError) throw visitError;

      const { error: statusError } = await supabase.from("estimates").update({ status: "Home Visit Booked" }).eq("id", est.id);
      if (statusError) throw statusError;

      // WhatsApp
      if (templates) {
        const tests = (est.estimate_tests || []).map((t: any) => ({ name: t.test_name, price: Number(t.price), fasting: t.fasting_required }));
        const msg = buildVisitMessage({
          tests,
          totalAmount: Number(est.total_amount),
          discountAmount: Number(est.discount_amount),
          homeVisitCharges: Number(est.home_visit_charges),
          finalAmount: Number(est.final_amount),
          header: templates.estimate_header,
          visitHeader: templates.visit_confirmation_header,
          fastingInstructions: templates.fasting_instructions,
          homeVisitDisclaimer: templates.home_visit_disclaimer,
          footer: templates.footer_text,
          visitDate: format(new Date(visitForm.visit_date), "dd-MM-yyyy"),
          visitTime: visitForm.visit_time,
          address: visitForm.address,
        });
        shareOnWhatsApp(est.whatsapp_number, msg);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["estimates"] });
      qc.invalidateQueries({ queryKey: ["home_visits"] });
      setBookingEstimate(null);
      setVisitForm({ visit_date: "", visit_time: "", address: "", phlebotomist_id: "" });
      toast.success("Home visit booked!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleSelect = (id: string) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const handleExport = () => {
    exportToExcel(estimates.map((e: any) => ({
      Date: format(new Date(e.created_at), "dd-MM-yyyy"),
      "Patient Name": e.patient_name || "",
      "WhatsApp": e.whatsapp_number,
      "Total Amount": e.total_amount,
      "Discount": e.discount_amount,
      "Home Visit": e.home_visit_charges,
      "Final Amount": e.final_amount,
    })), "estimates_export");
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">Estimate Dashboard</h1>
        <div className="flex gap-2">
          {selected.length > 0 && (
            <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate(selected)}>
              <Trash2 className="h-4 w-4 mr-1" />Delete ({selected.length})
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => deleteMutation.mutate(estimates.map((e: any) => e.id))} disabled={estimates.length === 0}>
            <Trash2 className="h-4 w-4 mr-1" />Delete All
          </Button>
          <Button size="sm" variant="outline" onClick={() => setExportDialog(true)}><Download className="h-4 w-4 mr-1" />Excel</Button>
        </div>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : estimates.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No estimates yet.</p>
      ) : (
        <div className="grid gap-2">
          {estimates.map((est: any) => (
            <Card key={est.id} className="glass-card">
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  <Checkbox checked={selected.includes(est.id)} onCheckedChange={() => toggleSelect(est.id)} className="mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <span className="font-medium text-sm">{est.patient_name || "—"}</span>
                      <span className="text-xs text-muted-foreground">{format(new Date(est.created_at), "dd-MM-yyyy")}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{est.whatsapp_number}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(est.estimate_tests || []).map((t: any) => (
                        <span key={t.id} className="text-xs bg-accent rounded px-1.5 py-0.5">{t.test_name}</span>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-xs">
                      <span>₹{est.total_amount}</span>
                      {Number(est.discount_amount) > 0 && <span className="text-success">-₹{est.discount_amount}</span>}
                      <span className="font-bold">Final: ₹{est.final_amount}</span>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setBookingEstimate(est)}>
                    <MapPin className="h-3.5 w-3.5 mr-1" />Book Visit
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Book Home Visit Dialog */}
      <Dialog open={!!bookingEstimate} onOpenChange={(o) => !o && setBookingEstimate(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Book Home Visit</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); bookVisitMutation.mutate(); }} className="space-y-4">
            <div><Label>Visit Date *</Label><Input type="date" value={visitForm.visit_date} onChange={(e) => setVisitForm(p => ({ ...p, visit_date: e.target.value }))} required /></div>
            <div><Label>Visit Time *</Label><Input type="time" value={visitForm.visit_time} onChange={(e) => setVisitForm(p => ({ ...p, visit_time: e.target.value }))} required /></div>
            <div><Label>Address *</Label><Textarea value={visitForm.address} onChange={(e) => setVisitForm(p => ({ ...p, address: e.target.value }))} required rows={3} /></div>
            <div>
              <Label>Assign Phlebotomist</Label>
              <Select value={visitForm.phlebotomist_id} onValueChange={(v) => setVisitForm(p => ({ ...p, phlebotomist_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {phlebotomists.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="w-full" disabled={bookVisitMutation.isPending}>Book & Share on WhatsApp</Button>
          </form>
        </DialogContent>
      </Dialog>

      <ExportPasswordDialog open={exportDialog} onOpenChange={setExportDialog} onSuccess={handleExport} />
    </div>
  );
};

export default EstimateDashboard;
