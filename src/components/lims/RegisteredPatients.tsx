import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, ChevronLeft, ChevronRight, Pencil, Download, Eye, Send } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { exportToExcel } from "@/lib/excel";
import ExportPasswordDialog from "@/components/ExportPasswordDialog";
import EditRegistrationDialog from "./EditRegistrationDialog";
import InvoicePreview from "./InvoicePreview";

const PAGE_SIZE = 20;

const RegisteredPatients = () => {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [editReg, setEditReg] = useState<any>(null);
  const [viewBillReg, setViewBillReg] = useState<any>(null);
  const [showExportPwd, setShowExportPwd] = useState(false);

  const handleSearch = (val: string) => {
    setSearch(val);
    setPage(0);
    clearTimeout((window as any).__regSearchTimeout);
    (window as any).__regSearchTimeout = setTimeout(() => setDebouncedSearch(val), 400);
  };

  const { data: count = 0 } = useQuery({
    queryKey: ["patient_registrations_count", debouncedSearch],
    queryFn: async () => {
      const { data } = await supabase.rpc("get_patient_registrations_count" as any, { p_search: debouncedSearch });
      return Number(data) || 0;
    },
  });

  const { data: registrations = [], isLoading } = useQuery({
    queryKey: ["patient_registrations", page, debouncedSearch],
    queryFn: async () => {
      const { data } = await supabase.rpc("get_patient_registrations_paginated" as any, {
        p_page: page, p_page_size: PAGE_SIZE, p_search: debouncedSearch,
      });
      return (data || []) as any[];
    },
  });

  const totalPages = Math.ceil(count / PAGE_SIZE);

  const statusColor = (s: string) => {
    switch (s) {
      case "registered": return "secondary";
      case "sample_collected": return "default";
      case "processing": return "outline";
      case "completed": return "default";
      case "cancelled": return "destructive";
      default: return "secondary";
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
          "Date": r.created_at ? format(new Date(r.created_at), "dd-MM-yyyy HH:mm") : "",
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => handleSearch(e.target.value)} placeholder="Search by name, mobile, invoice, UMR..." className="pl-8" />
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowExportPwd(true)}>
          <Download className="h-4 w-4 mr-1" />Export All
        </Button>
      </div>

      <div className="text-sm text-muted-foreground">{count} registration(s) found</div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>Tests</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : registrations.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No registrations found</TableCell></TableRow>
            ) : registrations.map((r: any) => {
              const testList = Array.isArray(r.tests) ? r.tests : [];
              const cancelledTests = Array.isArray(r.cancelled_tests) ? r.cancelled_tests : [];
              const cancelledIds = new Set(cancelledTests.map((ct: any) => ct.test_id));
              const activeTests = testList.filter((t: any) => !cancelledIds.has(t.test_id));
              return (
                <TableRow key={r.id} className={`${r.bill_cancelled ? "opacity-60" : ""} ${r.is_stat && !r.bill_cancelled && r.status !== "dispatched" ? "bg-destructive/5" : ""}`}>
                  <TableCell className="font-mono text-xs">
                    <div className="flex items-center gap-1.5">
                      {r.is_stat && !r.bill_cancelled && r.status !== "dispatched" && (
                        <span className="relative flex h-2.5 w-2.5 shrink-0"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive"></span></span>
                      )}
                      {r.invoice_number}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">{r.created_at ? format(new Date(r.created_at), "dd-MM-yyyy HH:mm") : "—"}</TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{r.title} {r.patient_name}</div>
                    {r.umr_number && <div className="text-xs text-muted-foreground">{r.umr_number}</div>}
                  </TableCell>
                  <TableCell className="text-sm">{r.mobile_number}</TableCell>
                  <TableCell className="text-xs max-w-[200px]">
                    <div className="truncate">{activeTests.map((t: any) => t.test_name).join(", ") || "—"}</div>
                    {cancelledTests.length > 0 && (
                      <div className="text-destructive truncate">Cancelled: {cancelledTests.map((ct: any) => ct.test_name || ct.test_id).join(", ")}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="text-sm font-medium">₹{r.final_amount}</div>
                    {r.due_amount > 0 && <div className="text-xs text-destructive">Due: ₹{r.due_amount}</div>}
                    {r.refund_amount > 0 && <div className="text-xs text-orange-600">Refund: ₹{r.refund_amount}</div>}
                  </TableCell>
                  <TableCell><Badge variant={statusColor(r.status)}>{r.bill_cancelled ? "cancelled" : r.status}</Badge></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="View Bill" onClick={() => setViewBillReg(r)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => setEditReg(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
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
    </div>
  );
};

export default RegisteredPatients;
