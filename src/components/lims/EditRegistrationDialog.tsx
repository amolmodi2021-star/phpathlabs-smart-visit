import { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Save, Ban, Lock } from "lucide-react";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";
import {
  syncRegistrationPaymentRow,
  syncDueCollectionPaymentModes,
  splitPaymentModes,
  fetchFrozenRegistrationBillSnapshot,
  sumLoggedRefunds,
  resolveCancelBillSnapshot,
  logPaymentTransaction,
} from "@/lib/paymentTransactions";
import {
  applyDueCollectionGroupEdits,
  dueCollectionGroupEditsChanged,
  groupDueCollectionsByDate,
  mergeEditedRegistrationSplit,
  splitRegistrationAndDuePayments,
  sumPaymentEntries,
  maxAmountForModeSplit,
  type DueCollectionGroupEdit,
} from "@/lib/billPayment";
import { syncPatientDemographicsByUmr, invalidatePatientCaches } from "@/lib/syncPatientDemographics";
import DoctorAutocomplete, { ensureDoctor } from "@/components/lims/DoctorAutocomplete";
import { genderFromTitle, PATIENT_TITLES } from "@/lib/normalizePatientFields";

const TITLES = [...PATIENT_TITLES];
const PAYMENT_MODES = ["Cash", "GPay", "Paytm", "Credit Card", "NEFT"];

interface EditRegistrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  registration: any;
}

