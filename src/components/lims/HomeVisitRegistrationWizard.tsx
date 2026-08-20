import { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { UserPlus, Save, Send, Loader2 } from "lucide-react";
import { getCurrentUserName } from "@/lib/auth";
import { buildSampleTubeGroups } from "@/lib/sampleTubeGrouping";
import { registerPatientAtomic } from "@/lib/registerPatientAtomic";
import { ensureDoctor } from "@/components/lims/DoctorAutocomplete";
import { supabase } from "@/integrations/supabase/client";
import PatientRegistration, {
  type HomeVisitPrefill,
  type RegistrationSessionDraft,
} from "@/components/lims/PatientRegistration";
import InvoicePreview from "@/components/lims/InvoicePreview";
import { applyRoundUpToNextTen, withEffectiveDiscountPct } from "@/lib/roundUpDiscount";

const PAYMENT_MODES = ["Cash", "GPay", "Paytm", "Credit Card", "NEFT"];

type Step = "form" | "session" | "payment" | "invoices";

interface Props {
  visit: any;
  open: boolean;
  onClose: () => void;
}

function mapVisitToPrefill(
  visit: any,
  opts: { allowHomeVisitCharges: boolean; completingPhleboName: string; mobileOverride?: string; blankPatientIdentity?: boolean },
): HomeVisitPrefill {
  const est = visit?.estimates || {};
  const tests = (est.estimate_tests || []).map((t: any) => ({
    test_id: t.test_id,
    test_name: t.test_name,
    price: Number(t.price) || 0,
    fasting_required: !!t.fasting_required,
    discount_applicable: t.discount_applicable !== false,
    individual_discount_type: t.individual_discount_type || null,
    individual_discount_value: Number(t.individual_discount_value) || 0,
    item_type: t.item_type || "test",
  }));
  const blank = !!opts.blankPatientIdentity;
  return {
    homeVisitId: visit.id,
    mobile: opts.mobileOverride ?? est.whatsapp_number ?? "",
    title: blank ? "" : (est.title || ""),
    patientName: blank ? "" : (est.patient_name || ""),
    gender: blank ? "" : (est.gender || ""),
    dob: blank ? "" : (est.dob || ""),
    email: blank ? "" : (est.email || ""),
    doctorName: blank ? "SELF" : (est.doctor_name || "SELF"),
    address: visit.address || "",
    umr: null,
    tests: blank || !opts.allowHomeVisitCharges ? [] : tests,
    homeVisitCharges: opts.allowHomeVisitCharges ? Number(est.home_visit_charges) || 0 : 0,
    globalDiscountType: blank ? "percent" : ((est.global_discount_type as "percent" | "amount") || "percent"),
    globalDiscountValue: blank ? 0 : (Number(est.global_discount_value) || 0),
    completingPhleboName: opts.completingPhleboName,
    allowHomeVisitCharges: opts.allowHomeVisitCharges,
  };
}

/**
 * Home Visits → Completed: same New Registration form (trimmed), multi-patient session,
 * cumulative payment, then LIMS invoice numbers + WhatsApp queue via InvoicePreview.
 */
const HomeVisitRegistrationWizard = ({ visit, open, onClose }: Props) => {
  const qc = useQueryClient();
  const lockedUserName = (getCurrentUserName() || "").trim();
  const [step, setStep] = useState<Step>("form");
  const [formKey, setFormKey] = useState(0);
  const [session, setSession] = useState<RegistrationSessionDraft[]>([]);
  const [roundUpSelected, setRoundUpSelected] = useState(false);
  const [addingExtra, setAddingExtra] = useState(false);
  const [selectedModes, setSelectedModes] = useState<Set<string>>(new Set());
  const [modeAmounts, setModeAmounts] = useState<Record<string, number>>({});
  const [invoiceBatch, setInvoiceBatch] = useState<any[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [queueRequestId, setQueueRequestId] = useState(0);
  const [batchSending, setBatchSending] = useState(false);
  const [sendStatus, setSendStatus] = useState("");
  const batchWaitRef = useRef<{ resolve: (ok: boolean) => void } | null>(null);

  const primaryMobile = String(visit?.estimates?.whatsapp_number || "").replace(/\D/g, "").slice(-10);

  const prefill = useMemo(() => {
    if (!visit) return null;
    if (addingExtra) {
      return mapVisitToPrefill(visit, {
        allowHomeVisitCharges: false,
        completingPhleboName: lockedUserName,
        mobileOverride: primaryMobile || session[0]?.mobile || "",
        blankPatientIdentity: true,
      });
    }
    return mapVisitToPrefill(visit, {
      allowHomeVisitCharges: true,
      completingPhleboName: lockedUserName,
    });
  }, [visit, addingExtra, lockedUserName, primaryMobile, session]);

  const baseGrandTotal = useMemo(
    () => session.reduce((s, p) => s + Number(p.calculations.finalAmount || 0), 0),
    [session],
  );
  const baseGrandDiscount = useMemo(
    () => session.reduce((s, p) => s + Number(p.calculations.totalDiscount || 0), 0),
    [session],
  );

  /** Apply ₹10 round-up across all patients' discounted tests (HV charges included). */
  const billedSession = useMemo(() => {
    if (!roundUpSelected || !(baseGrandDiscount > 0) || session.length === 0) {
      return session.map((p) => ({
        ...p,
        calculations: {
          ...p.calculations,
          testDetails: withEffectiveDiscountPct(p.calculations.testDetails || []),
        },
      }));
    }
    type Flat = {
      price: number;
      discount: number;
      _pi: number;
      _ti: number;
      [k: string]: any;
    };
    const flat: Flat[] = [];
    session.forEach((p, pi) => {
      (p.calculations.testDetails || []).forEach((t: any, ti: number) => {
        flat.push({ ...t, price: Number(t.price) || 0, discount: Number(t.discount) || 0, _pi: pi, _ti: ti });
      });
    });
    const hvc = session.reduce((s, p) => s + Number(p.calculations.homeVisitCharges || 0), 0);
    const adj = applyRoundUpToNextTen(flat, hvc);
    if (!adj) {
      return session.map((p) => ({
        ...p,
        calculations: {
          ...p.calculations,
          testDetails: withEffectiveDiscountPct(p.calculations.testDetails || []),
        },
      }));
    }
    return session.map((p, pi) => {
      const lines = adj.testDetails.filter((t) => (t as Flat)._pi === pi);
      const totalDiscount = lines.reduce((s, t) => s + t.discount, 0);
      const totalAmount = Number(p.calculations.totalAmount) || 0;
      const homeVisitCharges = Number(p.calculations.homeVisitCharges) || 0;
      const finalAmount = Math.round(totalAmount - totalDiscount + homeVisitCharges);
      return {
        ...p,
        calculations: {
          ...p.calculations,
          totalDiscount,
          finalAmount,
          testDetails: lines.map(({ _pi, _ti, ...rest }) => rest),
        },
      };
    });
  }, [session, roundUpSelected, baseGrandDiscount]);

  const grandTotal = useMemo(
    () => billedSession.reduce((s, p) => s + Number(p.calculations.finalAmount || 0), 0),
    [billedSession],
  );
  const roundUpTarget = useMemo(() => {
    if (!(baseGrandDiscount > 0)) return null;
    const flat = session.flatMap((p) =>
      (p.calculations.testDetails || []).map((t: any) => ({
        price: Number(t.price) || 0,
        discount: Number(t.discount) || 0,
      })),
    );
    const hvc = session.reduce((s, p) => s + Number(p.calculations.homeVisitCharges || 0), 0);
    return applyRoundUpToNextTen(flat, hvc)?.finalAmount ?? null;
  }, [session, baseGrandDiscount]);

  useEffect(() => {
    setRoundUpSelected(false);
  }, [baseGrandTotal, baseGrandDiscount, session.length]);

  useEffect(() => {
    if (!roundUpSelected || roundUpTarget == null) return;
    if (selectedModes.size !== 1) return;
    const mode = Array.from(selectedModes)[0];
    setModeAmounts({ [mode]: roundUpTarget });
  }, [roundUpSelected, roundUpTarget, selectedModes.size]);

  const paidAmount = useMemo(
    () => Array.from(selectedModes).reduce((sum, m) => sum + (modeAmounts[m] || 0), 0),
    [selectedModes, modeAmounts],
  );
  const dueAmount = Math.max(0, grandTotal - paidAmount);

  const toggleMode = (mode: string) => {
    setSelectedModes((prev) => {
      const next = new Set(prev);
      if (next.has(mode)) {
        next.delete(mode);
        setModeAmounts((a) => {
          const n = { ...a };
          delete n[mode];
          return n;
        });
      } else next.add(mode);
      return next;
    });
  };

  const handleSessionContinue = (draft: RegistrationSessionDraft) => {
    const withPhlebo = {
      ...draft,
      completingPhleboName: lockedUserName || draft.completingPhleboName || null,
    };
    setSession((prev) => [...prev, withPhlebo]);
    setAddingExtra(false);
    setStep("session");
  };

  const startAddPatient = () => {
    setAddingExtra(true);
    setFormKey((k) => k + 1);
    setStep("form");
  };

  /** Equal integer split; primary gets remainder (odd figure). Cap at each bill. */
  const distributePayments = (totalPaid: number, finals: number[]) => {
    const n = finals.length;
    if (n <= 0) return [];
    const paidTotal = Math.max(0, Math.floor(totalPaid));
    if (n === 1) return [Math.min(paidTotal, finals[0] || 0)];
    const base = Math.floor(paidTotal / n);
    const shares = Array.from({ length: n }, (_, i) => (i === 0 ? paidTotal - base * (n - 1) : base));
    const paid = shares.map((share, i) => Math.min(share, Math.max(0, finals[i] || 0)));
    let leftover = paidTotal - paid.reduce((a, b) => a + b, 0);
    for (let i = 0; i < n && leftover > 0; i++) {
      const room = Math.max(0, (finals[i] || 0) - paid[i]);
      const add = Math.min(room, leftover);
      paid[i] += add;
      leftover -= add;
    }
    return paid;
  };

  const registerMutation = useMutation({
    mutationFn: async () => {
      if (billedSession.length === 0) throw new Error("Add at least one patient");
      if (paidAmount > grandTotal) throw new Error("Payment cannot exceed grand total");
      const stampedBy = getCurrentUserName();
      if (!stampedBy) throw new Error("Please sign in again before saving");
      const phlebo = lockedUserName || stampedBy;
      if (!phlebo) throw new Error("Signed-in user name required for Completed by (Phlebo)");

      const finals = billedSession.map((p) => Number(p.calculations.finalAmount || 0));
      const paidPerPatient = distributePayments(paidAmount, finals);

      const modeEntries = Array.from(selectedModes)
        .filter((m) => (modeAmounts[m] || 0) > 0)
        .map((m) => ({ mode: m, amount: modeAmounts[m] || 0 }));

      const registered: any[] = [];

      for (let i = 0; i < billedSession.length; i++) {
        const draft = billedSession[i];
        const patientPaid = paidPerPatient[i] || 0;
        const patientDue = Math.max(0, finals[i] - patientPaid);

        // Split modes proportionally per patient (same idea as old consolidated HV payment)
        let patientPayments: { mode: string; amount: number }[] = [];
        if (modeEntries.length && paidAmount > 0) {
          patientPayments = modeEntries.map(({ mode, amount }) => {
            const raw = finals.map((f) => (grandTotal > 0 ? Math.floor((amount * f) / grandTotal) : 0));
            raw[0] += amount - raw.reduce((a, b) => a + b, 0);
            return { mode, amount: Math.min(raw[i] || 0, finals[i] || 0) };
          }).filter((p) => p.amount > 0);
        }

        // Fix rounding so sum of mode amounts equals patientPaid
        const modesSum = patientPayments.reduce((s, p) => s + p.amount, 0);
        if (patientPayments.length && modesSum !== patientPaid) {
          patientPayments[0].amount += patientPaid - modesSum;
          if (patientPayments[0].amount < 0) patientPayments[0].amount = 0;
        }

        const tubeGroups = await buildSampleTubeGroups(
          draft.calculations.testDetails.map((t: any) => ({
            test_id: t.test_id,
            test_name: t.test_name,
            item_type: t.item_type || "test",
          })),
        );

        const isPrimary = i === 0;
        const regData = {
          mobile_number: draft.mobile,
          patient_name: draft.patientName,
          title: draft.title,
          gender: draft.gender,
          dob: draft.dob,
          email: draft.email,
          address: draft.address,
          doctor_name: draft.doctorName || "SELF",
          umr_number: draft.umr,
          visit_type: "home_visit",
          channel_id: draft.channelId,
          tests: draft.calculations.testDetails.map((t: any) => ({
            test_id: t.test_id,
            test_name: t.test_name,
            price: t.price,
            discount: t.discount,
            discounted_price: t.discountedPrice,
            fasting_required: t.fasting_required,
            item_type: t.item_type || "test",
          })),
          gross_amount: draft.calculations.totalAmount,
          discount_amount: draft.calculations.totalDiscount,
          net_amount: draft.calculations.totalAmount - draft.calculations.totalDiscount,
          home_visit_charges: isPrimary ? draft.calculations.homeVisitCharges : 0,
          final_amount: draft.calculations.finalAmount,
          payments: patientPayments,
          paid_amount: patientPaid,
          due_amount: patientDue,
          global_discount_type: draft.globalDiscountValue > 0 ? draft.globalDiscountType : null,
          global_discount_value: draft.globalDiscountValue,
          remarks: draft.remarks,
          is_stat: draft.isStat,
          report_language: (draft.reportLanguage || "English").toUpperCase(),
          registered_by: stampedBy,
          completing_phlebo_name: phlebo,
          home_visit_id: isPrimary ? visit.id : null,
        };

        const paymentModeStr = patientPayments.map((p) => `${p.mode}: ₹${p.amount}`).join(", ");

        const reg = await registerPatientAtomic({
          registration: regData,
          tubes: tubeGroups,
          payment: {
            payments: patientPayments,
            total_amount: patientPaid,
            gross_amount: draft.calculations.totalAmount,
            discount_amount: draft.calculations.totalDiscount,
            final_amount: draft.calculations.finalAmount,
            paid_amount: patientPaid,
            due_amount: patientDue,
          },
          homeVisitId: isPrimary ? visit.id : null,
          homeVisitPatch: isPrimary
            ? {
                status: "Registered",
                address: draft.address,
                payment_mode: paymentModeStr || null,
                paid_amount: patientPaid,
                due_amount: patientDue,
              }
            : null,
        });

        ensureDoctor(draft.doctorName);

        const assignedUmr = (reg?.umr_number as string) || draft.umr;
        if (assignedUmr) {
          const { data: existing } = await supabase
            .from("patient_master")
            .select("id")
            .eq("umr_id", assignedUmr)
            .limit(1)
            .maybeSingle();
          const row = {
            patient_name: draft.patientName,
            title: draft.title || null,
            mobile_number: draft.mobile,
            gender: draft.gender,
            date_of_birth: draft.dob,
            email: draft.email,
            address: draft.address || null,
            last_visit_date: new Date().toISOString(),
          };
          if (existing) {
            await supabase.from("patient_master").update(row as any).eq("id", existing.id);
          } else {
            await supabase.from("patient_master").insert({
              ...row,
              umr_id: assignedUmr,
              source: "lims",
              first_visit_date: new Date().toISOString(),
            } as any);
          }
        }

        registered.push({
          ...reg,
          tests: draft.calculations.testDetails,
          calculations: draft.calculations,
        });
      }

      return registered;
    },
    onSuccess: (regs) => {
      qc.invalidateQueries({ queryKey: ["home_visits"] });
      qc.invalidateQueries({ queryKey: ["patient_registrations"] });
      qc.invalidateQueries({ queryKey: ["patient_master"] });
      qc.invalidateQueries({ queryKey: ["completed_home_visits"] });
      qc.invalidateQueries({ queryKey: ["registered_home_visit_ids"] });
      toast.success(
        regs.length === 1
          ? `Registered — Invoice ${regs[0].invoice_number}`
          : `Registered ${regs.length} patients — invoices generated`,
      );
      setInvoiceBatch(regs);
      setPreviewIndex(0);
      setSendStatus("");
      setStep("invoices");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onQueueSettled = useCallback((result: { ok: boolean; error?: string }) => {
    batchWaitRef.current?.resolve(!!result.ok);
    batchWaitRef.current = null;
  }, []);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const sendAllInvoices = async () => {
    if (!invoiceBatch.length || batchSending) return;
    setBatchSending(true);
    try {
      for (let i = 0; i < invoiceBatch.length; i++) {
        const inv = invoiceBatch[i];
        const name = `${inv.title || ""} ${inv.patient_name || ""}`.trim() || inv.patient_name || "patient";
        setPreviewIndex(i);
        setSendStatus(`Sending invoice to ${name}…`);
        await sleep(400);
        const wait = new Promise<boolean>((resolve) => {
          batchWaitRef.current = { resolve };
        });
        setQueueRequestId((n) => n + 1);
        const ok = await Promise.race([wait, sleep(45000).then(() => false)]);
        if (!ok) toast.error(`Failed queuing invoice for ${name}`);
        if (i < invoiceBatch.length - 1) {
          setSendStatus(`Queued for ${name}. Next in 3 seconds…`);
          await sleep(3000);
        }
      }
      setSendStatus("All invoices queued for WhatsApp");
      toast.success("All invoices queued one by one");
    } finally {
      setBatchSending(false);
    }
  };

  if (!visit || !prefill) return null;
  const activeInvoice = invoiceBatch[previewIndex] || null;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o && !registerMutation.isPending && !batchSending) onClose();
        }}
      >
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {step === "payment"
                ? "Collect payment & register"
                : step === "session"
                  ? "Visit patients"
                  : step === "invoices"
                    ? "Invoices"
                    : addingExtra
                      ? "Add patient to visit"
                      : "Complete home visit — register"}
            </DialogTitle>
          </DialogHeader>

          {step === "form" && (
            <PatientRegistration
              key={formKey}
              homeVisitOnly
              homeVisitPrefill={{ ...prefill, completingPhleboName: lockedUserName }}
              deferPayment
              embedded
              submitLabel={addingExtra ? "Add patient" : "Continue"}
              onSessionContinue={handleSessionContinue}
              onClose={onClose}
            />
          )}

          {step === "session" && (
            <div className="space-y-4">
              <div className="space-y-2">
                {session.map((p, idx) => (
                  <div key={`${p.mobile}-${p.patientName}-${idx}`} className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
                    <div>
                      <p className="text-sm font-medium">
                        {p.title} {p.patientName}
                        {idx === 0 ? " (Primary)" : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">{p.mobile}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {p.tests.map((t) => (
                          <span key={t.test_id} className="rounded bg-accent px-1 py-0.5 text-[10px]">
                            {t.test_name}
                          </span>
                        ))}
                      </div>
                      {idx === 0 && p.calculations.homeVisitCharges > 0 && (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          incl. HV ₹{p.calculations.homeVisitCharges}
                        </p>
                      )}
                      {idx > 0 && (
                        <p className="mt-1 text-[10px] text-muted-foreground">No home visit charges</p>
                      )}
                    </div>
                    <p className="text-sm font-bold">₹{p.calculations.finalAmount}</p>
                  </div>
                ))}
              </div>

              <div className="flex justify-between rounded-lg bg-muted p-3 text-sm font-bold">
                <span>
                  Grand total ({session.length} patient{session.length > 1 ? "s" : ""})
                </span>
                <span>₹{grandTotal}</span>
              </div>

              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1 gap-1" onClick={startAddPatient}>
                  <UserPlus className="h-4 w-4" />
                  Add patient
                </Button>
                <Button type="button" className="flex-1" onClick={() => setStep("payment")}>
                  {session.length > 1 ? "Collect payment →" : "Proceed to payment →"}
                </Button>
              </div>
            </div>
          )}

          {step === "payment" && (
            <div className="space-y-4">
              <div className="space-y-2">
                {billedSession.map((p, idx) => {
                  const finals = billedSession.map((x) => Number(x.calculations.finalAmount || 0));
                  const shares = distributePayments(paidAmount, finals);
                  const share = shares[idx] || 0;
                  const dueShare = Math.max(0, Number(p.calculations.finalAmount || 0) - share);
                  return (
                  <div key={`pay-${idx}`} className="flex justify-between text-sm border-b pb-2">
                    <div>
                      <p className="font-medium">
                        {p.title} {p.patientName}
                      </p>
                      <p className="text-xs text-muted-foreground">{p.mobile}</p>
                      {paidAmount > 0 && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Paid share ₹{share} · Due ₹{dueShare}
                        </p>
                      )}
                      {(p.calculations.testDetails || []).some((t: any) => t.discount > 0) && (
                        <div className="mt-1 space-y-0.5">
                          {(p.calculations.testDetails || []).filter((t: any) => t.discount > 0).map((t: any) => (
                            <p key={t.test_id} className="text-[10px] text-primary">
                              {t.test_name}: −₹{t.discount}
                              {t.effectiveDiscountPct != null ? ` (${t.effectiveDiscountPct}%)` : ""}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                    <p className="font-semibold">₹{p.calculations.finalAmount}</p>
                  </div>
                  );
                })}
              </div>
              <div className="flex justify-between rounded-lg bg-muted p-3 font-bold">
                <span>Cumulative total</span>
                <span>₹{grandTotal}</span>
              </div>
              {roundUpTarget != null && baseGrandDiscount > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-xs text-muted-foreground">Round collect:</span>
                  <Button
                    type="button"
                    size="sm"
                    variant={roundUpSelected ? "default" : "outline"}
                    className="h-7 text-xs"
                    onClick={() => setRoundUpSelected((v) => !v)}
                  >
                    {roundUpSelected ? `Using ₹${grandTotal}` : `Collect ₹${roundUpTarget}`}
                  </Button>
                  {roundUpSelected && (
                    <span className="text-[10px] text-muted-foreground">
                      Exact was ₹{baseGrandTotal} — discount reduced across tests so payable is a ₹10 multiple
                    </span>
                  )}
                </div>
              )}
              {session.length > 1 && (
                <p className="text-xs text-muted-foreground">
                  Partial payments split equally (no decimals). Primary gets any odd remainder; unpaid stays due per patient.
                </p>
              )}

              <div>
                <Label className="text-base font-semibold">Payment</Label>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {PAYMENT_MODES.map((mode) => (
                    <label
                      key={mode}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm ${
                        selectedModes.has(mode) ? "border-primary bg-primary/5" : "border-border"
                      }`}
                    >
                      <Checkbox checked={selectedModes.has(mode)} onCheckedChange={() => toggleMode(mode)} />
                      {mode}
                    </label>
                  ))}
                </div>
                {selectedModes.size > 0 && (
                  <div className="mt-2 space-y-2">
                    {Array.from(selectedModes).map((mode) => {
                      const other = Array.from(selectedModes)
                        .filter((m) => m !== mode)
                        .reduce((s, m) => s + (modeAmounts[m] || 0), 0);
                      const maxFor = Math.max(0, grandTotal - other);
                      return (
                        <div key={mode}>
                          <Label className="text-xs">{mode} Amount</Label>
                          <Input
                            type="number"
                            min={0}
                            max={maxFor}
                            value={modeAmounts[mode] || ""}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              setModeAmounts((prev) => ({ ...prev, [mode]: Math.min(val, maxFor) }));
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                  <span>
                    Paid: <strong>₹{paidAmount}</strong>
                  </span>
                  {dueAmount > 0 && (
                    <span className="text-destructive flex items-center gap-2">
                      Due: <strong>₹{dueAmount}</strong>
                      {roundUpTarget != null && !roundUpSelected && baseGrandDiscount > 0 && (
                        <Button type="button" size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => setRoundUpSelected(true)}>
                          Collect ₹{roundUpTarget}
                        </Button>
                      )}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setStep("session")}>
                  Back
                </Button>
                <Button
                  className="flex-1"
                  disabled={registerMutation.isPending}
                  onClick={() => registerMutation.mutate()}
                >
                  <Save className="h-4 w-4 mr-2" />
                  {session.length > 1
                    ? registerMutation.isPending
                      ? "Saving…"
                      : "Save & Generate Invoices"
                    : registerMutation.isPending
                      ? "Saving…"
                      : "Save & Generate Invoice"}
                </Button>
              </div>
            </div>
          )}

          {step === "invoices" && (
            <div className="space-y-4">
              <div className="space-y-2">
                {invoiceBatch.map((inv, idx) => (
                  <div
                    key={inv.id || idx}
                    className={`flex justify-between rounded-lg border p-3 text-sm ${previewIndex === idx ? "border-primary bg-primary/5" : ""}`}
                  >
                    <div>
                      <p className="font-medium">{inv.title} {inv.patient_name}</p>
                      <p className="text-xs text-muted-foreground">{inv.mobile_number}</p>
                      <p className="text-xs font-mono mt-0.5">{inv.invoice_number}</p>
                    </div>
                    <p className="font-semibold">₹{inv.final_amount}</p>
                  </div>
                ))}
              </div>
              {sendStatus ? <p className="text-sm font-medium text-primary">{sendStatus}</p> : null}
              <div className="flex gap-2">
                <Button type="button" variant="outline" disabled={batchSending} onClick={onClose}>
                  Done
                </Button>
                <Button
                  className="flex-1"
                  disabled={batchSending || invoiceBatch.length === 0}
                  onClick={() => void sendAllInvoices()}
                >
                  {batchSending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                  {batchSending
                    ? "Sending…"
                    : invoiceBatch.length > 1
                      ? "Send all invoices (WhatsApp)"
                      : "Send invoice (WhatsApp)"}
                </Button>
              </div>
            </div>
          )}

        </DialogContent>
      </Dialog>

      {step === "invoices" && activeInvoice && (
        <InvoicePreview
          key={String(activeInvoice.invoice_number || previewIndex)}
          data={activeInvoice}
          open={!!activeInvoice}
          onClose={() => {}}
          hidePrint
          queueRequestId={queueRequestId}
          onQueueSettled={onQueueSettled}
          statusHint={sendStatus}
        />
      )}
    </>
  );
};

export default HomeVisitRegistrationWizard;
