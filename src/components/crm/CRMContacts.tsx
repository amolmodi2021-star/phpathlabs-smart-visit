import { useState } from "react";
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
import { Download, Search, Pencil, Upload } from "lucide-react";
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
  const [editName, setEditName] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Bulk update state
  const [bulkUpdating, setBulkUpdating] = useState(false);

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ["crm-contacts", locationFilter, tagFilter, search, page],
    queryFn: async () => {
      let q = supabase.from("crm_contacts").select("*").order("updated_at", { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (locationFilter !== "ALL") q = q.eq("location", locationFilter);
      if (tagFilter !== "ALL") q = q.eq("record_tag", tagFilter);
      if (search) q = q.or(`patient_name.ilike.%${search}%,mobile_number.ilike.%${search}%,umr_number.ilike.%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
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

  const handleExport = () => {
    if (!contacts.length) return toast.error("No data to export");
    const rows = contacts.map((c: any) => ({
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
    toast.success("Exported!");
  };

  const openEdit = (contact: any) => {
    setEditContact(contact);
    setEditName(contact.patient_name || "");
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editContact) return;
    setEditSaving(true);
    const { error } = await supabase.from("crm_contacts").update({ patient_name: editName.trim().toUpperCase() }).eq("id", editContact.id);
    setEditSaving(false);
    if (error) {
      toast.error("Failed to update name");
    } else {
      toast.success("Name updated");
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
        <span className="text-sm text-muted-foreground">Total: {totalCount}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        💡 <strong>Bulk Update Names:</strong> Upload Excel with columns "primary_key" (or "mobile") and "patient_name" to update names in bulk.
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
              <TableHead>Last Sent</TableHead>
              <TableHead>Days Since</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={13} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : contacts.length === 0 ? (
              <TableRow><TableCell colSpan={13} className="text-center py-8">No contacts found. Import data to get started.</TableCell></TableRow>
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

      {/* Edit Name Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Patient Name</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs text-muted-foreground">Primary Key</Label><p className="text-sm font-mono">{editContact?.primary_key}</p></div>
            <div><Label className="text-xs text-muted-foreground">Mobile</Label><p className="text-sm">{editContact?.mobile_number || "—"}</p></div>
            <div><Label className="text-xs text-muted-foreground">Location</Label><p className="text-sm">{editContact?.location || "—"}</p></div>
            <div>
              <Label>Patient Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Enter patient name" className="uppercase" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={editSaving || !editName.trim()}>{editSaving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CRMContacts;
