import RefreshButton from "@/components/lims/RefreshButton";
import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Loader2, Download, Lock, CalendarIcon, Search, X, Printer } from "lucide-react";
import { format, startOfDay, endOfDay, parseISO } from "date-fns";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";
import * as XLSX from "@e965/xlsx";
import jsPDF from "jspdf";
import { patientDisplayName } from "@/lib/patientDisplayName";
import { isHiddenDailyReportType, paymentRowGross, paymentRowPaid } from "@/lib/dailyReportMetrics";

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

  // Lookup registrations referenced by visible transactions to derive visit/source/billing columns
  const registrationIds = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((t: any) => { if (t.registration_id) set.add(t.registration_id); });
    return Array.from(set);
  }, [transactions]);

  const { data: regLookup = [] } = useQuery({
    queryKey: ["daily-report-registrations", registrationIds],
    enabled: registrationIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_registrations")
        .select("id, visit_type, channel_id, pickup_point_id, title, gender, patient_name, home_visit_charges, due_amount, bill_cancelled")
        .in("id", registrationIds);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const { data: channelsLookup = [] } = useQuery({
    queryKey: ["daily-report-channels"],
    queryFn: async () => {
      const { data } = await supabase.from("channels").select("id, name, billing_type");
      return (data || []) as any[];
    },
  });

  const { data: pickupsLookup = [] } = useQuery({
    queryKey: ["daily-report-pickups"],
    queryFn: async () => {
      const { data } = await supabase.from("pickup_points").select("id, name, billing_type");
      return (data || []) as any[];
    },
  });

  const regMap = useMemo(() => Object.fromEntries(regLookup.map((r: any) => [r.id, r])), [regLookup]);
  const channelMap = useMemo(() => Object.fromEntries(channelsLookup.map((c: any) => [c.id, c])), [channelsLookup]);
  const pickupMap = useMemo(() => Object.fromEntries(pickupsLookup.map((p: any) => [p.id, p])), [pickupsLookup]);
  const hvcByRegId = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of regLookup as any[]) {
      m[r.id] = Number(r.home_visit_charges || 0);
    }
    return m;
  }, [regLookup]);

  const visitTypeLabel = (v?: string) => {
    if (v === "lab_visit") return "Lab Visit";
    if (v === "home_visit") return "Home Visit";
    if (v === "pickup_point") return "Pickup Point";
    if (v === "channel") return "Channel";
    return "—";
  };

  const getPatientName = (r: any) => {
    const reg = r?.registration_id ? regMap[r.registration_id] : null;
    const name = patientDisplayName(reg || r);
    return name === "—" ? "-" : name;
  };

  const getRegInfo = (regId?: string) => {
    if (!regId) return { visit: "—", source: "—", billing: "—" as "credit" | "debit" | "—" };
    const r: any = regMap[regId];
    if (!r) return { visit: "—", source: "—", billing: "—" as "credit" | "debit" | "—" };
    let visit = visitTypeLabel(r.visit_type);
    let source = "—";
    let billing: "credit" | "debit" = "debit";
    if (r.visit_type === "pickup_point" && r.pickup_point_id) {
      const pp = pickupMap[r.pickup_point_id];
      source = pp?.name || "—";
      billing = pp?.billing_type === "credit" ? "credit" : "debit";
    } else if (r.channel_id) {
      const ch = channelMap[r.channel_id];
      source = ch?.name || "—";
      visit = "Channel";
      billing = ch?.billing_type === "credit" ? "credit" : "debit";
    }
    return { visit, source, billing };
  };

  const getRowGross = (r: any): number => paymentRowGross(r, hvcByRegId);

  const getRowPaid = (r: any): number => paymentRowPaid(r);

  const formatSignedRupee = (v: number): { text: string; negative: boolean } => {
    if (v === 0) return { text: "₹0", negative: false };
    if (v < 0) return { text: `-₹${Math.abs(v)}`, negative: true };
    return { text: `₹${v}`, negative: false };
  };


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

  // Type rank: cancellation rows must appear before refund rows within the same invoice
  const typeRank = (type: string): number => {
    if (type === "bill_cancellation" || type === "old_bill_cancellation") return 0;
    if (type === "refund" || type === "old_bill_refund") return 1;
    return 2;
  };

  // Filtered data
  const filtered = useMemo(() => {
    const rows = transactions.filter((t: any) => {
      // Hide cross-day cancellation marker rows; the paired old_bill_refund row carries the cash impact
      if (isHiddenDailyReportType(t.transaction_type)) return false;
      if (userFilter !== "ALL" && t.performed_by !== userFilter) return false;
      if (typeFilter !== "ALL" && t.transaction_type !== typeFilter) return false;
      if (modeFilter !== "ALL") {
        const key = modeFilter.toLowerCase().replace(/\s+/g, "_") + "_amount";
        // Show row if this mode has any non-zero amount (positive in or negative refund)
        if (Number(t[key] || 0) === 0) return false;
      }
      return true;
    });
    // Stable sort: invoice_number desc, then cancellation before refund, then chronological
    return [...rows].sort((a: any, b: any) => {
      const invA = a.invoice_number || "";
      const invB = b.invoice_number || "";
      if (invA !== invB) return invB.localeCompare(invA);
      const rankDiff = typeRank(a.transaction_type) - typeRank(b.transaction_type);
      if (rankDiff !== 0) return rankDiff;
      return new Date(a.transaction_date).getTime() - new Date(b.transaction_date).getTime();
    });
  }, [transactions, userFilter, typeFilter, modeFilter]);

  /**
   * Outstanding dues for bills registered in the filtered set.
   * Uses live patient_registrations.due_amount (not the frozen Due snapshot on
   * payment_transactions), so dues already collected no longer inflate the cards.
   */
  const addLiveOutstandingDues = (
    rows: any[],
    t: { credit_due: number; debit_due: number },
  ) => {
    const seen = new Set<string>();
    rows.forEach((r: any) => {
      if (r.transaction_type !== "registration_payment") return;
      const regId = r.registration_id;
      if (!regId || seen.has(regId)) return;
      seen.add(regId);
      const reg: any = regMap[regId];
      if (!reg || reg.bill_cancelled) return;
      const liveDue = Math.max(0, Number(reg.due_amount || 0));
      if (liveDue <= 0.01) return;
      const billing = getRegInfo(regId).billing;
      if (billing === "credit") t.credit_due += liveDue;
      else t.debit_due += liveDue;
    });
  };

  // Summary totals
  const totals = useMemo(() => {
    const t = {
      cash: 0, gpay: 0, paytm: 0, credit_card: 0, neft: 0,
      total_in: 0, total_out: 0, gross: 0, discount: 0, final: 0,
      paid: 0, due: 0, credit_due: 0, debit_due: 0, refund: 0,
    };
    filtered.forEach((r: any) => {
      t.cash += Number(r.cash_amount || 0);
      t.gpay += Number(r.gpay_amount || 0);
      t.paytm += Number(r.paytm_amount || 0);
      t.credit_card += Number(r.credit_card_amount || 0);
      t.neft += Number(r.neft_amount || 0);
      t.gross += getRowGross(r);
      t.discount += Number(r.discount_amount || 0);
      t.final += Number(r.final_amount || 0);
      t.paid += getRowPaid(r);
      t.due += Number(r.due_amount || 0);
      t.refund += Number(r.refund_amount || 0);
      if (r.direction === "in") t.total_in += Number(r.total_amount || 0);
      else t.total_out += Number(r.total_amount || 0);
    });
    addLiveOutstandingDues(filtered, t);
    return t;
  }, [filtered, regMap, channelMap, pickupMap]);

  const exportToExcel = () => {
    const rows = filtered.map((r: any) => {
      const info = getRegInfo(r.registration_id);
      return {
        "Invoice #": r.invoice_number,
        "Invoice Date": formatInvoiceDate(r.invoice_number),
        "Date/Time": format(parseISO(r.transaction_date), "dd-MM-yyyy hh:mm a"),
        "Username": r.performed_by || "",
        "Type": TRANSACTION_LABELS[r.transaction_type] || r.transaction_type,
        "Direction": r.direction === "in" ? "Money In" : "Money Out",
        "Patient Name": getPatientName(r) === "-" ? "" : getPatientName(r),
        "Visit Type": info.visit,
        "Pickup/Channel Name": info.source,
        "Billing": info.billing === "—" ? "" : info.billing.toUpperCase(),
        "Gross Amount": getRowGross(r),
        "Discount": Number(r.discount_amount || 0),
        "Final Amount": Number(r.final_amount || 0),
        "Total Paid": getRowPaid(r),
        "Total Due": Number(r.due_amount || 0),
        "Cash": Number(r.cash_amount || 0),
        "GPay": Number(r.gpay_amount || 0),
        "Paytm": Number(r.paytm_amount || 0),
        "NEFT": Number(r.neft_amount || 0),
        "Credit Card": Number(r.credit_card_amount || 0),
        "Refund": Number(r.refund_amount || 0),
        "Remarks": r.remarks || "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Daily Report");
    XLSX.writeFile(wb, `Daily_Report_${effectiveDateFrom}_to_${effectiveDateTo}.xlsx`);
  };

  const printPdf = () => {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 5;

    // Column definitions: total widths must fit pageW - 2*margin (~287mm)
    const cols: { key: string; label: string; w: number; align?: "left" | "right" | "center" }[] = [
      { key: "inv", label: "Inv #", w: 18 },
      { key: "invDate", label: "Inv Date", w: 14 },
      { key: "time", label: "Time", w: 13 },
      { key: "user", label: "User", w: 14 },
      { key: "type", label: "Type", w: 18 },
      { key: "patient", label: "Patient", w: 28 },
      { key: "visit", label: "Visit", w: 12 },
      { key: "source", label: "Pickup/Channel", w: 22 },
      { key: "billing", label: "Bill", w: 9 },
      { key: "gross", label: "Gross", w: 12, align: "right" },
      { key: "disc", label: "Disc", w: 11, align: "right" },
      { key: "final", label: "Final", w: 12, align: "right" },
      { key: "paid", label: "Paid", w: 12, align: "right" },
      { key: "due", label: "Due", w: 11, align: "right" },
      { key: "cash", label: "Cash", w: 11, align: "right" },
      { key: "gpay", label: "GPay", w: 11, align: "right" },
      { key: "paytm", label: "Paytm", w: 11, align: "right" },
      { key: "neft", label: "NEFT", w: 11, align: "right" },
      { key: "cc", label: "CC", w: 11, align: "right" },
      { key: "refund", label: "Refund", w: 12, align: "right" },
      { key: "remarks", label: "Remarks", w: 17 },
    ];

    const tableW = cols.reduce((s, c) => s + c.w, 0);
    const startX = margin + (pageW - 2 * margin - tableW) / 2;
    const rowH = 4.2;
    const headerH = 5;
    let y = margin;

    const fmtAmt = (n: number) => {
      if (!n) return "-";
      const v = Math.round(n);
      return v < 0 ? `(${Math.abs(v)})` : String(v);
    };
    const visitShort = (v: string) => {
      if (v === "Lab Visit") return "Lab";
      if (v === "Home Visit") return "Home";
      if (v === "Pickup Point") return "Pickup";
      if (v === "Channel") return "Channel";
      return v;
    };
    const truncate = (s: string, maxW: number) => {
      doc.setFontSize(6.5);
      let str = s || "";
      if (doc.getTextWidth(str) <= maxW) return str;
      while (str.length > 1 && doc.getTextWidth(str + "…") > maxW) str = str.slice(0, -1);
      return str + "…";
    };

    const drawHeader = () => {
      // Title block
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(0, 0, 0);
      doc.text("PH PathLabs — Daily Payment Register", margin, y + 4);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      const periodStr = isSearching
        ? `Search: ${invoiceSearch}`
        : `${effectiveDateFrom} to ${effectiveDateTo}`;
      doc.text(`Period: ${periodStr}`, margin, y + 8.5);
      const filterBits: string[] = [];
      if (adminUnlocked) {
        if (userFilter !== "ALL") filterBits.push(`User: ${userFilter}`);
        if (typeFilter !== "ALL") filterBits.push(`Type: ${TRANSACTION_LABELS[typeFilter] || typeFilter}`);
        if (modeFilter !== "ALL") filterBits.push(`Mode: ${modeFilter}`);
      }
      if (filterBits.length) doc.text(filterBits.join("  •  "), margin, y + 12);
      doc.setFontSize(7);
      doc.text(
        `Generated: ${format(new Date(), "dd-MM-yyyy hh:mm a")}`,
        pageW - margin,
        y + 4,
        { align: "right" }
      );
      doc.text(`Txns: ${filtered.length}`, pageW - margin, y + 8.5, { align: "right" });
      y += 14;

      // Summary band
      doc.setFillColor(245, 245, 245);
      doc.rect(margin, y, pageW - 2 * margin, 12, "F");
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "bold");
      const sumParts = [
        `In: ${totals.total_in.toFixed(0)}`,
        `Out: ${Math.abs(totals.total_out).toFixed(0)}`,
        `Net: ${(totals.total_in + totals.total_out).toFixed(0)}`,
        `Cash: ${totals.cash.toFixed(0)}`,
        `GPay: ${totals.gpay.toFixed(0)}`,
        `Paytm: ${totals.paytm.toFixed(0)}`,
        `NEFT: ${totals.neft.toFixed(0)}`,
        `CC: ${totals.credit_card.toFixed(0)}`,
        `Refund: ${totals.refund.toFixed(0)}`,
      ];
      doc.setTextColor(40, 40, 40);
      doc.text(sumParts.join("    "), margin + 2, y + 4.5);
      doc.setTextColor(140, 60, 0);
      doc.text(
        `Credit Dues (unpaid): ${totals.credit_due.toFixed(0)}    Debit Dues (unpaid): ${totals.debit_due.toFixed(0)}`,
        margin + 2,
        y + 9.5,
      );
      doc.setTextColor(40, 40, 40);
      y += 14;

      // Column header row
      doc.setFillColor(225, 230, 240);
      doc.rect(startX, y, tableW, headerH, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(0, 0, 0);
      let cx = startX;
      cols.forEach((c) => {
        const tx =
          c.align === "right" ? cx + c.w - 1 : c.align === "center" ? cx + c.w / 2 : cx + 1;
        doc.text(c.label, tx, y + 3.5, { align: c.align || "left" });
        cx += c.w;
      });
      // Vertical lines
      doc.setDrawColor(180, 180, 180);
      doc.setLineWidth(0.1);
      let vx = startX;
      doc.line(startX, y, startX, y + headerH);
      cols.forEach((c) => {
        vx += c.w;
        doc.line(vx, y, vx, y + headerH);
      });
      doc.line(startX, y + headerH, startX + tableW, y + headerH);
      y += headerH;
    };

    drawHeader();

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);

    let rowIdx = 0;
    filtered.forEach((r: any) => {
      if (y + rowH > pageH - 8) {
        doc.addPage();
        y = margin;
        drawHeader();
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
      }
      // Row background
      if (r.direction === "out") {
        doc.setFillColor(255, 235, 235);
        doc.rect(startX, y, tableW, rowH, "F");
      } else if (rowIdx % 2 === 1) {
        doc.setFillColor(250, 250, 250);
        doc.rect(startX, y, tableW, rowH, "F");
      }

      const info = getRegInfo(r.registration_id);
      const values: Record<string, string> = {
        inv: String(r.invoice_number || ""),
        invDate: formatInvoiceDate(r.invoice_number),
        time: format(parseISO(r.transaction_date), "hh:mm a"),
        user: r.performed_by || "",
        type: TRANSACTION_LABELS[r.transaction_type] || r.transaction_type,
        patient: getPatientName(r),
        visit: visitShort(info.visit),
        source: info.source || "-",
        billing: info.billing === "—" ? "-" : info.billing.toUpperCase().slice(0, 3),
        gross: fmtAmt(getRowGross(r)),
        disc: fmtAmt(Number(r.discount_amount || 0)),
        final: fmtAmt(Number(r.final_amount || 0)),
        paid: fmtAmt(getRowPaid(r)),
        due: fmtAmt(Number(r.due_amount || 0)),
        cash: fmtAmt(Number(r.cash_amount || 0)),
        gpay: fmtAmt(Number(r.gpay_amount || 0)),
        paytm: fmtAmt(Number(r.paytm_amount || 0)),
        neft: fmtAmt(Number(r.neft_amount || 0)),
        cc: fmtAmt(Number(r.credit_card_amount || 0)),
        refund: fmtAmt(Number(r.refund_amount || 0)),
        remarks: r.remarks || "-",
      };

      let cx = startX;
      cols.forEach((c) => {
        const raw = values[c.key] ?? "";
        const txt = truncate(raw, c.w - 1.5);
        const isNeg = raw.startsWith("(");
        const isDue = c.key === "due" && raw !== "-";
        if (isNeg || isDue) doc.setTextColor(180, 0, 0);
        else doc.setTextColor(20, 20, 20);
        const tx =
          c.align === "right" ? cx + c.w - 1 : c.align === "center" ? cx + c.w / 2 : cx + 1;
        doc.text(txt, tx, y + 3, { align: c.align || "left" });
        cx += c.w;
      });
      doc.setTextColor(0, 0, 0);

      // Row bottom line
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.1);
      doc.line(startX, y + rowH, startX + tableW, y + rowH);

      y += rowH;
      rowIdx++;
    });

    // Vertical column lines for the body section on each page (simple full-width verticals at footer)
    // Totals row
    if (y + rowH + 2 > pageH - 8) {
      doc.addPage();
      y = margin;
      drawHeader();
    }
    doc.setFillColor(220, 230, 245);
    doc.rect(startX, y, tableW, rowH + 0.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    const totVals: Record<string, string> = {
      gross: totals.gross.toFixed(0),
      disc: totals.discount.toFixed(0),
      final: totals.final.toFixed(0),
      paid: totals.paid.toFixed(0),
      due: totals.due.toFixed(0),
      cash: totals.cash.toFixed(0),
      gpay: totals.gpay.toFixed(0),
      paytm: totals.paytm.toFixed(0),
      neft: totals.neft.toFixed(0),
      cc: totals.credit_card.toFixed(0),
      refund: totals.refund.toFixed(0),
    };
    let cx = startX;
    let labelDrawn = false;
    cols.forEach((c) => {
      if (totVals[c.key] !== undefined) {
        doc.setTextColor(0, 0, 0);
        doc.text(totVals[c.key], cx + c.w - 1, y + 3.2, { align: "right" });
      } else if (!labelDrawn && c.key === "billing") {
        doc.setTextColor(0, 0, 0);
        doc.text("TOTALS", cx + c.w - 1, y + 3.2, { align: "right" });
        labelDrawn = true;
      }
      cx += c.w;
    });
    y += rowH + 0.5;

    // Page numbers
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text(`Page ${i} of ${pageCount}`, pageW - margin, pageH - 3, { align: "right" });
      doc.text("PH PathLabs • Daily Payment Register", margin, pageH - 3);
    }

    const fname = isSearching
      ? `Daily_Report_search_${invoiceSearch}.pdf`
      : `Daily_Report_${effectiveDateFrom}_to_${effectiveDateTo}.pdf`;
    doc.save(fname);
  };

  const printUserwisePdf = (targetUser: "ALL" | string) => {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 5;

    const cols: { key: string; label: string; w: number; align?: "left" | "right" | "center" }[] = [
      { key: "inv", label: "Inv #", w: 18 },
      { key: "invDate", label: "Inv Date", w: 14 },
      { key: "time", label: "Time", w: 13 },
      { key: "type", label: "Type", w: 20 },
      { key: "patient", label: "Patient", w: 32 },
      { key: "visit", label: "Visit", w: 14 },
      { key: "source", label: "Pickup/Channel", w: 24 },
      { key: "billing", label: "Bill", w: 10 },
      { key: "gross", label: "Gross", w: 12, align: "right" },
      { key: "disc", label: "Disc", w: 11, align: "right" },
      { key: "final", label: "Final", w: 12, align: "right" },
      { key: "paid", label: "Paid", w: 12, align: "right" },
      { key: "due", label: "Due", w: 11, align: "right" },
      { key: "cash", label: "Cash", w: 12, align: "right" },
      { key: "gpay", label: "GPay", w: 12, align: "right" },
      { key: "paytm", label: "Paytm", w: 12, align: "right" },
      { key: "neft", label: "NEFT", w: 12, align: "right" },
      { key: "cc", label: "CC", w: 12, align: "right" },
      { key: "refund", label: "Refund", w: 12, align: "right" },
      { key: "remarks", label: "Remarks", w: 18 },
    ];
    const tableW = cols.reduce((s, c) => s + c.w, 0);
    const startX = margin + (pageW - 2 * margin - tableW) / 2;
    const rowH = 4.2;
    const headerH = 5;
    let y = margin;

    const fmtAmt = (n: number) => {
      if (!n) return "-";
      const v = Math.round(n);
      return v < 0 ? `(${Math.abs(v)})` : String(v);
    };
    const visitShort = (v: string) =>
      v === "Lab Visit" ? "Lab" : v === "Home Visit" ? "Home" : v === "Pickup Point" ? "Pickup" : v;
    const truncate = (s: string, maxW: number) => {
      doc.setFontSize(6.5);
      let str = s || "";
      if (doc.getTextWidth(str) <= maxW) return str;
      while (str.length > 1 && doc.getTextWidth(str + "…") > maxW) str = str.slice(0, -1);
      return str + "…";
    };

    const periodStr = isSearching
      ? `Search: ${invoiceSearch}`
      : `${effectiveDateFrom} to ${effectiveDateTo}`;

    const drawDocTitleBlock = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(0, 0, 0);
      doc.text("PH PathLabs — Daily Payment Register (User-wise)", margin, y + 4);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(`Period: ${periodStr}`, margin, y + 8.5);
      doc.setFontSize(7);
      doc.text(
        `Generated: ${format(new Date(), "dd-MM-yyyy hh:mm a")}`,
        pageW - margin,
        y + 4,
        { align: "right" }
      );
      y += 11;
    };

    const drawColumnHeader = () => {
      doc.setFillColor(225, 230, 240);
      doc.rect(startX, y, tableW, headerH, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(0, 0, 0);
      let cx = startX;
      cols.forEach((c) => {
        const tx =
          c.align === "right" ? cx + c.w - 1 : c.align === "center" ? cx + c.w / 2 : cx + 1;
        doc.text(c.label, tx, y + 3.5, { align: c.align || "left" });
        cx += c.w;
      });
      doc.setDrawColor(180, 180, 180);
      doc.setLineWidth(0.1);
      let vx = startX;
      doc.line(startX, y, startX, y + headerH);
      cols.forEach((c) => {
        vx += c.w;
        doc.line(vx, y, vx, y + headerH);
      });
      doc.line(startX, y + headerH, startX + tableW, y + headerH);
      y += headerH;
    };

    const drawUserBanner = (userName: string, count: number, sub?: string) => {
      doc.setFillColor(45, 70, 130);
      doc.rect(margin, y, pageW - 2 * margin, 8, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(`User: ${userName}`, margin + 2, y + 5.5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(`Transactions: ${count}`, margin + 80, y + 5.5);
      if (sub) doc.text(sub, margin + 130, y + 5.5);
      doc.text(`Period: ${periodStr}`, pageW - margin - 2, y + 5.5, { align: "right" });
      doc.setTextColor(0, 0, 0);
      y += 10;
    };

    const ensureSpace = (needed: number, repeatHeader: boolean) => {
      if (y + needed > pageH - 8) {
        doc.addPage();
        y = margin;
        drawDocTitleBlock();
        if (repeatHeader) drawColumnHeader();
      }
    };

    const drawDataRow = (r: any, rowIdx: number) => {
      ensureSpace(rowH, true);
      if (r.direction === "out") {
        doc.setFillColor(255, 235, 235);
        doc.rect(startX, y, tableW, rowH, "F");
      } else if (rowIdx % 2 === 1) {
        doc.setFillColor(250, 250, 250);
        doc.rect(startX, y, tableW, rowH, "F");
      }
      const info = getRegInfo(r.registration_id);
      const values: Record<string, string> = {
        inv: String(r.invoice_number || ""),
        invDate: formatInvoiceDate(r.invoice_number),
        time: format(parseISO(r.transaction_date), "hh:mm a"),
        type: TRANSACTION_LABELS[r.transaction_type] || r.transaction_type,
        patient: getPatientName(r),
        visit: visitShort(info.visit),
        source: info.source || "-",
        billing: info.billing === "—" ? "-" : info.billing.toUpperCase().slice(0, 3),
        gross: fmtAmt(getRowGross(r)),
        disc: fmtAmt(Number(r.discount_amount || 0)),
        final: fmtAmt(Number(r.final_amount || 0)),
        paid: fmtAmt(getRowPaid(r)),
        due: fmtAmt(Number(r.due_amount || 0)),
        cash: fmtAmt(Number(r.cash_amount || 0)),
        gpay: fmtAmt(Number(r.gpay_amount || 0)),
        paytm: fmtAmt(Number(r.paytm_amount || 0)),
        neft: fmtAmt(Number(r.neft_amount || 0)),
        cc: fmtAmt(Number(r.credit_card_amount || 0)),
        refund: fmtAmt(Number(r.refund_amount || 0)),
        remarks: r.remarks || "-",
      };
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      let cx = startX;
      cols.forEach((c) => {
        const raw = values[c.key] ?? "";
        const txt = truncate(raw, c.w - 1.5);
        const isNeg = raw.startsWith("(");
        const isDue = c.key === "due" && raw !== "-";
        if (isNeg || isDue) doc.setTextColor(180, 0, 0);
        else doc.setTextColor(20, 20, 20);
        const tx =
          c.align === "right" ? cx + c.w - 1 : c.align === "center" ? cx + c.w / 2 : cx + 1;
        doc.text(txt, tx, y + 3, { align: c.align || "left" });
        cx += c.w;
      });
      doc.setTextColor(0, 0, 0);
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.1);
      doc.line(startX, y + rowH, startX + tableW, y + rowH);
      y += rowH;
    };

    const drawTotalsRow = (userTotals: any, label: string) => {
      ensureSpace(rowH + 1, true);
      doc.setFillColor(220, 230, 245);
      doc.rect(startX, y, tableW, rowH + 0.5, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      const totVals: Record<string, string> = {
        gross: userTotals.gross.toFixed(0),
        disc: userTotals.discount.toFixed(0),
        final: userTotals.final.toFixed(0),
        paid: userTotals.paid.toFixed(0),
        due: userTotals.due.toFixed(0),
        cash: userTotals.cash.toFixed(0),
        gpay: userTotals.gpay.toFixed(0),
        paytm: userTotals.paytm.toFixed(0),
        neft: userTotals.neft.toFixed(0),
        cc: userTotals.credit_card.toFixed(0),
        refund: userTotals.refund.toFixed(0),
      };
      let cx = startX;
      let labelDrawn = false;
      cols.forEach((c) => {
        if (totVals[c.key] !== undefined) {
          doc.setTextColor(0, 0, 0);
          doc.text(totVals[c.key], cx + c.w - 1, y + 3.2, { align: "right" });
        } else if (!labelDrawn && c.key === "billing") {
          doc.setTextColor(0, 0, 0);
          doc.text(label, cx + c.w - 1, y + 3.2, { align: "right" });
          labelDrawn = true;
        }
        cx += c.w;
      });
      y += rowH + 1.5;
    };

    const computeTotals = (rows: any[]) => {
      const t = {
        cash: 0, gpay: 0, paytm: 0, credit_card: 0, neft: 0,
        total_in: 0, total_out: 0, gross: 0, discount: 0, final: 0,
        paid: 0, due: 0, credit_due: 0, debit_due: 0, refund: 0,
      };
      rows.forEach((r: any) => {
        t.cash += Number(r.cash_amount || 0);
        t.gpay += Number(r.gpay_amount || 0);
        t.paytm += Number(r.paytm_amount || 0);
        t.credit_card += Number(r.credit_card_amount || 0);
        t.neft += Number(r.neft_amount || 0);
        t.gross += getRowGross(r);
        t.discount += Number(r.discount_amount || 0);
        t.final += Number(r.final_amount || 0);
        t.paid += getRowPaid(r);
        t.due += Number(r.due_amount || 0);
        t.refund += Number(r.refund_amount || 0);
        if (r.direction === "in") t.total_in += Number(r.total_amount || 0);
        else t.total_out += Number(r.total_amount || 0);
      });
      addLiveOutstandingDues(rows, t);
      return t;
    };

    const groups: Record<string, any[]> = {};
    filtered.forEach((r: any) => {
      const u = (r.performed_by && String(r.performed_by).trim()) || "(Unassigned)";
      (groups[u] = groups[u] || []).push(r);
    });

    let userKeys = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    if (targetUser !== "ALL") userKeys = userKeys.filter((u) => u === targetUser);
    if (userKeys.length === 0) {
      doc.setFontSize(11);
      doc.text("No transactions found for the selected user.", margin, margin + 10);
      doc.save("Daily_Report_Userwise_empty.pdf");
      return;
    }

    userKeys.forEach((user, idx) => {
      if (idx > 0) {
        doc.addPage();
        y = margin;
      }
      drawDocTitleBlock();
      const rows = groups[user];
      const uTotals = computeTotals(rows);
      const net = uTotals.total_in + uTotals.total_out;
      drawUserBanner(
        user,
        rows.length,
        `Net: ${net.toFixed(0)}  •  In: ${uTotals.total_in.toFixed(0)}  •  Out: ${Math.abs(uTotals.total_out).toFixed(0)}  •  Credit Dues: ${uTotals.credit_due.toFixed(0)}  •  Debit Dues: ${uTotals.debit_due.toFixed(0)}`
      );
      drawColumnHeader();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      rows.forEach((r, i) => drawDataRow(r, i));
      drawTotalsRow(uTotals, "USER TOTAL");
    });

    if (targetUser === "ALL" && userKeys.length > 0) {
      doc.addPage();
      y = margin;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      doc.text("User-wise Collection Summary", margin, y + 5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(`Period: ${periodStr}`, margin, y + 10);
      doc.text(
        `Generated: ${format(new Date(), "dd-MM-yyyy hh:mm a")}`,
        pageW - margin,
        y + 5,
        { align: "right" }
      );
      y += 14;

      const sumCols: { key: string; label: string; w: number; align?: "left" | "right" }[] = [
        { key: "user", label: "User", w: 40 },
        { key: "txns", label: "Txns", w: 14, align: "right" },
        { key: "cash", label: "Cash", w: 20, align: "right" },
        { key: "gpay", label: "GPay", w: 20, align: "right" },
        { key: "paytm", label: "Paytm", w: 20, align: "right" },
        { key: "neft", label: "NEFT", w: 20, align: "right" },
        { key: "cc", label: "CC", w: 20, align: "right" },
        { key: "in", label: "Total In", w: 24, align: "right" },
        { key: "out", label: "Refund/Out", w: 24, align: "right" },
        { key: "credit_due", label: "Credit Dues", w: 24, align: "right" },
        { key: "debit_due", label: "Debit Dues", w: 24, align: "right" },
        { key: "net", label: "Net Collection", w: 28, align: "right" },
      ];
      const sumW = sumCols.reduce((s, c) => s + c.w, 0);
      const sumX = margin + (pageW - 2 * margin - sumW) / 2;
      const sumRowH = 6;

      doc.setFillColor(45, 70, 130);
      doc.rect(sumX, y, sumW, 7, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      let cx = sumX;
      sumCols.forEach((c) => {
        const tx = c.align === "right" ? cx + c.w - 1.5 : cx + 1.5;
        doc.text(c.label, tx, y + 4.8, { align: c.align || "left" });
        cx += c.w;
      });
      y += 7;

      const summaryRows = userKeys
        .map((u) => {
          const t = computeTotals(groups[u]);
          return {
            user: u,
            txns: groups[u].length,
            cash: t.cash,
            gpay: t.gpay,
            paytm: t.paytm,
            neft: t.neft,
            cc: t.credit_card,
            in: t.total_in,
            out: Math.abs(t.total_out),
            credit_due: t.credit_due,
            debit_due: t.debit_due,
            net: t.total_in + t.total_out,
          };
        })
        .sort((a, b) => b.net - a.net);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      summaryRows.forEach((row, i) => {
        if (y + sumRowH > pageH - 8) {
          doc.addPage();
          y = margin;
        }
        if (i % 2 === 1) {
          doc.setFillColor(248, 248, 250);
          doc.rect(sumX, y, sumW, sumRowH, "F");
        }
        let cx2 = sumX;
        sumCols.forEach((c) => {
          const v = (row as any)[c.key];
          let txt: string;
          if (c.key === "user") {
            doc.setFontSize(8);
            let s = String(v);
            while (s.length > 1 && doc.getTextWidth(s + "…") > c.w - 3) s = s.slice(0, -1);
            txt = s.length < String(v).length ? s + "…" : s;
          } else if (c.key === "txns") {
            txt = String(v);
          } else {
            txt = Math.round(v).toString();
          }
          doc.setTextColor(20, 20, 20);
          if (c.key === "out" && row.out > 0) doc.setTextColor(180, 0, 0);
          if ((c.key === "credit_due" && row.credit_due > 0) || (c.key === "debit_due" && row.debit_due > 0)) {
            doc.setTextColor(180, 80, 0);
          }
          if (c.key === "net") doc.setFont("helvetica", "bold");
          else doc.setFont("helvetica", "normal");
          const tx = c.align === "right" ? cx2 + c.w - 1.5 : cx2 + 1.5;
          doc.text(txt, tx, y + 4, { align: c.align || "left" });
          cx2 += c.w;
        });
        doc.setDrawColor(220, 220, 220);
        doc.setLineWidth(0.1);
        doc.line(sumX, y + sumRowH, sumX + sumW, y + sumRowH);
        y += sumRowH;
      });

      const gTot = summaryRows.reduce(
        (a, r) => ({
          txns: a.txns + r.txns,
          cash: a.cash + r.cash,
          gpay: a.gpay + r.gpay,
          paytm: a.paytm + r.paytm,
          neft: a.neft + r.neft,
          cc: a.cc + r.cc,
          in: a.in + r.in,
          out: a.out + r.out,
          credit_due: a.credit_due + r.credit_due,
          debit_due: a.debit_due + r.debit_due,
          net: a.net + r.net,
        }),
        { txns: 0, cash: 0, gpay: 0, paytm: 0, neft: 0, cc: 0, in: 0, out: 0, credit_due: 0, debit_due: 0, net: 0 }
      );
      if (y + sumRowH > pageH - 8) { doc.addPage(); y = margin; }
      doc.setFillColor(220, 230, 245);
      doc.rect(sumX, y, sumW, sumRowH + 0.5, "F");
      doc.setFont("helvetica", "bold");
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(8.5);
      let cx3 = sumX;
      sumCols.forEach((c) => {
        let txt = "";
        if (c.key === "user") txt = "GRAND TOTAL";
        else if (c.key === "txns") txt = String(gTot.txns);
        else txt = Math.round((gTot as any)[c.key]).toString();
        const tx = c.align === "right" ? cx3 + c.w - 1.5 : cx3 + 1.5;
        doc.text(txt, tx, y + 4.2, { align: c.align || "left" });
        cx3 += c.w;
      });
      y += sumRowH + 0.5;
    }

    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text(`Page ${i} of ${pageCount}`, pageW - margin, pageH - 3, { align: "right" });
      doc.text("PH PathLabs • Daily Payment Register (User-wise)", margin, pageH - 3);
    }

    const safeUser = (targetUser === "ALL" ? "AllUsers" : targetUser).replace(/[^a-zA-Z0-9_-]/g, "_");
    const periodPart = isSearching
      ? `search_${invoiceSearch}`
      : `${effectiveDateFrom}_to_${effectiveDateTo}`;
    const fname =
      targetUser === "ALL"
        ? `Daily_Report_Userwise_${periodPart}.pdf`
        : `Daily_Report_${safeUser}_${periodPart}.pdf`;
    doc.save(fname);
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
        <RefreshButton
          queryKeys={["payment-transactions", "daily-report-registrations", "daily-report-channels", "daily-report-pickups"]}
          className="ml-auto"
        />
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
                  {Object.entries(TRANSACTION_LABELS).filter(([k]) => k !== "old_bill_cancellation").map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
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
        <Button variant="outline" size="sm" onClick={printPdf} disabled={filtered.length === 0}>
          <Printer className="h-3.5 w-3.5 mr-1" /> Print PDF
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={filtered.length === 0 || uniqueUsers.length === 0}>
              <Printer className="h-3.5 w-3.5 mr-1" /> Print User-wise
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
            <DropdownMenuLabel>Choose user</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => printUserwisePdf("ALL")}>
              All Users (one PDF, sectioned)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {uniqueUsers.length === 0 ? (
              <DropdownMenuItem disabled>No users found</DropdownMenuItem>
            ) : (
              uniqueUsers.map((u) => (
                <DropdownMenuItem key={u} onClick={() => printUserwisePdf(u)}>
                  {u}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isSearching && (
        <div>
          <Badge variant="secondary" className="text-xs">
            Searching all dates — date filter ignored ({transactions.length} result{transactions.length === 1 ? "" : "s"})
          </Badge>
        </div>
      )}

      {/* Credit / Debit Dues — top summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-center">
          <p className="text-xs font-medium text-amber-800/80 uppercase tracking-wide">Credit Dues</p>
          <p className="text-2xl font-bold text-amber-900 mt-1">₹{totals.credit_due.toFixed(2)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">Still unpaid on credit bills (live)</p>
        </div>
        <div className="rounded-lg border border-orange-200 bg-orange-50/60 p-4 text-center">
          <p className="text-xs font-medium text-orange-800/80 uppercase tracking-wide">Debit Dues</p>
          <p className="text-2xl font-bold text-orange-900 mt-1">₹{totals.debit_due.toFixed(2)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">Still unpaid on debit bills (live)</p>
        </div>
      </div>

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
                <TableHead className="whitespace-nowrap">Visit Type</TableHead>
                <TableHead className="whitespace-nowrap">Pickup/Channel</TableHead>
                <TableHead className="whitespace-nowrap">Billing</TableHead>
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
                  <TableCell className="text-sm whitespace-nowrap">{getPatientName(r)}</TableCell>
                  {(() => {
                    const info = getRegInfo(r.registration_id);
                    return (
                      <>
                        <TableCell className="text-xs whitespace-nowrap">{info.visit}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap max-w-[140px] truncate" title={info.source}>{info.source}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {info.billing === "—" ? "—" : (
                            <Badge variant={info.billing === "credit" ? "secondary" : "default"} className="capitalize">{info.billing}</Badge>
                          )}
                        </TableCell>
                      </>
                    );
                  })()}
                  <TableCell className="text-right text-sm">₹{getRowGross(r)}</TableCell>
                  <TableCell className="text-right text-sm">₹{Number(r.discount_amount || 0)}</TableCell>
                  <TableCell className="text-right text-sm font-medium">₹{Number(r.final_amount || 0)}</TableCell>
                  {(() => {
                    const paid = getRowPaid(r);
                    const shown = formatSignedRupee(paid);
                    return (
                      <TableCell className={`text-right text-sm ${shown.negative ? "text-destructive font-medium" : ""}`}>
                        {shown.text}
                      </TableCell>
                    );
                  })()}
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
                <TableCell colSpan={9} className="text-right">Totals</TableCell>
                <TableCell className="text-right">₹{totals.gross.toFixed(2)}</TableCell>
                <TableCell className="text-right">₹{totals.discount.toFixed(2)}</TableCell>
                <TableCell className="text-right">₹{totals.final.toFixed(2)}</TableCell>
                <TableCell className={`text-right ${totals.paid < 0 ? "text-destructive" : ""}`}>
                  {totals.paid < 0 ? `-₹${Math.abs(totals.paid).toFixed(2)}` : `₹${totals.paid.toFixed(2)}`}
                </TableCell>
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
