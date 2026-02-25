import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { format } from "date-fns";
import { Download, Phone, MapPin } from "lucide-react";
import { exportToExcel } from "@/lib/excel";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";

const statusColors: Record<string, string> = {
  Pending: "bg-warning text-warning-foreground",
  Completed: "bg-success text-success-foreground",
  Cancelled: "bg-destructive text-destructive-foreground",
};

const HomeVisits = () => {
  const qc = useQueryClient();
  const [cancelDialog, setCancelDialog] = useState<any>(null);
  const [cancelReason, setCancelReason] = useState("");

  const { data: visits = [], isLoading } = useQuery({
    queryKey: ["home_visits"],
    queryFn: async () => {
      const { data } = await supabase.from("home_visits").select("*, estimates(*, estimate_tests(*)), phlebotomists(name, mobile)").order("visit_date", { ascending: false });
      return data || [];
    },
  });

  const { data: phlebotomists = [] } = useQuery({
    queryKey: ["phlebotomists", "active"],
    queryFn: async () => { const { data } = await supabase.from("phlebotomists").select("*").eq("status", "Active"); return data || []; },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, reason }: { id: string; status: string; reason?: string }) => {
      const update: any = { status };
      if (reason) update.cancellation_reason = reason;
      const { error } = await supabase.from("home_visits").update(update).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["home_visits"] }); toast.success("Updated"); setCancelDialog(null); setCancelReason(""); },
    onError: (e: Error) => toast.error(e.message),
  });

  const assignPhlebotomist = useMutation({
    mutationFn: async ({ id, pId }: { id: string; pId: string }) => {
      const { error } = await supabase.from("home_visits").update({ phlebotomist_id: pId }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["home_visits"] }); toast.success("Assigned"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleStatusChange = (visit: any, newStatus: string) => {
    if (newStatus === "Cancelled") {
      setCancelDialog(visit);
    } else {
      updateStatus.mutate({ id: visit.id, status: newStatus });
    }
  };

  const formatTime12hr = (time: string) => {
    if (!time) return "";
    const [h, m] = time.split(":");
    const hour = parseInt(h, 10);
    const ampm = hour >= 12 ? "PM" : "AM";
    const h12 = hour % 12 || 12;
    return `${h12}:${m} ${ampm}`;
  };

  const handleExport = () => {
    exportToExcel(visits.map((v: any) => ({
      "Visit Date": v.visit_date,
      "Visit Time": formatTime12hr(v.visit_time),
      "Patient": v.estimates?.patient_name || "",
      "Mobile": v.estimates?.whatsapp_number || "",
      "Address": v.address,
      "Phlebotomist": v.phlebotomists?.name || "",
      "Status": v.status,
      "Home Visit Charges": v.estimates?.home_visit_charges || 0,
    })), "home_visits_export");
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Home Visits</h1>
        <Button size="sm" variant="outline" onClick={handleExport}><Download className="h-4 w-4 mr-1" />Excel</Button>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : visits.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No home visits yet.</p>
      ) : (
        <div className="grid gap-2">
          {visits.map((v: any) => {
            const est = v.estimates;
            return (
              <Card key={v.id} className="glass-card">
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div>
                      <p className="font-medium text-sm">{est?.patient_name || "—"}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <MapPin className="h-3 w-3" />{v.address}
                      </p>
                    </div>
                    <Badge className={statusColors[v.status] || ""}>{v.status}</Badge>
                  </div>

                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>{v.visit_date} | {formatTime12hr(v.visit_time)}</span>
                    {v.phlebotomists && <span>• {v.phlebotomists.name}</span>}
                    <span>• ₹{est?.home_visit_charges || 0}</span>
                  </div>

                  {v.status === "Cancelled" && v.cancellation_reason && (
                    <p className="text-xs text-destructive">Reason: {v.cancellation_reason}</p>
                  )}

                  <div className="flex flex-wrap gap-2 items-center">
                    <Select value={v.status} onValueChange={(s) => handleStatusChange(v, s)}>
                      <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Pending">Pending</SelectItem>
                        <SelectItem value="Completed">Completed</SelectItem>
                        <SelectItem value="Cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>

                    <Select value={v.phlebotomist_id || ""} onValueChange={(pId) => assignPhlebotomist.mutate({ id: v.id, pId })}>
                      <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Assign..." /></SelectTrigger>
                      <SelectContent>
                        {phlebotomists.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>

                    {est?.whatsapp_number && (
                      <Button size="sm" variant="ghost" onClick={() => window.open(`https://wa.me/91${est.whatsapp_number}`, "_blank")}>
                        <Phone className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Cancel dialog */}
      <Dialog open={!!cancelDialog} onOpenChange={(o) => !o && setCancelDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cancellation Reason</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Reason *</Label><Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} required /></div>
            <Button className="w-full" disabled={!cancelReason.trim()} onClick={() => updateStatus.mutate({ id: cancelDialog?.id, status: "Cancelled", reason: cancelReason })}>
              Confirm Cancellation
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default HomeVisits;
