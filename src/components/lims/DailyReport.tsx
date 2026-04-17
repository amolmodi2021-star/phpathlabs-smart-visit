import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Loader2, Download, Lock, CalendarIcon, Search, X } from "lucide-react";
import { format, startOfDay, endOfDay, parseISO } from "date-fns";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";
import * as XLSX from "xlsx";

const TRANSACTION_LABELS: Record<string, string> = {
  registration_payment: "Registration",
  due_collection: "Due Collection",
  old_due_recovered: "Old Due Recovered",
  discount_applied: "Discount Applied",
  refund: "Refund",
  old_bill_refund: "Old Bill Refund",
  bill_cancellation: "Bill Cancellation",
  old_bill_cancellation: "Old Bill Cancelled",
};

const DailyReport = () => {
  const today = format(new Date(), "yyyy-MM-dd");
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [showAdminPwd, setShowAdminPwd] = useState(false);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [userFilter, setUserFilter] = useState("ALL");
  const [modeFilter, setModeFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(invoiceSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [invoiceSearch]);

  const effectiveDateFrom = adminUnlocked ? dateFrom : today;
  const effectiveDateTo = adminUnlocked ? dateTo : today;
  const isSearching = debouncedSearch.length >= 3;

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ["payment-transactions", effectiveDateFrom, effectiveDateTo, debouncedSearch],
    queryFn: async () => {
      if (isSearching) {
        const { data, error } = await supabase
          .from("payment_transactions" as any)
          .select("*")
          .ilike("invoice_number", `%${debouncedSearch}%`)
          .order("transaction_date", { ascending: false })
          .limit(200);
        if (error) throw error;
        return (data || []) as any[];
      }
      const from = startOfDay(parseISO(effectiveDateFrom)).toISOString();
      const to = endOfDay(parseISO(effectiveDateTo)).toISOString();
      const { data, error } = await supabase
        .from("payment_transactions" as any)
        .select("*")
        .gte("transaction_date", from)
        .lte("transaction_date", to)
        .order("invoice_number", { ascending: false })
        .order("transaction_date", { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // Derive invoice date from invoice number YYMMDD prefix (e.g. "2604160004" -> 16-04-2026)
  const formatInvoiceDate = (invoiceNumber: string | null | undefined): string => {
    if (!invoiceNumber || invoiceNumber.length < 6) return "-";
    const yy = invoiceNumber.slice(0, 2);
    const mm = invoiceNumber.slice(2, 4);
    const dd = invoiceNumber.slice(4, 6);
    if (!/^\d{6}$/.test(yy + mm + dd)) return "-";
    return `${dd}-${mm}-20${yy}`;
  };

  // Unique users for filter
  const uniqueUsers = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((t: any) => { if (t.performed_by) set.add(t.performed_by); });
    return Array.from(set).sort();
  }, [transactions]);

  // Filtered data
  const filtered = useMemo(() => {
    return transactions.filter((t: any) => {
      if (userFilter !== "ALL" && t.performed_by !== userFilter) return false;
      if (typeFilter !== "ALL" && t.transaction_type !== typeFilter) return false;
      if (modeFilter !== "ALL") {
        const key = modeFilter.toLowerCase().replace(/\s+/g, "_") + "_amount";
        // Show row if this mode has any non-zero amount (positive in or negative refund)
        if (Number(t[key] || 0) === 0) return false;
      }
      return true;
    });
  }, [transactions, userFilter, typeFilter, modeFilter]);

  // Summary totals
  const totals = useMemo(() => {
    const t = { cash: 0, gpay: 0, paytm: 0, credit_card: 0, neft: 0, total_in: 0, total_out: 0, gross: 0, discount: 0, final: 0, paid: 0, due: 0, refund: 0 };
    filtered.forEach((r: any) => {
      t.cash += Number(r.cash_amount || 0);
      t.gpay += Number(r.gpay_amount || 0);
      t.paytm += Number(r.paytm_amount || 0);
      t.credit_card += Number(r.credit_card_amount || 0);
      t.neft += Number(r.neft_amount || 0);
      t.gross += Number(r.gross_amount || 0);
      t.discount += Number(r.discount_amount || 0);
      t.final += Number(r.final_amount || 0);
      t.paid += Number(r.paid_amount || 0);
      t.due += Number(r.due_amount || 0);
      t.refund += Number(r.refund_amount || 0);
      if (r.direction === "in") t.total_in += Number(r.total_amount || 0);
      else t.total_out += Number(r.total_amount || 0);
    });
    return t;
  }, [filtered]);

  const exportToExcel = () => {
    const rows = filtered.map((r: any) => ({
      "Invoice #": r.invoice_number,
      "Invoice Date": formatInvoiceDate(r.invoice_number),
      "Date/Time": format(parseISO(r.transaction_date), "dd-MM-yyyy hh:mm a"),
      "Username": r.performed_by || "",
      "Type": TRANSACTION_LABELS[r.transaction_type] || r.transaction_type,
      "Direction": r.direction === "in" ? "Money In" : "Money Out",
      "Patient Name": r.patient_name || "",
      "Gross Amount": Number(r.gross_amount || 0),
      "Discount": Number(r.discount_amount || 0),
      "Final Amount": Number(r.final_amount || 0),
      "Total Paid": Number(r.paid_amount || 0),
      "Total Due": Number(r.due_amount || 0),
      "Cash": Number(r.cash_amount || 0),
      "GPay": Number(r.gpay_amount || 0),
      "Paytm": Number(r.paytm_amount || 0),
      "NEFT": Number(r.neft_amount || 0),
      "Credit Card": Number(r.credit_card_amount || 0),
      "Refund": Number(r.refund_amount || 0),
      "Remarks": r.remarks || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Daily Report");
    XLSX.writeFile(wb, `Daily_Report_${effectiveDateFrom}_to_${effectiveDateTo}.xlsx`);
  };

  return (
    <div className="space-y-4">
      {/* Header & Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
        <h2 className="font-semibold text-lg">Daily Payment Register</h2>
        {!adminUnlocked && (
          <Button variant="outline" size="sm" onClick={() => setShowAdminPwd(true)}>
            <Lock className="h-3.5 w-3.5 mr-1" /> Admin View
          </Button>
        )}
        {adminUnlocked && <Badge variant="secondary">Admin Mode</Badge>}
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3 flex-wrap">
        <div>
          <Label className="text-xs">From Date</Label>
          <Input type="date" value={effectiveDateFrom} onChange={e => setDateFrom(e.target.value)} disabled={!adminUnlocked} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">To Date</Label>
          <Input type="date" value={effectiveDateTo} onChange={e => setDateTo(e.target.value)} disabled={!adminUnlocked} className="w-40" />
        </div>
        {adminUnlocked && (
          <>
            <div>
              <Label className="text-xs">User</Label>
              <Select value={userFilter} onValueChange={setUserFilter}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Users</SelectItem>
                  {uniqueUsers.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Types</SelectItem>
                  {Object.entries(TRANSACTION_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Payment Mode</Label>
              <Select value={modeFilter} onValueChange={setModeFilter}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Modes</SelectItem>
                  <SelectItem value="Cash">Cash</SelectItem>
                  <SelectItem value="GPay">GPay</SelectItem>
                  <SelectItem value="Paytm">Paytm</SelectItem>
                  <SelectItem value="NEFT">NEFT</SelectItem>
                  <SelectItem value="Credit Card">Credit Card</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}
        <div>
          <Label className="text-xs">Search Invoice #</Label>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="text"
              value={invoiceSearch}
              onChange={e => setInvoiceSearch(e.target.value)}
              placeholder="e.g. 2604160004"
              className="w-48 pl-7 pr-7"
            />
            {invoiceSearch && (
              <button
                type="button"
                onClick={() => setInvoiceSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={exportToExcel} disabled={filtered.length === 0}>
          <Download className="h-3.5 w-3.5 mr-1" /> Export Excel
        </Button>
      </div>

      {isSearching && (
        <div>
          <Badge variant="secondary" className="text-xs">
            Searching all dates — date filter ignored ({transactions.length} result{transactions.length === 1 ? "" : "s"})
          </Badge>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border p-3 text-center">
          <p className="text-xs text-muted-foreground">Total In</p>
          <p className="text-lg font-bold text-primary">₹{totals.total_in.toFixed(2)}</p>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <p className="text-xs text-muted-foreground">Total Out (Refunds)</p>
          <p className="text-lg font-bold text-destructive">₹{Math.abs(totals.total_out).toFixed(2)}</p>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <p className="text-xs text-muted-foreground">Net Collection</p>
          <p className="text-lg font-bold">₹{(totals.total_in + totals.total_out).toFixed(2)}</p>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <p className="text-xs text-muted-foreground">Transactions</p>
          <p className="text-lg font-bold">{filtered.length}</p>
        </div>
      </div>

      {/* Consolidated Mode Summary */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {[
          { label: "Cash", val: totals.cash },
          { label: "GPay", val: totals.gpay },
          { label: "Paytm", val: totals.paytm },
          { label: "NEFT", val: totals.neft },
          { label: "Credit Card", val: totals.credit_card },
        ].map(m => (
          <div key={m.label} className="rounded border p-2 text-center">
            <p className="text-xs text-muted-foreground">{m.label}</p>
            <p className="font-semibold text-sm">₹{m.val.toFixed(2)}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">No transactions found for this period.</p>
      ) : (
        <div className="overflow-x-auto border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">Invoice #</TableHead>
                <TableHead className="whitespace-nowrap">Invoice Date</TableHead>
                <TableHead className="whitespace-nowrap">Date/Time</TableHead>
                <TableHead className="whitespace-nowrap">Username</TableHead>
                <TableHead className="whitespace-nowrap">Type</TableHead>
                <TableHead className="whitespace-nowrap">Patient Name</TableHead>
                <TableHead className="text-right whitespace-nowrap">Gross</TableHead>
                <TableHead className="text-right whitespace-nowrap">Discount</TableHead>
                <TableHead className="text-right whitespace-nowrap">Final</TableHead>
                <TableHead className="text-right whitespace-nowrap">Paid</TableHead>
                <TableHead className="text-right whitespace-nowrap">Due</TableHead>
                <TableHead className="text-right whitespace-nowrap">Cash</TableHead>
                <TableHead className="text-right whitespace-nowrap">GPay</TableHead>
                <TableHead className="text-right whitespace-nowrap">Paytm</TableHead>
                <TableHead className="text-right whitespace-nowrap">NEFT</TableHead>
                <TableHead className="text-right whitespace-nowrap">Credit Card</TableHead>
                <TableHead className="text-right whitespace-nowrap">Refund</TableHead>
                <TableHead className="whitespace-nowrap">Remarks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r: any) => (
                <TableRow key={r.id} className={r.direction === "out" ? "bg-destructive/5" : ""}>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{r.invoice_number}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{formatInvoiceDate(r.invoice_number)}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{format(parseISO(r.transaction_date), "dd-MM-yyyy hh:mm a")}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{r.performed_by}</TableCell>
                  <TableCell>
                    <Badge variant={r.direction === "out" ? "destructive" : "secondary"} className="text-xs whitespace-nowrap">
                      {TRANSACTION_LABELS[r.transaction_type] || r.transaction_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{r.patient_name || "-"}</TableCell>
                  <TableCell className="text-right text-sm">₹{Number(r.gross_amount || 0)}</TableCell>
                  <TableCell className="text-right text-sm">₹{Number(r.discount_amount || 0)}</TableCell>
                  <TableCell className="text-right text-sm font-medium">₹{Number(r.final_amount || 0)}</TableCell>
                  <TableCell className="text-right text-sm">₹{Number(r.paid_amount || 0)}</TableCell>
                  <TableCell className="text-right text-sm">{Number(r.due_amount || 0) > 0 ? <span className="text-destructive">₹{Number(r.due_amount)}</span> : "₹0"}</TableCell>
                  {(["cash_amount","gpay_amount","paytm_amount","neft_amount","credit_card_amount"] as const).map((k) => {
                    const v = Number(r[k] || 0);
                    if (v === 0) return <TableCell key={k} className="text-right text-sm">-</TableCell>;
                    const isNeg = v < 0;
                    return (
                      <TableCell key={k} className={`text-right text-sm ${isNeg ? "text-destructive font-medium" : ""}`}>
                        {isNeg ? `-₹${Math.abs(v)}` : `₹${v}`}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-right text-sm">{Number(r.refund_amount || 0) > 0 ? <span className="text-destructive">₹{r.refund_amount}</span> : "-"}</TableCell>
                  <TableCell className="text-xs max-w-[120px] truncate">{r.remarks || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className="font-semibold">
                <TableCell colSpan={6} className="text-right">Totals</TableCell>
                <TableCell className="text-right">₹{totals.gross.toFixed(2)}</TableCell>
                <TableCell className="text-right">₹{totals.discount.toFixed(2)}</TableCell>
                <TableCell className="text-right">₹{totals.final.toFixed(2)}</TableCell>
                <TableCell className="text-right">₹{totals.paid.toFixed(2)}</TableCell>
                <TableCell className="text-right">₹{totals.due.toFixed(2)}</TableCell>
                <TableCell className="text-right">₹{totals.cash.toFixed(2)}</TableCell>
                <TableCell className="text-right">₹{totals.gpay.toFixed(2)}</TableCell>
                <TableCell className="text-right">₹{totals.paytm.toFixed(2)}</TableCell>
                <TableCell className="text-right">₹{totals.neft.toFixed(2)}</TableCell>
                <TableCell className="text-right">₹{totals.credit_card.toFixed(2)}</TableCell>
                <TableCell className="text-right">₹{totals.refund.toFixed(2)}</TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}

      {/* Admin Password Gate */}
      <DeletePasswordDialog
        open={showAdminPwd}
        onOpenChange={setShowAdminPwd}
        onSuccess={() => { setAdminUnlocked(true); setShowAdminPwd(false); }}
        description="Enter admin password to access historical reports and filters."
      />
    </div>
  );
};

export default DailyReport;
