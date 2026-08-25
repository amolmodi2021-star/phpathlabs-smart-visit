import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePhlebotomistAvailability } from "@/hooks/usePhlebotomistAvailability";
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
import { Download, Phone, MapPin, ChevronDown, ChevronUp, Pencil, Trash2, Plus, AlertTriangle, Clock, FileImage, Eye } from "lucide-react";
import { exportToExcel } from "@/lib/excel";
import { formatDateDDMMYYYY } from "@/lib/utils";
import { useState, useCallback, useMemo, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import ExportPasswordDialog from "@/components/ExportPasswordDialog";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";
import EditHomeVisitDialog from "@/components/EditHomeVisitDialog";
import HomeVisitRegistrationWizard from "@/components/lims/HomeVisitRegistrationWizard";
import AddHomeVisitDialog from "@/components/AddHomeVisitDialog";
import { revertHomeVisitToPendingIfUnregistered } from "@/lib/homeVisitDuplicates";
import PaymentDetailsDialog from "@/components/PaymentDetailsDialog";
import ReceiptViewDialog from "@/components/ReceiptViewDialog";
import MessagePreviewDialog from "@/components/MessagePreviewDialog";
import { format, isToday, isTomorrow, parseISO, addDays } from "date-fns";
import { useAbnormalHistory } from "@/hooks/useAbnormalHistory";
import { useMessageTemplates } from "@/hooks/useMessageTemplates";
import { buildVisitMessage } from "@/lib/whatsapp";
import { patientDisplayName } from "@/lib/patientDisplayName";

const statusColors: Record<string, string> = {
  Pending: "bg-warning text-warning-foreground",
  Completed: "bg-success text-success-foreground",
  Cancelled: "bg-destructive text-destructive-foreground",
  Registered: "bg-primary text-primary-foreground",
};

const HomeVisits = () => {
  useRealtimeSync("home_visits", ["home_visits"]);
  const { getUnavailableReason } = usePhlebotomistAvailability();
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

  // Delay reason state
  const [delayReasonDialog, setDelayReasonDialog] = useState<any>(null);
  const [delayReasonType, setDelayReasonType] = useState<"custom" | "prefilled">("custom");
  const [delayReasonText, setDelayReasonText] = useState("");

  const [phlebUnlockedIds, setPhlebUnlockedIds] = useState<Set<string>>(new Set());
  const [phlebPasswordDialog, setPhlebPasswordDialog] = useState(false);
  const [pendingPhlebVisitId, setPendingPhlebVisitId] = useState<string | null>(null);
  const [statusUnlockedIds, setStatusUnlockedIds] = useState<Set<string>>(new Set());
  const [statusPasswordDialog, setStatusPasswordDialog] = useState(false);
  const [pendingStatusVisitId, setPendingStatusVisitId] = useState<string | null>(null);
  const [completionEditVisit, setCompletionEditVisit] = useState<any>(null);
  const [receiptViewVisit, setReceiptViewVisit] = useState<any>(null);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const { data: templates } = useMessageTemplates();

  // Legacy payment edit for already-completed visits (pre-redesign)
  const [consolidatedPaymentVisits, setConsolidatedPaymentVisits] = useState<any[] | null>(null);

  // Compute the date window for the server query based on the active date filter.
  // This prevents fetching the entire home_visits table as data grows.
  const queryDateWindow = useMemo(() => {
    const today = format(new Date(), "yyyy-MM-dd");
    const tomorrow = format(addDays(new Date(), 1), "yyyy-MM-dd");
    const dayAfter = format(addDays(new Date(), 2), "yyyy-MM-dd");
    if (dateFilter === "today") return { from: today, to: today };
    if (dateFilter === "tomorrow") return { from: tomorrow, to: tomorrow };
    if (dateFilter === "dayafter") return { from: dayAfter, to: dayAfter };
    return { from: filterFromDate || today, to: filterToDate || today };
  }, [dateFilter, filterFromDate, filterToDate]);

  const { data: visits = [], isLoading } = useQuery({
    queryKey: ["home_visits", queryDateWindow.from, queryDateWindow.to],
    queryFn: async () => {
      const { data } = await supabase
        .from("home_visits")
        .select("id, estimate_id, visit_date, visit_time, address, status, phlebotomist_id, cancellation_reason, created_at, estimates(id, title, patient_name, gender, email, doctor_name, dob, whatsapp_number, total_amount, discount_amount, home_visit_charges, final_amount, global_discount_type, global_discount_value, status, estimate_tests(id, test_id, test_name, price, fasting_required, discount_applicable, individual_discount_type, individual_discount_value, item_type)), phlebotomists(name, mobile)")
        .gte("visit_date", queryDateWindow.from)
        .lte("visit_date", queryDateWindow.to)
        .order("visit_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500);
      return data || [];
    },
  });

  // Heal abandoned Completed/Registered cards with zero patient registrations → Pending
  useEffect(() => {
    const candidates = (visits as any[]).filter(
      (v) => v?.id && (v.status === "Completed" || v.status === "Registered"),
    );
    if (!candidates.length) return;
    let cancelled = false;
    (async () => {
      let changed = 0;
      for (const v of candidates) {
        try {
          if (await revertHomeVisitToPendingIfUnregistered(v.id)) changed += 1;
        } catch (e) {
          console.warn("revertHomeVisitToPendingIfUnregistered failed", v.id, e);
        }
      }
      if (!cancelled && changed > 0) {
        qc.invalidateQueries({ queryKey: ["home_visits"] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visits, qc]);

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

  const isVisitDelayed = (visit: any): boolean => {
    if (visit.status !== "Pending") return false;
    const now = new Date();
    const today = format(now, "yyyy-MM-dd");
    // Only consider delayed if the visit is scheduled for today (not rescheduled to a future date)
    if (visit.visit_date !== today) return false;
    const visitDateTime = new Date(`${visit.visit_date}T${visit.visit_time || "00:00"}`);
    const diffMs = now.getTime() - visitDateTime.getTime();
    return diffMs > 25 * 60 * 1000; // 25 minutes
  };

  const checkMissingAndProceed = (visit: any) => {
    // Always open edit dialog in completion mode so user can review/update details and tests
    setCompletionEditVisit(visit);
  };

  const handleStatusChange = (visit: any, newStatus: string) => {
    if (newStatus === "Cancelled") {
      setCancelDialog(visit);
    } else if (newStatus === "Completed") {
      // Do NOT mark Completed yet — only after at least one patient is registered
      // on this same visit card (HomeVisitRegistrationWizard homeVisitPatch).
      if (isVisitDelayed(visit) && !visit.delay_reason) {
        setDelayReasonDialog(visit);
        setDelayReasonType("custom");
        setDelayReasonText("");
      } else {
        checkMissingAndProceed(visit);
      }
    } else {
      updateStatus.mutate({ id: visit.id, status: newStatus });
    }
  };

  const saveDelayReasonAndProceed = useMutation({
    mutationFn: async ({ visitId, reason }: { visitId: string; reason: string }) => {
      const { error } = await supabase.from("home_visits").update({ delay_reason: reason }).eq("id", visitId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["home_visits"] });
      const visit = delayReasonDialog;
      setDelayReasonDialog(null);
      checkMissingAndProceed(visit);
    },
    onError: (e: Error) => toast.error(e.message),
  });

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

  const saveConsolidatedPayment = useMutation({
    mutationFn: async ({ visitIds, data }: { visitIds: string[]; data: { paid_amount: number; due_amount: number; payment_mode: string; payment_remarks: string } }) => {
      const n = visitIds.length;
      if (n <= 1) {
        // Single patient — save as-is
        for (const visitId of visitIds) {
          const v = consolidatedPaymentVisits?.find((x: any) => x.id === visitId);
          const patientFinal = Number(v?.estimates?.final_amount || 0);
          const { error } = await supabase.from("home_visits").update({
            status: "Completed",
            paid_amount: data.paid_amount,
            due_amount: Math.max(0, patientFinal - data.paid_amount),
            payment_mode: data.payment_mode,
            payment_remarks: data.payment_remarks,
          }).eq("id", visitId);
          if (error) throw error;
        }
      } else {
        // Multi-patient: distribute paid amount proportionally to each patient's final_amount
        // Collect each patient's final_amount
        const patientFinals = visitIds.map(vid => {
          const v = consolidatedPaymentVisits?.find((x: any) => x.id === vid);
          return Number(v?.estimates?.final_amount || 0);
        });
        const grandTotal = patientFinals.reduce((s, f) => s + f, 0);

        // Calculate proportional paid amounts, capped at each patient's final
        const rawPaid = patientFinals.map(f => grandTotal > 0 ? Math.floor((data.paid_amount * f) / grandTotal) : 0);
        // Assign rounding remainder to primary patient (index 0)
        const rawSum = rawPaid.reduce((s, v) => s + v, 0);
        rawPaid[0] += data.paid_amount - rawSum;
        // Cap at each patient's final amount
        const patientPaids = rawPaid.map((p, i) => Math.min(p, patientFinals[i]));

        // Parse individual mode amounts from the mode string (e.g. "Cash: ₹41, GPay: ₹500")
        const modeEntries: { mode: string; amount: number }[] = [];
        if (data.payment_mode) {
          const parts = data.payment_mode.split(", ");
          for (const part of parts) {
            const colonIdx = part.indexOf(": ₹");
            if (colonIdx !== -1) {
              const mode = part.substring(0, colonIdx).trim();
              const amount = parseFloat(part.substring(colonIdx + 3)) || 0;
              modeEntries.push({ mode, amount });
            }
          }
        }
        for (let i = 0; i < n; i++) {
          const visitId = visitIds[i];
          const patientPaid = patientPaids[i];
          const patientDue = Math.max(0, patientFinals[i] - patientPaid);

          // Distribute each mode amount proportionally
          let patientModeStr = data.payment_mode;
          if (modeEntries.length > 0) {
            const distributedModes = modeEntries.map(({ mode, amount }) => {
              const rawModeAmts = patientFinals.map(f => grandTotal > 0 ? Math.floor((amount * f) / grandTotal) : 0);
              const rawModeSum = rawModeAmts.reduce((s, v) => s + v, 0);
              rawModeAmts[0] += amount - rawModeSum;
              const cappedMode = rawModeAmts.map((a, j) => Math.min(a, patientFinals[j]));
              return `${mode}: ₹${cappedMode[i]}`;
            });
            patientModeStr = distributedModes.join(", ");
          }

          const { error } = await supabase.from("home_visits").update({
            status: "Completed",
            paid_amount: patientPaid,
            due_amount: patientDue,
            payment_mode: patientModeStr,
            payment_remarks: data.payment_remarks,
          }).eq("id", visitId);
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["home_visits"] });
      toast.success(`All patients marked as Completed`);
      setConsolidatedPaymentVisits(null);
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
    if (v.status === "Completed" || v.status === "Registered") {
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
    const completed = visits.filter((v: any) => v.status === "Completed" || v.status === "Registered");
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
    exportToExcel(filteredVisits.map((v: any) => {
      const modeAmounts = parsePaymentModeAmounts(v.payment_mode);
      const delayed = isVisitDelayed(v) || (v.status === "Completed" && !!v.delay_reason);
      return {
        "Visit Date": formatDateDDMMYYYY(v.visit_date),
        "Visit Time": formatTime12hr(v.visit_time),
        "Patient": (() => { const n = patientDisplayName(v.estimates); return n === "—" ? "" : n; })(),
        "DOB": formatDateDDMMYYYY(v.estimates?.dob),
        "Mobile": v.estimates?.whatsapp_number || "",
        "Address": v.address,
        "Phlebotomist": v.phlebotomists?.name || "",
        "Status": v.status,
        "Delayed Visit": delayed ? "Yes" : "No",
        "Delay Reason": v.delay_reason || "",
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
          {["all", "Pending", "Completed", "Registered", "Cancelled"].map((s) => (
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
          {(() => {
            // Count unassigned visits in the current date-filtered set
            let dateFiltered = sortedVisits;
            if (dateFilter === "today") dateFiltered = dateFiltered.filter((v: any) => isToday(parseISO(v.visit_date)));
            else if (dateFilter === "tomorrow") dateFiltered = dateFiltered.filter((v: any) => isTomorrow(parseISO(v.visit_date)));
            else if (dateFilter === "dayafter") { const dayAfter = format(addDays(new Date(), 2), "yyyy-MM-dd"); dateFiltered = dateFiltered.filter((v: any) => v.visit_date === dayAfter); }
            else { if (filterFromDate) dateFiltered = dateFiltered.filter((v: any) => v.visit_date >= filterFromDate); if (filterToDate) dateFiltered = dateFiltered.filter((v: any) => v.visit_date <= filterToDate); }
            const unassignedCount = dateFiltered.filter((v: any) => !v.phlebotomist_id && v.status !== "Cancelled").length;
            return (
              <Button
                size="sm"
                variant={filterPhlebotomist === "unassigned" ? "default" : "outline"}
                className={`h-7 text-xs ${unassignedCount > 0 && filterPhlebotomist !== "unassigned" ? "border-destructive text-destructive font-bold" : ""} ${unassignedCount > 0 && filterPhlebotomist === "unassigned" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}`}
                onClick={() => setFilterPhlebotomist("unassigned")}
              >
                Unassigned{unassignedCount > 0 ? ` (${unassignedCount})` : ""}
              </Button>
            );
          })()}
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
            const currentStatus = v.status === "Completed" || v.status === "Cancelled" || v.status === "Registered" ? v.status : "Pending";
            const prevStatus = prevVisit ? (prevVisit.status === "Completed" || prevVisit.status === "Cancelled" || prevVisit.status === "Registered" ? prevVisit.status : "Pending") : null;
            const showDivider = idx === 0 || currentDate !== prevDate || currentStatus !== prevStatus;

            const dateLabel = isToday(parseISO(currentDate))
              ? `Today — ${formatDateDDMMYYYY(currentDate)}`
              : formatDateDDMMYYYY(currentDate);

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
              <Card className={`glass-card ${isSelected ? 'ring-2 ring-primary' : ''} ${isVisitDelayed(v) ? 'bg-destructive/10 border-destructive/30' : ''}`}>
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
                        <p className="font-medium text-sm">{patientDisplayName(est)}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <MapPin className="h-3 w-3" />{v.address}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {(v.status === "Completed" || v.status === "Registered") && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-primary" onClick={() => setReceiptViewVisit(v)}>
                          <FileImage className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                        if (templates) {
                          const tests = (est?.estimate_tests || []).map((t: any) => ({ name: t.test_name, price: Number(t.price), fasting: t.fasting_required }));
                          const msg = buildVisitMessage({
                            tests,
                            totalAmount: Number(est?.total_amount || 0),
                            discountAmount: Number(est?.discount_amount || 0),
                            homeVisitCharges: Number(est?.home_visit_charges || 0),
                            finalAmount: Number(est?.final_amount || 0),
                            header: templates.estimate_header,
                            fastingInstructions: templates.fasting_instructions,
                            noFastingMessage: templates.no_fasting_message,
                            homeVisitDisclaimer: templates.home_visit_disclaimer,
                            footer: templates.footer_text,
                            visitDate: formatDateDDMMYYYY(v.visit_date),
                            visitTime: formatTime12hr(v.visit_time),
                            visitHeader: templates.visit_confirmation_header,
                            address: v.address,
                            patientName: est?.patient_name ? est.patient_name.toUpperCase() : undefined,
                          });
                          setPreviewMessage(msg);
                        }
                      }}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditDialog(v)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Badge className={statusColors[v.status] || ""}>{v.status}</Badge>
                    </div>
                  </div>

                  {/* Date, time, phlebotomist info */}
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>{formatDateDDMMYYYY(v.visit_date)} | {formatTime12hr(v.visit_time)}</span>
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

                  {/* Delay indicator */}
                  {isVisitDelayed(v) && (
                    <div className="flex items-center gap-1 text-xs text-destructive">
                      <Clock className="h-3 w-3" />
                      <span className="font-medium">Delayed Visit</span>
                      {v.delay_reason && <span className="text-muted-foreground">— {v.delay_reason}</span>}
                    </div>
                  )}
                  {!isVisitDelayed(v) && v.delay_reason && (v.status === "Completed" || v.status === "Registered") && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>Delay Reason: {v.delay_reason}</span>
                    </div>
                  )}

                  {/* Payment details for completed / registered visits */}
                  {(v.status === "Completed" || v.status === "Registered") && v.payment_mode && (
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
                    {v.status === "Registered" ? (
                      <Badge className={statusColors["Registered"]}>Registered</Badge>
                    ) : v.status === "Completed" && !statusUnlockedIds.has(v.id) ? (
                      <div className="flex items-center gap-1">
                        <Badge className={statusColors["Completed"]}>Completed</Badge>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setPendingStatusVisitId(v.id); setStatusPasswordDialog(true); }}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                    <Select value={v.status} onValueChange={(s) => {
                      if (v.status === "Completed" && statusUnlockedIds.has(v.id)) {
                        setStatusUnlockedIds(prev => { const next = new Set(prev); next.delete(v.id); return next; });
                      }
                      handleStatusChange(v, s);
                    }}>
                      <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Pending">Pending</SelectItem>
                        <SelectItem value="Completed">Completed</SelectItem>
                        <SelectItem value="Cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                    )}

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
                          {phlebotomists.map((p: any) => {
                            const reason = getUnavailableReason(p, v.visit_date);
                            const hasTimeConflict = !reason && visits.some(
                              (ov: any) => ov.id !== v.id && ov.phlebotomist_id === p.id && ov.visit_date === v.visit_date && ov.visit_time === v.visit_time && ov.status !== "Cancelled"
                            );
                            const disableReason = reason || (hasTimeConflict ? "Time slot occupied" : null);
                            return (
                              <SelectItem key={p.id} value={p.id} disabled={!!disableReason}>
                                {p.name}{disableReason ? ` (${disableReason})` : ""}
                              </SelectItem>
                            );
                          })}
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

      {/* Completed → same New Registration form (trimmed) + multi-patient + LIMS invoices */}
      {completionEditVisit && (
        <HomeVisitRegistrationWizard
          visit={completionEditVisit}
          open={!!completionEditVisit}
          onClose={async () => {
            const visitId = completionEditVisit?.id;
            setCompletionEditVisit(null);
            // Abandoned wizard with no patient registered → stay / revert to Pending
            if (visitId) {
              try {
                await revertHomeVisitToPendingIfUnregistered(visitId);
              } catch (e) {
                console.warn("Could not revert unregistered home visit to Pending:", e);
              }
            }
            qc.invalidateQueries({ queryKey: ["home_visits"] });
          }}
        />
      )}

      <Dialog open={!!delayReasonDialog} onOpenChange={(o) => { if (!o) setDelayReasonDialog(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Visit Delayed — Reason Required</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This visit is past its scheduled time by more than 25 minutes. Please provide a reason for the delay before proceeding.</p>
          <div className="space-y-4">
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="delayType" checked={delayReasonType === "custom"} onChange={() => setDelayReasonType("custom")} />
                <span className="text-sm">Enter reason</span>
              </label>
              {delayReasonType === "custom" && (
                <Textarea value={delayReasonText} onChange={(e) => setDelayReasonText(e.target.value)} placeholder="Enter delay reason..." rows={3} />
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="delayType" checked={delayReasonType === "prefilled"} onChange={() => setDelayReasonType("prefilled")} />
                <span className="text-sm">Other</span>
              </label>
              {delayReasonType === "prefilled" && (
                <div className="bg-muted rounded p-2 text-sm text-muted-foreground italic">
                  "Sorry Sir, Yeh meri galti hai"
                </div>
              )}
            </div>
            <Button
              className="w-full"
              disabled={delayReasonType === "custom" && !delayReasonText.trim() || saveDelayReasonAndProceed.isPending}
              onClick={() => {
                const reason = delayReasonType === "prefilled" ? "Sorry Sir, Yeh meri galti hai" : delayReasonText.trim();
                saveDelayReasonAndProceed.mutate({ visitId: delayReasonDialog.id, reason });
              }}
            >
              {saveDelayReasonAndProceed.isPending ? "Saving..." : "Submit & Proceed to Registration"}
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
        description={`Delete ${selectedIds.size} home visit${selectedIds.size !== 1 ? "s" : ""}? This cannot be undone.`}
      />

      <ExportPasswordDialog open={exportDialog} onOpenChange={setExportDialog} onSuccess={handleExport} />
      {addVisitOpen && (
        <AddHomeVisitDialog open={addVisitOpen} onClose={() => setAddVisitOpen(false)} />
      )}

      {/* Payment details dialog for marking as Completed */}
      {paymentVisit && (
        <PaymentDetailsDialog
          open={!!paymentVisit}
          onClose={() => setPaymentVisit(null)}
          finalAmount={paymentVisit.estimates?.final_amount || 0}
          isPending={savePaymentAndComplete.isPending}
          onSave={(data) => savePaymentAndComplete.mutate({ visitId: paymentVisit.id, data })}
          visitData={paymentVisit}
        />
      )}

      {/* Consolidated payment dialog for multi-patient visits */}
      {consolidatedPaymentVisits && consolidatedPaymentVisits.length > 0 && (() => {
        const grandTotal = consolidatedPaymentVisits.reduce((sum: number, v: any) => sum + Number(v.estimates?.final_amount || 0), 0);
        return (
          <PaymentDetailsDialog
            open={true}
            onClose={() => setConsolidatedPaymentVisits(null)}
            finalAmount={grandTotal}
            isPending={saveConsolidatedPayment.isPending}
            onSave={(data) => saveConsolidatedPayment.mutate({ visitIds: consolidatedPaymentVisits.map((v: any) => v.id), data })}
            visitData={consolidatedPaymentVisits[0]}
            consolidatedVisits={consolidatedPaymentVisits}
          />
        );
      })()}


      {/* Password dialog for editing completed visits */}
      <DeletePasswordDialog
        open={editPasswordDialog}
        onOpenChange={(o) => { setEditPasswordDialog(o); if (!o) setPendingEditVisit(null); }}
        onSuccess={() => { setEditVisit(pendingEditVisit); setPendingEditVisit(null); }}
        description="Enter password to edit a completed or registered visit record."
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
          visitData={editPaymentVisit}
        />
      )}


      {/* Password dialog for phlebotomist change on completed visits */}
      <DeletePasswordDialog
        open={phlebPasswordDialog}
        onOpenChange={(o) => { setPhlebPasswordDialog(o); if (!o) setPendingPhlebVisitId(null); }}
        onSuccess={() => { if (pendingPhlebVisitId) setPhlebUnlockedIds(prev => new Set(prev).add(pendingPhlebVisitId)); setPendingPhlebVisitId(null); }}
        description="Enter password to change phlebotomist for a completed visit."
      />
      {/* Password dialog for status change on completed visits */}
      <DeletePasswordDialog
        open={statusPasswordDialog}
        onOpenChange={(o) => { setStatusPasswordDialog(o); if (!o) setPendingStatusVisitId(null); }}
        onSuccess={() => { if (pendingStatusVisitId) setStatusUnlockedIds(prev => new Set(prev).add(pendingStatusVisitId)); setPendingStatusVisitId(null); }}
        description="Enter password to change the status of a completed visit."
      />
      {/* Receipt view dialog for completed visits */}
      <ReceiptViewDialog
        open={!!receiptViewVisit}
        onClose={() => setReceiptViewVisit(null)}
        visitData={receiptViewVisit}
      />
      <MessagePreviewDialog open={!!previewMessage} onOpenChange={(o) => !o && setPreviewMessage(null)} title="Home Visit Confirmation Message" message={previewMessage || ""} />
    </div>
  );
};

export default HomeVisits;
