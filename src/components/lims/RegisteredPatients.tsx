import { useState } from "react";
import { isActionAllowed } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, ChevronLeft, ChevronRight, Pencil, Download, Eye, ChevronDown, ChevronUp, Trash2, CalendarIcon, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { exportToExcel } from "@/lib/excel";
import ExportPasswordDialog from "@/components/ExportPasswordDialog";
import EditRegistrationDialog from "./EditRegistrationDialog";
import InvoicePreview from "./InvoicePreview";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

const RegisteredPatients = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [editReg, setEditReg] = useState<any>(null);
  const [viewBillReg, setViewBillReg] = useState<any>(null);
  const [showExportPwd, setShowExportPwd] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [showClearPwd, setShowClearPwd] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>();

  const registrationSearchFilter = debouncedSearch
    ? `patient_name.ilike.%${debouncedSearch}%,mobile_number.ilike.%${debouncedSearch}%,invoice_number.ilike.%${debouncedSearch}%,umr_number.ilike.%${debouncedSearch}%`
    : "";

  const fromIso = fromDate ? new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate(), 0, 0, 0).toISOString() : null;
  const toIso = toDate ? new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 23, 59, 59, 999).toISOString() : null;

  const handleSearch = (val: string) => {
    setSearch(val);
    setPage(0);
    clearTimeout((window as any).__regSearchTimeout);
    (window as any).__regSearchTimeout = setTimeout(() => setDebouncedSearch(val), 400);
  };

  const handleFromDate = (d: Date | undefined) => { setFromDate(d); setPage(0); };
  const handleToDate = (d: Date | undefined) => { setToDate(d); setPage(0); };
  const clearDates = () => { setFromDate(undefined); setToDate(undefined); setPage(0); };

  const { data: channels = [] } = useQuery({
    queryKey: ["channels_lookup"],
    queryFn: async () => {
      const { data } = await supabase.from("channels").select("id, name");
      return (data || []) as { id: string; name: string }[];
    },
  });

  const channelMap = Object.fromEntries(channels.map(c => [c.id, c.name]));

  const { data: count = 0 } = useQuery({
    queryKey: ["patient_registrations_count", debouncedSearch, fromIso, toIso],
    queryFn: async () => {
      let query = supabase.from("patient_registrations").select("id", { count: "exact", head: true });
      if (registrationSearchFilter) query = query.or(registrationSearchFilter);
      if (fromIso) query = query.gte("created_at", fromIso);
      if (toIso) query = query.lte("created_at", toIso);
      const { count, error } = await query;
      if (error) throw error;
      return count || 0;
    },
  });

  const { data: registrations = [], isLoading } = useQuery({
    queryKey: ["patient_registrations", page, debouncedSearch, fromIso, toIso],
    queryFn: async () => {
      let query = supabase
        .from("patient_registrations")
        .select("*")
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (registrationSearchFilter) query = query.or(registrationSearchFilter);
      if (fromIso) query = query.gte("created_at", fromIso);
      if (toIso) query = query.lte("created_at", toIso);
      const { data, error } = await query;
      if (error) throw error;
      const rows = (data || []) as any[];
      rows.sort((a: any, b: any) => {
        const aUrgent = a.is_stat && !a.bill_cancelled && a.status !== "dispatched" ? 1 : 0;
        const bUrgent = b.is_stat && !b.bill_cancelled && b.status !== "dispatched" ? 1 : 0;
        return bUrgent - aUrgent;
      });
      return rows;
    },
  });

  const totalPages = Math.ceil(count / PAGE_SIZE);

  const statusColor = (s: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (s) {
      case "registered": return "secondary";
      case "partially_collected": return "outline";
      case "sample_collected": return "default";
      case "partially_accepted": return "outline";
      case "sample_accepted": return "default";
      case "processing": case "partial_processing": return "outline";
      case "processed": return "default";
      case "partial_verified": return "outline";
      case "verified": return "default";
      case "partially_approved": return "outline";
      case "approved": return "default";
      case "partially_dispatched": return "outline";
      case "dispatched": return "default";
      case "repeat_collection": return "destructive";
      case "cancelled": return "destructive";
      default: return "secondary";
    }
  };

  const statusLabel = (s: string) => {
    const labels: Record<string, string> = {
      registered: "Registered", partially_collected: "Partial Collection", sample_collected: "Collected",
      partially_accepted: "Partial Accepted", sample_accepted: "Accepted",
      processing: "Processing", partial_processing: "Partial Processing", processed: "Processed",
      partial_verified: "Partial Verified", verified: "Verified",
      partially_approved: "Partial Approved", approved: "Approved",
      partially_dispatched: "Partial Dispatched", dispatched: "Dispatched",
      repeat_collection: "Repeat Collection",
    };
    return labels[s] || s;
  };

  const visitTypeLabel = (v: string) => {
    switch (v) {
      case "lab_visit": return "Lab";
      case "home_visit": return "Home";
      case "pickup_point": return "Pickup";
      default: return v || "—";
    }
  };

  const handleExport = async () => {
    try {
      toast.info("Fetching all registrations...");
      const { data, error } = await supabase.rpc("get_all_patient_registrations" as any, { p_search: "" });
      if (error) throw error;
      const rows = (data || []).map((r: any) => {
        const testList = Array.isArray(r.tests) ? r.tests : [];
        const cancelledTests = Array.isArray(r.cancelled_tests) ? r.cancelled_tests : [];
        const payments = Array.isArray(r.payments) ? r.payments : [];
        return {
          "Invoice #": r.invoice_number,
          "Date": r.created_at ? format(new Date(r.created_at), "dd-MM-yyyy hh:mm a") : "",
          "Title": r.title || "",
          "Patient Name": r.patient_name,
          "Gender": r.gender || "",
          "DOB": r.dob || "",
          "Mobile": r.mobile_number,
          "Email": r.email || "",
          "Doctor": r.doctor_name || "",
          "UMR": r.umr_number || "",
          "Address": r.address || "",
          "Visit Type": r.visit_type || "",
          "Tests": testList.map((t: any) => t.test_name).join(", "),
          "Created By": r.registered_by || "",
          "Gross Amount": r.gross_amount,
          "Discount": r.discount_amount,
          "Home Visit Charges": r.home_visit_charges,
          "Net Amount": r.net_amount,
          "Final Amount": r.final_amount,
          "Payment Modes": payments.map((p: any) => `${p.mode}: ₹${p.amount}`).join(", "),
          "Paid Amount": r.paid_amount,
          "Due Amount": r.due_amount,
          "Status": r.status,
          "Cancelled Tests": cancelledTests.map((t: any) => t.test_name || t.test_id).join(", "),
          "Refund Amount": r.refund_amount || 0,
          "Refund Mode": r.refund_mode || "",
          "Refund Date": r.refund_date ? format(new Date(r.refund_date), "dd-MM-yyyy hh:mm a") : "",
          "Bill Cancelled": r.bill_cancelled ? "Yes" : "No",
        };
      });
      exportToExcel(rows, `Patient_Registrations_${format(new Date(), "ddMMyyyy")}`);
      toast.success(`Exported ${rows.length} registrations`);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const colCount = 16;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => handleSearch(e.target.value)} placeholder="Search by name, mobile, invoice, UMR..." className="pl-8" />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={cn("justify-start text-left font-normal", !fromDate && "text-muted-foreground")}>
              <CalendarIcon className="h-4 w-4 mr-1" />
              {fromDate ? format(fromDate, "dd-MM-yyyy") : "From date"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={fromDate} onSelect={handleFromDate} initialFocus className={cn("p-3 pointer-events-auto")} />
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={cn("justify-start text-left font-normal", !toDate && "text-muted-foreground")}>
              <CalendarIcon className="h-4 w-4 mr-1" />
              {toDate ? format(toDate, "dd-MM-yyyy") : "To date"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={toDate} onSelect={handleToDate} initialFocus className={cn("p-3 pointer-events-auto")} />
          </PopoverContent>
        </Popover>
        {(fromDate || toDate) && (
          <Button variant="ghost" size="sm" onClick={clearDates}>
            <X className="h-4 w-4 mr-1" />Clear dates
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setShowExportPwd(true)}>
          <Download className="h-4 w-4 mr-1" />Export All
        </Button>
        {isActionAllowed("clear_data") && (
          <Button variant="destructive" size="sm" onClick={() => setShowClearPwd(true)} disabled={clearing}>
            <Trash2 className="h-4 w-4 mr-1" />{clearing ? "Clearing..." : "Clear All Data"}
          </Button>
        )}
      </div>

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Invoice #</TableHead>
              <TableHead>Registered Date &amp; Time</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>Visit</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Remarks</TableHead>
              <TableHead>Created By</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead className="text-right">Discount</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead className="text-right">HV Charge</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={colCount + 1} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : registrations.length === 0 ? (
              <TableRow><TableCell colSpan={colCount + 1} className="text-center py-8 text-muted-foreground">No registrations found</TableCell></TableRow>
            ) : registrations.map((r: any) => {
              const testList = Array.isArray(r.tests) ? r.tests : [];
              const cancelledTests = Array.isArray(r.cancelled_tests) ? r.cancelled_tests : [];
              const cancelledIds = new Set(cancelledTests.map((ct: any) => ct.test_id));
              const activeTests = testList.filter((t: any) => !cancelledIds.has(t.test_id));
              const isExpanded = expandedRow === r.id;

              return (
                <>
                  <TableRow
                    key={r.id}
                    className={`cursor-pointer ${r.bill_cancelled ? "opacity-60" : ""} ${r.is_stat && !r.bill_cancelled && r.status !== "dispatched" ? "bg-destructive/5" : ""}`}
                    onClick={() => setExpandedRow(isExpanded ? null : r.id)}
                  >
                    <TableCell className="px-2">
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.invoice_number}</TableCell>
                    <TableCell className="text-xs">{r.created_at ? format(new Date(r.created_at), "dd-MM-yyyy hh:mm a") : "—"}</TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">
                        {r.title} {r.patient_name}
                        {r.is_stat && !r.bill_cancelled && r.status !== "dispatched" && (
                          <span className="relative inline-flex h-2.5 w-2.5 ml-1.5 align-middle"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive"></span></span>
                        )}
                      </div>
                      {r.umr_number && <div className="text-xs text-muted-foreground">{r.umr_number}</div>}
                    </TableCell>
                    <TableCell className="text-sm">{r.mobile_number}</TableCell>
                    <TableCell className="text-xs">{visitTypeLabel(r.visit_type)}</TableCell>
                    <TableCell className="text-xs">{r.channel_id ? (channelMap[r.channel_id] || "—") : "—"}</TableCell>
                    <TableCell className="text-xs max-w-[120px] truncate">{r.remarks || "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="text-sm font-medium">₹{r.final_amount}</div>
                      {r.due_amount > 0 && <div className="text-xs text-destructive">Due: ₹{r.due_amount}</div>}
                      {r.refund_amount > 0 && <div className="text-xs text-orange-600">Refund: ₹{r.refund_amount}</div>}
                    </TableCell>
                    <TableCell><Badge variant={statusColor(r.status)}>{r.bill_cancelled ? "cancelled" : statusLabel(r.status)}</Badge></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="View Bill" onClick={() => setViewBillReg(r)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => setEditReg(r)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow key={`${r.id}-details`} className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={colCount + 1} className="py-3 px-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                          <div>
                            <span className="font-medium text-muted-foreground">Tests: </span>
                            <div className="mt-1 space-y-0.5">
                              {activeTests.map((t: any, i: number) => (
                                <div key={i} className="text-xs">• {t.test_name} — ₹{t.discounted_price ?? t.price}</div>
                              ))}
                              {cancelledTests.length > 0 && cancelledTests.map((ct: any, i: number) => (
                                <div key={`c-${i}`} className="text-xs text-destructive">• {ct.test_name || ct.test_id} (Cancelled)</div>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-1 text-xs">
                            <div><span className="font-medium text-muted-foreground">Doctor:</span> {r.doctor_name || "—"}</div>
                            <div><span className="font-medium text-muted-foreground">Report Language:</span> {r.report_language || "ENGLISH"}</div>
                            <div><span className="font-medium text-muted-foreground">Address:</span> {r.address || "—"}</div>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft className="h-4 w-4 mr-1" />Prev
          </Button>
          <span className="text-sm text-muted-foreground">Page {page + 1} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
            Next<ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      <EditRegistrationDialog
        open={!!editReg}
        onOpenChange={(o) => !o && setEditReg(null)}
        registration={editReg}
      />

      <InvoicePreview
        data={viewBillReg}
        open={!!viewBillReg}
        onClose={() => setViewBillReg(null)}
      />

      <ExportPasswordDialog
        open={showExportPwd}
        onOpenChange={setShowExportPwd}
        onSuccess={handleExport}
      />

      <ExportPasswordDialog
        open={showClearPwd}
        onOpenChange={setShowClearPwd}
        onSuccess={async () => {
          setClearing(true);
          try {
            await supabase.from("patient_results").delete().neq("id", "00000000-0000-0000-0000-000000000000");
            await supabase.from("approved_reports").delete().neq("id", "00000000-0000-0000-0000-000000000000");
            await supabase.from("outsourced_test_snips").delete().neq("id", "00000000-0000-0000-0000-000000000000");
            await supabase.from("sample_tubes" as any).delete().neq("id", "00000000-0000-0000-0000-000000000000");
            await supabase.from("patient_registrations").delete().neq("id", "00000000-0000-0000-0000-000000000000");
            await supabase.from("invoice_counter").delete().neq("date_key", "");
            await supabase.from("sample_tube_counter" as any).delete().neq("date_key", "");
            await supabase.from("patient_master").delete().neq("id", "00000000-0000-0000-0000-000000000000");
            await supabase.rpc("generate_umr_number" as any).then(() => {});
            // Reset UMR counter to 0
            await supabase.from("umr_counter" as any).update({ last_sequence: 0 }).eq("counter_key", "main");
            toast.success("All LIMS data cleared successfully");
            qc.invalidateQueries();
          } catch (err: any) {
            toast.error(err.message || "Failed to clear data");
          } finally {
            setClearing(false);
          }
        }}
      />
    </div>
  );
};

export default RegisteredPatients;
