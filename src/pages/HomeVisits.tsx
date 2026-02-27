import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Download, Phone, MapPin, ChevronDown, ChevronUp, Pencil, Trash2, Plus, AlertTriangle } from "lucide-react";
import { exportToExcel } from "@/lib/excel";
import { useState, useCallback, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import ExportPasswordDialog from "@/components/ExportPasswordDialog";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";
import EditHomeVisitDialog from "@/components/EditHomeVisitDialog";
import AddHomeVisitDialog from "@/components/AddHomeVisitDialog";
import PaymentDetailsDialog from "@/components/PaymentDetailsDialog";
import { format, isToday, isTomorrow, parseISO, addDays } from "date-fns";
import { useAbnormalHistory } from "@/hooks/useAbnormalHistory";

const statusColors: Record<string, string> = {
  Pending: "bg-warning text-warning-foreground",
  Completed: "bg-success text-success-foreground",
  Cancelled: "bg-destructive text-destructive-foreground",
};

const HomeVisits = () => {
  useRealtimeSync("home_visits", ["home_visits"]);
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
  const [addVisitOpen, setAddVisitOpen] = useState(false);
  const [dateFilter, setDateFilter] = useState<"today" | "tomorrow" | "dayafter" | "range">("today");
  const [filterFromDate, setFilterFromDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [filterToDate, setFilterToDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterPhlebotomist, setFilterPhlebotomist] = useState<string>("all");
  const [paymentVisit, setPaymentVisit] = useState<any>(null);
  const [editPasswordDialog, setEditPasswordDialog] = useState(false);
  const [pendingEditVisit, setPendingEditVisit] = useState<any>(null);
  const [editPaymentVisit, setEditPaymentVisit] = useState<any>(null);
  const [editPaymentPasswordDialog, setEditPaymentPasswordDialog] = useState(false);
  const [pendingEditPaymentVisit, setPendingEditPaymentVisit] = useState<any>(null);
  const [phlebUnlockedIds, setPhlebUnlockedIds] = useState<Set<string>>(new Set());
  const [phlebPasswordDialog, setPhlebPasswordDialog] = useState(false);
  const [pendingPhlebVisitId, setPendingPhlebVisitId] = useState<string | null>(null);


  const { data: visits = [], isLoading } = useQuery({
    queryKey: ["home_visits"],
    queryFn: async () => {
      const { data } = await supabase.from("home_visits").select("*, estimates(*, estimate_tests(*)), phlebotomists(name, mobile)").order("visit_date", { ascending: false }).order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { getForMobile, sendMutation: abnormalSend } = useAbnormalHistory((visits as any[]).map((v: any) => v.estimates?.whatsapp_number));

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
    onSuccess: (_, variables) => { qc.invalidateQueries({ queryKey: ["home_visits"] }); toast.success("Assigned"); setAssignSelectOpenFor(null); setPhlebUnlockedIds(prev => { const next = new Set(prev); next.delete(variables.id); return next; }); },
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
    } else if (newStatus === "Completed") {
      setPaymentVisit(visit);
    } else {
      updateStatus.mutate({ id: visit.id, status: newStatus });
    }
  };

  const savePaymentAndComplete = useMutation({
    mutationFn: async ({ visitId, data }: { visitId: string; data: { paid_amount: number; due_amount: number; payment_mode: string; payment_remarks: string } }) => {
      const { error } = await supabase.from("home_visits").update({
        status: "Completed",
        paid_amount: data.paid_amount,
        due_amount: data.due_amount,
        payment_mode: data.payment_mode,
        payment_remarks: data.payment_remarks,
      }).eq("id", visitId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["home_visits"] });
      toast.success("Marked as Completed");
      setPaymentVisit(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updatePaymentDetails = useMutation({
    mutationFn: async ({ visitId, data }: { visitId: string; data: { paid_amount: number; due_amount: number; payment_mode: string; payment_remarks: string } }) => {
      const { error } = await supabase.from("home_visits").update({
        paid_amount: data.paid_amount,
        due_amount: data.due_amount,
        payment_mode: data.payment_mode,
        payment_remarks: data.payment_remarks,
      }).eq("id", visitId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["home_visits"] });
      toast.success("Payment details updated");
      setEditPaymentVisit(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openEditDialog = (v: any) => {
    if (v.status === "Completed") {
      setPendingEditVisit(v);
      setEditPasswordDialog(true);
    } else {
      setEditVisit(v);
    }
  };

  const openEditPaymentDialog = (v: any) => {
    setPendingEditPaymentVisit(v);
    setEditPaymentPasswordDialog(true);
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
    let result = sortedVisits;

    // Date filter
    if (dateFilter === "today") {
      result = result.filter((v: any) => isToday(parseISO(v.visit_date)));
    } else if (dateFilter === "tomorrow") {
      result = result.filter((v: any) => isTomorrow(parseISO(v.visit_date)));
    } else if (dateFilter === "dayafter") {
      const dayAfter = format(addDays(new Date(), 2), "yyyy-MM-dd");
      result = result.filter((v: any) => v.visit_date === dayAfter);
    } else {
      if (filterFromDate) result = result.filter((v: any) => v.visit_date >= filterFromDate);
      if (filterToDate) result = result.filter((v: any) => v.visit_date <= filterToDate);
    }

    // Status filter
    if (filterStatus !== "all") {
      result = result.filter((v: any) => v.status === filterStatus);
    }

    // Phlebotomist filter
    if (filterPhlebotomist !== "all") {
      if (filterPhlebotomist === "unassigned") {
        result = result.filter((v: any) => !v.phlebotomist_id);
      } else {
        result = result.filter((v: any) => v.phlebotomist_id === filterPhlebotomist);
      }
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((v: any) => {
        const name = (v.estimates?.patient_name || "").toLowerCase();
        const mobile = v.estimates?.whatsapp_number || "";
        return name.includes(q) || mobile.includes(q);
      });
    }

    return result;
  }, [sortedVisits, search, dateFilter, filterFromDate, filterToDate, filterStatus, filterPhlebotomist]);

  const parsePaymentModeAmounts = (paymentMode: string | null) => {
    const result = { Cash: 0, "Credit Card": 0, GPay: 0, Paytm: 0 };
    if (!paymentMode) return result;
    const parts = paymentMode.split(", ");
    for (const part of parts) {
      const colonIdx = part.indexOf(": ₹");
      if (colonIdx !== -1) {
        const mode = part.substring(0, colonIdx).trim();
        const amount = parseFloat(part.substring(colonIdx + 3)) || 0;
        if (mode in result) (result as any)[mode] = amount;
      }
    }
    return result;
  };

  const handleExport = () => {
    exportToExcel(visits.map((v: any) => {
      const modeAmounts = parsePaymentModeAmounts(v.payment_mode);
      return {
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
        "Paid Amount": v.paid_amount || 0,
        "Due Amount": v.due_amount || 0,
        "Cash": modeAmounts.Cash,
        "Credit Card": modeAmounts["Credit Card"],
        "GPay": modeAmounts.GPay,
        "Paytm": modeAmounts.Paytm,
        "Payment Remarks": v.payment_remarks || "",
      };
    }), "home_visits_export");
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

      {/* Filter Bars */}
      <div className="space-y-2">
        {/* Date Filter */}
        <div className="flex flex-wrap items-center gap-2 bg-muted/50 rounded-lg p-2">
          <span className="text-xs font-medium text-muted-foreground min-w-[40px]">Date:</span>
          <Button
            size="sm"
            variant={dateFilter === "today" ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setDateFilter("today")}
          >
            Today
          </Button>
          <Button
            size="sm"
            variant={dateFilter === "tomorrow" ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setDateFilter("tomorrow")}
          >
            Tomorrow
          </Button>
          <Button
            size="sm"
            variant={dateFilter === "dayafter" ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setDateFilter("dayafter")}
          >
            Day After
          </Button>
          <Button
            size="sm"
            variant={dateFilter === "range" ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setDateFilter("range")}
          >
            Date Range
          </Button>
          {dateFilter === "range" && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Input
                type="date"
                value={filterFromDate}
                onChange={(e) => setFilterFromDate(e.target.value)}
                className="h-7 text-xs w-[130px]"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                value={filterToDate}
                onChange={(e) => setFilterToDate(e.target.value)}
                className="h-7 text-xs w-[130px]"
              />
            </div>
          )}
        </div>

        {/* Status Filter */}
        <div className="flex flex-wrap items-center gap-2 bg-muted/50 rounded-lg p-2">
          <span className="text-xs font-medium text-muted-foreground min-w-[40px]">Status:</span>
          {["all", "Pending", "Completed", "Cancelled"].map((s) => (
            <Button
              key={s}
              size="sm"
              variant={filterStatus === s ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => setFilterStatus(s)}
            >
              {s === "all" ? "All" : s}
            </Button>
          ))}
        </div>

        {/* Phlebotomist Filter */}
        <div className="flex flex-wrap items-center gap-2 bg-muted/50 rounded-lg p-2">
          <span className="text-xs font-medium text-muted-foreground min-w-[40px]">Phleb:</span>
          <Button
            size="sm"
            variant={filterPhlebotomist === "all" ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setFilterPhlebotomist("all")}
          >
            All
          </Button>
          <Button
            size="sm"
            variant={filterPhlebotomist === "unassigned" ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setFilterPhlebotomist("unassigned")}
          >
            Unassigned
          </Button>
          {phlebotomists.map((p: any) => (
            <Button
              key={p.id}
              size="sm"
              variant={filterPhlebotomist === p.id ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => setFilterPhlebotomist(p.id)}
            >
              {p.name}
            </Button>
          ))}
        </div>
      </div>

      <Button size="sm" className="w-full" onClick={() => setAddVisitOpen(true)}>
        <Plus className="h-4 w-4 mr-1" />Add New Home Visit
      </Button>


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

                  {/* Payment details for completed visits */}
                  {v.status === "Completed" && v.payment_mode && (
                    <div className="bg-muted/50 rounded-lg p-2 space-y-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">Payment Details</span>
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => openEditPaymentDialog(v)}>
                          <Pencil className="h-3 w-3 mr-1" />Edit
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <span className="text-muted-foreground">Paid: <span className="text-foreground font-medium">₹{v.paid_amount || 0}</span></span>
                        <span className="text-muted-foreground">Due: <span className={`font-medium ${(v.due_amount || 0) > 0 ? 'text-destructive' : 'text-success'}`}>₹{v.due_amount || 0}</span></span>
                        <span className="text-muted-foreground">Mode: <span className="text-foreground font-medium">{v.payment_mode}</span></span>
                        {v.payment_remarks && <span className="text-muted-foreground col-span-2">Remarks: {v.payment_remarks}</span>}
                      </div>
                    </div>
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

                    {v.status === "Completed" && !phlebUnlockedIds.has(v.id) ? (
                      <div className="flex items-center gap-1">
                        {v.phlebotomists ? (
                          <span className="text-xs text-muted-foreground px-2 py-1 bg-muted/50 rounded">{v.phlebotomists.name}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground px-2 py-1">No phlebotomist</span>
                        )}
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setPendingPhlebVisitId(v.id); setPhlebPasswordDialog(true); }}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
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
                    )}

                    {est?.whatsapp_number && (
                      <a href={`tel:${est.whatsapp_number}`} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                        <Phone className="h-3.5 w-3.5" />
                        <span>{est.whatsapp_number}</span>
                      </a>
                    )}
                  </div>

                  {/* Abnormal history icon */}
                  {est?.whatsapp_number && (() => {
                    const abnormal = getForMobile(est.whatsapp_number);
                    return abnormal ? (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-6 px-1 text-warning" onClick={() => abnormalSend.mutate({ id: abnormal.id, mobile: est.whatsapp_number, message: abnormal.message, context: "home_visit" })}>
                          <AlertTriangle className="h-3.5 w-3.5" />
                        </Button>
                        {abnormal.sent_at && <span className="text-[9px] text-muted-foreground leading-none">{format(new Date(abnormal.sent_at), "dd-MM HH:mm")}</span>}
                      </div>
                    ) : null;
                  })()}
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

      {/* Delete password dialog */}
      <DeletePasswordDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        onSuccess={() => deleteVisits.mutate(Array.from(selectedIds))}
        description={`Delete ${selectedIds.size} home visit${selectedIds.size !== 1 ? 's' : ''}? This cannot be undone.`}
      />

      <ExportPasswordDialog open={exportDialog} onOpenChange={setExportDialog} onSuccess={handleExport} />
      <AddHomeVisitDialog open={addVisitOpen} onClose={() => setAddVisitOpen(false)} />

      {/* Payment details dialog for marking as Completed */}
      {paymentVisit && (
        <PaymentDetailsDialog
          open={!!paymentVisit}
          onClose={() => setPaymentVisit(null)}
          finalAmount={paymentVisit.estimates?.final_amount || 0}
          isPending={savePaymentAndComplete.isPending}
          onSave={(data) => savePaymentAndComplete.mutate({ visitId: paymentVisit.id, data })}
        />
      )}

      {/* Password dialog for editing completed visits */}
      <DeletePasswordDialog
        open={editPasswordDialog}
        onOpenChange={(o) => { setEditPasswordDialog(o); if (!o) setPendingEditVisit(null); }}
        onSuccess={() => { setEditVisit(pendingEditVisit); setPendingEditVisit(null); }}
        description="Enter password to edit a completed visit record."
      />

      {/* Password dialog for editing payment details of completed visits */}
      <DeletePasswordDialog
        open={editPaymentPasswordDialog}
        onOpenChange={(o) => { setEditPaymentPasswordDialog(o); if (!o) setPendingEditPaymentVisit(null); }}
        onSuccess={() => { setEditPaymentVisit(pendingEditPaymentVisit); setPendingEditPaymentVisit(null); }}
        description="Enter password to edit payment details."
      />

      {/* Edit payment details dialog */}
      {editPaymentVisit && (
        <PaymentDetailsDialog
          open={!!editPaymentVisit}
          onClose={() => setEditPaymentVisit(null)}
          finalAmount={editPaymentVisit.estimates?.final_amount || 0}
          isPending={updatePaymentDetails.isPending}
          initialData={{
            paid_amount: editPaymentVisit.paid_amount || 0,
            payment_mode: editPaymentVisit.payment_mode || "",
            payment_remarks: editPaymentVisit.payment_remarks || "",
          }}
          onSave={(data) => updatePaymentDetails.mutate({ visitId: editPaymentVisit.id, data })}
        />
      )}

      {/* Password dialog for phlebotomist change on completed visits */}
      <DeletePasswordDialog
        open={phlebPasswordDialog}
        onOpenChange={(o) => { setPhlebPasswordDialog(o); if (!o) setPendingPhlebVisitId(null); }}
        onSuccess={() => { if (pendingPhlebVisitId) setPhlebUnlockedIds(prev => new Set(prev).add(pendingPhlebVisitId)); setPendingPhlebVisitId(null); }}
        description="Enter password to change phlebotomist for a completed visit."
      />
    </div>
  );
};

export default HomeVisits;
