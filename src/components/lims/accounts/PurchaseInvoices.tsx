import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, startOfMonth, endOfMonth } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { uploadBlobToCloudinary } from "@/lib/cardStorageCloudinary";
import { getCurrentUserName } from "@/lib/auth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Camera, FileText, ImagePlus, Plus, Loader2 } from "lucide-react";

type InvoiceStatus = "pending" | "paid";
type StatusFilter = "pending" | "paid" | "all";

type Company = { id: string; name: string; tds_percent: number };
type Vendor = { id: string; name: string };
type Bank = { id: string; name: string };
type PaymentMode = { id: string; name: string; requires_bank: boolean; sort_order: number };

type InvoiceMedia = {
  id: string;
  cloudinary_url: string;
  resource_type: string | null;
  file_name: string | null;
};

type PurchaseInvoice = {
  id: string;
  company_id: string;
  vendor_id: string | null;
  vendor_name: string;
  invoice_number: string;
  invoice_date: string;
  invoice_amount: number;
  tds_percent: number;
  tds_amount: number;
  net_payable: number;
  comment: string | null;
  status: InvoiceStatus;
  po_id: string | null;
  payment_mode_id: string | null;
  payment_date: string | null;
  bank_id: string | null;
  paid_at: string | null;
  paid_by: string | null;
  company?: { id: string; name: string } | null;
  vendor?: { id: string; name: string } | null;
  payment_mode?: { id: string; name: string } | null;
  bank?: { id: string; name: string } | null;
  media?: InvoiceMedia[];
};

type PoSummary = {
  id: string;
  po_number: string;
  po_date: string;
  status: string;
  vendor_id: string | null;
  vendor_name: string;
};

type PoItem = {
  id: string;
  po_id: string;
  item_name: string;
  qty_ordered: number;
  qty_received: number;
  qty_billed: number;
  unit_price: number;
  gst_percent: number;
  sort_order: number;
};

type PendingMedia = {
  id: string;
  file: File;
  previewUrl?: string;
  kind: "image" | "pdf";
};

const ALL_COMPANIES = "__all__";
const NO_PO = "__none__";
const NEW_VENDOR = "__new__";

const money = (n: number) =>
  "\u20b9" +
  Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "";
  try {
    return format(parseISO(iso), "dd-MM-yyyy");
  } catch {
    return String(iso);
  }
};

const calcLineAmount = (qty: number, unitPrice: number, gstPercent: number) =>
  round2(qty * unitPrice * (1 + gstPercent / 100));

const monthOptions = (count = 24) => {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = format(d, "yyyy-MM");
    out.push({ value, label: format(d, "MMMM yyyy") });
  }
  return out;
};

const billableQty = (item: PoItem) =>
  Math.max(0, Number(item.qty_received) - Number(item.qty_billed));

async function upsertVendorByName(name: string): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Vendor name is required");
  const { data: existing } = await supabase
    .from("accounts_vendors")
    .select("id")
    .ilike("name", trimmed)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const { data, error } = await supabase
    .from("accounts_vendors")
    .insert({ name: trimmed, is_active: true })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      const { data: again } = await supabase
        .from("accounts_vendors")
        .select("id")
        .eq("name", trimmed)
        .maybeSingle();
      if (again?.id) return again.id;
    }
    throw error;
  }
  return data.id;
}

async function refreshPoStatus(poId: string) {
  const { data: items } = await supabase
    .from("accounts_po_items")
    .select("qty_ordered, qty_received, qty_billed")
    .eq("po_id", poId);
  if (!items?.length) return;
  const allReceived = items.every(
    (i) => Number(i.qty_received) >= Number(i.qty_ordered) - 0.0001,
  );
  const allBilled = items.every(
    (i) => Number(i.qty_billed) >= Number(i.qty_received) - 0.0001 && Number(i.qty_received) > 0,
  );
  const anyBilled = items.some((i) => Number(i.qty_billed) > 0);
  let status = "open";
  if (allReceived && allBilled) status = "closed";
  else if (anyBilled) status = "partial";
  await supabase.from("accounts_purchase_orders").update({ status }).eq("id", poId);
}

