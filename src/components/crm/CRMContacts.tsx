import { useState } from "react";
import { format } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { exportToExcel, parseExcelFile } from "@/lib/excel";
import { Download, Search, Pencil, Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";

const CRMContacts = () => {
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("ALL");
  const [tagFilter, setTagFilter] = useState("ALL");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;
  const qc = useQueryClient();

  // Edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editContact, setEditContact] = useState<any>(null);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [editSaving, setEditSaving] = useState(false);

  // Bulk update state
  const [bulkUpdating, setBulkUpdating] = useState(false);

  // Delete state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteMode, setDeleteMode] = useState<"selected" | "all">("selected");
  const [deleting, setDeleting] = useState(false);

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ["crm-contacts", locationFilter, tagFilter, search, page],
    queryFn: async () => {
      let q = supabase.from("crm_contacts").select("*")
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (locationFilter !== "ALL") q = q.eq("location", locationFilter);
      if (tagFilter !== "ALL") q = q.eq("record_tag", tagFilter);
      if (search) q = q.or(`patient_name.ilike.%${search}%,mobile_number.ilike.%${search}%,umr_number.ilike.%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      // Sort client-side: PH VESU first (by visit_date desc), then NON PHPL (by created_at desc)
      const parseDate = (d: string | null) => {
        if (!d) return 0;
        const parts = d.split("-");
        if (parts.length === 3) return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).getTime() || 0;
        return 0;
      };
      return (data || []).sort((a: any, b: any) => {
        const locA = a.location === "PH VESU" ? 0 : 1;
        const locB = b.location === "PH VESU" ? 0 : 1;
        if (locA !== locB) return locA - locB;
        if (a.location === "PH VESU") return parseDate(b.visit_date) - parseDate(a.visit_date);
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    },
  });

  const { data: totalCount = 0 } = useQuery({
    queryKey: ["crm-contacts-count"],
    queryFn: async () => {
      const { count, error } = await supabase.from("crm_contacts").select("*", { count: "exact", head: true });
      if (error) throw error;
      return count || 0;
    },
  });

  const toggleSelect = (id: string) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };

  const toggleAll = () => {
    if (selected.size === contacts.length) setSelected(new Set());
    else setSelected(new Set(contacts.map((c: any) => c.id)));
  };

  const daysSince = (d: string | null) => {
    if (!d) return "—";
    const diff = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
    return diff >= 0 ? diff : "—";
  };

  const handleExport = async () => {
    toast.info("Fetching all contacts for export...");
    try {
      const allContacts: any[] = [];
      const BATCH = 1000;
      let from = 0;
      let hasMore = true;
      while (hasMore) {
        let q = supabase.from("crm_contacts").select("*").range(from, from + BATCH - 1);
        if (locationFilter !== "ALL") q = q.eq("location", locationFilter);
        if (tagFilter !== "ALL") q = q.eq("record_tag", tagFilter);
        if (search) q = q.or(`patient_name.ilike.%${search}%,mobile_number.ilike.%${search}%,umr_number.ilike.%${search}%`);
        const { data, error } = await q;
        if (error) throw error;
        if (!data || data.length === 0) { hasMore = false; break; }
        allContacts.push(...data);
        if (data.length < BATCH) hasMore = false;
        else from += BATCH;
      }
      if (!allContacts.length) return toast.error("No data to export");
      const rows = allContacts.map((c: any) => ({
        "Primary Key": c.primary_key,
        Location: c.location,
        UMR: c.umr_number,
        "Bill #": c.bill_number,
        "Visit Date": c.visit_date,
        "Patient Name": c.patient_name,
        Mobile: c.mobile_number,
        "Visit Type": c.visit_type,
        Doctor: c.doctor_name,
        "Gross Amt": c.gross_amount,
        "Discount Amt": c.discount_amount,
        "Net Amt": c.net_amount,
        "Paid Amt": c.paid_amount,
        "Due Amt": c.due_amount,
        "Payment Type": c.payment_type,
        Remarks: c.remarks,
        "Created By": c.created_by,
        Tag: c.record_tag,
        "Discount %": c.default_discount_pct,
        "Last Sent": c.last_sent_type,
        "Last Sent Date": c.last_sent_date,
      }));
      exportToExcel(rows, `CRM_Contacts_${new Date().toISOString().slice(0, 10)}`);
      toast.success(`Exported ${allContacts.length} contacts!`);
    } catch (err) {
      console.error(err);
      toast.error("Export failed");
    }
  };

  const EDITABLE_FIELDS = [
    { key: "patient_name", label: "Patient Name", uppercase: true },
    { key: "mobile_number", label: "Mobile Number" },
    { key: "umr_number", label: "UMR Number" },
    { key: "location", label: "Location" },
    { key: "visit_date", label: "Visit Date" },
    { key: "bill_number", label: "Bill Number" },
    { key: "visit_type", label: "Visit Type" },
    { key: "doctor_name", label: "Doctor Name", uppercase: true },
    { key: "gross_amount", label: "Gross Amount" },
    { key: "discount_amount", label: "Discount Amount" },
    { key: "net_amount", label: "Net Amount" },
    { key: "paid_amount", label: "Paid Amount" },
    { key: "due_amount", label: "Due Amount" },
    { key: "payment_type", label: "Payment Type" },
    { key: "remarks", label: "Remarks" },
    { key: "created_by", label: "Created By" },
    { key: "record_tag", label: "Tag" },
    { key: "default_discount_pct", label: "Default Discount %" },
  ];

  const openEdit = (contact: any) => {
    setEditContact(contact);
    const fields: Record<string, string> = {};
    EDITABLE_FIELDS.forEach(f => { fields[f.key] = String(contact[f.key] ?? ""); });
    setEditFields(fields);
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editContact) return;
    setEditSaving(true);
    const updates: Record<string, any> = {};
    EDITABLE_FIELDS.forEach(f => {
      let val = editFields[f.key] ?? "";
      if (f.uppercase) val = val.toUpperCase();
      if (["gross_amount", "discount_amount", "net_amount", "paid_amount", "due_amount", "default_discount_pct"].includes(f.key)) {
        updates[f.key] = parseFloat(val) || 0;
      } else {
        updates[f.key] = val || null;
      }
    });
    // Recalculate primary_key from UMR + mobile
    const umr = String(updates.umr_number || "").trim();
    const mob = String(updates.mobile_number || "").replace(/\D/g, "").slice(-10);
    if (mob.length === 10) {
      updates.primary_key = `${umr}|${mob}`;
    }
    const { error } = await supabase.from("crm_contacts").update(updates).eq("id", editContact.id);
    setEditSaving(false);
    if (error) {
      toast.error("Failed to update contact");
    } else {
      toast.success("Contact updated");
      setEditOpen(false);
      qc.invalidateQueries({ queryKey: ["crm-contacts"] });
    }
  };

  const handleBulkNameUpdate = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const rows = await parseExcelFile(file);
      if (!rows.length) return toast.error("No data in file");

      const keys = Object.keys(rows[0]);
      // Expect columns: primary_key (or mobile_number) and patient_name
      // Try to find by header name first
      const pkCol = keys.find(k => k.toLowerCase().includes("primary") || k.toLowerCase().includes("key"));
      const mobileCol = keys.find(k => k.toLowerCase().includes("mobile") || k.toLowerCase().includes("phone"));
      const nameCol = keys.find(k => k.toLowerCase().includes("name") || k.toLowerCase().includes("patient"));

      if (!nameCol) return toast.error("Excel must have a column with 'name' or 'patient' in the header");
      if (!pkCol && !mobileCol) return toast.error("Excel must have a 'primary_key' or 'mobile' column");

      setBulkUpdating(true);
      let updated = 0, failed = 0;

      for (const row of rows) {
        const name = String(row[nameCol!] || "").trim().toUpperCase();
        if (!name) { failed++; continue; }

        let q;
        if (pkCol && row[pkCol]) {
          q = supabase.from("crm_contacts").update({ patient_name: name }).eq("primary_key", String(row[pkCol]).trim());
        } else if (mobileCol && row[mobileCol]) {
          const mob = String(row[mobileCol]).replace(/\D/g, "").slice(-10);
          if (mob.length !== 10) { failed++; continue; }
          q = supabase.from("crm_contacts").update({ patient_name: name }).eq("mobile_number", mob);
        } else {
          failed++; continue;
        }

        const { error } = await q;
        if (error) failed++; else updated++;
      }

      setBulkUpdating(false);
      qc.invalidateQueries({ queryKey: ["crm-contacts"] });
      toast.success(`Bulk update: ${updated} updated, ${failed} failed`);
    } catch {
      setBulkUpdating(false);
      toast.error("Failed to parse Excel");
    }
  };

  const handleBulkDiscountUpdate = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const rows = await parseExcelFile(file);
      if (!rows.length) return toast.error("No data in file");

      const keys = Object.keys(rows[0]);
      const pkCol = keys.find(k => k.toLowerCase().includes("primary") || k.toLowerCase().includes("key"));
      const mobileCol = keys.find(k => k.toLowerCase().includes("mobile") || k.toLowerCase().includes("phone"));
      const umrCol = keys.find(k => k.toLowerCase().includes("umr"));
      const discountCol = keys.find(k => k.toLowerCase().includes("discount") || k.toLowerCase().includes("%"));

      if (!discountCol) return toast.error("Excel must have a column with 'discount' or '%' in the header");
      if (!pkCol && !mobileCol && !umrCol) return toast.error("Excel must have a 'primary_key', 'mobile', or 'umr' column");

      setBulkUpdating(true);
      let updated = 0, failed = 0;

      for (const row of rows) {
        const discount = parseFloat(String(row[discountCol!] || "0")) || 0;

        let q;
        if (pkCol && row[pkCol]) {
          q = supabase.from("crm_contacts").update({ default_discount_pct: discount }).eq("primary_key", String(row[pkCol]).trim());
        } else if (umrCol && row[umrCol]) {
          q = supabase.from("crm_contacts").update({ default_discount_pct: discount }).eq("umr_number", String(row[umrCol]).trim());
        } else if (mobileCol && row[mobileCol]) {
          const mob = String(row[mobileCol]).replace(/\D/g, "").slice(-10);
          if (mob.length !== 10) { failed++; continue; }
          q = supabase.from("crm_contacts").update({ default_discount_pct: discount }).eq("mobile_number", mob);
        } else {
          failed++; continue;
        }

        const { error } = await q;
        if (error) failed++; else updated++;
      }

      setBulkUpdating(false);
      qc.invalidateQueries({ queryKey: ["crm-contacts"] });
      toast.success(`Bulk discount update: ${updated} updated, ${failed} failed`);
    } catch {
      setBulkUpdating(false);
      toast.error("Failed to parse Excel");
    }
  };

  const handleBulkLastSentUpdate = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const rows = await parseExcelFile(file);
      if (!rows.length) return toast.error("No data in file");

      const keys = Object.keys(rows[0]);
      const pkCol = keys.find(k => k.toLowerCase().includes("primary") || k.toLowerCase().includes("key"));
      const mobileCol = keys.find(k => k.toLowerCase().includes("mobile") || k.toLowerCase().includes("phone"));
      const umrCol = keys.find(k => k.toLowerCase().includes("umr"));
      const dateCol = keys.find(k => k.toLowerCase().includes("date") || k.toLowerCase().includes("sent"));
      const typeCol = keys.find(k => k.toLowerCase().includes("type") || k.toLowerCase().includes("channel"));

      if (!dateCol) return toast.error("Excel must have a column with 'date' or 'sent' in the header");
      if (!pkCol && !mobileCol && !umrCol) return toast.error("Excel must have a 'primary_key', 'mobile', or 'umr' column");

      setBulkUpdating(true);
      let updated = 0, failed = 0;

      for (const row of rows) {
        const dateStr = String(row[dateCol!] || "").trim();
        if (!dateStr) { failed++; continue; }

        // Parse dd-mm-yyyy or yyyy-mm-dd to ISO
        let isoDate: string;
        const ddmmyyyy = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (ddmmyyyy) {
          isoDate = `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}T00:00:00Z`;
        } else {
          const parsed = new Date(dateStr);
          if (isNaN(parsed.getTime())) { failed++; continue; }
          isoDate = parsed.toISOString();
        }

        const updates: Record<string, any> = { last_sent_date: isoDate };
        if (typeCol && row[typeCol]) updates.last_sent_type = String(row[typeCol]).trim();

        let q;
        if (pkCol && row[pkCol]) {
          q = supabase.from("crm_contacts").update(updates).eq("primary_key", String(row[pkCol]).trim());
        } else if (umrCol && row[umrCol]) {
          q = supabase.from("crm_contacts").update(updates).eq("umr_number", String(row[umrCol]).trim());
        } else if (mobileCol && row[mobileCol]) {
          const mob = String(row[mobileCol]).replace(/\D/g, "").slice(-10);
          if (mob.length !== 10) { failed++; continue; }
          q = supabase.from("crm_contacts").update(updates).eq("mobile_number", mob);
        } else {
          failed++; continue;
        }

        const { error } = await q;
        if (error) failed++; else updated++;
      }

      setBulkUpdating(false);
      qc.invalidateQueries({ queryKey: ["crm-contacts"] });
      toast.success(`Bulk last sent update: ${updated} updated, ${failed} failed`);
    } catch {
      setBulkUpdating(false);
      toast.error("Failed to parse Excel");
    }
  };

  const handleDelete = async () => {
    if (deletePassword !== "9819111107") return toast.error("Incorrect password");
    setDeleting(true);
    try {
      if (deleteMode === "all") {
        // Delete all in batches
        let hasMore = true;
        while (hasMore) {
          const { data } = await supabase.from("crm_contacts").select("id").limit(500);
          if (!data || data.length === 0) { hasMore = false; break; }
          const ids = data.map((r: any) => r.id);
          await supabase.from("crm_contacts").delete().in("id", ids);
        }
        toast.success("All contacts deleted");
      } else {
        if (selected.size === 0) { setDeleting(false); return toast.error("No contacts selected"); }
        const ids = Array.from(selected);
        for (let i = 0; i < ids.length; i += 100) {
          await supabase.from("crm_contacts").delete().in("id", ids.slice(i, i + 100));
        }
        toast.success(`${ids.length} contacts deleted`);
        setSelected(new Set());
      }
      qc.invalidateQueries({ queryKey: ["crm-contacts"] });
      qc.invalidateQueries({ queryKey: ["crm-contacts-count"] });
      setDeleteOpen(false);
      setDeletePassword("");
    } catch {
      toast.error("Delete failed");
    }
    setDeleting(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search name, mobile, UMR..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="pl-8" />
        </div>
        <Select value={locationFilter} onValueChange={(v) => { setLocationFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Locations</SelectItem>
            <SelectItem value="PH VESU">PH VESU</SelectItem>
            <SelectItem value="NON PHPL">NON PHPL</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tagFilter} onValueChange={(v) => { setTagFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Tags</SelectItem>
            <SelectItem value="DAILY">DAILY</SelectItem>
            <SelectItem value="NON PHPL">NON PHPL</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="h-4 w-4 mr-1" />Export</Button>
        <label className="cursor-pointer">
          <Button variant="outline" size="sm" asChild disabled={bulkUpdating}>
            <span><Upload className="h-4 w-4 mr-1" />{bulkUpdating ? "Updating..." : "Bulk Update Names"}</span>
          </Button>
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleBulkNameUpdate} disabled={bulkUpdating} />
        </label>
        <label className="cursor-pointer">
          <Button variant="outline" size="sm" asChild disabled={bulkUpdating}>
            <span><Upload className="h-4 w-4 mr-1" />{bulkUpdating ? "Updating..." : "Bulk Update Discount"}</span>
          </Button>
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleBulkDiscountUpdate} disabled={bulkUpdating} />
        </label>
        <label className="cursor-pointer">
          <Button variant="outline" size="sm" asChild disabled={bulkUpdating}>
            <span><Upload className="h-4 w-4 mr-1" />{bulkUpdating ? "Updating..." : "Bulk Update Last Sent"}</span>
          </Button>
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleBulkLastSentUpdate} disabled={bulkUpdating} />
        </label>
        {selected.size > 0 && (
          <Button variant="destructive" size="sm" onClick={() => { setDeleteMode("selected"); setDeleteOpen(true); }}>
            <Trash2 className="h-4 w-4 mr-1" />Delete Selected ({selected.size})
          </Button>
        )}
        <Button variant="destructive" size="sm" onClick={() => { setDeleteMode("all"); setDeleteOpen(true); }}>
          <Trash2 className="h-4 w-4 mr-1" />Delete All
        </Button>
        <span className="text-sm text-muted-foreground">Total: {totalCount}</span>
      </div>
      <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-2">
        💡 <strong>Bulk Update:</strong> Upload Excel with "primary_key" (or "mobile"/"umr") + "patient_name" for names, "discount" for discount %, or "last_sent_date" for last sent.
        <a href="/samples/Sample_Bulk_Update_Names.xlsx" download className="text-primary underline text-xs">📥 Sample Names</a>
        <a href="/samples/Sample_Bulk_Update_Discount.xlsx" download className="text-primary underline text-xs">📥 Sample Discount</a>
        <a href="/samples/Sample_Bulk_Update_LastSent.xlsx" download className="text-primary underline text-xs">📥 Sample Last Sent</a>
      </p>

      <div className="border rounded-lg overflow-auto max-h-[60vh]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"><Checkbox checked={contacts.length > 0 && selected.size === contacts.length} onCheckedChange={toggleAll} /></TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="w-8"></TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>UMR</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Visit Date</TableHead>
              <TableHead>Bill #</TableHead>
              <TableHead>Doctor</TableHead>
              <TableHead>Net Amt</TableHead>
              <TableHead>Tag</TableHead>
              <TableHead>Created Date</TableHead>
              <TableHead>Last Sent</TableHead>
              <TableHead>Days Since</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={14} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : contacts.length === 0 ? (
              <TableRow><TableCell colSpan={14} className="text-center py-8">No contacts found. Import data to get started.</TableCell></TableRow>
            ) : contacts.map((c: any) => (
              <TableRow key={c.id}>
                <TableCell><Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggleSelect(c.id)} /></TableCell>
                <TableCell className="font-medium">{c.patient_name || "—"}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(c)} title="Edit name">
                    <Pencil className="h-3 w-3" />
                  </Button>
                </TableCell>
                <TableCell>{c.mobile_number || "—"}</TableCell>
                <TableCell>{c.umr_number || "—"}</TableCell>
                <TableCell>{c.location || "—"}</TableCell>
                <TableCell>{c.visit_date || "—"}</TableCell>
                <TableCell>{c.bill_number || "—"}</TableCell>
                <TableCell>{c.doctor_name || "—"}</TableCell>
                <TableCell>{c.net_amount ?? "—"}</TableCell>
                <TableCell>{c.record_tag || "—"}</TableCell>
                <TableCell>{c.created_at ? format(new Date(c.created_at), "dd-MM-yyyy") : "—"}</TableCell>
                <TableCell>{c.last_sent_type || "—"}</TableCell>
                <TableCell>{daysSince(c.last_sent_date)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex gap-2 justify-center">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
        <span className="text-sm self-center">Page {page + 1}</span>
        <Button variant="outline" size="sm" disabled={contacts.length < PAGE_SIZE} onClick={() => setPage(p => p + 1)}>Next</Button>
      </div>

      {/* Edit Contact Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>Edit Contact</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs text-muted-foreground">Primary Key</Label><p className="text-sm font-mono">{editContact?.primary_key}</p></div>
            {EDITABLE_FIELDS.map(f => (
              <div key={f.key}>
                <Label className="text-xs">{f.label}</Label>
                <Input
                  value={editFields[f.key] || ""}
                  onChange={(e) => setEditFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                  className={f.uppercase ? "uppercase" : ""}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={editSaving}>{editSaving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={(o) => { setDeleteOpen(o); if (!o) setDeletePassword(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{deleteMode === "all" ? "Delete All Contacts" : `Delete ${selected.size} Selected Contacts`}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleteMode === "all"
              ? "This will permanently delete ALL CRM contacts. This action cannot be undone."
              : `This will permanently delete ${selected.size} selected contacts.`}
          </p>
          <div>
            <Label>Enter password to confirm</Label>
            <Input type="password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} placeholder="Enter password" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteOpen(false); setDeletePassword(""); }}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting || !deletePassword}>
              {deleting ? "Deleting..." : "Confirm Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CRMContacts;
