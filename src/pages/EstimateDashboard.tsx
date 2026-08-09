import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import PaginatedTableFooter from "@/components/ui/PaginatedTableFooter";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { format, addDays } from "date-fns";
import { Download, Trash2, MapPin, Pencil, AlertTriangle, Eye } from "lucide-react";
import { exportToExcel } from "@/lib/excel";
import { useMessageTemplates } from "@/hooks/useMessageTemplates";
import { usePhlebotomistAvailability } from "@/hooks/usePhlebotomistAvailability";
import { buildEstimateMessage, buildVisitMessage, shareOnWhatsApp } from "@/lib/whatsapp";
import { logMessageSend } from "@/lib/messageLog";
import MessagePreviewDialog from "@/components/MessagePreviewDialog";
import { useAbnormalHistory } from "@/hooks/useAbnormalHistory";
import ExportPasswordDialog from "@/components/ExportPasswordDialog";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";
import EditEstimateDialog from "@/components/EditEstimateDialog";
import TimeSlotPicker from "@/components/TimeSlotPicker";
import { patientDisplayName } from "@/lib/patientDisplayName";

const EstimateDashboard = () => {
  useRealtimeSync("estimates", ["estimates"]);
  // estimate_tests not in realtime publication; estimates updates above cover the dashboard.
  const qc = useQueryClient();
  const { data: templates } = useMessageTemplates();
  const { getUnavailableReason } = usePhlebotomistAvailability();
  const [selected, setSelected] = useState<string[]>([]);
  const [bookingEstimate, setBookingEstimate] = useState<any>(null);
  const [visitForm, setVisitForm] = useState({ patient_name: "", visit_date: "", visit_time: "", address: "", phlebotomist_id: "", home_visit_charges: "" });
  const [exportDialog, setExportDialog] = useState(false);
  const [editEstimate, setEditEstimate] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchAllDates, setSearchAllDates] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;
  const [deleteDialog, setDeleteDialog] = useState<{ ids: string[]; description: string } | null>(null);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { setPage(0); }, [debouncedSearch, searchAllDates]);

  // COST OPTIMIZATION (2026-04-28): default view limited to last 7 days, with
  // estimated count instead of exact (no full-table scan). Search box honours
  // the same 7-day window unless "Search all dates" is ticked. Export still
  // returns the full set (see handleExport — no date filter applied there).
  const { data: pagedEstimates, isLoading } = useQuery({
    queryKey: ["estimates", "dashboard", debouncedSearch, page, searchAllDates],
    queryFn: async () => {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      let q = supabase
        .from("estimates")
        .select("*, estimate_tests(*)", { count: "estimated" })
        .eq("status", "Estimate Created")
        .order("created_at", { ascending: false })
        .range(from, to);
      // Apply 7-day window unless user explicitly opts into all-dates search
      if (!searchAllDates) {
        q = q.gte("created_at", sevenDaysAgo);
      }
      if (debouncedSearch) {
        q = q.or(`patient_name.ilike.%${debouncedSearch}%,whatsapp_number.ilike.%${debouncedSearch}%`);
      }
      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: (data || []) as any[], total: count || 0 };
    },
    placeholderData: keepPreviousData,
  });

  const estimates = pagedEstimates?.rows || [];
  const totalEstimates = pagedEstimates?.total || 0;

  const { getForMobile, sendMutation: abnormalSend } = useAbnormalHistory((estimates as any[]).map((e: any) => e.whatsapp_number));

  const { data: phlebotomists = [] } = useQuery({
    queryKey: ["phlebotomists", "active"],
    queryFn: async () => { const { data } = await supabase.from("phlebotomists").select("*").eq("status", "Active"); return data || []; },
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => { const { error } = await supabase.from("estimates").delete().in("id", ids); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["estimates"] }); qc.invalidateQueries({ queryKey: ["abnormal_history"] }); setSelected([]); toast.success("Deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const bookVisitMutation = useMutation({
    mutationFn: async () => {
      if (!visitForm.visit_date || !visitForm.visit_time || !visitForm.address) throw new Error("Fill all required fields");
      const selectedDateTime = new Date(`${visitForm.visit_date}T${visitForm.visit_time}:00`);
      if (Number.isNaN(selectedDateTime.getTime())) throw new Error("Invalid visit date/time");
      if (selectedDateTime.getTime() < Date.now()) throw new Error("Cannot book for date/time that has already passed");
      const est = bookingEstimate;
      const hvCharges = parseFloat(visitForm.home_visit_charges) || 0;

      const { error: visitError } = await supabase.from("home_visits").insert({
        estimate_id: est.id,
        visit_date: visitForm.visit_date,
        visit_time: visitForm.visit_time,
        address: visitForm.address,
        phlebotomist_id: visitForm.phlebotomist_id || null,
      });
      if (visitError) throw visitError;

      const newFinal = Number(est.total_amount) - Number(est.discount_amount) + hvCharges;
      const { error: statusError } = await supabase.from("estimates").update({ status: "Home Visit Booked", home_visit_charges: hvCharges, final_amount: newFinal }).eq("id", est.id);
      if (statusError) throw statusError;

      // WhatsApp
      if (templates) {
        const tests = (est.estimate_tests || []).map((t: any) => ({ name: t.test_name, price: Number(t.price), fasting: t.fasting_required }));
        const hvCharges = parseFloat(visitForm.home_visit_charges) || 0;
        const msg = buildVisitMessage({
          tests,
          totalAmount: Number(est.total_amount),
          discountAmount: Number(est.discount_amount),
          homeVisitCharges: hvCharges,
          finalAmount: Number(est.total_amount) - Number(est.discount_amount) + hvCharges,
          header: templates.estimate_header,
          visitHeader: templates.visit_confirmation_header,
          fastingInstructions: templates.fasting_instructions,
          noFastingMessage: templates.no_fasting_message,
          homeVisitDisclaimer: templates.home_visit_disclaimer,
          footer: templates.footer_text,
          visitDate: format(new Date(visitForm.visit_date), "dd-MM-yyyy"),
          visitTime: (() => { const [h, m] = visitForm.visit_time.split(":"); const hour = parseInt(h, 10); return `${hour % 12 || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`; })(),
          address: visitForm.address,
          patientName: est.patient_name ? est.patient_name.toUpperCase() : undefined,
        });
        await logMessageSend(est.whatsapp_number, est.patient_name, "Estimate", undefined, undefined, msg);
        shareOnWhatsApp(est.whatsapp_number, msg);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["estimates"] });
      qc.invalidateQueries({ queryKey: ["home_visits"] });
      setBookingEstimate(null);
      setVisitForm({ patient_name: "", visit_date: "", visit_time: "", address: "", phlebotomist_id: "", home_visit_charges: "" });
      toast.success("Home visit booked!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleSelect = (id: string) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const handleExport = async () => {
    try {
      const CHUNK = 1000;
      let all: any[] = [];
      let from = 0;
      // Fetch ALL estimates matching current filters (bypass 1000 row default limit)
      // eslint-disable-next-line no-constant-condition
      while (true) {
        let q = supabase
          .from("estimates")
          .select("*")
          .eq("status", "Estimate Created")
          .order("created_at", { ascending: false })
          .range(from, from + CHUNK - 1);
        if (debouncedSearch) {
          q = q.or(`patient_name.ilike.%${debouncedSearch}%,whatsapp_number.ilike.%${debouncedSearch}%`);
        }
        const { data, error } = await q;
        if (error) throw error;
        const rows = (data || []) as any[];
        all = all.concat(rows);
        if (rows.length < CHUNK) break;
        from += CHUNK;
      }
      if (all.length === 0) {
        toast.error("No estimates to export");
        return;
      }
      exportToExcel(all.map((e: any) => ({
        Date: format(new Date(e.created_at), "dd-MM-yyyy"),
        "Patient Name": (() => { const n = patientDisplayName(e); return n === "—" ? "" : n; })(),
        "WhatsApp": e.whatsapp_number,
        "Total Amount": e.total_amount,
        "Discount": e.discount_amount,
        "Home Visit": e.home_visit_charges,
        "Final Amount": e.final_amount,
      })), "estimates_export");
      toast.success(`Exported ${all.length} estimate(s)`);
    } catch (err: any) {
      toast.error(err?.message || "Export failed");
    }
  };

  // Server-side search applied
  const filteredEstimates = estimates;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">Estimate Dashboard</h1>
        <div className="flex gap-2">
          {selected.length > 0 && (
            <Button size="sm" variant="destructive" onClick={() => setDeleteDialog({ ids: selected, description: `Delete ${selected.length} selected estimate(s)?` })}>
              <Trash2 className="h-4 w-4 mr-1" />Delete ({selected.length})
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setDeleteDialog({ ids: estimates.map((e: any) => e.id), description: "Delete ALL estimates? This cannot be undone." })} disabled={estimates.length === 0}>
            <Trash2 className="h-4 w-4 mr-1" />Delete All
          </Button>
          <Button size="sm" variant="outline" onClick={() => setExportDialog(true)}><Download className="h-4 w-4 mr-1" />Excel</Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Input
          placeholder={searchAllDates ? "Search all estimates..." : "Search last 7 days..."}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          name="estimate-search"
          data-lpignore="true"
          data-form-type="other"
          data-1p-ignore="true"
        />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap cursor-pointer">
          <Checkbox checked={searchAllDates} onCheckedChange={(v) => setSearchAllDates(!!v)} />
          Search all dates
        </label>
      </div>
      {!searchAllDates && (
        <p className="text-xs text-muted-foreground">Showing last 7 days only. Tick "Search all dates" to widen.</p>
      )}

      {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : filteredEstimates.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No estimates yet.</p>
      ) : (
        <div className="grid gap-2">
          {filteredEstimates.map((est: any) => (
            <Card key={est.id} className="glass-card">
              <CardContent className="p-3">
                <div className="flex items-start gap-2">
                  <Checkbox checked={selected.includes(est.id)} onCheckedChange={() => toggleSelect(est.id)} className="mt-1 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <span className="font-medium text-sm">{patientDisplayName(est)}</span>
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
                    <div className="flex items-center flex-wrap gap-1 mt-2">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => {
                        if (templates) {
                          const tests = (est.estimate_tests || []).map((t: any) => ({ name: t.test_name, price: Number(t.price), fasting: t.fasting_required }));
                          const msg = buildEstimateMessage({
                            tests,
                            totalAmount: Number(est.total_amount),
                            discountAmount: Number(est.discount_amount),
                            homeVisitCharges: Number(est.home_visit_charges),
                            finalAmount: Number(est.final_amount),
                            header: templates.estimate_header,
                            fastingInstructions: templates.fasting_instructions,
                            noFastingMessage: templates.no_fasting_message,
                            homeVisitDisclaimer: templates.home_visit_disclaimer,
                            footer: templates.footer_text,
                            patientName: est.patient_name || undefined,
                          });
                          setPreviewMessage(msg);
                        }
                      }}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditEstimate(est)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setBookingEstimate(est); setVisitForm(p => ({ ...p, patient_name: est.patient_name || "", home_visit_charges: Number(est.home_visit_charges) > 0 ? String(est.home_visit_charges) : "" })); }}>
                        <MapPin className="h-3.5 w-3.5 mr-1" />Book Visit
                      </Button>
                      {(() => {
                        const abnormal = getForMobile(est.whatsapp_number);
                        return abnormal ? (
                          <>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-warning" onClick={() => abnormalSend.mutate({ id: abnormal.id, mobile: est.whatsapp_number, message: abnormal.message, context: "estimate" })}>
                              <AlertTriangle className="h-3.5 w-3.5" />
                            </Button>
                            {abnormal.sent_at && <span className="text-[9px] text-muted-foreground leading-none">{format(new Date(abnormal.sent_at), "dd-MM HH:mm")}</span>}
                          </>
                        ) : null;
                      })()}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <PaginatedTableFooter page={page} pageSize={PAGE_SIZE} total={totalEstimates} onPageChange={setPage} />

      {/* Book Home Visit Dialog */}
      <Dialog open={!!bookingEstimate} onOpenChange={(o) => !o && setBookingEstimate(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Book Home Visit</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); bookVisitMutation.mutate(); }} className="space-y-4">
            <div>
              <Label>Patient Name</Label>
              <Input value={visitForm.patient_name} onChange={(e) => setVisitForm(p => ({ ...p, patient_name: e.target.value }))} placeholder="Patient name (optional)" />
            </div>
            <div>
              <Label>Visit Date *</Label>
              <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
                {[0, 1, 2].map(offset => {
                  const d = addDays(new Date(), offset);
                  const dateStr = format(d, "yyyy-MM-dd");
                  const dayName = format(d, "EEEE");
                  const dateLabel = format(d, "dd MMM");
                  const label = offset === 0 ? `Today (${dayName}, ${dateLabel})` : offset === 1 ? `Tomorrow (${dayName}, ${dateLabel})` : `Day After (${dayName}, ${dateLabel})`;
                  return (
                    <Button key={offset} type="button" size="sm" variant={visitForm.visit_date === dateStr ? "default" : "outline"} className="h-7 text-xs" onClick={() => setVisitForm(p => ({ ...p, visit_date: dateStr }))}>
                      {label}
                    </Button>
                  );
                })}
              </div>
              <Input type="date" value={visitForm.visit_date} min={format(new Date(), "yyyy-MM-dd")} onChange={(e) => setVisitForm(p => ({ ...p, visit_date: e.target.value }))} onBlur={() => {
                const today = format(new Date(), "yyyy-MM-dd");
                if (visitForm.visit_date && /^\d{4}-\d{2}-\d{2}$/.test(visitForm.visit_date) && visitForm.visit_date < today) {
                  setVisitForm(p => ({ ...p, visit_date: today }));
                  toast.error("Past dates are not allowed");
                }
                if (visitForm.visit_date === today && visitForm.visit_time && visitForm.visit_time < format(new Date(), "HH:mm")) {
                  setVisitForm(p => ({ ...p, visit_time: "" }));
                  toast.error("Selected time has already passed");
                }
              }} required />
            </div>
            <div>
              <Label>Assign Phlebotomist</Label>
              <Select value={visitForm.phlebotomist_id} onValueChange={(v) => setVisitForm(p => ({ ...p, phlebotomist_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {phlebotomists.map((p: any) => {
                    const reason = getUnavailableReason(p, visitForm.visit_date);
                    return (
                      <SelectItem key={p.id} value={p.id} disabled={!!reason}>
                        {p.name}{reason ? ` (${reason})` : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Visit Time *</Label>
              <Input type="time" value={visitForm.visit_time} onChange={(e) => setVisitForm(p => ({ ...p, visit_time: e.target.value }))} onBlur={() => {
                const today = format(new Date(), "yyyy-MM-dd");
                if (visitForm.visit_date === today && visitForm.visit_time && visitForm.visit_time < format(new Date(), "HH:mm")) {
                  setVisitForm(p => ({ ...p, visit_time: "" }));
                  toast.error("Past time is not allowed for today");
                }
              }} required />
              <TimeSlotPicker
                date={visitForm.visit_date}
                phlebotomistId={visitForm.phlebotomist_id}
                selectedTime={visitForm.visit_time}
                onSelectTime={(t) => setVisitForm(p => ({ ...p, visit_time: t }))}
              />
            </div>
            <div><Label>Address *</Label><Textarea value={visitForm.address} onChange={(e) => setVisitForm(p => ({ ...p, address: e.target.value }))} required rows={3} /></div>
            <div><Label>Home Visit Charges (₹)</Label><Input type="number" value={visitForm.home_visit_charges} onChange={(e) => setVisitForm(p => ({ ...p, home_visit_charges: e.target.value }))} placeholder="0" /></div>
            <Button type="submit" className="w-full" disabled={bookVisitMutation.isPending}>Book & Share on WhatsApp</Button>
          </form>
        </DialogContent>
      </Dialog>

      <EditEstimateDialog estimate={editEstimate} open={!!editEstimate} onClose={() => setEditEstimate(null)} />
      <ExportPasswordDialog open={exportDialog} onOpenChange={setExportDialog} onSuccess={handleExport} />
      <DeletePasswordDialog
        open={!!deleteDialog}
        onOpenChange={(o) => !o && setDeleteDialog(null)}
        onSuccess={() => { if (deleteDialog) deleteMutation.mutate(deleteDialog.ids); }}
        description={deleteDialog?.description}
      />
      <MessagePreviewDialog open={!!previewMessage} onOpenChange={(o) => !o && setPreviewMessage(null)} title="Estimate Message" message={previewMessage || ""} />
    </div>
  );
};

export default EstimateDashboard;
