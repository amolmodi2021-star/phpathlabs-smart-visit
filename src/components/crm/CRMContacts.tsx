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
import { Progress } from "@/components/ui/progress";
import { exportToExcel, parseExcelFile } from "@/lib/excel";
import { generateAndUploadCard, getTemplateAssets, type CardData } from "@/lib/cardRenderer";
import { Download, Search, Pencil, Upload, Trash2, Send } from "lucide-react";
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

  // Send loyalty card state
  const [sendOpen, setSendOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState(0);
  const [sendPhase, setSendPhase] = useState("");

  const { data: cardTemplates = [] } = useQuery({
    queryKey: ["loyalty_card_templates"],
    queryFn: async () => {
      const { data } = await supabase.from("loyalty_card_templates").select("*").order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ["crm-contacts", locationFilter, tagFilter, search, page],
    queryFn: async () => {
      // Fetch all matching records in batches (Supabase has 1000 row limit per query)
      const BATCH = 1000;
      let allData: any[] = [];
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
        allData = allData.concat(data);
        if (data.length < BATCH) hasMore = false;
        else from += BATCH;
      }
      
      // Sort: PH VESU first, then by visit date desc, then visit time desc if available,
      // then bill number desc as a fallback tie-breaker for same-day records.
      const normalizeLocation = (value: unknown) => String(value || "").trim().toUpperCase();
      const parseVisitDate = (value: unknown) => {
        const raw = String(value || "").trim();
        const match = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
        if (!match) return 0;
        const [, dd, mm, yyyy] = match;
        return Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd));
      };
      const parseVisitTime = (value: unknown) => {
        const raw = String(value || "").trim().toUpperCase();
        if (!raw) return 0;
        const ampmMatch = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
        if (ampmMatch) {
          let [, hh, mm, meridian] = ampmMatch;
          let hours = Number(hh) % 12;
          if (meridian === "PM") hours += 12;
          return hours * 60 + Number(mm);
        }
        const twentyFourHourMatch = raw.match(/^(\d{1,2}):(\d{2})$/);
        if (twentyFourHourMatch) {
          const [, hh, mm] = twentyFourHourMatch;
          return Number(hh) * 60 + Number(mm);
        }
        return 0;
      };
      const parseBillNumber = (value: unknown) => {
        const digits = String(value || "").replace(/\D/g, "");
        return digits ? Number(digits) : 0;
      };
      const sorted = allData.sort((a: any, b: any) => {
        const locA = normalizeLocation(a.location) === "PH VESU" ? 0 : 1;
        const locB = normalizeLocation(b.location) === "PH VESU" ? 0 : 1;
        if (locA !== locB) return locA - locB;

        if (locA === 0) {
          const dateDiff = parseVisitDate(b.visit_date) - parseVisitDate(a.visit_date);
          if (dateDiff !== 0) return dateDiff;

          const timeDiff = parseVisitTime(b.visit_time) - parseVisitTime(a.visit_time);
          if (timeDiff !== 0) return timeDiff;

          const billDiff = parseBillNumber(b.bill_number) - parseBillNumber(a.bill_number);
          if (billDiff !== 0) return billDiff;
        }

        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      
      // Apply pagination client-side
      return sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
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
    toast.info("Fetching all contacts for export... This may take a moment.");
    try {
      const allContacts: any[] = [];
      const BATCH = 900;
      let from = 0;
      let hasMore = true;
      while (hasMore) {
        let q = supabase.from("crm_contacts").select("*").order("created_at", { ascending: true }).range(from, from + BATCH - 1);
        if (locationFilter !== "ALL") q = q.eq("location", locationFilter);
        if (tagFilter !== "ALL") q = q.eq("record_tag", tagFilter);
        if (search) q = q.or(`patient_name.ilike.%${search}%,mobile_number.ilike.%${search}%,umr_number.ilike.%${search}%`);
        const { data, error } = await q;
        if (error) throw error;
        if (!data || data.length === 0) { hasMore = false; break; }
        allContacts.push(...data);
        toast.info(`Fetched ${allContacts.length} records so far...`, { id: "export-progress" });
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
    { key: "last_sent_type", label: "Sent Type" },
    { key: "last_sent_date", label: "Last Sent Date" },
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
      const pkCol = keys.find(k => k.toLowerCase().includes("primary") || k.toLowerCase().includes("key"));
      const mobileCol = keys.find(k => k.toLowerCase().includes("mobile") || k.toLowerCase().includes("phone"));
      const umrCol = keys.find(k => k.toLowerCase().includes("umr"));
      const nameCol = keys.find(k => k.toLowerCase().includes("name") || k.toLowerCase().includes("patient"));

      if (!nameCol) return toast.error("Excel must have a column with 'name' or 'patient' in the header");
      if (!pkCol && !mobileCol && !umrCol) return toast.error("Excel must have a 'primary_key', 'mobile', or 'umr' column");

      setBulkUpdating(true);
      let updated = 0, failed = 0;

      const pkBatches = new Map<string, string[]>();
      const umrBatches = new Map<string, string[]>();
      const mobBatches = new Map<string, string[]>();

      for (const row of rows) {
        const name = String(row[nameCol!] || "").trim().toUpperCase();
        if (!name) { failed++; continue; }

        if (pkCol && row[pkCol]) {
          if (!pkBatches.has(name)) pkBatches.set(name, []);
          pkBatches.get(name)!.push(String(row[pkCol]).trim());
        } else if (umrCol && row[umrCol]) {
          if (!umrBatches.has(name)) umrBatches.set(name, []);
          umrBatches.get(name)!.push(String(row[umrCol]).trim());
        } else if (mobileCol && row[mobileCol]) {
          const mob = String(row[mobileCol]).replace(/\D/g, "").slice(-10);
          if (mob.length !== 10) { failed++; continue; }
          if (!mobBatches.has(name)) mobBatches.set(name, []);
          mobBatches.get(name)!.push(mob);
        } else {
          failed++; continue;
        }
      }

      const CHUNK = 200;
      for (const [name, pks] of pkBatches) {
        for (let i = 0; i < pks.length; i += CHUNK) {
          const chunk = pks.slice(i, i + CHUNK);
          const { error } = await supabase.from("crm_contacts").update({ patient_name: name }).in("primary_key", chunk);
          if (error) failed += chunk.length; else updated += chunk.length;
        }
      }
      for (const [name, umrs] of umrBatches) {
        for (let i = 0; i < umrs.length; i += CHUNK) {
          const chunk = umrs.slice(i, i + CHUNK);
          const { error } = await supabase.from("crm_contacts").update({ patient_name: name }).in("umr_number", chunk);
          if (error) failed += chunk.length; else updated += chunk.length;
        }
      }
      for (const [name, mobs] of mobBatches) {
        for (let i = 0; i < mobs.length; i += CHUNK) {
          const chunk = mobs.slice(i, i + CHUNK);
          const { error } = await supabase.from("crm_contacts").update({ patient_name: name }).in("mobile_number", chunk);
          if (error) failed += chunk.length; else updated += chunk.length;
        }
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

      // Group rows by discount value and match type for batching
      const pkBatches = new Map<number, string[]>();
      const umrBatches = new Map<number, string[]>();
      const mobBatches = new Map<number, string[]>();

      for (const row of rows) {
        const discount = parseFloat(String(row[discountCol!] || "0")) || 0;

        if (pkCol && row[pkCol]) {
          if (!pkBatches.has(discount)) pkBatches.set(discount, []);
          pkBatches.get(discount)!.push(String(row[pkCol]).trim());
        } else if (umrCol && row[umrCol]) {
          if (!umrBatches.has(discount)) umrBatches.set(discount, []);
          umrBatches.get(discount)!.push(String(row[umrCol]).trim());
        } else if (mobileCol && row[mobileCol]) {
          const mob = String(row[mobileCol]).replace(/\D/g, "").slice(-10);
          if (mob.length !== 10) { failed++; continue; }
          if (!mobBatches.has(discount)) mobBatches.set(discount, []);
          mobBatches.get(discount)!.push(mob);
        } else {
          failed++; continue;
        }
      }

      // Execute batched updates (one query per discount value per match type)
      const CHUNK = 200;
      for (const [discount, pks] of pkBatches) {
        for (let i = 0; i < pks.length; i += CHUNK) {
          const chunk = pks.slice(i, i + CHUNK);
          const { error } = await supabase.from("crm_contacts").update({ default_discount_pct: discount }).in("primary_key", chunk);
          if (error) failed += chunk.length; else updated += chunk.length;
        }
      }
      for (const [discount, umrs] of umrBatches) {
        for (let i = 0; i < umrs.length; i += CHUNK) {
          const chunk = umrs.slice(i, i + CHUNK);
          const { error } = await supabase.from("crm_contacts").update({ default_discount_pct: discount }).in("umr_number", chunk);
          if (error) failed += chunk.length; else updated += chunk.length;
        }
      }
      for (const [discount, mobs] of mobBatches) {
        for (let i = 0; i < mobs.length; i += CHUNK) {
          const chunk = mobs.slice(i, i + CHUNK);
          const { error } = await supabase.from("crm_contacts").update({ default_discount_pct: discount }).in("mobile_number", chunk);
          if (error) failed += chunk.length; else updated += chunk.length;
        }
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

      // Build a composite key for batching: isoDate + sentType
      const pkBatches = new Map<string, string[]>();
      const umrBatches = new Map<string, string[]>();
      const mobBatches = new Map<string, string[]>();

      const parseDate = (dateStr: string): string | null => {
        const ddmmyyyy = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}T00:00:00Z`;
        const parsed = new Date(dateStr);
        if (isNaN(parsed.getTime())) return null;
        return parsed.toISOString();
      };

      for (const row of rows) {
        const dateStr = String(row[dateCol!] || "").trim();
        if (!dateStr) { failed++; continue; }
        const isoDate = parseDate(dateStr);
        if (!isoDate) { failed++; continue; }
        const sentType = typeCol && row[typeCol] ? String(row[typeCol]).trim() : "";
        const batchKey = `${isoDate}|||${sentType}`;

        if (pkCol && row[pkCol]) {
          if (!pkBatches.has(batchKey)) pkBatches.set(batchKey, []);
          pkBatches.get(batchKey)!.push(String(row[pkCol]).trim());
        } else if (umrCol && row[umrCol]) {
          if (!umrBatches.has(batchKey)) umrBatches.set(batchKey, []);
          umrBatches.get(batchKey)!.push(String(row[umrCol]).trim());
        } else if (mobileCol && row[mobileCol]) {
          const mob = String(row[mobileCol]).replace(/\D/g, "").slice(-10);
          if (mob.length !== 10) { failed++; continue; }
          if (!mobBatches.has(batchKey)) mobBatches.set(batchKey, []);
          mobBatches.get(batchKey)!.push(mob);
        } else {
          failed++; continue;
        }
      }

      const CHUNK = 200;
      const buildUpdates = (batchKey: string) => {
        const [isoDate, sentType] = batchKey.split("|||");
        const updates: Record<string, any> = { last_sent_date: isoDate };
        if (sentType) updates.last_sent_type = sentType;
        return updates;
      };

      for (const [batchKey, pks] of pkBatches) {
        const updates = buildUpdates(batchKey);
        for (let i = 0; i < pks.length; i += CHUNK) {
          const chunk = pks.slice(i, i + CHUNK);
          const { error } = await supabase.from("crm_contacts").update(updates).in("primary_key", chunk);
          if (error) failed += chunk.length; else updated += chunk.length;
        }
      }
      for (const [batchKey, umrs] of umrBatches) {
        const updates = buildUpdates(batchKey);
        for (let i = 0; i < umrs.length; i += CHUNK) {
          const chunk = umrs.slice(i, i + CHUNK);
          const { error } = await supabase.from("crm_contacts").update(updates).in("umr_number", chunk);
          if (error) failed += chunk.length; else updated += chunk.length;
        }
      }
      for (const [batchKey, mobs] of mobBatches) {
        const updates = buildUpdates(batchKey);
        for (let i = 0; i < mobs.length; i += CHUNK) {
          const chunk = mobs.slice(i, i + CHUNK);
          const { error } = await supabase.from("crm_contacts").update(updates).in("mobile_number", chunk);
          if (error) failed += chunk.length; else updated += chunk.length;
        }
      }

      setBulkUpdating(false);
      qc.invalidateQueries({ queryKey: ["crm-contacts"] });
      toast.success(`Bulk last sent update: ${updated} updated, ${failed} failed`);
    } catch {
      setBulkUpdating(false);
      toast.error("Failed to parse Excel");
    }
  };

  const handleNonPhplUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const rows = await parseExcelFile(file);
      if (!rows.length) return toast.error("No data in file");

      const keys = Object.keys(rows[0]);
      const nameCol = keys.find(k => k.toLowerCase().includes("name"));
      const mobileCol = keys.find(k => k.toLowerCase().includes("mobile") || k.toLowerCase().includes("phone"));
      const umrCol = keys.find(k => k.toLowerCase().includes("umr"));
      const locationCol = keys.find(k => k.toLowerCase().includes("location"));
      const discountCol = keys.find(k => k.toLowerCase().includes("discount") || k.toLowerCase().includes("%"));

      if (!mobileCol) return toast.error("Excel must have a 'Mobile' column");

      setBulkUpdating(true);
      let added = 0, skipped = 0, failed = 0;

      const { data: blacklistData } = await supabase.from("crm_blacklist").select("mobile_number");
      const blacklist = new Set((blacklistData || []).map((b: any) => b.mobile_number));

      const toUpsert: any[] = [];
      const seenPks = new Set<string>();

      for (const row of rows) {
        const rawMob = String(row[mobileCol!] || "").replace(/\D/g, "").slice(-10);
        if (rawMob.length !== 10) { failed++; continue; }
        if (blacklist.has(rawMob)) { skipped++; continue; }

        const umr = umrCol ? String(row[umrCol] || "").trim() : "";
        const pk = `${umr}|${rawMob}`;
        if (seenPks.has(pk)) { skipped++; continue; }
        seenPks.add(pk);

        const name = nameCol ? String(row[nameCol] || "").trim() : "";
        const location = locationCol ? String(row[locationCol] || "").trim() || "NON PHPL" : "NON PHPL";
        const discount = discountCol ? (parseFloat(String(row[discountCol] || "20")) || 20) : 20;

        toUpsert.push({
          primary_key: pk,
          mobile_number: rawMob,
          umr_number: umr || null,
          patient_name: name || null,
          location,
          default_discount_pct: discount,
          record_tag: null,
          visit_date: null,
        });
      }

      const CHUNK = 200;
      for (let i = 0; i < toUpsert.length; i += CHUNK) {
        const chunk = toUpsert.slice(i, i + CHUNK);
        const { error } = await supabase.from("crm_contacts").upsert(chunk, { onConflict: "primary_key" });
        if (error) { console.error(error); failed += chunk.length; } else { added += chunk.length; }
      }

      setBulkUpdating(false);
      qc.invalidateQueries({ queryKey: ["crm-contacts"] });
      qc.invalidateQueries({ queryKey: ["crm-contacts-count"] });
      toast.success(`NON PHPL upload: ${added} added/updated, ${skipped} skipped, ${failed} failed`);
    } catch {
      setBulkUpdating(false);
      toast.error("Failed to parse Excel");
    }
  };

  const handleClearTags = async () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    try {
      const BATCH = 50;
      for (let i = 0; i < ids.length; i += BATCH) {
        const batch = ids.slice(i, i + BATCH);
        const { error } = await supabase.from("crm_contacts").update({ record_tag: null }).in("id", batch);
        if (error) throw error;
      }
      toast.success(`Cleared tags for ${ids.length} records`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["crm-contacts"] });
    } catch {
      toast.error("Failed to clear tags");
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

  const handleSendLoyaltyCards = async () => {
    if (selected.size === 0) return toast.error("Select contacts first");
    if (!selectedTemplateId) return toast.error("Select a card template first");

    // Fetch full data for all selected IDs (may span multiple pages)
    const selectedIds = Array.from(selected);
    let selectedContacts: any[] = [];
    const FETCH_CHUNK = 200;
    for (let i = 0; i < selectedIds.length; i += FETCH_CHUNK) {
      const chunk = selectedIds.slice(i, i + FETCH_CHUNK);
      const { data } = await supabase.from("crm_contacts").select("*").in("id", chunk);
      if (data) selectedContacts = selectedContacts.concat(data);
    }
    selectedContacts = selectedContacts.filter((c: any) => c.mobile_number);
    if (selectedContacts.length === 0) return toast.error("No selected contacts with mobile numbers");

    // Fetch WhatsApp settings
    const { data: settings } = await supabase
      .from("app_settings")
      .select("setting_key, setting_value")
      .like("setting_key", "loyalty_%");

    const cfg: Record<string, string> = {};
    (settings || []).forEach((s: any) => { cfg[s.setting_key] = s.setting_value; });

    const apiBaseUrl = cfg["loyalty_wa_baseUrl"];
    const apiKey = cfg["loyalty_wa_apiKey"];
    const templateName = cfg["loyalty_wa_templateName"];
    const authHeaderName = cfg["loyalty_wa_authHeaderName"] || "apikey";
    const authHeaderPrefix = cfg["loyalty_wa_authHeaderPrefix"] || "";
    const fromNumber = cfg["loyalty_wa_fromNumber"] || "";
    const campaignName = cfg["loyalty_wa_campaignName"] || "";
    const bodyMapping = cfg["loyalty_wa_bodyMapping"];
    const queueEnabled = cfg["loyalty_wa_queueEnabled"] !== "false";
    const delayMs = Number(cfg["loyalty_wa_delayMs"]) || 3000;
    const staticExpiryDate = cfg["crm_abc_static_expiry_date"] || "";

    if (!apiBaseUrl || !apiKey || !templateName) {
      return toast.error("WhatsApp API not configured. Set up in Loyalty Cards → WhatsApp Settings.");
    }

    let mapping: Record<string, string> = {};
    try { mapping = bodyMapping ? JSON.parse(bodyMapping) : {}; } catch { mapping = {}; }

    setSending(true);
    setSendProgress(0);
    setSendOpen(false);

    // Phase 1: Generate card images
    setSendPhase("Generating card images...");
    let templateAssets: Awaited<ReturnType<typeof getTemplateAssets>>;
    try {
      templateAssets = await getTemplateAssets(selectedTemplateId);
      if (!templateAssets) throw new Error("Template not found or has no background image");
    } catch (err: any) {
      setSending(false);
      setSendPhase("");
      return toast.error(err.message || "Failed to load template");
    }

    const { bgImg, canvas, ctx, placeholders } = templateAssets;
    const imageUrls: (string | null)[] = [];

    for (let i = 0; i < selectedContacts.length; i++) {
      const r = selectedContacts[i];
      const mobile = (r.mobile_number || "").replace(/\D/g, "");
      const normalizedMobile = mobile.length > 10 ? mobile.slice(-10) : mobile;

      const cardData: CardData = {
        Name: r.patient_name || "",
        Mobile: normalizedMobile,
        UMR: r.umr_number || "",
        "Discount %": `${r.default_discount_pct ?? 20}%`,
        "Expiry Date": staticExpiryDate,
      };

      const imageUrl = await generateAndUploadCard(selectedTemplateId, cardData, bgImg, canvas, ctx, placeholders);
      imageUrls.push(imageUrl);
      setSendProgress(Math.round(((i + 1) / selectedContacts.length) * 50));
    }

    // Phase 2: Send WhatsApp
    setSendPhase("Sending WhatsApp messages...");
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < selectedContacts.length; i++) {
      const r = selectedContacts[i];
      const rawMobile = (r.mobile_number || "").replace(/\D/g, "");
      const normalizedMobile = rawMobile.length > 10 ? rawMobile.slice(-10) : rawMobile;
      const toNumber = normalizedMobile ? `+91${normalizedMobile}` : "";

      const components: Record<string, unknown> = {};

      if (Object.keys(mapping).length > 0) {
        const sortedKeys = Object.keys(mapping).sort((a, b) => Number(a) - Number(b));
        const params: string[] = sortedKeys.map((key) => {
          const field = mapping[key];
          switch (field) {
            case "Name": return r.patient_name || "";
            case "Mobile": return r.mobile_number || "";
            case "UMR": return r.umr_number || "";
            case "Discount %": return `${r.default_discount_pct ?? 20}%`;
            case "Expiry Date": return "";
            default: return "";
          }
        });
        components.body = { params };
      }

      const imgUrl = imageUrls[i];
      if (imgUrl) {
        components.header = { type: "image", image: { link: imgUrl } };
      }

      const payload: Record<string, unknown> = {
        from: fromNumber,
        to: toNumber,
        templateName,
        campaignName,
        type: "template",
      };
      if (Object.keys(components).length > 0) {
        payload.components = components;
      }

      try {
        const proxyRes = await supabase.functions.invoke("whatsapp-proxy", {
          body: { apiBaseUrl, apiKey, authHeaderName, authHeaderPrefix, payload },
        });

        if (proxyRes.error || proxyRes.data?.status >= 400) {
          failed++;
        } else {
          sent++;
          await supabase.from("crm_contacts").update({
            last_sent_type: "ABC",
            last_sent_date: new Date().toISOString(),
            record_tag: null,
          }).eq("id", r.id);
        }
      } catch {
        failed++;
      }

      // Always delete the generated card image after sending
      if (imgUrl) {
        try {
          const urlPath = new URL(imgUrl).pathname;
          const filePath = urlPath.split("/loyalty-cards/").pop();
          if (filePath) {
            await supabase.storage.from("loyalty-cards").remove([filePath]);
          }
        } catch (e) { console.warn("Failed to delete card image:", e); }
      }

      setSendProgress(50 + Math.round(((i + 1) / selectedContacts.length) * 50));

      if (queueEnabled && delayMs > 0 && i < selectedContacts.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    setSending(false);
    setSendPhase("");
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["crm-contacts"] });
    qc.invalidateQueries({ queryKey: ["crm-sent-history"] });
    toast.success(`Loyalty cards sent: ${sent} success, ${failed} failed`);
  };

  return (
    <div className="space-y-4">
      {sending && (
        <div className="space-y-2 p-3 border rounded-lg bg-muted/50">
          <p className="text-sm font-medium">{sendPhase}</p>
          <Progress value={sendProgress} />
          <p className="text-xs text-muted-foreground">{sendProgress}% complete</p>
        </div>
      )}

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
        <label className="cursor-pointer">
          <Button variant="secondary" size="sm" asChild disabled={bulkUpdating}>
            <span><Upload className="h-4 w-4 mr-1" />{bulkUpdating ? "Uploading..." : "Upload NON PHPL"}</span>
          </Button>
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleNonPhplUpload} disabled={bulkUpdating} />
        </label>
        {selected.size > 0 && (
          <>
            <Button size="sm" onClick={() => setSendOpen(true)} disabled={sending}>
              <Send className="h-4 w-4 mr-1" />Send Loyalty Card ({selected.size})
            </Button>
            <Button variant="outline" size="sm" onClick={handleClearTags}>
              Clear Tags ({selected.size})
            </Button>
            <Button variant="destructive" size="sm" onClick={() => { setDeleteMode("selected"); setDeleteOpen(true); }}>
              <Trash2 className="h-4 w-4 mr-1" />Delete Selected ({selected.size})
            </Button>
          </>
        )}
        <Button size="sm" variant="secondary" onClick={async () => {
          toast.info("Fetching all DAILY contacts...");
          const BATCH = 1000;
          let allIds: string[] = [];
          let from = 0;
          while (true) {
            const { data } = await supabase.from("crm_contacts").select("id").eq("record_tag", "DAILY").range(from, from + BATCH - 1);
            if (!data || data.length === 0) break;
            allIds = allIds.concat(data.map((r: any) => r.id));
            if (data.length < BATCH) break;
            from += BATCH;
          }
          if (allIds.length === 0) return toast.error("No DAILY tagged contacts found");
          setSelected(new Set(allIds));
          toast.success(`Selected ${allIds.length} DAILY contacts`);
        }}>
          <Send className="h-4 w-4 mr-1" />Select All DAILY
        </Button>
        <Button variant="outline" size="sm" onClick={async () => {
          if (!window.confirm("Clear DAILY tag from ALL contacts with DAILY tag?")) return;
          toast.info("Clearing all DAILY tags...");
          const BATCH = 200;
          let cleared = 0;
          let from = 0;
          while (true) {
            const { data: chunk } = await supabase
              .from("crm_contacts")
              .select("id")
              .eq("record_tag", "DAILY")
              .range(from, from + 999);
            if (!chunk || chunk.length === 0) break;
            const ids = chunk.map((c: any) => c.id);
            for (let i = 0; i < ids.length; i += BATCH) {
              const batch = ids.slice(i, i + BATCH);
              await supabase.from("crm_contacts").update({ record_tag: null }).in("id", batch);
              cleared += batch.length;
            }
            if (chunk.length < 1000) break;
            from += 1000;
          }
          setSelected(new Set());
          qc.invalidateQueries({ queryKey: ["crm-contacts"] });
          toast.success(`Cleared DAILY tag from ${cleared} records`);
        }}>
          Clear All DAILY Tags
        </Button>
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
        <a href="/samples/Sample_NonPHPL_Upload.xlsx" download className="text-primary underline text-xs">📥 Sample NON PHPL</a>
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
              
              <TableHead>Net Amt</TableHead>
              <TableHead>Discount %</TableHead>
              <TableHead>Tag</TableHead>
              <TableHead>Created Date</TableHead>
              <TableHead>Sent Type</TableHead>
              <TableHead>Last Sent Date</TableHead>
              <TableHead>Days Since</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={15} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : contacts.length === 0 ? (
              <TableRow><TableCell colSpan={15} className="text-center py-8">No contacts found. Import data to get started.</TableCell></TableRow>
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
                
                <TableCell>{c.net_amount ?? "—"}</TableCell>
                <TableCell>{c.default_discount_pct ?? "—"}</TableCell>
                <TableCell>{c.record_tag || "—"}</TableCell>
                <TableCell>{c.created_at ? format(new Date(c.created_at), "dd-MM-yyyy") : "—"}</TableCell>
                <TableCell>{c.last_sent_type || "—"}</TableCell>
                <TableCell>{c.last_sent_date ? format(new Date(c.last_sent_date), "dd-MM-yyyy") : "—"}</TableCell>
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

      {/* Send Loyalty Card Dialog */}
      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Loyalty Card to {selected.size} contacts</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Card Template</Label>
              <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select template" />
                </SelectTrigger>
                <SelectContent>
                  {cardTemplates.map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Cards will be generated (or looked up if existing) and sent via WhatsApp using Loyalty Cards settings.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendOpen(false)}>Cancel</Button>
            <Button onClick={handleSendLoyaltyCards} disabled={!selectedTemplateId}>
              <Send className="h-4 w-4 mr-1" />Generate & Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CRMContacts;
