import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Pencil, Plus, Search, Upload } from "lucide-react";
import { exportToExcel, parseExcelFile } from "@/lib/excel";

export type PoCatalogItem = {
  id: string;
  item_code: string;
  item_name: string;
  company_name: string;
  alias_name: string;
  gst_rate: number;
  price: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

type CompanyOption = { id: string; name: string };

const QUERY_KEY = "accounts_po_catalog_items";
const COMPANIES_KEY = "accounts_companies";

const EXCEL_HEADERS = {
  code: "Item Code",
  name: "Item Name",
  company: "Company Name",
  alias: "Alias Name",
  gst: "GST Rate",
  price: "Price",
  active: "Active",
} as const;

function num(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : fallback;
}

function parseActive(v: unknown, fallback = true): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return fallback;
  if (["yes", "y", "true", "1", "active"].includes(s)) return true;
  if (["no", "n", "false", "0", "inactive"].includes(s)) return false;
  return fallback;
}

function cell(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return row[key];
    }
  }
  const lowerMap = new Map(
    Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]),
  );
  for (const key of keys) {
    const hit = lowerMap.get(key.trim().toLowerCase());
    if (hit !== undefined && hit !== null && String(hit).trim() !== "") return hit;
  }
  return "";
}

function StatusCell({ active }: { active: boolean }) {
  return (
    <span className={active ? "text-xs text-emerald-700" : "text-xs text-muted-foreground"}>
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function toExcelRows(rows: PoCatalogItem[]) {
  return rows.map((r) => ({
    [EXCEL_HEADERS.code]: r.item_code,
    [EXCEL_HEADERS.name]: r.item_name,
    [EXCEL_HEADERS.company]: r.company_name,
    [EXCEL_HEADERS.alias]: r.alias_name || "",
    [EXCEL_HEADERS.gst]: Number(r.gst_rate),
    [EXCEL_HEADERS.price]: Number(r.price),
    [EXCEL_HEADERS.active]: r.is_active ? "Yes" : "No",
  }));
}

const PoItems = () => {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PoCatalogItem | null>(null);
  const [itemName, setItemName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [aliasName, setAliasName] = useState("");
  const [gstRate, setGstRate] = useState("0");
  const [price, setPrice] = useState("0");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: [QUERY_KEY],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts_po_catalog_items" as any)
        .select("id, item_code, item_name, company_name, alias_name, gst_rate, price, is_active, created_at, updated_at")
        .order("item_code");
      if (error) throw error;
      return (data || []) as PoCatalogItem[];
    },
  });

  const { data: companies = [] } = useQuery({
    queryKey: [COMPANIES_KEY, "active_for_po_items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts_companies" as any)
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as CompanyOption[];
    },
  });

  const companyByLower = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of companies) map.set(c.name.trim().toLowerCase(), c.name);
    return map;
  }, [companies]);

  const resolveCompanyName = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return companyByLower.get(trimmed.toLowerCase()) || null;
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showInactive && !r.is_active) return false;
      if (!q) return true;
      return (
        r.item_code.toLowerCase().includes(q) ||
        r.item_name.toLowerCase().includes(q) ||
        (r.company_name || "").toLowerCase().includes(q) ||
        (r.alias_name || "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, showInactive]);

  const openAdd = () => {
    setEditing(null);
    setItemName("");
    setCompanyName("");
    setAliasName("");
    setGstRate("0");
    setPrice("0");
    setDialogOpen(true);
  };

  const openEdit = (row: PoCatalogItem) => {
    setEditing(row);
    setItemName(row.item_name);
    const matched = resolveCompanyName(row.company_name || "") || row.company_name || "";
    setCompanyName(matched);
    setGstRate(String(row.gst_rate ?? 0));
    setPrice(String(row.price ?? 0));
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const name = itemName.trim();
      if (!name) throw new Error("Item name is required");
      const company = resolveCompanyName(companyName);
      if (!company) throw new Error("Select the company this item is ordered from");
      const gst = num(gstRate);
      const amt = num(price);
      if (gst < 0 || gst > 100) throw new Error("GST Rate must be between 0 and 100");
      if (amt < 0) throw new Error("Price cannot be negative");

      if (editing) {
        const { error } = await supabase
          .from("accounts_po_catalog_items" as any)
          .update({
            item_name: name,
            company_name: company,
            alias_name: aliasName.trim(),
            gst_rate: gst,
            price: amt,
          } as any)
          .eq("id", editing.id);
        if (error) throw error;
        return;
      }

      const { error } = await supabase.from("accounts_po_catalog_items" as any).insert({
        item_name: name,
        company_name: company,
        alias_name: aliasName.trim(),
        gst_rate: gst,
        price: amt,
        is_active: true,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      setDialogOpen(false);
      toast.success(editing ? "Item updated" : "Item added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("accounts_po_catalog_items" as any)
        .update({ is_active } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      toast.success("Updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const parsed = await parseExcelFile(file);
      if (!parsed.length) throw new Error("Excel file has no data rows");

      const toUpsert: Array<{
        item_code: string;
        item_name: string;
        company_name: string;
        alias_name: string;
        gst_rate: number;
        price: number;
        is_active: boolean;
      }> = [];
      const toInsert: Array<{
        item_name: string;
        company_name: string;
        alias_name: string;
        gst_rate: number;
        price: number;
        is_active: boolean;
      }> = [];

      const errors: string[] = [];

      parsed.forEach((raw, idx) => {
        const row = raw as Record<string, unknown>;
        const excelRow = idx + 2;
        const code = String(cell(row, EXCEL_HEADERS.code, "Code", "item_code") || "").trim().toUpperCase();
        const name = String(cell(row, EXCEL_HEADERS.name, "Name", "item_name") || "").trim();
        const companyRaw = String(cell(row, EXCEL_HEADERS.company, "Company", "company_name") || "").trim();
        const alias = String(cell(row, EXCEL_HEADERS.alias, "Alias", "alias_name") || "").trim();
        const gst = num(cell(row, EXCEL_HEADERS.gst, "GST", "GST %", "gst_rate"));
        const amt = num(cell(row, EXCEL_HEADERS.price, "Unit Price", "price"));
        const active = parseActive(cell(row, EXCEL_HEADERS.active, "Status", "is_active"), true);

        if (!name) {
          errors.push(`Row ${excelRow}: Item Name is required`);
          return;
        }
        const company = resolveCompanyName(companyRaw);
        if (!company) {
          errors.push(
            `Row ${excelRow}: Company Name must match an Accounts → Settings company` +
              (companyRaw ? ` (got "${companyRaw}")` : ""),
          );
          return;
        }
        if (gst < 0 || gst > 100) {
          errors.push(`Row ${excelRow}: GST Rate must be 0–100`);
          return;
        }
        if (amt < 0) {
          errors.push(`Row ${excelRow}: Price cannot be negative`);
          return;
        }

        if (code) {
          toUpsert.push({
            item_code: code,
            item_name: name,
            company_name: company,
            alias_name: alias,
            gst_rate: gst,
            price: amt,
            is_active: active,
          });
        } else {
          toInsert.push({
            item_name: name,
            company_name: company,
            alias_name: alias,
            gst_rate: gst,
            price: amt,
            is_active: active,
          });
        }
      });

      if (errors.length) {
        throw new Error(errors.slice(0, 5).join("; ") + (errors.length > 5 ? ` (+${errors.length - 5} more)` : ""));
      }

      let upserted = 0;
      let inserted = 0;

      const chunkSize = 200;
      for (let i = 0; i < toUpsert.length; i += chunkSize) {
        const chunk = toUpsert.slice(i, i + chunkSize);
        const { error } = await supabase
          .from("accounts_po_catalog_items" as any)
          .upsert(chunk as any, { onConflict: "item_code" });
        if (error) throw error;
        upserted += chunk.length;
      }

      for (let i = 0; i < toInsert.length; i += chunkSize) {
        const chunk = toInsert.slice(i, i + chunkSize);
        const { error } = await supabase.from("accounts_po_catalog_items" as any).insert(chunk as any);
        if (error) throw error;
        inserted += chunk.length;
      }

      await supabase.rpc("accounts_po_catalog_sync_code_seq" as any);
      return { upserted, inserted };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      toast.success(`Import done — ${r.upserted} upserted, ${r.inserted} new`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const downloadTemplate = () => {
    exportToExcel(
      [
        {
          [EXCEL_HEADERS.code]: "",
          [EXCEL_HEADERS.name]: "Sample reagent kit",
          [EXCEL_HEADERS.company]: companies[0]?.name || "Company from Settings",
          [EXCEL_HEADERS.gst]: 18,
          [EXCEL_HEADERS.price]: 1250,
          [EXCEL_HEADERS.active]: "Yes",
        },
      ],
      "po_items_template",
    );
  };

  const exportList = () => {
    if (!rows.length) {
      toast.error("No items to export");
      return;
    }
    exportToExcel(toExcelRows(rows), `po_items_${new Date().toISOString().slice(0, 10)}`);
    toast.success("Exported");
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="py-3 flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="text-sm">PO Items</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Master list for purchase orders. Pick the company each item is ordered from (Settings → Companies).
              Item codes are auto-generated; Excel re-upload upserts by Item Code.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" className="h-8" onClick={openAdd}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add
            </Button>
            <Button size="sm" variant="outline" className="h-8" onClick={downloadTemplate}>
              <FileSpreadsheet className="h-3.5 w-3.5 mr-1" /> Template
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={uploadMutation.isPending}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5 mr-1" />
              {uploadMutation.isPending ? "Importing…" : "Import Excel"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadMutation.mutate(f);
                e.target.value = "";
              }}
            />
            <Button size="sm" variant="outline" className="h-8" onClick={exportList}>
              <Download className="h-3.5 w-3.5 mr-1" /> Export
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8 h-9"
                placeholder="Search code / name / company…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              variant={showInactive ? "secondary" : "outline"}
              className="h-8"
              onClick={() => setShowInactive((v) => !v)}
            >
              {showInactive ? "Showing inactive" : "Show inactive"}
            </Button>
            <Badge variant="secondary">{filtered.length}</Badge>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-9">Item Code</TableHead>
                  <TableHead className="h-9">Item Name</TableHead>
                  <TableHead className="h-9">Alias</TableHead>
                  <TableHead className="h-9">Company</TableHead>
                  <TableHead className="h-9 text-right">GST %</TableHead>
                  <TableHead className="h-9 text-right">Price</TableHead>
                  <TableHead className="h-9">Status</TableHead>
                  <TableHead className="h-9 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-6">
                      Loading…
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-6">
                      No PO items yet. Add one or import from Excel.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((row) => (
                  <TableRow key={row.id} className={!row.is_active ? "opacity-60" : undefined}>
                    <TableCell className="py-2 font-mono text-sm">{row.item_code}</TableCell>
                    <TableCell className="py-2 text-sm font-medium">{row.item_name}</TableCell>
                    <TableCell className="py-2 text-sm text-muted-foreground">{row.alias_name || "—"}</TableCell>
                    <TableCell className="py-2 text-sm">{row.company_name || "—"}</TableCell>
                    <TableCell className="py-2 text-sm text-right tabular-nums">{Number(row.gst_rate)}</TableCell>
                    <TableCell className="py-2 text-sm text-right tabular-nums">
                      {Number(row.price).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="py-2"><StatusCell active={row.is_active} /></TableCell>
                    <TableCell className="py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => openEdit(row)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7"
                          onClick={() => toggleActive.mutate({ id: row.id, is_active: !row.is_active })}
                        >
                          {row.is_active ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit PO Item" : "Add PO Item"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {editing && (
              <div>
                <Label className="text-xs">Item Code</Label>
                <Input value={editing.item_code} disabled className="h-9 font-mono" />
              </div>
            )}
            {!editing && (
              <p className="text-xs text-muted-foreground">
                Item code will be generated automatically (e.g. POI00001).
              </p>
            )}
            <div>
              <Label className="text-xs">Item Name</Label>
              <Input value={itemName} onChange={(e) => setItemName(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">Company (order from) *</Label>
              <Select value={companyName || undefined} onValueChange={setCompanyName}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={companies.length ? "Select company" : "Add companies in Settings first"} />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!companies.length && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  No active companies. Add them under Accounts → Settings → Companies.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">GST Rate (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.001}
                  value={gstRate}
                  onChange={(e) => setGstRate(e.target.value)}
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs">Price</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !companies.length}>
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PoItems;
