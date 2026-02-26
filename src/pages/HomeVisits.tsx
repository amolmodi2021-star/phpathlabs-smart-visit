import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Download, Phone, MapPin, ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react";
import { exportToExcel } from "@/lib/excel";
import { useState, useCallback, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import ExportPasswordDialog from "@/components/ExportPasswordDialog";
import EditHomeVisitDialog from "@/components/EditHomeVisitDialog";
import { format, isToday, parseISO } from "date-fns";

const statusColors: Record<string, string> = {
  Pending: "bg-warning text-warning-foreground",
  Completed: "bg-success text-success-foreground",
  Cancelled: "bg-destructive text-destructive-foreground",
};

const HomeVisits = () => {
  const qc = useQueryClient();
  const [cancelDialog, setCancelDialog] = useState<any>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [exportDialog, setExportDialog] = useState(false);
  const [assignSelectOpenFor, setAssignSelectOpenFor] = useState<string | null>(null);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editVisit, setEditVisit] = useState<any>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data: visits = [], isLoading } = useQuery({
    queryKey: ["home_visits"],
    queryFn: async () => {
      const { data } = await supabase.from("home_visits").select("*, estimates(*, estimate_tests(*)), phlebotomists(name, mobile)").order("visit_date", { ascending: false }).order("created_at", { ascending: false });
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["home_visits"] }); toast.success("Assigned"); setAssignSelectOpenFor(null); },
    onError: (e: Error) => toast.error(e.message),
  });


  const deleteVisits = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from("home_visits").delete().in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["home_visits"] }); toast.success("Deleted"); setSelectedIds(new Set()); setDeleteConfirmOpen(false); },
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

  const toggleExpand = useCallback((id: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === visits.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visits.map((v: any) => v.id)));
    }
  }, [selectedIds.size, visits]);

  const openEditDialog = (v: any) => setEditVisit(v);

  // Sort: Today's visits (time asc) → Pending (date+time asc) → Completed (date+time desc)
  const sortedVisits = useMemo(() => {
    const toTime = (v: any) => {
      const [h, m] = (v.visit_time || "00:00").split(":");
      return parseInt(h) * 60 + parseInt(m);
    };
    const toDateTime = (v: any) => new Date(`${v.visit_date}T${v.visit_time || "00:00"}`).getTime();

    const todayPending = visits.filter((v: any) => v.status === "Pending" && isToday(parseISO(v.visit_date)));
    const otherPending = visits.filter((v: any) => v.status === "Pending" && !isToday(parseISO(v.visit_date)));
    const completed = visits.filter((v: any) => v.status === "Completed");
    const cancelled = visits.filter((v: any) => v.status === "Cancelled");

    todayPending.sort((a: any, b: any) => toTime(a) - toTime(b));
    otherPending.sort((a: any, b: any) => toDateTime(a) - toDateTime(b));
    completed.sort((a: any, b: any) => toDateTime(b) - toDateTime(a));
    cancelled.sort((a: any, b: any) => toDateTime(b) - toDateTime(a));

    return [...todayPending, ...otherPending, ...completed, ...cancelled];
  }, [visits]);

  const filteredVisits = useMemo(() => {
    if (!search.trim()) return sortedVisits;
    const q = search.toLowerCase();
    return sortedVisits.filter((v: any) => {
      const name = (v.estimates?.patient_name || "").toLowerCase();
      const mobile = v.estimates?.whatsapp_number || "";
      return name.includes(q) || mobile.includes(q);
    });
  }, [sortedVisits, search]);

  const handleExport = () => {
    exportToExcel(visits.map((v: any) => ({
      "Visit Date": v.visit_date,
      "Visit Time": formatTime12hr(v.visit_time),
      "Patient": v.estimates?.patient_name || "",
      "Mobile": v.estimates?.whatsapp_number || "",
      "Address": v.address,
      "Phlebotomist": v.phlebotomists?.name || "",
      "Status": v.status,
      "Total Amount": v.estimates?.total_amount || 0,
      "Discount": v.estimates?.discount_amount || 0,
      "Home Visit Charges": v.estimates?.home_visit_charges || 0,
      "Final Amount": v.estimates?.final_amount || 0,
    })), "home_visits_export");
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold">Home Visits</h1>
        <div className="flex gap-2">
          {selectedIds.size > 0 && (
            <Button size="sm" variant="destructive" onClick={() => setDeleteConfirmOpen(true)}>
              <Trash2 className="h-4 w-4 mr-1" />Delete ({selectedIds.size})
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setExportDialog(true)}><Download className="h-4 w-4 mr-1" />Excel</Button>
        </div>
      </div>

      <Input placeholder="Search by patient name or mobile number..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full" />

      {/* Select All */}
      {filteredVisits.length > 0 && (
        <div className="flex items-center gap-2">
          <Checkbox
            checked={selectedIds.size === filteredVisits.length && filteredVisits.length > 0}
            onCheckedChange={toggleSelectAll}
          />
          <span className="text-xs text-muted-foreground">Select All ({filteredVisits.length})</span>
        </div>
      )}

      {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : filteredVisits.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No home visits yet.</p>
      ) : (
        <div className="grid gap-2">
          {filteredVisits.map((v: any, idx: number) => {
            const est = v.estimates;
            const tests = est?.estimate_tests || [];
            const isExpanded = expandedCards.has(v.id);
            const isSelected = selectedIds.has(v.id);

            // Date divider logic
            const prevVisit = idx > 0 ? filteredVisits[idx - 1] : null;
            const currentDate = v.visit_date;
            const prevDate = prevVisit?.visit_date;
            const currentStatus = v.status === "Completed" || v.status === "Cancelled" ? v.status : "Pending";
            const prevStatus = prevVisit ? (prevVisit.status === "Completed" || prevVisit.status === "Cancelled" ? prevVisit.status : "Pending") : null;
            const showDivider = idx === 0 || currentDate !== prevDate || currentStatus !== prevStatus;

            const dateLabel = isToday(parseISO(currentDate))
              ? `Today — ${format(parseISO(currentDate), "dd MMM yyyy")}`
              : format(parseISO(currentDate), "dd MMM yyyy");

            return (
              <div key={v.id}>
                {showDivider && (
                  <div className="flex items-center gap-3 mt-5 mb-3">
                    <Separator className={`flex-1 h-[2px] ${isToday(parseISO(currentDate)) ? 'bg-success' : 'bg-foreground/30'}`} />
                    <span className={`text-sm font-semibold whitespace-nowrap px-3 py-1 rounded-full ${isToday(parseISO(currentDate)) ? 'bg-success text-success-foreground' : 'text-foreground bg-muted'}`}>
                      {currentStatus !== "Pending" ? `${currentStatus} — ${dateLabel}` : dateLabel}
                    </span>
                    <Separator className={`flex-1 h-[2px] ${isToday(parseISO(currentDate)) ? 'bg-success' : 'bg-foreground/30'}`} />
                  </div>
                )}
              <Card className={`glass-card ${isSelected ? 'ring-2 ring-primary' : ''}`}>
                <CardContent className="p-3 space-y-2">
                  {/* Header row */}
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div className="flex items-start gap-2">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(v.id)}
                        className="mt-1"
                      />
                      <div>
                        <p className="font-medium text-sm">{est?.patient_name || "—"}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <MapPin className="h-3 w-3" />{v.address}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditDialog(v)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Badge className={statusColors[v.status] || ""}>{v.status}</Badge>
                    </div>
                  </div>

                  {/* Date, time, phlebotomist info */}
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>{v.visit_date} | {formatTime12hr(v.visit_time)}</span>
                    {v.phlebotomists && <span>• {v.phlebotomists.name}</span>}
                  </div>

                  {/* Amounts row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-xs">
                    <div className="bg-muted/50 rounded px-2 py-1">
                      <span className="text-muted-foreground">Total: </span>
                      <span className="font-medium">₹{est?.total_amount || 0}</span>
                    </div>
                    <div className="bg-muted/50 rounded px-2 py-1">
                      <span className="text-muted-foreground">Discount: </span>
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">₹{est?.discount_amount || 0}</span>
                    </div>
                    <div className="bg-muted/50 rounded px-2 py-1">
                      <span className="text-muted-foreground">Visit: </span>
                      <span className="font-medium">₹{est?.home_visit_charges || 0}</span>
                    </div>
                    <div className="bg-muted/50 rounded px-2 py-1">
                      <span className="text-muted-foreground">Final: </span>
                      <span className="font-semibold text-primary">₹{est?.final_amount || 0}</span>
                    </div>
                  </div>

                  {/* Expand/Collapse tests */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs w-full justify-center gap-1"
                    onClick={() => toggleExpand(v.id)}
                  >
                    {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {tests.length} Test{tests.length !== 1 ? 's' : ''} Booked
                  </Button>

                  {isExpanded && tests.length > 0 && (
                    <div className="bg-muted/30 rounded p-2 space-y-1">
                      {tests.map((t: any, i: number) => (
                        <div key={t.id} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">{i + 1}.</span>
                            <span>{t.test_name}</span>
                            {t.fasting_required && <Badge variant="outline" className="text-[10px] px-1 py-0">Fasting</Badge>}
                          </div>
                          <div className="flex items-center gap-2">
                            {t.price !== t.discounted_price && (
                              <span className="line-through text-muted-foreground">₹{t.price}</span>
                            )}
                            <span className="font-medium">₹{t.discounted_price}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {v.status === "Cancelled" && v.cancellation_reason && (
                    <p className="text-xs text-destructive">Reason: {v.cancellation_reason}</p>
                  )}

                  {/* Actions row */}
                  <div className="flex flex-wrap gap-2 items-center">
                    <Select value={v.status} onValueChange={(s) => handleStatusChange(v, s)}>
                      <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Pending">Pending</SelectItem>
                        <SelectItem value="Completed">Completed</SelectItem>
                        <SelectItem value="Cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>

                    <Select
                      value={v.phlebotomist_id || ""}
                      onOpenChange={(open) => setAssignSelectOpenFor(open ? v.id : (assignSelectOpenFor === v.id ? null : assignSelectOpenFor))}
                      onValueChange={(pId) => { if (assignSelectOpenFor !== v.id) return; if (pId !== (v.phlebotomist_id || "")) assignPhlebotomist.mutate({ id: v.id, pId }); }}
                    >
                      <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Assign..." /></SelectTrigger>
                      <SelectContent>
                        {phlebotomists.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>

                    {est?.whatsapp_number && (
                      <a href={`tel:${est.whatsapp_number}`} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                        <Phone className="h-3.5 w-3.5" />
                        <span>{est.whatsapp_number}</span>
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
              </div>
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

      {/* Edit dialog */}
      <EditHomeVisitDialog visit={editVisit} open={!!editVisit} onClose={() => setEditVisit(null)} />

      {/* Delete confirmation dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirm Delete</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete {selectedIds.size} home visit{selectedIds.size !== 1 ? 's' : ''}? This action cannot be undone.
          </p>
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteVisits.mutate(Array.from(selectedIds))}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ExportPasswordDialog open={exportDialog} onOpenChange={setExportDialog} onSuccess={handleExport} />
    </div>
  );
};

export default HomeVisits;
