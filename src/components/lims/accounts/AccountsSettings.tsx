import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import { getCurrentUserName } from "@/lib/auth";
import CloudinaryAccountsPanel from "@/components/lims/CloudinaryAccountsPanel";
import {
  getTallyModeMap,
  getTallySettings,
  saveTallyModeMapRow,
  saveTallySettings,
} from "@/lib/tallyIntegration";

type Company = {
  id: string;
  name: string;
  tds_percent: number;
  address: string;
  contact_person: string;
  contact_number: string;
  email: string;
  /** Exact Tally ledger name (preserve spelling/case). */
  debit_to: string;
  /** Exact Tally ledger name (preserve spelling/case). */
  credit_to: string;
  is_active: boolean;
};
type Bank = { id: string; name: string; is_active: boolean };
type PaymentMode = { id: string; name: string; requires_bank: boolean; is_active: boolean; sort_order: number };

/** Collapse extra spaces (same idea as registration address cleanup). */
function trimAddress(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Keep last 10 digits — same as New Registration mobile formatting. */
function formatMobile10(value: string): string {
  return value.replace(/\D/g, "").slice(-10);
}

function normalizeEmail(value: string): string {
  return value.replace(/\s+/g, "").trim().toLowerCase();
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

type ModuleSettings = {
  id: number;
  email_from: string | null;
  email_from_name: string | null;
  email_reply_to: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  smtp_pass: string | null;
  resend_api_key: string | null;
  po_logo_url: string | null;
  po_brand_primary: string | null;
  po_brand_accent: string | null;
};

const EMPTY_MODULE: ModuleSettings = {
  id: 1,
  email_from: "",
  email_from_name: "PH PathLabs Accounts",
  email_reply_to: "",
  smtp_host: "",
  smtp_port: 587,
  smtp_user: "",
  smtp_pass: "",
  resend_api_key: "",
  po_logo_url: "",
  po_brand_primary: "#0f766e",
  po_brand_accent: "#134e4a",
};

function StatusCell({ active }: { active: boolean }) {
  return (
    <span className={active ? "text-xs text-emerald-700" : "text-xs text-muted-foreground"}>
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function CompaniesSection() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [email, setEmail] = useState("");
  const [debitTo, setDebitTo] = useState("");
  const [creditTo, setCreditTo] = useState("");
  const [tdsPercent, setTdsPercent] = useState("0");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["accounts_companies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts_companies")
        .select("id, name, tds_percent, address, contact_person, contact_number, email, debit_to, credit_to, is_active")
        .order("name");
      if (error) throw error;
      return (data || []) as Company[];
    },
  });

  const openAdd = () => {
    setEditing(null);
    setName("");
    setAddress("");
    setContactPerson("");
    setContactNumber("");
    setEmail("");
    setDebitTo("");
    setCreditTo("");
    setTdsPercent("0");
    setDialogOpen(true);
  };

  const openEdit = (row: Company) => {
    setEditing(row);
    setName(row.name);
    setAddress(row.address || "");
    setContactPerson(row.contact_person || "");
    setContactNumber(formatMobile10(row.contact_number || ""));
    setEmail(row.email || "");
    setDebitTo(row.debit_to || "");
    setCreditTo(row.credit_to || "");
    setTdsPercent(String(row.tds_percent));
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Company name is required");
      const tds = Number(tdsPercent);
      if (!Number.isFinite(tds) || tds < 0 || tds > 100) throw new Error("TDS % must be between 0 and 100");
      const cleanAddress = trimAddress(address);
      const cleanPerson = contactPerson.replace(/\s+/g, " ").trim();
      const cleanMobile = formatMobile10(contactNumber);
      const cleanEmail = normalizeEmail(email);
      // Tally ledgers: trim ends only — keep exact spelling/case/spacing inside.
      const cleanDebitTo = debitTo.trim();
      const cleanCreditTo = creditTo.trim();
      if (contactNumber.trim() && cleanMobile.length !== 10) {
        throw new Error("Contact number must be a valid 10-digit mobile");
      }
      if (!cleanEmail) throw new Error("Email address is required to send purchase orders");
      if (!isValidEmail(cleanEmail)) throw new Error("Enter a valid email address");
      if (!cleanDebitTo) throw new Error("Debit To (Tally ledger) is required");
      if (!cleanCreditTo) throw new Error("Credit To (Tally ledger) is required");
      const payload = {
        name: trimmed,
        tds_percent: tds,
        address: cleanAddress,
        contact_person: cleanPerson,
        contact_number: cleanMobile,
        email: cleanEmail,
        debit_to: cleanDebitTo,
        credit_to: cleanCreditTo,
        is_active: true,
      };
      if (editing) {
        const { error } = await supabase.from("accounts_companies").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("accounts_companies").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts_companies"] });
      setDialogOpen(false);
      toast.success(editing ? "Company updated" : "Company added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("accounts_companies").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts_companies"] });
      toast.success("Updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="py-3 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">Companies</CardTitle>
        <Button size="sm" className="h-8" onClick={openAdd}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-9">Name</TableHead>
                <TableHead className="h-9">Contact</TableHead>
                <TableHead className="h-9">Mobile</TableHead>
                <TableHead className="h-9">Email</TableHead>
                <TableHead className="h-9">Debit To</TableHead>
                <TableHead className="h-9">Credit To</TableHead>
                <TableHead className="h-9">TDS %</TableHead>
                <TableHead className="h-9">Status</TableHead>
                <TableHead className="h-9 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={9} className="text-center text-xs text-muted-foreground py-4">Loading…</TableCell></TableRow>
              )}
              {!isLoading && rows.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-xs text-muted-foreground py-4">No companies yet.</TableCell></TableRow>
              )}
              {rows.map((row) => (
                <TableRow key={row.id} className={!row.is_active ? "opacity-60" : undefined}>
                  <TableCell className="py-2 text-sm font-medium">
                    <div>{row.name}</div>
                    {row.address ? (
                      <div className="text-xs text-muted-foreground font-normal mt-0.5 max-w-[240px] truncate" title={row.address}>
                        {row.address}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="py-2 text-sm">{row.contact_person || "—"}</TableCell>
                  <TableCell className="py-2 text-sm tabular-nums">{row.contact_number || "—"}</TableCell>
                  <TableCell className="py-2 text-sm max-w-[180px] truncate" title={row.email || undefined}>
                    {row.email || "—"}
                  </TableCell>
                  <TableCell className="py-2 text-sm max-w-[140px] truncate font-mono text-xs" title={row.debit_to || undefined}>
                    {row.debit_to || "—"}
                  </TableCell>
                  <TableCell className="py-2 text-sm max-w-[140px] truncate font-mono text-xs" title={row.credit_to || undefined}>
                    {row.credit_to || "—"}
                  </TableCell>
                  <TableCell className="py-2 text-sm tabular-nums">{Number(row.tds_percent)}%</TableCell>
                  <TableCell className="py-2"><StatusCell active={row.is_active} /></TableCell>
                  <TableCell className="py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => openEdit(row)}><Pencil className="h-3.5 w-3.5" /></Button>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Company" : "Add Company"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Company Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">Company Address</Label>
              <Textarea
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onBlur={() => setAddress((v) => trimAddress(v))}
                rows={2}
                className="text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Concerned Person Name</Label>
              <Input
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                onBlur={() => setContactPerson((v) => v.replace(/\s+/g, " ").trim())}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Contact Number</Label>
              <Input
                value={contactNumber}
                onChange={(e) => setContactNumber(formatMobile10(e.target.value))}
                placeholder="Paste number (any format)"
                inputMode="tel"
                className="h-9"
              />
              {contactNumber ? (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Formatted: {contactNumber || "Need 10 digits"}
                  {contactNumber.length === 10 ? " ✓" : ""}
                </p>
              ) : null}
            </div>
            <div>
              <Label className="text-xs">Email Address *</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setEmail((v) => normalizeEmail(v))}
                placeholder="orders@company.com"
                className="h-9"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Used to email purchase orders to this company.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Debit To *</Label>
                <Input
                  value={debitTo}
                  onChange={(e) => setDebitTo(e.target.value)}
                  onBlur={() => setDebitTo((v) => v.trim())}
                  placeholder="Exact Tally ledger name"
                  className="h-9 font-mono text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Credit To *</Label>
                <Input
                  value={creditTo}
                  onChange={(e) => setCreditTo(e.target.value)}
                  onBlur={() => setCreditTo((v) => v.trim())}
                  placeholder="Exact Tally ledger name"
                  className="h-9 font-mono text-sm"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground -mt-1">
              Enter ledger names exactly as in Tally (case and spelling). Used later for Tally integration.
            </p>
            <div>
              <Label className="text-xs">TDS %</Label>
              <Input type="number" min={0} max={100} step={0.001} value={tdsPercent} onChange={(e) => setTdsPercent(e.target.value)} className="h-9" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function NamedListSection({
  title,
  table,
  queryKey,
}: {
  title: string;
  table: "accounts_banks";
  queryKey: string;
}) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: [queryKey],
    queryFn: async () => {
      const { data, error } = await supabase.from(table).select("id, name, is_active").order("name");
      if (error) throw error;
      return (data || []) as Bank[];
    },
  });

  const openAdd = () => { setEditing(null); setName(""); setDialogOpen(true); };
  const openEdit = (row: Bank) => { setEditing(row); setName(row.name); setDialogOpen(true); };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Name is required");
      const payload = { name: trimmed, is_active: true };
      if (editing) {
        const { error } = await supabase.from(table).update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from(table).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [queryKey] });
      setDialogOpen(false);
      toast.success(editing ? "Updated" : "Added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from(table).update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [queryKey] });
      toast.success("Updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const singular = title.endsWith("s") ? title.slice(0, -1) : title;

  return (
    <Card>
      <CardHeader className="py-3 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">{title}</CardTitle>
        <Button size="sm" className="h-8" onClick={openAdd}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-9">Name</TableHead>
                <TableHead className="h-9">Status</TableHead>
                <TableHead className="h-9 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={3} className="text-center text-xs text-muted-foreground py-4">Loading…</TableCell></TableRow>
              )}
              {!isLoading && rows.length === 0 && (
                <TableRow><TableCell colSpan={3} className="text-center text-xs text-muted-foreground py-4">None yet.</TableCell></TableRow>
              )}
              {rows.map((row) => (
                <TableRow key={row.id} className={!row.is_active ? "opacity-60" : undefined}>
                  <TableCell className="py-2 text-sm font-medium">{row.name}</TableCell>
                  <TableCell className="py-2"><StatusCell active={row.is_active} /></TableCell>
                  <TableCell className="py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => openEdit(row)}><Pencil className="h-3.5 w-3.5" /></Button>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit" : "Add"} {singular}</DialogTitle></DialogHeader>
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function PaymentModesSection() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentMode | null>(null);
  const [name, setName] = useState("");
  const [requiresBank, setRequiresBank] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["accounts_payment_modes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts_payment_modes")
        .select("id, name, requires_bank, is_active, sort_order")
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return (data || []) as PaymentMode[];
    },
  });

  const openAdd = () => {
    setEditing(null);
    setName("");
    setRequiresBank(false);
    setDialogOpen(true);
  };

  const openEdit = (row: PaymentMode) => {
    setEditing(row);
    setName(row.name);
    setRequiresBank(row.requires_bank);
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Name is required");
      const payload = { name: trimmed, requires_bank: requiresBank, is_active: true };
      if (editing) {
        const { error } = await supabase.from("accounts_payment_modes").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("accounts_payment_modes").insert({ ...payload, sort_order: 100 });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts_payment_modes"] });
      setDialogOpen(false);
      toast.success(editing ? "Payment mode updated" : "Payment mode added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("accounts_payment_modes").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts_payment_modes"] });
      toast.success("Updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="py-3 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">Payment Modes</CardTitle>
        <Button size="sm" className="h-8" onClick={openAdd}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-9">Name</TableHead>
                <TableHead className="h-9">Requires Bank</TableHead>
                <TableHead className="h-9">Status</TableHead>
                <TableHead className="h-9 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-4">Loading…</TableCell></TableRow>
              )}
              {!isLoading && rows.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-4">No payment modes.</TableCell></TableRow>
              )}
              {rows.map((row) => (
                <TableRow key={row.id} className={!row.is_active ? "opacity-60" : undefined}>
                  <TableCell className="py-2 text-sm font-medium">{row.name}</TableCell>
                  <TableCell className="py-2 text-sm">{row.requires_bank ? "Yes" : "No"}</TableCell>
                  <TableCell className="py-2"><StatusCell active={row.is_active} /></TableCell>
                  <TableCell className="py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => openEdit(row)}><Pencil className="h-3.5 w-3.5" /></Button>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Payment Mode" : "Add Payment Mode"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <Label className="text-xs">Requires bank</Label>
              <Switch checked={requiresBank} onCheckedChange={setRequiresBank} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function EmailPoBrandingSection() {
  const qc = useQueryClient();
  const [form, setForm] = useState<ModuleSettings>(EMPTY_MODULE);
  const [uploading, setUploading] = useState(false);

  const { isLoading } = useQuery({
    queryKey: ["accounts_module_settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts_module_settings")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        setForm({
          id: 1,
          email_from: data.email_from || "",
          email_from_name: data.email_from_name || "PH PathLabs Accounts",
          email_reply_to: data.email_reply_to || "",
          smtp_host: data.smtp_host || "",
          smtp_port: data.smtp_port ?? 587,
          smtp_user: data.smtp_user || "",
          smtp_pass: data.smtp_pass || "",
          resend_api_key: data.resend_api_key || "",
          po_logo_url: data.po_logo_url || "",
          po_brand_primary: data.po_brand_primary || "#0f766e",
          po_brand_accent: data.po_brand_accent || "#134e4a",
        });
      }
      return data;
    },
  });

  const set = <K extends keyof ModuleSettings>(key: K, value: ModuleSettings[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        email_from: form.email_from?.trim() || null,
        email_from_name: form.email_from_name?.trim() || null,
        email_reply_to: form.email_reply_to?.trim() || null,
        smtp_host: form.smtp_host?.trim() || null,
        smtp_port: form.smtp_port ? Number(form.smtp_port) : null,
        smtp_user: form.smtp_user?.trim() || null,
        smtp_pass: form.smtp_pass?.trim() || null,
        resend_api_key: form.resend_api_key?.trim() || null,
        po_logo_url: form.po_logo_url?.trim() || null,
        po_brand_primary: form.po_brand_primary || "#0f766e",
        po_brand_accent: form.po_brand_accent || "#134e4a",
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("accounts_module_settings").upsert({ id: 1, ...payload });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts_module_settings"] });
      const who = getCurrentUserName();
      toast.success(who ? `Settings saved (${who})` : "Settings saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const ext = file.name.split(".").pop() || "png";
    const path = `accounts-po-logo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("invoice-assets").upload(path, file, { upsert: true });
    if (error) {
      toast.error("Logo upload failed: " + error.message);
      setUploading(false);
      return;
    }
    const { data: urlData } = supabase.storage.from("invoice-assets").getPublicUrl(path);
    set("po_logo_url", urlData.publicUrl);
    setUploading(false);
    toast.success("Logo uploaded — click Save to apply");
    e.target.value = "";
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Email & PO Branding</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">Loading…</p></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="py-3"><CardTitle className="text-sm">Email & PO Branding</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">From email</Label>
            <Input value={form.email_from || ""} onChange={(e) => set("email_from", e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">From name</Label>
            <Input value={form.email_from_name || ""} onChange={(e) => set("email_from_name", e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">Reply-to</Label>
            <Input value={form.email_reply_to || ""} onChange={(e) => set("email_reply_to", e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">SMTP host</Label>
            <Input value={form.smtp_host || ""} onChange={(e) => set("smtp_host", e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">SMTP port</Label>
            <Input type="number" value={form.smtp_port ?? 587} onChange={(e) => set("smtp_port", Number(e.target.value) || null)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">SMTP user</Label>
            <Input value={form.smtp_user || ""} onChange={(e) => set("smtp_user", e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">SMTP password</Label>
            <Input type="password" value={form.smtp_pass || ""} onChange={(e) => set("smtp_pass", e.target.value)} className="h-9" autoComplete="new-password" />
          </div>
          <div>
            <Label className="text-xs">Resend API key</Label>
            <Input type="password" value={form.resend_api_key || ""} onChange={(e) => set("resend_api_key", e.target.value)} className="h-9" autoComplete="new-password" />
          </div>
        </div>

        <div className="border-t pt-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground">Purchase order branding</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <Label className="text-xs">PO logo URL</Label>
              <Input value={form.po_logo_url || ""} onChange={(e) => set("po_logo_url", e.target.value)} className="h-9" placeholder="https://…" />
            </div>
            <div>
              <Label className="text-xs">Upload logo</Label>
              <Input type="file" accept="image/*" onChange={handleLogoUpload} disabled={uploading} className="h-9" />
            </div>
            {form.po_logo_url && (
              <div className="flex items-end">
                <img src={form.po_logo_url} alt="PO logo preview" className="h-12 max-w-[200px] object-contain border rounded p-1" />
              </div>
            )}
            <div>
              <Label className="text-xs">Primary brand color</Label>
              <div className="flex gap-2">
                <input type="color" value={form.po_brand_primary || "#0f766e"} onChange={(e) => set("po_brand_primary", e.target.value)} className="h-9 w-12 rounded border" />
                <Input value={form.po_brand_primary || ""} onChange={(e) => set("po_brand_primary", e.target.value)} className="h-9 font-mono" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Accent brand color</Label>
              <div className="flex gap-2">
                <input type="color" value={form.po_brand_accent || "#134e4a"} onChange={(e) => set("po_brand_accent", e.target.value)} className="h-9 w-12 rounded border" />
                <Input value={form.po_brand_accent || ""} onChange={(e) => set("po_brand_accent", e.target.value)} className="h-9 font-mono" />
              </div>
            </div>
          </div>
        </div>

        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || uploading}>
          {saveMutation.isPending ? "Saving…" : "Save settings"}
        </Button>
      </CardContent>
    </Card>
  );
}

function TallyIntegrationSection() {
  const qc = useQueryClient();
  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["accounts_tally_settings"],
    queryFn: getTallySettings,
  });
  const { data: modes = [], isLoading: modesLoading } = useQuery({
    queryKey: ["accounts_tally_mode_map"],
    queryFn: getTallyModeMap,
  });

  const [companyName, setCompanyName] = useState("");
  const [bankLedger, setBankLedger] = useState("");
  const [modeLedgers, setModeLedgers] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!settings || modesLoading) return;
    setCompanyName(settings.company_name || "");
    setBankLedger(settings.default_settlement_bank_ledger || "");
    const map: Record<string, string> = {};
    for (const m of modes) map[m.mode_key] = m.tally_ledger || "";
    setModeLedgers(map);
    setHydrated(true);
  }, [settings, modes, modesLoading]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const bank = bankLedger.trim();
      if (!companyName.trim()) throw new Error("Enter Tally company name");
      if (!bank) throw new Error("Enter bank ledger (e.g. Axis Bank Ltd.)");
      for (const m of modes) {
        const ledger = (modeLedgers[m.mode_key] ?? m.tally_ledger).trim();
        if (!ledger) throw new Error(`Enter Tally ledger for ${m.label}`);
      }
      await saveTallySettings({
        company_name: companyName.trim(),
        default_settlement_bank_ledger: bank,
        // Keep legacy DB columns for older rows / migrations.
        income_ledger: settings?.income_ledger || bank,
        mdr_expense_ledger: settings?.mdr_expense_ledger || "Bank Charges",
      });
      for (const m of modes) {
        await saveTallyModeMapRow({
          mode_key: m.mode_key,
          label: m.label,
          tally_ledger: (modeLedgers[m.mode_key] ?? m.tally_ledger).trim(),
          uses_clearing: false,
          is_active: m.is_active,
          sort_order: m.sort_order,
        });
      }
    },
    onSuccess: () => {
      toast.success("Tally settings saved");
      qc.invalidateQueries({ queryKey: ["accounts_tally_settings"] });
      qc.invalidateQueries({ queryKey: ["accounts_tally_mode_map"] });
    },
    onError: (e: Error) => toast.error(e.message || "Save failed"),
  });

  const loading = settingsLoading || modesLoading || !hydrated;
  const modeHint = (key: string) =>
    key === "cash" ? "Particulars (Account is always Cash)" : "Particulars (Account is bank above)";

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-base">TallyPrime</CardTitle>
        <p className="text-sm text-muted-foreground">
          Set the company, bank account, and one ledger name per payment mode.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Tally company</Label>
                <Input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="h-9"
                  placeholder="P. H. PATHLABS PRIVATE LIMITED"
                />
              </div>
              <div>
                <Label className="text-xs">Bank account (GPay / Paytm / NEFT / Card)</Label>
                <Input
                  value={bankLedger}
                  onChange={(e) => setBankLedger(e.target.value)}
                  className="h-9"
                  placeholder="Axis Bank Ltd."
                />
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Payment mode ledgers</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">Mode</TableHead>
                    <TableHead>Tally ledger</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {modes.map((m) => (
                    <TableRow key={m.mode_key}>
                      <TableCell className="align-top">
                        <div className="font-medium text-sm">{m.label}</div>
                        <div className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                          {modeHint(m.mode_key)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8"
                          value={modeLedgers[m.mode_key] ?? m.tally_ledger}
                          onChange={(e) =>
                            setModeLedgers((prev) => ({ ...prev, [m.mode_key]: e.target.value }))
                          }
                          placeholder={m.mode_key === "cash" ? "Cash Sales" : m.label}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function AccountsSettings() {
  return (
    <div className="space-y-4 max-h-[calc(100vh-8rem)] overflow-y-auto pr-1 pb-4">
      <TallyIntegrationSection />
      <CompaniesSection />
      <NamedListSection title="Banks" table="accounts_banks" queryKey="accounts_banks" />
      <PaymentModesSection />
      <CloudinaryAccountsPanel
        purpose="bills"
        title="Cloudinary (Bills)"
        description="Cloudinary account for purchase invoice bill scans and attachments. Only one account can be active for the bills purpose."
      />
      <EmailPoBrandingSection />
    </div>
  );
}
