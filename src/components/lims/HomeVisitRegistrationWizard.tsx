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
import {
  OVERPAYMENT_MESSAGE,
  collectedExceedsBill,
  isOverpaymentMessage,
} from "@/lib/billPayment";
import { useResetPaymentsWhenBillChanges } from "@/hooks/useResetPaymentsWhenBillChanges";
import OverpaymentAlertDialog from "@/components/lims/OverpaymentAlertDialog";
import {
  nextInvoiceQueueToken,
  type InvoiceQueueToken,
} from "@/lib/whatsappOutboxQueue";

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
 * sequential LIMS invoice/UMR allocation, then WhatsApp outbox in that same order.
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
  const [queueRequest, setQueueRequest] = useState<InvoiceQueueToken | null>(null);
  const [batchSending, setBatchSending] = useState(false);
  const [sendStatus, setSendStatus] = useState("");
  const [sendMarks, setSendMarks] = useState<Array<"pending" | "sending" | "queued" | "failed">>([]);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [overpaymentInfo, setOverpaymentInfo] = useState<{ collected: number; bill: number } | null>(null);
  const batchWaitRef = useRef<{ invoiceNumber: string; resolve: (ok: boolean) => void } | null>(null);
  const readyInvoiceRef = useRef<string | null>(null);
  const readyWaitersRef = useRef<Map<string, () => void>>(new Map());
  const queueNonceRef = useRef(0);
  const sendAllInvoicesRef = useRef<(regs?: any[]) => Promise<void>>(async () => {});
  const sendingLockRef = useRef(false);

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
  }, [roundUpSelected, selectedModes.size, roundUpTarget]);

  const paidAmount = useMemo(
    () => Array.from(selectedModes).reduce((sum, m) => sum + (modeAmounts[m] || 0), 0),
    [selectedModes, modeAmounts],
  );
  const dueAmount = Math.max(0, grandTotal - paidAmount);

  useResetPaymentsWhenBillChanges(
    grandTotal,
    selectedModes,
    modeAmounts,
    setSelectedModes,
    setModeAmounts,
  );

  const blockIfOverpaid = (collected: number, bill: number) => {
    if (!collectedExceedsBill(collected, bill)) return false;
    setOverpaymentInfo({ collected, bill });
    setSelectedModes(new Set());
    setModeAmounts({});
    return true;
  };

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
      if (collectedExceedsBill(paidAmount, grandTotal)) throw new Error(OVERPAYMENT_MESSAGE);
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
        // Always link extra family members to this visit. Invoice + UMR numbers
        // are allocated inside register_patient_atomic (row-locked counters) and
        // this loop awaits each patient so allocations stay in session order.
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
          global_discount_type: roundUpSelected
            ? null
            : (draft.globalDiscountValue > 0 ? draft.globalDiscountType : null),
          global_discount_value: roundUpSelected ? 0 : draft.globalDiscountValue,
          remarks: draft.remarks,
          is_stat: draft.isStat,
          report_language: (draft.reportLanguage || "English").toUpperCase(),
          registered_by: stampedBy,
          completing_phlebo_name: phlebo,
          // Link every patient on this visit; only primary patches the visit row.
          home_visit_id: visit.id,
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
                // One visit card only — stay Completed after 1 or N patient invoices
                status: "Completed",
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

        // Keep the booking estimate in sync with the primary registered patient
        // (Completed HV / Home Visits list read name + mobile from estimates).
        if (isPrimary && visit?.estimates?.id) {
          await supabase
            .from("estimates")
            .update({
              patient_name: draft.patientName,
              title: draft.title || null,
              gender: draft.gender || null,
              dob: draft.dob || null,
              email: draft.email || null,
              doctor_name: (draft.doctorName || "SELF").toUpperCase(),
              whatsapp_number: draft.mobile,
              umr_number: assignedUmr || null,
            } as any)
            .eq("id", visit.estimates.id);
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
          ? `Visit completed — Invoice ${regs[0].invoice_number}`
          : `Visit completed — ${regs.length} patients invoiced`,
      );
      setInvoiceBatch(regs);
      setPreviewIndex(0);
      setSendStatus("");
      setSendMarks(regs.map(() => "pending"));
      setPreviewOpen(true);
      setQueueRequest(null);
      setStep("invoices");
      void sendAllInvoicesRef.current(regs);
    },
    onError: (e: Error) => {
      if (isOverpaymentMessage(e.message)) {
        setOverpaymentInfo({ collected: paidAmount, bill: grandTotal });
        setSelectedModes(new Set());
        setModeAmounts({});
        return;
      }
      toast.error(e.message);
    },
  });

  const onPreviewReady = useCallback((invoiceNumber: string) => {
    const no = String(invoiceNumber || "").trim();
    if (!no) return;
    readyInvoiceRef.current = no;
    const waiter = readyWaitersRef.current.get(no);
    if (waiter) {
      readyWaitersRef.current.delete(no);
      waiter();
    }
  }, []);

  const onQueueSettled = useCallback((result: { ok: boolean; error?: string; invoiceNumber?: string }) => {
    const waiting = batchWaitRef.current;
    if (!waiting) return;
    const settledNo = String(result.invoiceNumber || "").trim();
    if (settledNo && waiting.invoiceNumber !== settledNo) return;
    waiting.resolve(!!result.ok);
    batchWaitRef.current = null;
  }, []);

  const waitForPreviewReady = (invoiceNumber: string, timeoutMs = 20000) => {
    const no = String(invoiceNumber || "").trim();
    return new Promise<boolean>((resolve) => {
      if (readyInvoiceRef.current === no) {
        resolve(true);
        return;
      }
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        if (readyWaitersRef.current.get(no) === fire) readyWaitersRef.current.delete(no);
        resolve(ok);
      };
      const fire = () => {
        window.clearTimeout(timer);
        finish(true);
      };
      const timer = window.setTimeout(() => finish(false), timeoutMs);
      readyWaitersRef.current.set(no, fire);
      if (readyInvoiceRef.current === no) fire();
    });
  };

  const sendAllInvoices = async (regs?: any[]) => {
    const batch = Array.isArray(regs) && regs.length ? regs : invoiceBatch;
    if (!batch.length || sendingLockRef.current) return;
    sendingLockRef.current = true;
    const resendAll = sendMarks.length === batch.length && sendMarks.every((m) => m === "queued");
    setBatchSending(true);
    setPreviewOpen(true);
    setSendMarks((prev) => {
      if (resendAll) return batch.map(() => "pending");
      if (prev.length === batch.length) return prev.map((m) => (m === "queued" ? "queued" : "pending"));
      return batch.map(() => "pending");
    });
    try {
      let queued = 0;
      let failed = 0;
      let shownInvoice = previewOpen
        ? String(invoiceBatch[previewIndex]?.invoice_number || "").trim()
        : "";
      for (let i = 0; i < batch.length; i++) {
        const inv = batch[i];
        const invoiceNo = String(inv?.invoice_number || "").trim();
        const name = `${inv.title || ""} ${inv.patient_name || ""}`.trim() || inv.patient_name || "patient";
        if (!invoiceNo) {
          failed += 1;
          setSendMarks((prev) => {
            const next = [...prev];
            next[i] = "failed";
            return next;
          });
          toast.error(`Missing invoice number for ${name}`);
          continue;
        }
        if (!resendAll && sendMarks[i] === "queued") {
          queued += 1;
          continue;
        }

        setSendMarks((prev) => {
          const next = prev.length === batch.length ? [...prev] : batch.map(() => "pending" as const);
          next[i] = "sending";
          return next;
        });
        if (shownInvoice !== invoiceNo) readyInvoiceRef.current = null;
        setPreviewIndex(i);
        setQueueRequest(null);
        setPreviewOpen(true);
        setSendStatus(`Queuing invoice ${i + 1} of ${batch.length} — ${name}`);
        await new Promise((r) => window.setTimeout(r, 0));

        const ready = await waitForPreviewReady(invoiceNo);
        shownInvoice = invoiceNo;
        if (ready) await new Promise((r) => window.setTimeout(r, 60));
        if (!ready) {
          failed += 1;
          setSendMarks((prev) => {
            const next = [...prev];
            next[i] = "failed";
            return next;
          });
          toast.error(`Invoice preview not ready for ${name}`);
          continue;
        }

        const token = nextInvoiceQueueToken(invoiceNo, queueNonceRef.current);
        queueNonceRef.current = token.nonce;
        const wait = new Promise<boolean>((resolve) => {
          batchWaitRef.current = { invoiceNumber: invoiceNo, resolve };
        });
        setQueueRequest(token);
        const ok = await Promise.race([
          wait,
          new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 45000)),
        ]);
        if (batchWaitRef.current?.invoiceNumber === invoiceNo) batchWaitRef.current = null;
        setSendMarks((prev) => {
          const next = [...prev];
          next[i] = ok ? "queued" : "failed";
          return next;
        });
        if (!ok) {
          failed += 1;
          toast.error(`Failed queuing invoice for ${name}`);
        } else {
          queued += 1;
        }
      }
      if (failed === 0) {
        setSendStatus(
          batch.length === 1
            ? "Invoice queued for WhatsApp"
            : `All ${batch.length} invoices queued for WhatsApp in order`,
        );
        toast.success(
          batch.length === 1
            ? "Invoice queued for WhatsApp"
            : `${batch.length} invoices queued in order for WhatsApp`,
        );
      } else {
        setSendStatus(`Queued ${queued} of ${batch.length} — ${failed} failed`);
        toast.error(`${failed} invoice${failed === 1 ? "" : "s"} failed to queue`);
      }
    } finally {
      sendingLockRef.current = false;
      setBatchSending(false);
      setQueueRequest(null);
    }
  };
  sendAllInvoicesRef.current = sendAllInvoices;

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
            <>
              {!addingExtra && visit?.estimates?.patient_name && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                  Booking name on this visit: <strong>{String(visit.estimates.patient_name).toUpperCase()}</strong>
                  {visit.estimates.whatsapp_number
                    ? ` · ${String(visit.estimates.whatsapp_number).replace(/\D/g, "").slice(-10)}`
                    : ""}
                  . If you register a different family member, change mobile and name before Continue.
                </p>
              )}
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
            </>
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
                      <p className="text-xs text-muted-foreground">
                        {p.mobile}
                        {p.umr ? ` · ${p.umr}` : " · New patient (UMR on save)"}
                      </p>
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
                  onClick={() => {
                    if (blockIfOverpaid(paidAmount, grandTotal)) return;
                    registerMutation.mutate();
                  }}
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
                {invoiceBatch.map((inv, idx) => {
                  const mark = sendMarks[idx] || "pending";
                  const markLabel =
                    mark === "queued" ? "Queued"
                    : mark === "sending" ? "Queuing…"
                    : mark === "failed" ? "Failed"
                    : "Waiting";
                  return (
                  <div
                    key={inv.id || idx}
                    className={`flex justify-between rounded-lg border p-3 text-sm ${previewIndex === idx ? "border-primary bg-primary/5" : ""}`}
                  >
                    <div>
                      <p className="font-medium">{inv.title} {inv.patient_name}</p>
                      <p className="text-xs text-muted-foreground">{inv.mobile_number}</p>
                      <p className="text-xs font-mono mt-0.5">{inv.invoice_number}</p>
                      <p className={`mt-0.5 text-[10px] font-medium ${
                        mark === "failed" ? "text-destructive"
                        : mark === "queued" ? "text-primary"
                        : "text-muted-foreground"
                      }`}>
                        {markLabel}
                      </p>
                    </div>
                    <p className="font-semibold">₹{inv.final_amount}</p>
                  </div>
                  );
                })}
              </div>
              {sendStatus ? <p className="text-sm font-medium text-primary">{sendStatus}</p> : (
                <p className="text-xs text-muted-foreground">
                  Invoices send automatically in registration order. WhatsApp keeps one message per number in flight so family invoices stay in sequence.
                </p>
              )}
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
                    ? `Queuing ${Math.min(previewIndex + 1, invoiceBatch.length)} of ${invoiceBatch.length}…`
                    : sendMarks.some((m) => m === "failed")
                      ? "Retry failed invoices"
                      : sendMarks.every((m) => m === "queued") && sendMarks.length === invoiceBatch.length
                        ? "Resend all invoices"
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
          data={activeInvoice}
          open={previewOpen && !!activeInvoice}
          onClose={() => {
            if (!batchSending) setPreviewOpen(false);
          }}
          hidePrint
          queueRequest={queueRequest}
          onReady={onPreviewReady}
          onQueueSettled={onQueueSettled}
          statusHint={sendStatus}
        />
      )}

      <OverpaymentAlertDialog
        open={!!overpaymentInfo}
        onOpenChange={(o) => { if (!o) setOverpaymentInfo(null); }}
        collected={overpaymentInfo?.collected}
        billAmount={overpaymentInfo?.bill}
      />
    </>
  );
};

export default HomeVisitRegistrationWizard;
