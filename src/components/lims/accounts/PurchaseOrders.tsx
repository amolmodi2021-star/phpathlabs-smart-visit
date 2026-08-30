import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import jsPDF from "jspdf";
import {
  Plus,
  Loader2,
  Package,
  FileText,
  Mail,
  Download,
  Trash2,
  Eye,
  Truck,
  Receipt,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUserName } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

type PoStatus = "open" | "partial" | "closed" | "cancelled";

type Company = { id: string; name: string };
type Vendor = { id: string; name: string };

type PoItemRow = {
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

type PurchaseOrder = {
  id: string;
  po_number: string;
  company_id: string | null;
  vendor_id: string | null;
  vendor_name: string;
  po_date: string;
  status: PoStatus;
  notes: string | null;
  brand_primary: string | null;
  brand_accent: string | null;
  logo_url: string | null;
  email_to: string | null;
  email_sent_at: string | null;
  accounts_companies?: { name: string } | null;
  accounts_po_items?: PoItemRow[];
};

type ModuleSettings = {
  po_logo_url: string | null;
  po_brand_primary: string | null;
  po_brand_accent: string | null;
  email_from_name: string | null;
};

type DraftLine = {
  key: string;
  item_name: string;
  qty: string;
  unit_price: string;
  gst_percent: string;
};

type LinkedInvoice = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  invoice_amount: number;
  net_payable: number;
  status: string;
};

type ReceiveDraft = Record<string, string>;

const money = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);

const num = (v: string | number) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const lineNet = (qty: number, price: number, gst: number) =>
  qty * price * (1 + gst / 100);

const poTotals = (items: PoItemRow[]) => {
  let subtotal = 0;
  let gstTotal = 0;
  for (const it of items) {
    const base = num(it.qty_ordered) * num(it.unit_price);
    subtotal += base;
    gstTotal += base * (num(it.gst_percent) / 100);
  }
  return { subtotal, gstTotal, grand: subtotal + gstTotal };
};

const hasPendingDelivery = (items: PoItemRow[]) =>
  items.some((it) => num(it.qty_received) < num(it.qty_ordered));

const hasPendingBill = (items: PoItemRow[]) =>
  items.some((it) => num(it.qty_received) > num(it.qty_billed));

const derivePoStatus = (items: PoItemRow[]): PoStatus => {
  if (!items.length) return "open";
  const anyReceived = items.some((it) => num(it.qty_received) > 0);
  const allReceived = items.every(
    (it) => num(it.qty_received) >= num(it.qty_ordered),
  );
  if (allReceived) return "closed";
  if (anyReceived) return "partial";
  return "open";
};

const statusVariant = (status: PoStatus) => {
  if (status === "closed") return "default";
  if (status === "partial") return "secondary";
  if (status === "cancelled") return "destructive";
  return "outline";
};

const hexToRgb = (hex: string): [number, number, number] => {
  const h = (hex || "#0f766e").replace("#", "");
  if (h.length !== 6) return [15, 118, 110];
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
};

const newDraftLine = (): DraftLine => ({
  key: crypto.randomUUID(),
  item_name: "",
  qty: "1",
  unit_price: "0",
  gst_percent: "0",
});

async function generatePoNumber(poDate: string): Promise<string> {
  const datePart = format(parseISO(poDate), "yyyyMMdd");
  const prefix = `PO-${datePart}-`;
  const { data } = await supabase
    .from("accounts_purchase_orders")
    .select("po_number")
    .like("po_number", `${prefix}%`)
    .order("po_number", { ascending: false })
    .limit(1);

  if (data?.[0]?.po_number) {
    const last = parseInt(String(data[0].po_number).split("-").pop() || "0", 10);
    if (Number.isFinite(last)) {
      return `${prefix}${String(last + 1).padStart(4, "0")}`;
    }
  }
  return `${prefix}${String(Math.floor(1000 + Math.random() * 9000))}`;
}

async function resolveVendorId(vendorName: string): Promise<{ id: string | null; name: string }> {
  const trimmed = vendorName.trim();
  if (!trimmed) throw new Error("Vendor name is required");

  const { data: existing } = await supabase
    .from("accounts_vendors")
    .select("id, name")
    .ilike("name", trimmed)
    .maybeSingle();

  if (existing?.id) return { id: existing.id, name: existing.name };

  const { data: created, error } = await supabase
    .from("accounts_vendors")
    .insert({ name: trimmed })
    .select("id, name")
    .single();

  if (error) {
    const { data: retry } = await supabase
      .from("accounts_vendors")
      .select("id, name")
      .ilike("name", trimmed)
      .maybeSingle();
    if (retry?.id) return { id: retry.id, name: retry.name };
    throw error;
  }
  return { id: created.id, name: created.name };
}

