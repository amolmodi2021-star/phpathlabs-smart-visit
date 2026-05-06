import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Pencil, UserPlus, Check, X } from "lucide-react";
import {
  syncPatientDemographicsByUmr,
  invalidatePatientCaches,
  type PatientDemographics,
} from "@/lib/syncPatientDemographics";
import { useQueryClient } from "@tanstack/react-query";

const TITLES = ["Mr.", "Mrs.", "Ms.", "Master", "Miss", "Baby Of", "Dr."];

export interface PatientPick {
  patient_name: string;
  title: string;
  gender: string;
  dob: string | null;
  address: string;
  mobile_number: string;
  umr_number: string | null;
  email?: string | null;
  doctor_name?: string | null;
}

interface Props {
  open: boolean;
  mobile10: string;
  onClose: () => void;
  /** Called when user picks an existing patient (or saves edits, then picks). */
  onSelect: (p: PatientPick) => void;
  /** Called when user chooses "New Patient on this mobile" — registration form stays editable, mobile prefilled. */
  onNewPatient: (mobile10: string) => void;
}

interface RegRow {
  patient_name: string;
  title: string | null;
  gender: string | null;
  dob: string | null;
  address: string | null;
  mobile_number: string;
  umr_number: string | null;
  email: string | null;
  doctor_name: string | null;
}

