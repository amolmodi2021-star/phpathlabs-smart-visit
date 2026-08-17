import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { UserPlus, Save } from "lucide-react";
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

const PAYMENT_MODES = ["Cash", "GPay", "Paytm", "Credit Card", "NEFT"];

type Step = "form" | "session" | "payment";

interface Props {
  visit: any;
  open: boolean;
  onClose: () => void;
}

function mapVisitToPrefill(
  visit: any,
  opts: { allowHomeVisitCharges: boolean; completingPhleboName: string; mobileOverride?: string },
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
  return {
    homeVisitId: visit.id,
    mobile: opts.mobileOverride ?? est.whatsapp_number ?? "",
    title: est.title || "",
    patientName: est.patient_name || "",
    gender: est.gender || "",
    dob: est.dob || "",
    email: est.email || "",
    doctorName: est.doctor_name || "SELF",
    address: visit.address || "",
    umr: null,
    tests: opts.allowHomeVisitCharges ? tests : [],
    homeVisitCharges: opts.allowHomeVisitCharges ? Number(est.home_visit_charges) || 0 : 0,
    globalDiscountType: (est.global_discount_type as "percent" | "amount") || "percent",
    globalDiscountValue: Number(est.global_discount_value) || 0,
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
  const defaultPhlebo = visit?.phlebotomists?.name || "";
  const [step, setStep] = useState<Step>("form");
  const [formKey, setFormKey] = useState(0);
  const [session, setSession] = useState<RegistrationSessionDraft[]>([]);
  const [addingExtra, setAddingExtra] = useState(false);
  const [phleboName, setPhleboName] = useState(defaultPhlebo);
  const [selectedModes, setSelectedModes] = useState<Set<string>>(new Set());
  const [modeAmounts, setModeAmounts] = useState<Record<string, number>>({});
  const [invoiceQueue, setInvoiceQueue] = useState<any[]>([]);
  const [activeInvoice, setActiveInvoice] = useState<any>(null);

  const primaryMobile = String(visit?.estimates?.whatsapp_number || "").replace(/\D/g, "").slice(-10);

  const prefill = useMemo(() => {
    if (!visit) return null;
    if (addingExtra) {
      return mapVisitToPrefill(visit, {
        allowHomeVisitCharges: false,
        completingPhleboName: phleboName || defaultPhlebo,
        mobileOverride: primaryMobile || session[0]?.mobile || "",
      });
    }
    return mapVisitToPrefill(visit, {
      allowHomeVisitCharges: true,
      completingPhleboName: phleboName || defaultPhlebo,
    });
  }, [visit, addingExtra, phleboName, defaultPhlebo, primaryMobile, session]);

  const grandTotal = useMemo(
    () => session.reduce((s, p) => s + Number(p.calculations.finalAmount || 0), 0),
    [session],
  );

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
      completingPhleboName: draft.completingPhleboName || phleboName || defaultPhlebo || null,
    };
    if (withPhlebo.completingPhleboName) setPhleboName(withPhlebo.completingPhleboName);
    setSession((prev) => [...prev, withPhlebo]);
    setAddingExtra(false);
    setStep("session");
  };

  const startAddPatient = () => {
    setAddingExtra(true);
    setFormKey((k) => k + 1);
    setStep("form");
  };

  const distributePayments = (totalPaid: number, finals: number[]) => {
    const n = finals.length;
    const sum = finals.reduce((a, b) => a + b, 0);
    if (n === 1) return [Math.min(totalPaid, finals[0] || 0)];
    const raw = finals.map((f) => (sum > 0 ? Math.floor((totalPaid * f) / sum) : 0));
    raw[0] += totalPaid - raw.reduce((a, b) => a + b, 0);
    return raw.map((p, i) => Math.min(p, finals[i] || 0));
  };

  const registerMutation = useMutation({
    mutationFn: async () => {
      if (session.length === 0) throw new Error("Add at least one patient");
      if (paidAmount > grandTotal) throw new Error("Payment cannot exceed grand total");
      const stampedBy = getCurrentUserName();
      if (!stampedBy) throw new Error("Please sign in again before saving");
      const phlebo = (session[0]?.completingPhleboName || phleboName || defaultPhlebo || "").trim();
      if (!phlebo) throw new Error("Enter the phlebotomist who completed this visit");

      const finals = session.map((p) => Number(p.calculations.finalAmount || 0));
      const paidPerPatient = distributePayments(paidAmount, finals);

      const modeEntries = Array.from(selectedModes)
        .filter((m) => (modeAmounts[m] || 0) > 0)
        .map((m) => ({ mode: m, amount: modeAmounts[m] || 0 }));

      const registered: any[] = [];

      for (let i = 0; i < session.length; i++) {
        const draft = session[i];
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
      setInvoiceQueue(regs.slice(1));
      setActiveInvoice(regs[0] || null);
      if (!regs[0]) onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleCloseInvoice = () => {
    if (invoiceQueue.length > 0) {
      const [next, ...rest] = invoiceQueue;
      setInvoiceQueue(rest);
      setActiveInvoice(next);
      return;
    }
    setActiveInvoice(null);
    onClose();
  };

  if (!visit || !prefill) return null;

  return (
    <>
      <Dialog
        open={open && !activeInvoice}
        onOpenChange={(o) => {
          if (!o && !registerMutation.isPending) onClose();
        }}
      >
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {step === "payment"
                ? "Collect payment & register"
                : step === "session"
                  ? "Visit patients"
                  : addingExtra
                    ? "Add patient to visit"
                    : "Complete home visit — register"}
            </DialogTitle>
          </DialogHeader>

          {step === "form" && (
            <PatientRegistration
              key={formKey}
              homeVisitOnly
              homeVisitPrefill={{ ...prefill, completingPhleboName: phleboName || prefill.completingPhleboName }}
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
                {session.map((p, idx) => (
                  <div key={`pay-${idx}`} className="flex justify-between text-sm border-b pb-2">
                    <div>
                      <p className="font-medium">
                        {p.title} {p.patientName}
                      </p>
                      <p className="text-xs text-muted-foreground">{p.mobile}</p>
                    </div>
                    <p className="font-semibold">₹{p.calculations.finalAmount}</p>
                  </div>
                ))}
              </div>
              <div className="flex justify-between rounded-lg bg-muted p-3 font-bold">
                <span>Cumulative total</span>
                <span>₹{grandTotal}</span>
              </div>

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
                <div className="mt-2 flex gap-4 text-sm">
                  <span>
                    Paid: <strong>₹{paidAmount}</strong>
                  </span>
                  {dueAmount > 0 && (
                    <span className="text-destructive">
                      Due: <strong>₹{dueAmount}</strong>
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
        </DialogContent>
      </Dialog>

      {activeInvoice && (
        <InvoicePreview data={activeInvoice} open={!!activeInvoice} onClose={handleCloseInvoice} />
      )}
    </>
  );
};

export default HomeVisitRegistrationWizard;