async function loadImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, { mode: "cors" });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

type PdfPo = {
  po_number: string;
  po_date: string;
  vendor_name: string;
  company_name: string;
  notes: string | null;
  brand_primary: string;
  brand_accent: string;
  logo_url: string | null;
  items: PoItemRow[];
};

async function buildPoPdf(po: PdfPo): Promise<{ blob: Blob; base64: string }> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  const [pr, pg, pb] = hexToRgb(po.brand_primary);
  const [ar, ag, ab] = hexToRgb(po.brand_accent);
  let y = margin;

  doc.setFillColor(pr, pg, pb);
  doc.rect(0, 0, pageW, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Purchase Order", margin, 12);

  if (po.logo_url) {
    const logo = await loadImageAsDataUrl(po.logo_url);
    if (logo) {
      try {
        doc.addImage(logo, "PNG", pageW - margin - 24, 4, 24, 20);
      } catch {
        try {
          doc.addImage(logo, "JPEG", pageW - margin - 24, 4, 24, 20);
        } catch {
          /* skip logo */
        }
      }
    }
  }

  y = 36;
  doc.setTextColor(ar, ag, ab);
  doc.setFontSize(11);
  doc.text(po.company_name || "—", margin, y);
  y += 7;
  doc.setTextColor(60, 60, 60);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`PO #: ${po.po_number}`, margin, y);
  doc.text(`Date: ${format(parseISO(po.po_date), "dd-MM-yyyy")}`, pageW / 2, y);
  y += 6;
  doc.text(`Vendor: ${po.vendor_name}`, margin, y);
  y += 8;

  const cols = [
    { label: "Item", w: 62 },
    { label: "Qty", w: 18 },
    { label: "Rate", w: 24 },
    { label: "GST %", w: 18 },
    { label: "Net", w: 28 },
  ];
  const tableW = cols.reduce((s, c) => s + c.w, 0);
  let x = margin;

  doc.setFillColor(pr, pg, pb);
  doc.rect(margin, y, tableW, 7, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  for (const col of cols) {
    doc.text(col.label, x + 1.5, y + 5);
    x += col.w;
  }
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setTextColor(40, 40, 40);
  doc.setFontSize(9);

  for (const it of po.items) {
    if (y > 270) {
      doc.addPage();
      y = margin;
    }
    x = margin;
    const net = lineNet(num(it.qty_ordered), num(it.unit_price), num(it.gst_percent));
    const cells = [
      it.item_name,
      String(it.qty_ordered),
      num(it.unit_price).toFixed(2),
      String(it.gst_percent),
      net.toFixed(2),
    ];
    cols.forEach((col, i) => {
      const txt = cells[i].length > 34 ? `${cells[i].slice(0, 31)}…` : cells[i];
      doc.text(txt, x + 1.5, y + 5);
      x += col.w;
    });
    doc.setDrawColor(220, 220, 220);
    doc.line(margin, y + 7, margin + tableW, y + 7);
    y += 7;
  }

  const totals = poTotals(po.items);
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.text(`Subtotal: ${totals.subtotal.toFixed(2)}`, pageW - margin - 55, y);
  y += 5;
  doc.text(`GST: ${totals.gstTotal.toFixed(2)}`, pageW - margin - 55, y);
  y += 5;
  doc.setTextColor(pr, pg, pb);
  doc.text(`Grand Total: ${totals.grand.toFixed(2)}`, pageW - margin - 55, y);

  if (po.notes?.trim()) {
    y += 10;
    doc.setTextColor(80, 80, 80);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Notes:", margin, y);
    y += 5;
    const noteLines = doc.splitTextToSize(po.notes.trim(), pageW - margin * 2);
    doc.text(noteLines, margin, y);
  }

  const blob = doc.output("blob");
  const base64 = doc.output("datauristring").split(",")[1] || "";
  return { blob, base64 };
}