const PatientSelectDialog = ({ open, mobile10, onClose, onSelect, onNewPatient }: Props) => {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [patients, setPatients] = useState<RegRow[]>([]);
  const [editingUmr, setEditingUmr] = useState<string | null>(null);
  const [draft, setDraft] = useState<RegRow | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || mobile10.length !== 10) return;
    setLoading(true);
    setEditingUmr(null);
    setDraft(null);
    (async () => {
      // One row per UMR (latest visit). If UMR null, group by patient_name.
      const { data } = await supabase
        .from("patient_registrations")
        .select("patient_name,title,gender,dob,address,mobile_number,umr_number,email,doctor_name,created_at")
        .ilike("mobile_number", `%${mobile10}%`)
        .eq("bill_cancelled", false)
        .order("created_at", { ascending: false })
        .limit(50);
      const seen = new Set<string>();
      const out: RegRow[] = [];
      (data || []).forEach((r: any) => {
        const k = (r.umr_number || `name:${(r.patient_name || "").toUpperCase()}`).trim();
        if (seen.has(k)) return;
        seen.add(k);
        out.push(r);
      });
      setPatients(out);
      setLoading(false);
    })();
  }, [open, mobile10]);

  const startEdit = (p: RegRow) => {
    setEditingUmr(p.umr_number || `__name__${p.patient_name}`);
    setDraft({ ...p });
  };

  const cancelEdit = () => {
    setEditingUmr(null);
    setDraft(null);
  };

  const saveEdit = async () => {
    if (!draft) return;
    if (!draft.patient_name?.trim()) { toast.error("Patient name is required"); return; }
    if (!draft.title) { toast.error("Title is required"); return; }
    if (!draft.gender) { toast.error("Gender is required"); return; }
    setSaving(true);
    try {
      const cleanMobile = (draft.mobile_number || "").replace(/\D/g, "").slice(-10);
      const demo: PatientDemographics = {
        umr_number: draft.umr_number,
        patient_name: draft.patient_name.replace(/\s+/g, " ").trim().toUpperCase(),
        title: draft.title,
        gender: draft.gender,
        dob: draft.dob || null,
        email: draft.email || null,
        mobile_number: cleanMobile,
        address: (draft.address || "").toUpperCase(),
        doctor_name: (draft.doctor_name || "SELF").toUpperCase(),
      };

      if (draft.umr_number) {
        // Fan-out to ALL historical rows with this UMR.
        // Pass dummy id so the .neq filter doesn't exclude anything.
        const res = await syncPatientDemographicsByUmr(
          "00000000-0000-0000-0000-000000000000",
          demo,
        );
        if (res.warnings.length) console.warn("[PatientSelect] sync warnings", res.warnings);
      } else {
        // No UMR — update by mobile + name match in patient_registrations only.
        await supabase.from("patient_registrations")
          .update({
            patient_name: demo.patient_name, title: demo.title, gender: demo.gender,
            dob: demo.dob, email: demo.email, address: demo.address,
            doctor_name: demo.doctor_name, mobile_number: demo.mobile_number,
          } as any)
          .eq("mobile_number", cleanMobile)
          .eq("patient_name", draft.patient_name);
      }

      invalidatePatientCaches(qc);
      toast.success("Patient details updated across all visits");

      const updated: RegRow = { ...draft, ...demo } as any;
      // Reflect in local list
      setPatients((prev) => prev.map((x) =>
        (x.umr_number && x.umr_number === draft.umr_number) ||
        (!x.umr_number && x.patient_name === draft.patient_name && x.mobile_number === draft.mobile_number)
          ? updated : x,
      ));
      cancelEdit();
      // Auto-select the just-edited patient
      onSelect(rowToPick(updated));
    } catch (e: any) {
      toast.error(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const rowToPick = (r: RegRow): PatientPick => ({
    patient_name: r.patient_name || "",
    title: r.title || "",
    gender: r.gender || "",
    dob: r.dob || null,
    address: r.address || "",
    mobile_number: (r.mobile_number || "").replace(/\D/g, "").slice(-10),
    umr_number: r.umr_number || null,
    email: r.email || null,
    doctor_name: r.doctor_name || null,
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Patients on {mobile10}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Searching…</p>
        ) : patients.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No existing patient on this mobile.</p>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {patients.map((p, idx) => {
              const editKey = p.umr_number || `__name__${p.patient_name}`;
              const isEditing = editingUmr === editKey;
              return (
                <div key={idx} className="border rounded-md p-3">
                  {!isEditing ? (
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">
                          {p.title} {p.patient_name}
                          {p.umr_number && <span className="ml-2 text-xs text-muted-foreground">UMR: {p.umr_number}</span>}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {p.gender || "—"} • DOB {p.dob || "—"} • {p.mobile_number}
                        </div>
                        {p.address && <div className="text-xs text-muted-foreground truncate">{p.address}</div>}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button size="sm" variant="outline" onClick={() => startEdit(p)}>
                          <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                        </Button>
                        <Button size="sm" onClick={() => onSelect(rowToPick(p))}>
                          <Check className="h-3.5 w-3.5 mr-1" /> Select
                        </Button>
                      </div>
                    </div>
                  ) : draft && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Title *</Label>
                          <Select value={draft.title || ""} onValueChange={(v) => setDraft({ ...draft, title: v })}>
                            <SelectTrigger className="h-8"><SelectValue placeholder="Select" /></SelectTrigger>
                            <SelectContent>{TITLES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">Gender *</Label>
                          <Select value={draft.gender || ""} onValueChange={(v) => setDraft({ ...draft, gender: v })}>
                            <SelectTrigger className="h-8"><SelectValue placeholder="Select" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Male">Male</SelectItem>
                              <SelectItem value="Female">Female</SelectItem>
                              <SelectItem value="Unspecified">Unspecified</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs">Patient Name *</Label>
                        <Input className="h-8 uppercase" value={draft.patient_name || ""}
                          onChange={(e) => setDraft({ ...draft, patient_name: e.target.value.toUpperCase() })} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">DOB</Label>
                          <Input type="date" className="h-8" value={draft.dob || ""}
                            onChange={(e) => setDraft({ ...draft, dob: e.target.value })} />
                        </div>
                        <div>
                          <Label className="text-xs">Mobile</Label>
                          <Input className="h-8" value={draft.mobile_number || ""}
                            onChange={(e) => setDraft({ ...draft, mobile_number: e.target.value })} />
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs">Address</Label>
                        <Input className="h-8 uppercase" value={draft.address || ""}
                          onChange={(e) => setDraft({ ...draft, address: e.target.value.toUpperCase() })} />
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saving}>
                          <X className="h-3.5 w-3.5 mr-1" /> Cancel
                        </Button>
                        <Button size="sm" onClick={saveEdit} disabled={saving}>
                          <Check className="h-3.5 w-3.5 mr-1" /> {saving ? "Saving…" : "Save & Select"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="border-t pt-3 flex justify-between items-center">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onNewPatient(mobile10)}>
            <UserPlus className="h-4 w-4 mr-1" /> New Patient on this Mobile
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PatientSelectDialog;