const EditRegistrationDialog = ({ open, onOpenChange, registration: reg }: EditRegistrationDialogProps) => {
  const qc = useQueryClient();

  // Editable demographics
  const [patientName, setPatientName] = useState("");
  const [title, setTitle] = useState("");
  const [gender, setGender] = useState("");
  const [dob, setDob] = useState("");
  const [ageText, setAgeText] = useState("");
  const [email, setEmail] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [address, setAddress] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [remarks, setRemarks] = useState("");
  const [isStat, setIsStat] = useState(false);

  // Payment mode editing (registration + due collections)
  const [selectedModes, setSelectedModes] = useState<Set<string>>(new Set());
  const [modeAmounts, setModeAmounts] = useState<Record<string, number>>({});
  const [dueGroupEdits, setDueGroupEdits] = useState<Array<DueCollectionGroupEdit & { selectedModes: string[] }>>([]);

  // Cancel entire bill
  const [refundMode, setRefundMode] = useState<string>("Cash");
  const [showCancelBillPwd, setShowCancelBillPwd] = useState(false);
  const [saving, setSaving] = useState(false);

  // Payment-mode lock for invoices older than today
  const [showPaymentUnlockPwd, setShowPaymentUnlockPwd] = useState(false);
  const [paymentUnlocked, setPaymentUnlocked] = useState(false);

  useEffect(() => {
    if (reg && open) {
      setPaymentUnlocked(false);
      setPatientName(reg.patient_name || "");
      setTitle(reg.title || "");
      setGender(reg.gender || "");
      setDob(reg.dob || "");
      setAgeText(reg.age_text || "");
      setEmail(reg.email || "");
      setDoctorName(reg.doctor_name || "");
      setAddress(reg.address || "");
      setMobileNumber(reg.mobile_number || "");
      setRemarks(reg.remarks || "");
      setIsStat(reg.is_stat || false);
      setRefundMode("Cash");

      const existingPayments: any[] = Array.isArray(reg.payments) ? reg.payments : [];
      const { registration: originalSplit, dueCollections } = splitRegistrationAndDuePayments(existingPayments);
      const modes = new Set<string>(originalSplit.map((p: any) => p.mode).filter(Boolean));
      setSelectedModes(modes);
      const amounts: Record<string, number> = {};
      originalSplit.forEach((p: any) => { amounts[p.mode] = Number(p.amount) || 0; });
      setModeAmounts(amounts);
      setDueGroupEdits(
        groupDueCollectionsByDate(dueCollections).map((g) => {
          const modeAmounts: Record<string, number> = {};
          const selected: string[] = [];
          for (const entry of g.entries) {
            const mode = String(entry.mode || "Cash");
            modeAmounts[mode] = (modeAmounts[mode] || 0) + Number(entry.amount || 0);
            if (!selected.includes(mode)) selected.push(mode);
          }
          return {
            date: g.date,
            total: g.total,
            modeAmounts,
            selectedModes: selected,
          };
        }),
      );
    }
  }, [reg, open]);

  useEffect(() => {
    const g = genderFromTitle(title);
    if (g) setGender(g);
  }, [title]);

  const tests: any[] = reg ? (Array.isArray(reg.tests) ? reg.tests : []) : [];
  const alreadyCancelled = reg
    ? new Set((Array.isArray(reg.cancelled_tests) ? reg.cancelled_tests : []).map((t: any) => t.test_id || t))
    : new Set<string>();
  const isBillCancelled = reg?.bill_cancelled;

  const isInvoiceOlderThanToday = useMemo(() => {
    if (!reg?.created_at) return false;
    const d = new Date(reg.created_at);
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
    return d < startOfToday;
  }, [reg?.created_at]);
  const isPaymentLocked = isInvoiceOlderThanToday && !paymentUnlocked;

  const originalRegPaid = useMemo(() => {
    const existingPayments: any[] = Array.isArray(reg?.payments) ? reg.payments : [];
    return sumPaymentEntries(splitRegistrationAndDuePayments(existingPayments).registration);
  }, [reg?.payments]);

  const dueCollectionGroups = useMemo(() => {
    const existingPayments: any[] = Array.isArray(reg?.payments) ? reg.payments : [];
    return groupDueCollectionsByDate(
      splitRegistrationAndDuePayments(existingPayments).dueCollections,
    );
  }, [reg?.payments]);

  const dueModesDirty = useMemo(
    () => dueCollectionGroupEditsChanged(
      reg?.payments,
      dueGroupEdits.map(({ date, total, modeAmounts }) => ({ date, total, modeAmounts })),
    ),
    [reg?.payments, dueGroupEdits],
  );

  const dueGroupsMismatch = useMemo(() => {
    return dueGroupEdits.some((g) => {
      const allocated = Object.values(g.modeAmounts || {}).reduce((s, n) => s + Number(n || 0), 0);
      if ((g.selectedModes || []).length === 0 && g.total > 0) return true;
      return Math.abs(allocated - Number(g.total || 0)) > 0.01;
    });
  }, [dueGroupEdits]);

  const registrationSplitChanged = useMemo(() => {
    if (!reg) return false;
    const existingPayments: any[] = Array.isArray(reg.payments) ? reg.payments : [];
    const { registration: originalRegEntries } = splitRegistrationAndDuePayments(existingPayments);
    const editedSplit = Array.from(selectedModes)
      .filter((m) => (modeAmounts[m] || 0) > 0)
      .map((m) => ({ mode: m, amount: modeAmounts[m] || 0 }));
    const origModes = splitPaymentModes(originalRegEntries);
    const newModes = splitPaymentModes(editedSplit);
    return (
      origModes.cash !== newModes.cash ||
      origModes.gpay !== newModes.gpay ||
      origModes.paytm !== newModes.paytm ||
      origModes.credit_card !== newModes.credit_card ||
      origModes.neft !== newModes.neft
    );
  }, [reg, selectedModes, modeAmounts]);

  const togglePaymentMode = (mode: string) => {
    setSelectedModes((prev) => {
      const next = new Set(prev);
      if (next.has(mode)) {
        next.delete(mode);
        setModeAmounts((a) => {
          const n = { ...a };
          delete n[mode];
          return n;
        });
      } else {
        next.add(mode);
      }
      return next;
    });
  };

  const toggleDueGroupMode = (groupIdx: number, mode: string) => {
    setDueGroupEdits((prev) => prev.map((g, i) => {
      if (i !== groupIdx) return g;
      const selected = new Set(g.selectedModes || []);
      const nextAmounts = { ...(g.modeAmounts || {}) };
      if (selected.has(mode)) {
        selected.delete(mode);
        delete nextAmounts[mode];
      } else {
        selected.add(mode);
      }
      const selectedModes = Array.from(selected);
      if (selectedModes.length === 1) {
        return { ...g, selectedModes, modeAmounts: { [selectedModes[0]]: g.total } };
      }
      return { ...g, selectedModes, modeAmounts: nextAmounts };
    }));
  };

  // Auto-fill when single mode selected — original registration payment only
  useEffect(() => {
    if (selectedModes.size === 1) {
      const mode = Array.from(selectedModes)[0];
      setModeAmounts({ [mode]: originalRegPaid });
    }
  }, [selectedModes.size, originalRegPaid]);

  const editPaidAmount = Array.from(selectedModes).reduce((sum, mode) => sum + (modeAmounts[mode] || 0), 0);
  const paymentModesMismatch = originalRegPaid > 0 && selectedModes.size > 1 && Math.abs(editPaidAmount - originalRegPaid) > 0.01;

  if (!reg) return null;

  const handleSaveDetails = async () => {
    setSaving(true);
    try {
      if (isPaymentLocked && (dueModesDirty || registrationSplitChanged)) {
        throw new Error("Unlock payment mode editing for older invoices before changing payment modes");
      }
      if (dueGroupsMismatch) {
        throw new Error("Each due collection's payment modes must add up to that collection's total");
      }

      const editedSplit = Array.from(selectedModes)
        .filter((m) => (modeAmounts[m] || 0) > 0)
        .map((m) => ({ mode: m, amount: modeAmounts[m] || 0 }));

      const existingPayments: any[] = Array.isArray(reg.payments) ? reg.payments : [];
      const { registration: originalRegEntries } = splitRegistrationAndDuePayments(existingPayments);
      const paidCap = Number(reg.final_amount || 0);
      const paymentsWithDueModes = applyDueCollectionGroupEdits(
        existingPayments,
        dueGroupEdits.map(({ date, total, modeAmounts: amts }) => ({ date, total, modeAmounts: amts })),
      );
      const payments = mergeEditedRegistrationSplit(paymentsWithDueModes, editedSplit, paidCap);

      const updateData: any = {
        patient_name: patientName.replace(/\s+/g, " ").trim().toUpperCase(),
        title,
        gender,
        dob: dob || null,
        age_text: reg.visit_type === "pickup_point" ? (ageText.trim() || null) : null,
        email: email || null,
        doctor_name: (doctorName || "SELF").toUpperCase(),
        address: address.replace(/\s+/g, " ").trim().toUpperCase(),
        mobile_number: mobileNumber.replace(/\D/g, "").slice(-10),
        remarks: remarks.replace(/\s+/g, " ").trim().toUpperCase() || null,
        is_stat: isStat,
        payments,
      };

      const { error } = await supabase.from("patient_registrations").update(updateData).eq("id", reg.id);
      if (error) throw error;

      ensureDoctor(updateData.doctor_name);

      try {
        const syncResult = await syncPatientDemographicsByUmr(reg.id, {
          umr_number: reg.umr_number,
          patient_name: updateData.patient_name,
          title: updateData.title,
          gender: updateData.gender,
          dob: updateData.dob,
          age_text: updateData.age_text,
          email: updateData.email,
          mobile_number: updateData.mobile_number,
          address: updateData.address,
          doctor_name: updateData.doctor_name,
        });
        if (syncResult.warnings.length > 0) {
          // eslint-disable-next-line no-console
          console.warn("[EditRegistration] demographic sync warnings:", syncResult.warnings);
        }
        if (!String(reg.umr_number || "").trim()) {
          await supabase
            .from("approved_reports")
            .update({
              patient_name: updateData.patient_name,
              title: updateData.title ?? null,
              gender: updateData.gender ?? null,
              dob: updateData.dob ?? null,
              age_text: updateData.age_text ?? null,
              email: updateData.email ?? null,
              mobile_number: updateData.mobile_number ?? null,
              address: updateData.address ?? null,
              doctor_name: updateData.doctor_name ?? null,
            } as any)
            .eq("registration_id", reg.id);
        }
      } catch (syncErr) {
        // eslint-disable-next-line no-console
        console.warn("[EditRegistration] demographic sync failed", syncErr);
      }

      invalidatePatientCaches(qc);

      {
        const origModes = splitPaymentModes(originalRegEntries);
        const newModes = splitPaymentModes(editedSplit);
        const splitChanged =
          origModes.cash !== newModes.cash ||
          origModes.gpay !== newModes.gpay ||
          origModes.paytm !== newModes.paytm ||
          origModes.credit_card !== newModes.credit_card ||
          origModes.neft !== newModes.neft;
        if (splitChanged) {
          const syncedPaid = editedSplit.reduce((s, p) => s + (p.amount || 0), 0);
          await syncRegistrationPaymentRow({
            registration_id: reg.id,
            invoice_number: reg.invoice_number,
            patient_name: patientName,
            payments: editedSplit,
            paid_amount: syncedPaid,
            final_amount: Number(reg.final_amount || 0),
            due_amount: 0,
            change_reason: "Payment mode edited",
            sync_payment_split: true,
            sync_bill_snapshot: false,
          });
        }
      }

      if (dueModesDirty) {
        const remappedDue = splitRegistrationAndDuePayments(payments).dueCollections;
        await syncDueCollectionPaymentModes({
          registration_id: reg.id,
          dueCollections: remappedDue,
        });
        qc.invalidateQueries({ queryKey: ["lims-daily-report"] });
      }

      toast.success(dueModesDirty ? "Registration updated (due collection mode corrected)" : "Registration updated");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const processCancelBill = async () => {
    setSaving(true);
    try {
      const frozen = await fetchFrozenRegistrationBillSnapshot(reg.id);
      const alreadyRefunded = await sumLoggedRefunds(reg.id);
      const { origGross, origDiscount, origFinal, refundCash } = resolveCancelBillSnapshot(
        reg,
        frozen,
        alreadyRefunded,
      );
      const totalPaid = refundCash;
      const regDate = reg.created_at ? new Date(reg.created_at) : new Date();
      const regDateStr = (reg.invoice_number && /^\d{6}/.test(reg.invoice_number))
        ? `${reg.invoice_number.slice(4, 6)}-${reg.invoice_number.slice(2, 4)}-20${reg.invoice_number.slice(0, 2)}`
        : format(regDate, "dd-MM-yyyy");
      const origPayments: Array<{ mode: string; amount: number }> = Array.isArray(reg.payments) ? reg.payments : [];
      const origModesLabel = origPayments.length
        ? Array.from(new Set(origPayments.map((p: any) => p.mode))).join("/")
        : "—";

      // Freeze pattern: do NOT mutate the original registration_payment audit row.
      // Clear payments[] in the same write — otherwise enforce_bill_payment_cap rejects.
      const { error } = await supabase.from("patient_registrations").update({
        bill_cancelled: true,
        status: "cancelled",
        refund_amount: Number(reg.refund_amount || 0) + totalPaid,
        refund_mode: refundMode,
        refund_date: new Date().toISOString(),
        final_amount: 0,
        paid_amount: 0,
        due_amount: 0,
        payments: [],
      } as any).eq("id", reg.id);
      if (error) throw error;

      await supabase
        .from("sample_tubes" as any)
        .delete()
        .eq("registration_id", reg.id)
        .in("status", ["pending", "deferred", "collected"]);

      qc.invalidateQueries({ queryKey: ["patient_registrations"] });
      qc.invalidateQueries({ queryKey: ["sample_tubes_collection"] });
      qc.invalidateQueries({ queryKey: ["sample_collection_open_regs"] });
      qc.invalidateQueries({ queryKey: ["sample_collection_page_tubes"] });
      qc.invalidateQueries({ queryKey: ["sample_collection_regs"] });
      qc.invalidateQueries({ queryKey: ["sample_tubes_acceptance_pending"] });
      qc.invalidateQueries({ queryKey: ["sample_acceptance_regs"] });

      const todayStr = format(new Date(), "dd-MM-yyyy");
      const isCrossDay = regDateStr !== todayStr;
      if (totalPaid > 0) {
        logPaymentTransaction({
          registration_id: reg.id,
          invoice_number: reg.invoice_number,
          patient_name: patientName,
          transaction_type: isCrossDay ? "old_bill_refund" : "refund",
          direction: "out",
          payments: [{ mode: refundMode, amount: totalPaid }],
          total_amount: totalPaid,
          gross_amount: 0,
          discount_amount: 0,
          final_amount: 0,
          paid_amount: 0,
          due_amount: 0,
          refund_amount: totalPaid,
          remarks: `Refund of ₹${totalPaid} via ${refundMode} for cancelled invoice ${reg.invoice_number} (registered ${regDateStr}, originally paid via ${origModesLabel})`,
        });
      }

      if (origFinal > 0.009 || origGross > 0.009) {
        logPaymentTransaction({
          registration_id: reg.id,
          invoice_number: reg.invoice_number,
          patient_name: patientName,
          transaction_type: isCrossDay ? "old_bill_cancellation" : "bill_cancellation",
          direction: "out",
          payments: [],
          total_amount: 0,
          gross_amount: -origGross,
          discount_amount: -origDiscount,
          final_amount: -origFinal,
          paid_amount: 0,
          due_amount: 0,
          refund_amount: 0,
          remarks: `Bill cancelled — original invoice ${reg.invoice_number} dated ${regDateStr}, final ₹${origFinal}`,
        });
      }

      toast.success(
        totalPaid > 0
          ? `Bill cancelled. Refund ₹${totalPaid} via ${refundMode} recorded in today's Daily Report.`
          : `Bill cancelled. Gross/Final offset recorded in today's Daily Report.`,
      );
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const isPickup = reg.visit_type === "pickup_point";
  const age = isPickup
    ? (ageText.trim() || "")
    : dob
      ? `${Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000))} Years`
      : "";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Edit Registration — {reg.invoice_number}
              {isBillCancelled && <Badge variant="destructive">CANCELLED</Badge>}
            </DialogTitle>
          </DialogHeader>

          {/* Patient Details */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm">Patient Details</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Mobile Number</Label>
                <Input value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)} disabled={isBillCancelled} />
              </div>
              <div>
                <Label>Title</Label>
                <Select value={title} onValueChange={setTitle} disabled={isBillCancelled}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TITLES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Patient Name</Label>
                <Input value={patientName} onChange={(e) => setPatientName(e.target.value.toUpperCase())} disabled={isBillCancelled} />
              </div>
              <div>
                <Label>Gender</Label>
                <Select value={gender} onValueChange={setGender} disabled={isBillCancelled}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                    <SelectItem value="Unspecified">Unspecified</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                {isPickup ? (
                  <>
                    <Label>Age *</Label>
                    <Input
                      value={ageText}
                      onChange={(e) => setAgeText(e.target.value)}
                      placeholder="e.g. 35 Years"
                      disabled={isBillCancelled}
                    />
                  </>
                ) : (
                  <>
                    <Label>DOB {age && <span className="text-muted-foreground ml-1">({age})</span>}</Label>
                    <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} disabled={isBillCancelled} />
                  </>
                )}
              </div>
              <div>
                <Label>Email</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} disabled={isBillCancelled} />
              </div>
            </div>
            <div>
              <Label>Doctor Name</Label>
              <DoctorAutocomplete value={doctorName} onChange={setDoctorName} disabled={isBillCancelled} />
            </div>
            <div>
              <Label>Address</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value.toUpperCase())} disabled={isBillCancelled} />
            </div>
            <div>
              <Label>Remarks</Label>
              <Input value={remarks} onChange={(e) => setRemarks(e.target.value.toUpperCase())} placeholder="Optional remarks" className="uppercase" disabled={isBillCancelled} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-destructive/30 p-3">
              <div className="flex items-center gap-2">
                {isStat && (
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-destructive" />
                  </span>
                )}
                <Label className="text-destructive font-semibold cursor-pointer" htmlFor="edit-stat-toggle">STAT (Urgent)</Label>
              </div>
              <Switch id="edit-stat-toggle" checked={isStat} onCheckedChange={setIsStat} className="data-[state=checked]:bg-destructive" disabled={isBillCancelled} />
            </div>

            {/* Registration Payment Mode */}
            {!isBillCancelled && originalRegPaid > 0 && (
              <div className="space-y-2">
                <h3 className="font-semibold text-sm">Registration Payment Mode</h3>
                <div className="text-sm text-muted-foreground mb-1">
                  Paid at registration: <span className="font-semibold text-foreground">₹{originalRegPaid}</span>
                </div>

                {isPaymentLocked && (
                  <div className="p-3 rounded border border-orange-300 bg-orange-50 space-y-2">
                    <div className="text-sm text-orange-700 flex items-center gap-2">
                      <Lock className="h-4 w-4" />
                      Payment mode editing is locked for invoices from previous dates. Enter admin password to unlock.
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setShowPaymentUnlockPwd(true)}>
                      Unlock Payment Mode
                    </Button>
                  </div>
                )}

                <fieldset disabled={isPaymentLocked} className={isPaymentLocked ? "opacity-60 pointer-events-none" : ""}>
                  <div className="flex flex-wrap gap-2">
                    {PAYMENT_MODES.map((mode) => (
                      <Button
                        key={mode}
                        type="button"
                        size="sm"
                        variant={selectedModes.has(mode) ? "default" : "outline"}
                        onClick={() => togglePaymentMode(mode)}
                      >
                        {mode}
                      </Button>
                    ))}
                  </div>
                  {Array.from(selectedModes).map((mode) => {
                    const maxForThisMode = maxAmountForModeSplit(
                      originalRegPaid,
                      modeAmounts,
                      selectedModes,
                      mode,
                    );
                    return (
                      <div key={mode} className="flex items-center gap-2 mt-2">
                        <Label className="w-28 text-sm">{mode}:</Label>
                        <Input
                          type="number"
                          min={0}
                          max={maxForThisMode}
                          className="w-32"
                          value={modeAmounts[mode] || ""}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setModeAmounts((prev) => {
                              const max = maxAmountForModeSplit(
                                originalRegPaid,
                                prev,
                                selectedModes,
                                mode,
                              );
                              return { ...prev, [mode]: Math.min(val, max) };
                            });
                          }}
                          placeholder="₹ Amount"
                          readOnly={selectedModes.size === 1}
                        />
                      </div>
                    );
                  })}
                  {selectedModes.size > 1 && (
                    <div className="text-sm space-y-1 pt-1">
                      <div className="flex justify-between">
                        <span>Allocated:</span>
                        <span className={`font-medium ${paymentModesMismatch ? "text-destructive" : ""}`}>
                          ₹{editPaidAmount} / ₹{originalRegPaid}
                        </span>
                      </div>
                      {paymentModesMismatch && (
                        <div className="text-destructive text-xs font-medium">
                          Split amounts must equal ₹{originalRegPaid}
                        </div>
                      )}
                    </div>
                  )}
                </fieldset>
              </div>
            )}

            {/* Due Collection Payment Modes */}
            {!isBillCancelled && dueCollectionGroups.length > 0 && (
              <div className="space-y-3">
                <div>
                  <h3 className="font-semibold text-sm">Due Collection Payment Modes</h3>
                  <div className="text-sm text-muted-foreground">
                    Each due collection is edited like registration: change modes or split (e.g. Cash + GPay). Collection totals stay fixed.
                  </div>
                </div>

                {isPaymentLocked && originalRegPaid <= 0 && (
                  <div className="p-3 rounded border border-orange-300 bg-orange-50 space-y-2">
                    <div className="text-sm text-orange-700 flex items-center gap-2">
                      <Lock className="h-4 w-4" />
                      Due collection mode editing is locked for invoices from previous dates. Enter admin password to unlock.
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setShowPaymentUnlockPwd(true)}>
                      Unlock Payment Mode
                    </Button>
                  </div>
                )}

                <fieldset disabled={isPaymentLocked} className={isPaymentLocked ? "opacity-60 pointer-events-none space-y-3" : "space-y-3"}>
                  {dueGroupEdits.map((group, groupIdx) => {
                    const allocated = Object.values(group.modeAmounts || {}).reduce((s, n) => s + Number(n || 0), 0);
                    const mismatch = Math.abs(allocated - Number(group.total || 0)) > 0.01;
                    const selected = new Set(group.selectedModes || []);
                    return (
                      <div key={group.date || `due-${groupIdx}`} className="rounded border p-3 space-y-2">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <div className="text-sm font-medium">
                            Collection {groupIdx + 1}
                            {group.date ? (
                              <span className="ml-2 font-normal text-muted-foreground">
                                {format(new Date(group.date), "dd-MM-yyyy hh:mm a")}
                              </span>
                            ) : null}
                          </div>
                          <div className="text-sm">
                            Total: <span className="font-semibold">₹{group.total}</span>
                            <span className="text-muted-foreground text-xs ml-1">(locked)</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {PAYMENT_MODES.map((mode) => (
                            <Button
                              key={mode}
                              type="button"
                              size="sm"
                              variant={selected.has(mode) ? "default" : "outline"}
                              onClick={() => toggleDueGroupMode(groupIdx, mode)}
                            >
                              {mode}
                            </Button>
                          ))}
                        </div>
                        {Array.from(selected).map((mode) => {
                          const maxForThisMode = maxAmountForModeSplit(
                            group.total,
                            group.modeAmounts,
                            selected,
                            mode,
                          );
                          return (
                            <div key={mode} className="flex items-center gap-2">
                              <Label className="w-28 text-sm">{mode}:</Label>
                              <Input
                                type="number"
                                min={0}
                                max={maxForThisMode}
                                className="w-32"
                                value={group.modeAmounts[mode] || ""}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setDueGroupEdits((prev) =>
                                    prev.map((g, i) => {
                                      if (i !== groupIdx) return g;
                                      const max = maxAmountForModeSplit(
                                        g.total,
                                        g.modeAmounts,
                                        g.selectedModes || [],
                                        mode,
                                      );
                                      return {
                                        ...g,
                                        modeAmounts: {
                                          ...g.modeAmounts,
                                          [mode]: Math.min(val, max),
                                        },
                                      };
                                    }),
                                  );
                                }}
                                placeholder="₹ Amount"
                                readOnly={selected.size === 1}
                              />
                            </div>
                          );
                        })}
                        {selected.size > 1 && (
                          <div className="text-sm space-y-1 pt-1">
                            <div className="flex justify-between">
                              <span>Allocated:</span>
                              <span className={`font-medium ${mismatch ? "text-destructive" : ""}`}>
                                ₹{allocated} / ₹{group.total}
                              </span>
                            </div>
                            {mismatch && (
                              <div className="text-destructive text-xs font-medium">
                                Split amounts must equal ₹{group.total}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {dueModesDirty && (
                    <div className="text-xs text-muted-foreground">
                      Mode changes update Daily Report payment-mode columns for those due collections (same amounts).
                    </div>
                  )}
                </fieldset>
              </div>
            )}

            {!isBillCancelled && (
              <Button
                onClick={handleSaveDetails}
                disabled={saving || paymentModesMismatch || dueGroupsMismatch}
                className="w-full"
              >
                <Save className="h-4 w-4 mr-2" />Save Details
              </Button>
            )}
          </div>

          <Separator />

          {/* Tests (read-only) */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm">Tests ({tests.length})</h3>
            <p className="text-xs text-muted-foreground">
              Bill amounts, tests, and discounts cannot be edited here. To fix billing, Cancel Entire Bill below and register a new invoice.
            </p>
            <div className="space-y-2">
              {tests.map((t: any, i: number) => {
                const isCancelled = alreadyCancelled.has(t.test_id);
                const price = Number(t.price || 0);
                const lineDisc = Number(t.discount || 0)
                  || Math.max(0, price - Number(t.discounted_price ?? price));
                const net = t.discounted_price != null
                  ? Number(t.discounted_price)
                  : Math.max(0, price - lineDisc);
                return (
                  <div
                    key={t.test_id || i}
                    className={`p-2 rounded border flex items-center gap-3 ${isCancelled ? "bg-destructive/10 line-through opacity-60" : ""}`}
                  >
                    <span className="flex-1 text-sm">{t.test_name}</span>
                    <span className="text-sm text-muted-foreground">₹{price}</span>
                    {!isCancelled && lineDisc > 0 && (
                      <span className="text-sm text-green-600 font-medium">-₹{lineDisc}</span>
                    )}
                    {!isCancelled && <span className="text-sm font-medium">₹{net}</span>}
                    {isCancelled && <Badge variant="destructive" className="text-xs">Cancelled</Badge>}
                  </div>
                );
              })}
            </div>

            {Number(reg.refund_amount || 0) > 0 && (
              <div className="p-3 rounded border bg-muted/50 text-sm space-y-1">
                <div className="font-medium">Previous Refund</div>
                <div>Amount: ₹{reg.refund_amount} via {reg.refund_mode}</div>
                {reg.refund_date && <div>Date: {format(new Date(reg.refund_date), "dd-MM-yyyy hh:mm a")}</div>}
              </div>
            )}
          </div>

          <Separator />

          {/* Bill Summary (read-only from reg) */}
          <div className="space-y-2 text-sm">
            <h3 className="font-semibold">Bill Summary</h3>
            <div className="flex justify-between"><span>Gross Amount:</span><span>₹{reg.gross_amount}</span></div>
            {Number(reg.discount_amount || 0) > 0 && (
              <div className="flex justify-between text-green-600"><span>Discount:</span><span>-₹{reg.discount_amount}</span></div>
            )}
            {Number(reg.home_visit_charges || 0) > 0 && (
              <div className="flex justify-between"><span>Home Visit Charges:</span><span>+₹{reg.home_visit_charges}</span></div>
            )}
            <div className="flex justify-between font-bold border-t pt-1"><span>Final Amount:</span><span>₹{reg.final_amount}</span></div>
            <div className="flex justify-between"><span>Paid:</span><span>₹{reg.paid_amount}</span></div>
            {Number(reg.due_amount || 0) > 0 && (
              <div className="flex justify-between text-destructive font-bold"><span>Due:</span><span>₹{reg.due_amount}</span></div>
            )}
            {Number(reg.refund_amount || 0) > 0 && (
              <div className="flex justify-between text-orange-600"><span>Refunded:</span><span>₹{reg.refund_amount}</span></div>
            )}
          </div>

          {/* Cancel Entire Bill — always available when not already cancelled */}
          {!isBillCancelled && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <Label className="text-sm">Refund Mode for Full Cancellation:</Label>
                  <Select value={refundMode} onValueChange={setRefundMode}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Cash">Cash</SelectItem>
                      <SelectItem value="NEFT">NEFT</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => {
                    const inv = reg?.invoice_number || "";
                    const isOldBill = /^\d{6}/.test(inv) &&
                      `${inv.slice(4, 6)}-${inv.slice(2, 4)}-20${inv.slice(0, 2)}` !== format(new Date(), "dd-MM-yyyy");
                    if (isOldBill) {
                      setShowCancelBillPwd(true);
                    } else {
                      void processCancelBill();
                    }
                  }}
                  disabled={saving}
                >
                  <Ban className="h-4 w-4 mr-2" />Cancel Entire Bill
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <DeletePasswordDialog
        open={showCancelBillPwd}
        onOpenChange={setShowCancelBillPwd}
        onSuccess={processCancelBill}
        description={`This will cancel invoice ${reg.invoice_number}. Refund ₹${reg.paid_amount} via ${refundMode} will be recorded in TODAY's Daily Report. The original registration entry will remain unchanged.`}
      />
      <DeletePasswordDialog
        open={showPaymentUnlockPwd}
        onOpenChange={setShowPaymentUnlockPwd}
        onSuccess={() => {
          setPaymentUnlocked(true);
          toast.success("Payment mode editing unlocked for this session");
        }}
        description={`Invoice ${reg.invoice_number} is from a previous date. Enter admin password to unlock registration / due collection payment mode editing.`}
      />
    </>
  );
};

export default EditRegistrationDialog;