const PurchaseInvoices = () => {
  const qc = useQueryClient();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  const [month, setMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const [companyFilter, setCompanyFilter] = useState(ALL_COMPANIES);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");

  const [addOpen, setAddOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payInvoice, setPayInvoice] = useState<PurchaseInvoice | null>(null);

  const [formCompanyId, setFormCompanyId] = useState("");
  const [formTdsPercent, setFormTdsPercent] = useState(0);
  const [formVendorPick, setFormVendorPick] = useState("");
  const [formVendorName, setFormVendorName] = useState("");
  const [formInvoiceDate, setFormInvoiceDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [formInvoiceNumber, setFormInvoiceNumber] = useState("");
  const [formInvoiceAmount, setFormInvoiceAmount] = useState("");
  const [formComment, setFormComment] = useState("");
  const [formPoId, setFormPoId] = useState(NO_PO);
  const [formBillQtys, setFormBillQtys] = useState<Record<string, string>>({});
  const [pendingMedia, setPendingMedia] = useState<PendingMedia[]>([]);

  const [payModeId, setPayModeId] = useState("");
  const [payDate, setPayDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [payBankId, setPayBankId] = useState("");

  const months = useMemo(() => monthOptions(), []);

  const monthRange = useMemo(() => {
    const base = parseISO(`${month}-01`);
    return {
      from: format(startOfMonth(base), "yyyy-MM-dd"),
      to: format(endOfMonth(base), "yyyy-MM-dd"),
    };
  }, [month]);

  const { data: companies = [] } = useQuery({
    queryKey: ["accounts_companies_active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts_companies")
        .select("id, name, tds_percent")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as Company[];
    },
  });

  const { data: vendors = [] } = useQuery({
    queryKey: ["accounts_vendors_active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts_vendors")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as Vendor[];
    },
  });

  const { data: banks = [] } = useQuery({
    queryKey: ["accounts_banks_active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts_banks")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as Bank[];
    },
  });

  const { data: paymentModes = [] } = useQuery({
    queryKey: ["accounts_payment_modes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts_payment_modes")
        .select("id, name, requires_bank, sort_order")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data as PaymentMode[];
    },
  });

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["accounts_purchase_invoices", month, companyFilter, statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("accounts_purchase_invoices")
        .select(
          `*, company:accounts_companies(id, name), vendor:accounts_vendors(id, name),
          payment_mode:accounts_payment_modes(id, name), bank:accounts_banks(id, name),
          media:accounts_purchase_invoice_media(id, cloudinary_url, resource_type, file_name)`,
        )
        .gte("invoice_date", monthRange.from)
        .lte("invoice_date", monthRange.to)
        .order("invoice_date", { ascending: false });
      if (companyFilter !== ALL_COMPANIES) q = q.eq("company_id", companyFilter);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as PurchaseInvoice[];
    },
  });

  const resolvedVendorId = useMemo(() => {
    if (formVendorPick && formVendorPick !== NEW_VENDOR) return formVendorPick;
    const match = vendors.find(
      (v) => v.name.toLowerCase() === formVendorName.trim().toLowerCase(),
    );
    return match?.id || null;
  }, [formVendorPick, formVendorName, vendors]);

  const { data: openPos = [] } = useQuery({
    queryKey: ["accounts_open_pos", formCompanyId, resolvedVendorId, formVendorName],
    enabled: !!formCompanyId && !!formVendorName.trim(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts_purchase_orders")
        .select("id, po_number, po_date, status, vendor_id, vendor_name")
        .eq("company_id", formCompanyId)
        .in("status", ["open", "partial"])
        .order("po_date", { ascending: false });
      if (error) throw error;
      const name = formVendorName.trim().toLowerCase();
      return (data as PoSummary[]).filter((po) => {
        if (resolvedVendorId && po.vendor_id) return po.vendor_id === resolvedVendorId;
        return po.vendor_name.trim().toLowerCase() === name;
      });
    },
  });

  const { data: poItems = [] } = useQuery({
    queryKey: ["accounts_po_items_billable", formPoId],
    enabled: formPoId !== NO_PO && !!formPoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts_po_items")
        .select("*")
        .eq("po_id", formPoId)
        .order("sort_order");
      if (error) throw error;
      return (data as PoItem[]).filter((i) => billableQty(i) > 0.0001);
    },
  });

  const poLinked = formPoId !== NO_PO && !!formPoId;

  const computedFromPo = useMemo(() => {
    if (!poLinked) return 0;
    return poItems.reduce((sum, item) => {
      const qty = parseFloat(formBillQtys[item.id] || "0");
      if (!qty || qty <= 0) return sum;
      return sum + calcLineAmount(qty, Number(item.unit_price), Number(item.gst_percent));
    }, 0);
  }, [poLinked, poItems, formBillQtys]);

  const grossAmount = poLinked ? computedFromPo : parseFloat(formInvoiceAmount || "0") || 0;
  const tdsAmount = round2(grossAmount * (formTdsPercent / 100));
  const netPayable = round2(grossAmount - tdsAmount);

  const selectedPayMode = paymentModes.find((m) => m.id === payModeId);

  useEffect(() => {
    if (!addOpen) return;
    setFormCompanyId("");
    setFormTdsPercent(0);
    setFormVendorPick("");
    setFormVendorName("");
    setFormInvoiceDate(format(new Date(), "yyyy-MM-dd"));
    setFormInvoiceNumber("");
    setFormInvoiceAmount("");
    setFormComment("");
    setFormPoId(NO_PO);
    setFormBillQtys({});
    setPendingMedia([]);
  }, [addOpen]);

  useEffect(() => {
    if (poLinked && computedFromPo > 0) {
      setFormInvoiceAmount(String(round2(computedFromPo)));
    }
  }, [poLinked, computedFromPo]);

  useEffect(() => {
    if (!payOpen || !payInvoice) return;
    setPayModeId(paymentModes[0]?.id || "");
    setPayDate(format(new Date(), "yyyy-MM-dd"));
    setPayBankId("");
  }, [payOpen, payInvoice, paymentModes]);

  const resetAddForm = () => {
    setAddOpen(false);
    pendingMedia.forEach((m) => {
      if (m.previewUrl) URL.revokeObjectURL(m.previewUrl);
    });
    setPendingMedia([]);
  };

  const addMediaFiles = (files: FileList | null, kind: "image" | "pdf") => {
    if (!files?.length) return;
    const next: PendingMedia[] = [];
    for (const file of Array.from(files)) {
      const isPdf = kind === "pdf" || file.type === "application/pdf";
      next.push({
        id: crypto.randomUUID(),
        file,
        kind: isPdf ? "pdf" : "image",
        previewUrl: isPdf ? undefined : URL.createObjectURL(file),
      });
    }
    setPendingMedia((prev) => [...prev, ...next]);
  };

  const removePendingMedia = (id: string) => {
    setPendingMedia((prev) => {
      const item = prev.find((m) => m.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((m) => m.id !== id);
    });
  };

  const saveInvoice = useMutation({
    mutationFn: async () => {
      if (!formCompanyId) throw new Error("Select a company");
      if (!formVendorName.trim()) throw new Error("Enter vendor name");
      if (!formInvoiceNumber.trim()) throw new Error("Enter invoice number");
      if (!formInvoiceDate) throw new Error("Enter invoice date");
      if (grossAmount <= 0) throw new Error("Invoice amount must be greater than zero");

      const vendorId =
        formVendorPick && formVendorPick !== NEW_VENDOR
          ? formVendorPick
          : await upsertVendorByName(formVendorName);

      const poLines: {
        po_item_id: string;
        qty_billed: number;
        unit_price: number;
        gst_percent: number;
        line_amount: number;
      }[] = [];

      if (poLinked) {
        for (const item of poItems) {
          const qty = parseFloat(formBillQtys[item.id] || "0");
          if (!qty || qty <= 0) continue;
          const max = billableQty(item);
          if (qty > max + 0.0001) {
            throw new Error(
              `Qty to bill for "${item.item_name}" exceeds received-not-billed (${max})`,
            );
          }
          poLines.push({
            po_item_id: item.id,
            qty_billed: qty,
            unit_price: Number(item.unit_price),
            gst_percent: Number(item.gst_percent),
            line_amount: calcLineAmount(qty, Number(item.unit_price), Number(item.gst_percent)),
          });
        }
      }

      const payload = {
        company_id: formCompanyId,
        vendor_id: vendorId,
        vendor_name: formVendorName.trim(),
        invoice_number: formInvoiceNumber.trim(),
        invoice_date: formInvoiceDate,
        invoice_amount: round2(grossAmount),
        tds_percent: formTdsPercent,
        tds_amount: tdsAmount,
        net_payable: netPayable,
        comment: formComment.trim() || null,
        status: "pending" as const,
        po_id: poLinked ? formPoId : null,
        created_by: getCurrentUserName(),
      };

      const { data: inv, error: invErr } = await supabase
        .from("accounts_purchase_invoices")
        .insert(payload)
        .select("id")
        .single();
      if (invErr) throw invErr;

      for (const line of poLines) {
        const { error: lineErr } = await supabase.from("accounts_invoice_po_lines").insert({
          invoice_id: inv.id,
          po_item_id: line.po_item_id,
          qty_billed: line.qty_billed,
          unit_price: line.unit_price,
          gst_percent: line.gst_percent,
          line_amount: line.line_amount,
        });
        if (lineErr) throw lineErr;

        const { data: cur } = await supabase
          .from("accounts_po_items")
          .select("qty_billed, qty_received")
          .eq("id", line.po_item_id)
          .single();
        if (!cur) throw new Error("PO item not found");
        const newBilled = round2(Number(cur.qty_billed) + line.qty_billed);
        if (newBilled > Number(cur.qty_received) + 0.0001) {
          throw new Error("Billing would exceed received quantity");
        }
        const { error: updErr } = await supabase
          .from("accounts_po_items")
          .update({ qty_billed: newBilled })
          .eq("id", line.po_item_id);
        if (updErr) throw updErr;
      }

      if (poLinked && poLines.length) {
        await refreshPoStatus(formPoId);
      }

      for (const m of pendingMedia) {
        const isPdf = m.kind === "pdf";
        const uploaded = await uploadBlobToCloudinary(m.file, {
          purpose: "bills",
          resourceType: isPdf ? "auto" : "image",
          folder: "accounts-bills",
          filename: m.file.name,
        });
        const { error: mediaErr } = await supabase.from("accounts_purchase_invoice_media").insert({
          invoice_id: inv.id,
          cloudinary_url: uploaded.secure_url,
          public_id: uploaded.public_id,
          resource_type: uploaded.resource_type,
          file_name: m.file.name,
        });
        if (mediaErr) throw mediaErr;
      }
    },
    onSuccess: () => {
      toast.success("Purchase invoice saved");
      qc.invalidateQueries({ queryKey: ["accounts_purchase_invoices"] });
      qc.invalidateQueries({ queryKey: ["accounts_open_pos"] });
      qc.invalidateQueries({ queryKey: ["accounts_po_items_billable"] });
      resetAddForm();
    },
    onError: (e: unknown) => toast.error((e as Error)?.message || "Failed to save invoice"),
  });

  const markPaid = useMutation({
    mutationFn: async () => {
      if (!payInvoice) throw new Error("No invoice selected");
      if (payInvoice.net_payable == null || Number.isNaN(Number(payInvoice.net_payable))) {
        throw new Error("Net payable is not set on this invoice");
      }
      if (!payModeId) throw new Error("Select payment mode");
      if (!payDate) throw new Error("Enter payment date");
      if (selectedPayMode?.requires_bank && !payBankId) {
        throw new Error("Select bank for this payment mode");
      }
      const { error } = await supabase
        .from("accounts_purchase_invoices")
        .update({
          status: "paid",
          payment_mode_id: payModeId,
          payment_date: payDate,
          bank_id: selectedPayMode?.requires_bank ? payBankId : null,
          paid_at: new Date().toISOString(),
          paid_by: getCurrentUserName(),
        })
        .eq("id", payInvoice.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Invoice marked paid");
      qc.invalidateQueries({ queryKey: ["accounts_purchase_invoices"] });
      setPayOpen(false);
      setPayInvoice(null);
    },
    onError: (e: unknown) => toast.error((e as Error)?.message || "Failed to mark paid"),
  });

  const onCompanyChange = (id: string) => {
    setFormCompanyId(id);
    const co = companies.find((c) => c.id === id);
    setFormTdsPercent(Number(co?.tds_percent || 0));
    setFormPoId(NO_PO);
    setFormBillQtys({});
  };

  const onVendorSelect = (val: string) => {
    setFormVendorPick(val);
    if (val && val !== NEW_VENDOR) {
      const v = vendors.find((x) => x.id === val);
      if (v) setFormVendorName(v.name);
    } else if (val === NEW_VENDOR) {
      setFormVendorName("");
    }
    setFormPoId(NO_PO);
    setFormBillQtys({});
  };

  return (
    <Card>
      <CardHeader className="py-3 space-y-0">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <CardTitle className="text-base">Purchase Invoices</CardTitle>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add Invoice
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-3 pt-3">
          <div>
            <Label className="text-xs">Month</Label>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Company</Label>
            <Select value={companyFilter} onValueChange={setCompanyFilter}>
              <SelectTrigger className="w-[180px] h-8 text-xs">
                <SelectValue placeholder="All companies" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_COMPANIES}>All companies</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-[120px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No invoices for this filter.</p>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">TDS</TableHead>
                  <TableHead className="text-right">Net payable</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Media</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="text-sm">{inv.company?.name || "—"}</TableCell>
                    <TableCell className="text-sm">{inv.vendor_name}</TableCell>
                    <TableCell className="text-sm font-medium">{inv.invoice_number}</TableCell>
                    <TableCell className="text-sm tabular-nums">{fmtDate(inv.invoice_date)}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {money(Number(inv.invoice_amount))}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {money(Number(inv.tds_amount))}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums font-medium">
                      {money(Number(inv.net_payable))}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          inv.status === "paid"
                            ? "border-emerald-600 text-emerald-700 bg-emerald-50"
                            : "border-amber-600 text-amber-800 bg-amber-50"
                        }
                      >
                        {inv.status === "paid" ? "Paid" : "Pending"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5 max-w-[140px]">
                        {(inv.media || []).map((m) => {
                          const isPdf =
                            m.resource_type === "raw" ||
                            (m.file_name || "").toLowerCase().endsWith(".pdf") ||
                            m.cloudinary_url.toLowerCase().includes(".pdf");
                          if (isPdf) {
                            return (
                              <a
                                key={m.id}
                                href={m.cloudinary_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center text-xs text-primary hover:underline"
                                title={m.file_name || "PDF"}
                              >
                                <FileText className="h-4 w-4" />
                              </a>
                            );
                          }
                          return (
                            <a key={m.id} href={m.cloudinary_url} target="_blank" rel="noreferrer">
                              <img
                                src={m.cloudinary_url}
                                alt={m.file_name || "Bill"}
                                className="h-10 w-10 rounded border object-cover"
                              />
                            </a>
                          );
                        })}
                        {!inv.media?.length && (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {inv.status === "pending" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            setPayInvoice(inv);
                            setPayOpen(true);
                          }}
                        >
                          Mark Paid
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={addOpen} onOpenChange={(o) => !o && resetAddForm()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Purchase Invoice</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Company *</Label>
                <Select value={formCompanyId} onValueChange={onCompanyChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select company" />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>TDS %</Label>
                <Input value={formTdsPercent} readOnly className="bg-muted" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Vendor (select)</Label>
                <Select value={formVendorPick} onValueChange={onVendorSelect}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick existing vendor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW_VENDOR}>Type new vendor…</SelectItem>
                    {vendors.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Vendor name *</Label>
                <Input
                  value={formVendorName}
                  onChange={(e) => {
                    setFormVendorName(e.target.value);
                    setFormPoId(NO_PO);
                    setFormBillQtys({});
                  }}
                  placeholder="Select above or type name"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label>Invoice date *</Label>
                <Input
                  type="date"
                  value={formInvoiceDate}
                  onChange={(e) => setFormInvoiceDate(e.target.value)}
                />
              </div>
              <div>
                <Label>Invoice number *</Label>
                <Input
                  value={formInvoiceNumber}
                  onChange={(e) => setFormInvoiceNumber(e.target.value)}
                />
              </div>
              <div>
                <Label>Gross amount *</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={poLinked ? String(round2(computedFromPo)) : formInvoiceAmount}
                  onChange={(e) => setFormInvoiceAmount(e.target.value)}
                  readOnly={poLinked && computedFromPo > 0}
                  className={poLinked && computedFromPo > 0 ? "bg-muted" : undefined}
                />
              </div>
            </div>

            <div>
              <Label>Comment</Label>
              <Textarea rows={2} value={formComment} onChange={(e) => setFormComment(e.target.value)} />
            </div>

            {formCompanyId && formVendorName.trim() && (
              <div>
                <Label>Link to PO (optional)</Label>
                <Select
                  value={formPoId}
                  onValueChange={(v) => {
                    setFormPoId(v);
                    setFormBillQtys({});
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No PO link" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PO}>No PO</SelectItem>
                    {openPos.map((po) => (
                      <SelectItem key={po.id} value={po.id}>
                        {po.po_number} ({fmtDate(po.po_date)}) — {po.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {openPos.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    No open/partial POs for this company & vendor.
                  </p>
                )}
              </div>
            )}

            {poLinked && poItems.length > 0 && (
              <div className="rounded-md border p-3 space-y-2">
                <p className="text-sm font-medium">Bill against received PO items</p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Recv</TableHead>
                        <TableHead className="text-right">Billed</TableHead>
                        <TableHead className="text-right">Avail</TableHead>
                        <TableHead className="text-right">Qty to bill</TableHead>
                        <TableHead className="text-right">Line amt</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {poItems.map((item) => {
                        const avail = billableQty(item);
                        const qty = parseFloat(formBillQtys[item.id] || "0") || 0;
                        const lineAmt =
                          qty > 0
                            ? calcLineAmount(qty, Number(item.unit_price), Number(item.gst_percent))
                            : 0;
                        const over = qty > avail + 0.0001;
                        return (
                          <TableRow key={item.id}>
                            <TableCell className="text-xs">{item.item_name}</TableCell>
                            <TableCell className="text-right text-xs tabular-nums">
                              {Number(item.qty_received)}
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums">
                              {Number(item.qty_billed)}
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums font-medium">
                              {avail}
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                min="0"
                                max={avail}
                                step="0.001"
                                className={`h-8 w-24 ml-auto text-right ${over ? "border-destructive" : ""}`}
                                value={formBillQtys[item.id] || ""}
                                onChange={(e) =>
                                  setFormBillQtys((prev) => ({ ...prev, [item.id]: e.target.value }))
                                }
                              />
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums">
                              {qty > 0 ? money(lineAmt) : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {poLinked && poItems.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Selected PO has no items with received-but-unbilled quantity.
              </p>
            )}

            <div className="grid grid-cols-3 gap-3 rounded-md bg-muted/50 p-3 text-sm">
              <div>
                <span className="text-muted-foreground">Gross</span>
                <p className="font-medium tabular-nums">{money(grossAmount)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">TDS ({formTdsPercent}%)</span>
                <p className="font-medium tabular-nums">{money(tdsAmount)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Net payable</span>
                <p className="font-semibold tabular-nums">{money(netPayable)}</p>
              </div>
            </div>

            <div>
              <Label>Bill media</Label>
              <div className="flex flex-wrap gap-2 mt-1.5">
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    addMediaFiles(e.target.files, "image");
                    e.target.value = "";
                  }}
                />
                <input
                  ref={galleryRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addMediaFiles(e.target.files, "image");
                    e.target.value = "";
                  }}
                />
                <input
                  ref={pdfRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    addMediaFiles(e.target.files, "pdf");
                    e.target.value = "";
                  }}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => cameraRef.current?.click()}>
                  <Camera className="h-4 w-4 mr-1" /> Camera
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => galleryRef.current?.click()}>
                  <ImagePlus className="h-4 w-4 mr-1" /> Gallery
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => pdfRef.current?.click()}>
                  <FileText className="h-4 w-4 mr-1" /> PDF
                </Button>
              </div>
              {pendingMedia.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {pendingMedia.map((m) => (
                    <div key={m.id} className="relative group">
                      {m.kind === "pdf" ? (
                        <div className="h-14 w-14 rounded border flex items-center justify-center bg-muted">
                          <FileText className="h-6 w-6 text-muted-foreground" />
                        </div>
                      ) : (
                        <img
                          src={m.previewUrl}
                          alt={m.file.name}
                          className="h-14 w-14 rounded border object-cover"
                        />
                      )}
                      <button
                        type="button"
                        className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-xs"
                        onClick={() => removePendingMedia(m.id)}
                      >
                        뿯½
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetAddForm}>
              Cancel
            </Button>
            <Button onClick={() => saveInvoice.mutate()} disabled={saveInvoice.isPending}>
              {saveInvoice.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Save Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={payOpen} onOpenChange={(o) => !o && setPayOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Paid — {payInvoice?.invoice_number}</DialogTitle>
          </DialogHeader>
          {payInvoice && (
            <div className="space-y-4">
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Gross</span>
                  <span className="tabular-nums">{money(Number(payInvoice.invoice_amount))}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">TDS ({payInvoice.tds_percent}%)</span>
                  <span className="tabular-nums">{money(Number(payInvoice.tds_amount))}</span>
                </div>
                <div className="flex justify-between font-semibold text-base pt-1 border-t">
                  <span>Net payable</span>
                  <span className="tabular-nums">{money(Number(payInvoice.net_payable))}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Payment mode *</Label>
                  <Select value={payModeId} onValueChange={setPayModeId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select mode" />
                    </SelectTrigger>
                    <SelectContent>
                      {paymentModes.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Payment date *</Label>
                  <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                </div>
              </div>

              {selectedPayMode?.requires_bank && (
                <div>
                  <Label>Bank *</Label>
                  <Select value={payBankId} onValueChange={setPayBankId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select bank" />
                    </SelectTrigger>
                    <SelectContent>
                      {banks.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => markPaid.mutate()}
              disabled={
                markPaid.isPending ||
                !payInvoice ||
                payInvoice.net_payable == null ||
                Number.isNaN(Number(payInvoice.net_payable))
              }
            >
              {markPaid.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Confirm payment {payInvoice ? money(Number(payInvoice.net_payable)) : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default PurchaseInvoices;