const PurchaseOrders = () => {
  const qc = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");

  const [generateOpen, setGenerateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedPo, setSelectedPo] = useState<PurchaseOrder | null>(null);
  const [savedPoForActions, setSavedPoForActions] = useState<PurchaseOrder | null>(null);
  const [emailTo, setEmailTo] = useState("");

  const [companyId, setCompanyId] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [poDate, setPoDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([newDraftLine()]);
  const [receiveDraft, setReceiveDraft] = useState<ReceiveDraft>({});

  const { data: settings } = useQuery({
    queryKey: ["accounts_module_settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts_module_settings")
        .select("po_logo_url, po_brand_primary, po_brand_accent, email_from_name")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return (data || {}) as ModuleSettings;
    },
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["accounts_companies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts_companies")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as Company[];
    },
  });

  const { data: vendors = [] } = useQuery({
    queryKey: ["accounts_vendors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts_vendors")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as Vendor[];
    },
  });

  const { data: purchaseOrders = [], isLoading } = useQuery({
    queryKey: ["accounts_purchase_orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts_purchase_orders")
        .select("*, accounts_companies(name), accounts_po_items(*)")
        .order("po_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as PurchaseOrder[];
    },
  });

  const { data: linkedInvoices = [], isLoading: invoicesLoading } = useQuery({
    queryKey: ["accounts_po_invoices", selectedPo?.id],
    enabled: !!selectedPo?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts_purchase_invoices")
        .select("id, invoice_number, invoice_date, invoice_amount, net_payable, status")
        .eq("po_id", selectedPo!.id)
        .order("invoice_date", { ascending: false });
      if (error) throw error;
      return (data || []) as LinkedInvoice[];
    },
  });

  const draftTotals = useMemo(() => {
    let subtotal = 0;
    let gstTotal = 0;
    for (const ln of lines) {
      const qty = num(ln.qty);
      const price = num(ln.unit_price);
      const gst = num(ln.gst_percent);
      if (!ln.item_name.trim() || qty <= 0) continue;
      const base = qty * price;
      subtotal += base;
      gstTotal += base * (gst / 100);
    }
    return { subtotal, gstTotal, grand: subtotal + gstTotal };
  }, [lines]);

  const resetGenerateForm = () => {
    setCompanyId("");
    setVendorName("");
    setPoDate(today);
    setNotes("");
    setLines([newDraftLine()]);
    setEmailTo("");
  };

  const openDetail = (po: PurchaseOrder) => {
    setSelectedPo(po);
    setReceiveDraft({});
    setEmailTo(po.email_to || "");
    setDetailOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error("Select a company");
      const validLines = lines.filter(
        (ln) => ln.item_name.trim() && num(ln.qty) > 0,
      );
      if (!validLines.length) throw new Error("Add at least one line item");

      const vendor = await resolveVendorId(vendorName);
      const po_number = await generatePoNumber(poDate);
      const brand_primary = settings?.po_brand_primary || "#0f766e";
      const brand_accent = settings?.po_brand_accent || "#134e4a";
      const logo_url = settings?.po_logo_url || null;

      const { data: po, error: poErr } = await supabase
        .from("accounts_purchase_orders")
        .insert({
          po_number,
          company_id: companyId,
          vendor_id: vendor.id,
          vendor_name: vendor.name,
          po_date: poDate,
          status: "open",
          notes: notes.trim() || null,
          brand_primary,
          brand_accent,
          logo_url,
          email_to: emailTo.trim() || null,
          created_by: getCurrentUserName(),
        })
        .select("*, accounts_companies(name), accounts_po_items(*)")
        .single();

      if (poErr) throw poErr;

      const itemRows = validLines.map((ln, idx) => ({
        po_id: po.id,
        item_name: ln.item_name.trim(),
        qty_ordered: num(ln.qty),
        qty_received: 0,
        qty_billed: 0,
        unit_price: num(ln.unit_price),
        gst_percent: num(ln.gst_percent),
        sort_order: idx,
      }));

      const { error: itemsErr } = await supabase.from("accounts_po_items").insert(itemRows);
      if (itemsErr) throw itemsErr;

      const { data: fullPo, error: reloadErr } = await supabase
        .from("accounts_purchase_orders")
        .select("*, accounts_companies(name), accounts_po_items(*)")
        .eq("id", po.id)
        .single();
      if (reloadErr) throw reloadErr;
      return fullPo as PurchaseOrder;
    },
    onSuccess: (po) => {
      toast.success(`PO ${po.po_number} saved`);
      qc.invalidateQueries({ queryKey: ["accounts_purchase_orders"] });
      qc.invalidateQueries({ queryKey: ["accounts_vendors"] });
      setGenerateOpen(false);
      setSavedPoForActions(po);
      resetGenerateForm();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to save PO"),
  });

  const receiveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPo?.accounts_po_items?.length) {
        throw new Error("No line items on this PO");
      }

      const updates: { id: string; qty_received: number }[] = [];
      for (const it of selectedPo.accounts_po_items) {
        const add = num(receiveDraft[it.id] || "0");
        if (add <= 0) continue;
        const maxAdd = num(it.qty_ordered) - num(it.qty_received);
        if (add > maxAdd + 0.0001) {
          throw new Error(
            `${it.item_name}: cannot receive more than ${maxAdd} (pending)`,
          );
        }
        updates.push({ id: it.id, qty_received: num(it.qty_received) + add });
      }

      if (!updates.length) {
        throw new Error("Enter quantity to receive for at least one item");
      }

      for (const u of updates) {
        const { error } = await supabase
          .from("accounts_po_items")
          .update({ qty_received: u.qty_received })
          .eq("id", u.id);
        if (error) throw error;
      }

      const { data: refreshedItems, error: itemsErr } = await supabase
        .from("accounts_po_items")
        .select("*")
        .eq("po_id", selectedPo.id);
      if (itemsErr) throw itemsErr;

      const nextStatus = derivePoStatus((refreshedItems || []) as PoItemRow[]);
      const { error: poErr } = await supabase
        .from("accounts_purchase_orders")
        .update({ status: nextStatus })
        .eq("id", selectedPo.id);
      if (poErr) throw poErr;

      const { data: fullPo, error: reloadErr } = await supabase
        .from("accounts_purchase_orders")
        .select("*, accounts_companies(name), accounts_po_items(*)")
        .eq("id", selectedPo.id)
        .single();
      if (reloadErr) throw reloadErr;
      return fullPo as PurchaseOrder;
    },
    onSuccess: (po) => {
      toast.success("Goods received updated");
      setSelectedPo(po);
      setReceiveDraft({});
      qc.invalidateQueries({ queryKey: ["accounts_purchase_orders"] });
    },
    onError: (e: Error) => toast.error(e.message || "Receive failed"),
  });

  const downloadPdf = async (po: PurchaseOrder) => {
    try {
      const items = (po.accounts_po_items || []).sort(
        (a, b) => a.sort_order - b.sort_order,
      );
      const { blob } = await buildPoPdf({
        po_number: po.po_number,
        po_date: po.po_date,
        vendor_name: po.vendor_name,
        company_name: po.accounts_companies?.name || "—",
        notes: po.notes,
        brand_primary: po.brand_primary || settings?.po_brand_primary || "#0f766e",
        brand_accent: po.brand_accent || settings?.po_brand_accent || "#134e4a",
        logo_url: po.logo_url || settings?.po_logo_url || null,
        items,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${po.po_number}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("PDF downloaded");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "PDF download failed");
    }
  };

  const emailPo = async (po: PurchaseOrder) => {
    const to = (emailTo || po.email_to || "").trim();
    if (!to) {
      toast.error("Enter recipient email");
      return;
    }

    try {
      const items = (po.accounts_po_items || []).sort(
        (a, b) => a.sort_order - b.sort_order,
      );
      const totals = poTotals(items);
      const { base64 } = await buildPoPdf({
        po_number: po.po_number,
        po_date: po.po_date,
        vendor_name: po.vendor_name,
        company_name: po.accounts_companies?.name || "—",
        notes: po.notes,
        brand_primary: po.brand_primary || settings?.po_brand_primary || "#0f766e",
        brand_accent: po.brand_accent || settings?.po_brand_accent || "#134e4a",
        logo_url: po.logo_url || settings?.po_logo_url || null,
        items,
      });

      const html = `<p>Dear ${po.vendor_name},</p><p>Please find attached purchase order <strong>${po.po_number}</strong> dated ${format(parseISO(po.po_date), "dd-MM-yyyy")}.</p><p>Grand total: ${money(totals.grand)}</p><p>Regards,<br/>${settings?.email_from_name || "PH PathLabs Accounts"}</p>`;

      const { data, error } = await supabase.functions.invoke("send-accounts-email", {
        body: {
          to,
          subject: `Purchase Order ${po.po_number}`,
          html,
          pdfBase64: base64,
          filename: `${po.po_number}.pdf`,
        },
      });

      if (error) {
        toast.error(
          "Email edge function unavailable — configure send-accounts-email / Resend. PDF download still works.",
        );
        return;
      }

      if (data?.error) {
        toast.error(String(data.error));
        return;
      }

      await supabase
        .from("accounts_purchase_orders")
        .update({ email_to: to, email_sent_at: new Date().toISOString() })
        .eq("id", po.id);

      toast.success("PO emailed");
      qc.invalidateQueries({ queryKey: ["accounts_purchase_orders"] });
    } catch (e: unknown) {
      toast.error(
        e instanceof Error
          ? e.message
          : "Email failed — configure send-accounts-email / Resend. PDF download still works.",
      );
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
          <div>
            <CardTitle className="text-lg">Purchase Orders</CardTitle>
            <CardDescription>
              Create POs, receive goods, and track billing against received quantities.
            </CardDescription>
          </div>
          <Button
            onClick={() => {
              resetGenerateForm();
              setGenerateOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Generate PO
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !purchaseOrders.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No purchase orders yet. Click Generate PO to create one.
            </p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PO #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Flags</TableHead>
                    <TableHead className="w-[80px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchaseOrders.map((po) => {
                    const items = po.accounts_po_items || [];
                    const totals = poTotals(items);
                    return (
                      <TableRow key={po.id}>
                        <TableCell className="font-medium tabular-nums">{po.po_number}</TableCell>
                        <TableCell>{format(parseISO(po.po_date), "dd-MM-yyyy")}</TableCell>
                        <TableCell>{po.accounts_companies?.name || "—"}</TableCell>
                        <TableCell>{po.vendor_name}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(po.status)}>{po.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(totals.grand)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {hasPendingDelivery(items) && (
                              <Badge variant="outline" className="text-amber-700 border-amber-300">
                                <Truck className="h-3 w-3 mr-1" />
                                Pending delivery
                              </Badge>
                            )}
                            {hasPendingBill(items) && (
                              <Badge variant="outline" className="text-blue-700 border-blue-300">
                                <Receipt className="h-3 w-3 mr-1" />
                                Pending bill
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => openDetail(po)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate Purchase Order</DialogTitle>
            <DialogDescription>
              PO number is assigned automatically. Branding comes from Accounts module settings.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Company</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
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
            <div className="space-y-2">
              <Label>Vendor</Label>
              <Input
                list="po-vendor-list"
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                placeholder="Select or type new vendor"
              />
              <datalist id="po-vendor-list">
                {vendors.map((v) => (
                  <option key={v.id} value={v.name} />
                ))}
              </datalist>
            </div>
            <div className="space-y-2">
              <Label>PO date</Label>
              <Input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email to (optional)</Label>
              <Input
                type="email"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                placeholder="vendor@example.com"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Line items</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLines((prev) => [...prev, newDraftLine()])}
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Add row
              </Button>
            </div>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="w-[90px]">Qty</TableHead>
                    <TableHead className="w-[110px]">Unit price</TableHead>
                    <TableHead className="w-[90px]">GST %</TableHead>
                    <TableHead className="text-right w-[120px]">Line net</TableHead>
                    <TableHead className="w-[40px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((ln) => {
                    const net = lineNet(num(ln.qty), num(ln.unit_price), num(ln.gst_percent));
                    return (
                      <TableRow key={ln.key}>
                        <TableCell>
                          <Input
                            value={ln.item_name}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((r) =>
                                  r.key === ln.key ? { ...r, item_name: e.target.value } : r,
                                ),
                              )
                            }
                            placeholder="Item name"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            value={ln.qty}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((r) =>
                                  r.key === ln.key ? { ...r, qty: e.target.value } : r,
                                ),
                              )
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            value={ln.unit_price}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((r) =>
                                  r.key === ln.key ? { ...r, unit_price: e.target.value } : r,
                                ),
                              )
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            value={ln.gst_percent}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((r) =>
                                  r.key === ln.key ? { ...r, gst_percent: e.target.value } : r,
                                ),
                              )
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{money(net)}</TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={lines.length <= 1}
                            onClick={() =>
                              setLines((prev) => prev.filter((r) => r.key !== ln.key))
                            }
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end gap-6 text-sm">
              <span>
                Subtotal: <strong>{money(draftTotals.subtotal)}</strong>
              </span>
              <span>
                GST: <strong>{money(draftTotals.gstTotal)}</strong>
              </span>
              <span>
                Grand: <strong>{money(draftTotals.grand)}</strong>
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Save PO
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!savedPoForActions} onOpenChange={(o) => !o && setSavedPoForActions(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>PO saved — {savedPoForActions?.po_number}</DialogTitle>
            <DialogDescription>Download PDF or email the vendor.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => savedPoForActions && downloadPdf(savedPoForActions)}
            >
              <Download className="h-4 w-4 mr-1.5" /> Download PDF
            </Button>
            <Button onClick={() => savedPoForActions && emailPo(savedPoForActions)}>
              <Mail className="h-4 w-4 mr-1.5" /> Email PO
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {selectedPo && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  {selectedPo.po_number}
                </DialogTitle>
                <DialogDescription>
                  {selectedPo.vendor_name} · {format(parseISO(selectedPo.po_date), "dd-MM-yyyy")}{" "}
                  · {selectedPo.accounts_companies?.name}
                </DialogDescription>
              </DialogHeader>

              <Alert>
                <FileText className="h-4 w-4" />
                <AlertDescription>
                  Invoices can only bill received quantities — pay via Purchase tab.
                </AlertDescription>
              </Alert>

              <div className="flex flex-wrap gap-2 items-center">
                <Badge variant={statusVariant(selectedPo.status)}>{selectedPo.status}</Badge>
                {hasPendingDelivery(selectedPo.accounts_po_items || []) && (
                  <Badge variant="outline">Pending delivery</Badge>
                )}
                {hasPendingBill(selectedPo.accounts_po_items || []) && (
                  <Badge variant="outline">Pending bill</Badge>
                )}
              </div>

              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Ordered</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">Billed</TableHead>
                      <TableHead className="text-right">Receive now</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(selectedPo.accounts_po_items || [])
                      .sort((a, b) => a.sort_order - b.sort_order)
                      .map((it) => {
                        const pending = Math.max(0, num(it.qty_ordered) - num(it.qty_received));
                        return (
                          <TableRow key={it.id}>
                            <TableCell>{it.item_name}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {it.qty_ordered}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {it.qty_received}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {it.qty_billed}
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                min="0"
                                max={pending}
                                step="any"
                                className="w-24 ml-auto"
                                placeholder={pending > 0 ? String(pending) : "0"}
                                disabled={pending <= 0}
                                value={receiveDraft[it.id] || ""}
                                onChange={(e) =>
                                  setReceiveDraft((prev) => ({
                                    ...prev,
                                    [it.id]: e.target.value,
                                  }))
                                }
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-end">
                <Button onClick={() => receiveMutation.mutate()} disabled={receiveMutation.isPending}>
                  {receiveMutation.isPending && (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  )}
                  Update received quantities
                </Button>
              </div>

              <div className="space-y-2 border-t pt-4">
                <h4 className="text-sm font-semibold">Linked invoices</h4>
                {invoicesLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : !linkedInvoices.length ? (
                  <p className="text-sm text-muted-foreground">
                    No invoices linked to this PO yet.
                  </p>
                ) : (
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice #</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-right">Net payable</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {linkedInvoices.map((inv) => (
                          <TableRow key={inv.id}>
                            <TableCell>{inv.invoice_number}</TableCell>
                            <TableCell>
                              {format(parseISO(inv.invoice_date), "dd-MM-yyyy")}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {money(num(inv.invoice_amount))}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {money(num(inv.net_payable))}
                            </TableCell>
                            <TableCell>
                              <Badge variant={inv.status === "paid" ? "default" : "secondary"}>
                                {inv.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] items-end border-t pt-4">
                <div className="space-y-1">
                  <Label>Email to</Label>
                  <Input
                    type="email"
                    value={emailTo}
                    onChange={(e) => setEmailTo(e.target.value)}
                    placeholder="vendor@example.com"
                  />
                </div>
                <Button variant="outline" onClick={() => downloadPdf(selectedPo)}>
                  <Download className="h-4 w-4 mr-1.5" /> PDF
                </Button>
                <Button onClick={() => emailPo(selectedPo)}>
                  <Mail className="h-4 w-4 mr-1.5" /> Email
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PurchaseOrders;
