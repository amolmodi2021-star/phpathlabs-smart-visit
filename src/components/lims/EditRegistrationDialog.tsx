import { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Save, Ban, RotateCcw, Lock } from "lucide-react";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";
import { recalculateRegistrationStatus } from "@/lib/limsStatus";
import { logPaymentTransaction, syncRegistrationPaymentRow, splitPaymentModes } from "@/lib/paymentTransactions";

const TITLES = ["Mr.", "Mrs.", "Ms.", "Master", "Miss", "Baby Of", "Dr."];

interface EditRegistrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  registration: any;
}

const EditRegistrationDialog = ({ open, onOpenChange, registration: reg }: EditRegistrationDialogProps) => {
  const qc = useQueryClient();

  // Editable fields
  const [patientName, setPatientName] = useState("");
  const [title, setTitle] = useState("");
  const [gender, setGender] = useState("");
  const [dob, setDob] = useState("");
  const [email, setEmail] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [umrNumber, setUmrNumber] = useState("");
  const [address, setAddress] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [status, setStatus] = useState("");
  const [remarks, setRemarks] = useState("");
  const [isStat, setIsStat] = useState(false);

  // Payment editing
  const [selectedModes, setSelectedModes] = useState<Set<string>>(new Set());
  const [modeAmounts, setModeAmounts] = useState<Record<string, number>>({});

  // Cancel / Refund
  const [cancelledTestIds, setCancelledTestIds] = useState<Set<string>>(new Set());
  const [refundMode, setRefundMode] = useState<string>("Cash");
  const [showCancelBillPwd, setShowCancelBillPwd] = useState(false);
  const [showRefundPwd, setShowRefundPwd] = useState(false);
  const [showRefundUnlockPwd, setShowRefundUnlockPwd] = useState(false);
  const [refundUnlocked, setRefundUnlocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [homeVisitRefundRequested, setHomeVisitRefundRequested] = useState(false);

  // Overpayment refund (from discount change)
  const [overpaymentRefundMode, setOverpaymentRefundMode] = useState<string>("Cash");
  const [showOverpaymentRefundPwd, setShowOverpaymentRefundPwd] = useState(false);

  // Discount editing
  const [editTests, setEditTests] = useState<any[]>([]);
  const [globalDiscountType, setGlobalDiscountType] = useState<"percent" | "amount">("percent");
  const [globalDiscountValue, setGlobalDiscountValue] = useState(0);
  const [showDiscountUnlockPwd, setShowDiscountUnlockPwd] = useState(false);
  const [discountUnlocked, setDiscountUnlocked] = useState(false);

  // Populate on open
  useEffect(() => {
    if (reg && open) {
      setRefundUnlocked(false);
      setDiscountUnlocked(false);
      setHomeVisitRefundRequested(false);
      setPatientName(reg.patient_name || "");
      setTitle(reg.title || "");
      setGender(reg.gender || "");
      setDob(reg.dob || "");
      setEmail(reg.email || "");
      setDoctorName(reg.doctor_name || "");
      setUmrNumber(reg.umr_number || "");
      setAddress(reg.address || "");
      setMobileNumber(reg.mobile_number || "");
      setStatus(reg.status || "registered");
      setRemarks(reg.remarks || "");
      setIsStat(reg.is_stat || false);
      // Populate payments
      const existingPayments: any[] = Array.isArray(reg.payments) ? reg.payments : [];
      const modes = new Set<string>(existingPayments.map((p: any) => p.mode));
      setSelectedModes(modes);
      const amounts: Record<string, number> = {};
      existingPayments.forEach((p: any) => { amounts[p.mode] = Number(p.amount) || 0; });
      setModeAmounts(amounts);
      const existing = Array.isArray(reg.cancelled_tests) ? reg.cancelled_tests : [];
      setCancelledTestIds(new Set(existing.map((t: any) => t.test_id || t)));
      setRefundMode("Cash");
      // Populate tests for discount editing
      const regTests: any[] = Array.isArray(reg.tests) ? reg.tests : [];
      setEditTests(regTests.map((t: any) => ({
        ...t,
        individual_discount_type: t.individual_discount_type || null,
        individual_discount_value: Number(t.individual_discount_value || 0),
        discount_applicable: t.discount_applicable !== false,
      })));
      setGlobalDiscountType((reg.global_discount_type as any) || "percent");
      setGlobalDiscountValue(Number(reg.global_discount_value || 0));
    }
  }, [reg, open]);

  // Title → Gender auto
  useEffect(() => {
    if (["Mr.", "Master"].includes(title)) setGender("Male");
    else if (["Mrs.", "Ms.", "Miss"].includes(title)) setGender("Female");
  }, [title]);

  const tests: any[] = reg ? (Array.isArray(reg.tests) ? reg.tests : []) : [];
  const alreadyCancelled = reg ? new Set((Array.isArray(reg.cancelled_tests) ? reg.cancelled_tests : []).map((t: any) => t.test_id || t)) : new Set<string>();
  const isBillCancelled = reg?.bill_cancelled;
  const isPastAccepted = ["sample_accepted", "processing", "partial_processing", "processed", "partial_verified", "verified", "partially_approved", "approved", "partially_dispatched", "dispatched"].includes(reg?.status || "");
  const isRefundBlocked = isPastAccepted && !refundUnlocked;
  const isDiscountLocked = isPastAccepted && !discountUnlocked;

  const newlyCancelled = [...cancelledTestIds].filter(id => !alreadyCancelled.has(id));
  const refundCalc = useMemo(() => {
    let refundAmount = 0;
    newlyCancelled.forEach(testId => {
      const test = tests.find((t: any) => t.test_id === testId);
      if (test) {
        refundAmount += Number(test.discounted_price || test.price || 0);
      }
    });
    if (homeVisitRefundRequested) {
      refundAmount += Number(reg?.home_visit_charges || 0);
    }
    return refundAmount;
  }, [newlyCancelled, tests, homeVisitRefundRequested, reg]);

  const PAYMENT_MODES = ["Cash", "GPay", "Paytm", "Credit Card", "NEFT"];
  const lockedPaidAmount = Number(reg?.paid_amount || 0);

  const togglePaymentMode = (mode: string) => {
    setSelectedModes(prev => {
      const next = new Set(prev);
      if (next.has(mode)) { next.delete(mode); setModeAmounts(a => { const n = { ...a }; delete n[mode]; return n; }); }
      else next.add(mode);
      return next;
    });
  };

  // Auto-fill when single mode selected
  useEffect(() => {
    if (selectedModes.size === 1) {
      const mode = Array.from(selectedModes)[0];
      setModeAmounts({ [mode]: lockedPaidAmount });
    }
  }, [selectedModes.size, lockedPaidAmount]);

  // Discount calculations
  const discountCalc = useMemo(() => {
    let totalAmount = 0;
    let totalDiscount = 0;
    const updatedTests = editTests.map(t => {
      if (alreadyCancelled.has(t.test_id)) {
        return { ...t, discounted_price: 0 };
      }
      const price = Number(t.price || 0);
      totalAmount += price;
      let discount = 0;
      const hasIndividual = t.individual_discount_type && t.individual_discount_value > 0 && t.discount_applicable;
      if (hasIndividual) {
        discount = t.individual_discount_type === "percent"
          ? (price * t.individual_discount_value) / 100 : t.individual_discount_value;
      } else if (t.discount_applicable && globalDiscountValue > 0) {
        discount = globalDiscountType === "percent"
          ? (price * globalDiscountValue) / 100 : globalDiscountValue;
      }
      discount = Math.min(discount, price);
      totalDiscount += discount;
      return { ...t, discounted_price: price - discount };
    });
    const hvc = Number(reg?.home_visit_charges || 0);
    const finalAmount = totalAmount - totalDiscount + hvc;
    return { totalAmount, totalDiscount, finalAmount, hvc, updatedTests };
  }, [editTests, globalDiscountType, globalDiscountValue, alreadyCancelled, reg]);

  const discountChanged = useMemo(() => {
    return Math.abs(discountCalc.finalAmount - Number(reg?.final_amount || 0)) > 0.01 ||
      Math.abs(discountCalc.totalDiscount - Number(reg?.discount_amount || 0)) > 0.01;
  }, [discountCalc, reg]);

  const updateTestDiscount = (testId: string, field: string, value: any) => {
    setEditTests(prev => prev.map(t =>
      t.test_id === testId ? { ...t, [field]: value } : t
    ));
  };

  const editPaidAmount = Array.from(selectedModes).reduce((sum, mode) => sum + (modeAmounts[mode] || 0), 0);
  const paymentModesMismatch = lockedPaidAmount > 0 && selectedModes.size > 1 && Math.abs(editPaidAmount - lockedPaidAmount) > 0.01;

  // Overpayment detection when discount reduces final below paid
  const discountOverpayment = discountChanged && discountCalc.finalAmount < lockedPaidAmount
    ? lockedPaidAmount - discountCalc.finalAmount : 0;

  // Disable save if overpayment exists but no refund mode acknowledged via password
  const overpaymentBlocksSave = discountOverpayment > 0;

  if (!reg) return null;

  const handleSaveDetails = async () => {
    setSaving(true);
    try {
      const editedSplit = Array.from(selectedModes)
        .filter(m => (modeAmounts[m] || 0) > 0)
        .map(m => ({ mode: m, amount: modeAmounts[m] || 0 }));

      // Preserve due-collection entries (have a `date` field) — only the original
      // at-registration split (entries without `date`) is replaced by the dialog edits.
      const existingPayments: any[] = Array.isArray(reg.payments) ? reg.payments : [];
      const dueCollectionEntries = existingPayments.filter((p: any) => p && p.date);
      const originalRegEntries = existingPayments.filter((p: any) => p && !p.date);
      const payments = [...editedSplit, ...dueCollectionEntries];

      const updateData: any = {
        patient_name: patientName.replace(/\s+/g, ' ').trim().toUpperCase(),
        title,
        gender,
        dob: dob || null,
        email: email || null,
        doctor_name: (doctorName || "SELF").toUpperCase(),
        address: address.toUpperCase(),
        mobile_number: mobileNumber.replace(/\D/g, "").slice(-10),
        remarks: remarks.trim() || null,
        is_stat: isStat,
        payments,
      };

      // Include discount data if changed
      if (discountChanged) {
        updateData.tests = discountCalc.updatedTests;
        updateData.gross_amount = discountCalc.totalAmount;
        updateData.discount_amount = discountCalc.totalDiscount;
        updateData.final_amount = discountCalc.finalAmount;
        updateData.net_amount = discountCalc.totalAmount - discountCalc.totalDiscount;
        updateData.global_discount_type = globalDiscountValue > 0 ? globalDiscountType : null;
        updateData.global_discount_value = globalDiscountValue;
        // Recalculate due_amount to keep Due Payments section accurate
        updateData.due_amount = Math.max(0, discountCalc.finalAmount - lockedPaidAmount);
      }

      const { error } = await supabase.from("patient_registrations").update(updateData).eq("id", reg.id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["patient_registrations"] });

      // Sync the original registration_payment row's bill snapshot. Payment-mode
      // columns stay frozen UNLESS the user truly edited the original at-registration
      // split (mode typo correction) — never when adding what is really a due collection.
      {
        const newFinal = discountChanged ? discountCalc.finalAmount : Number(reg.final_amount || 0);
        const origModes = splitPaymentModes(originalRegEntries);
        const newModes = splitPaymentModes(editedSplit);
        const splitChanged =
          origModes.cash !== newModes.cash ||
          origModes.gpay !== newModes.gpay ||
          origModes.paytm !== newModes.paytm ||
          origModes.credit_card !== newModes.credit_card ||
          origModes.neft !== newModes.neft;
        const reasons: string[] = [];
        if (splitChanged) reasons.push("Payment mode edited");
        if (discountChanged) reasons.push("Discount edited");
        if (reasons.length > 0) {
          const origPaid = originalRegEntries.reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
          const syncedPaid = splitChanged
            ? editedSplit.reduce((s, p) => s + (p.amount || 0), 0)
            : origPaid;
          await syncRegistrationPaymentRow({
            registration_id: reg.id,
            invoice_number: reg.invoice_number,
            patient_name: patientName,
            payments: splitChanged ? editedSplit : originalRegEntries,
            paid_amount: syncedPaid,
            final_amount: newFinal,
            due_amount: Math.max(0, newFinal - lockedPaidAmount),
            gross_amount: discountChanged ? discountCalc.totalAmount : Number(reg.gross_amount || 0),
            discount_amount: discountChanged ? discountCalc.totalDiscount : Number(reg.discount_amount || 0),
            change_reason: reasons.join(" + "),
            sync_payment_split: splitChanged,
          });
        }
      }

      toast.success("Registration updated");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const processOverpaymentRefund = async () => {
    setSaving(true);
    try {
      const existingRefund = Number(reg.refund_amount || 0);
      const updateData: any = {
        tests: discountCalc.updatedTests,
        gross_amount: discountCalc.totalAmount,
        discount_amount: discountCalc.totalDiscount,
        final_amount: discountCalc.finalAmount,
        net_amount: discountCalc.totalAmount - discountCalc.totalDiscount,
        global_discount_type: globalDiscountValue > 0 ? globalDiscountType : null,
        global_discount_value: globalDiscountValue,
        due_amount: 0,
        paid_amount: discountCalc.finalAmount,
        refund_amount: existingRefund + discountOverpayment,
        refund_mode: overpaymentRefundMode,
        refund_date: new Date().toISOString(),
        payments: Array.from(selectedModes)
          .filter(m => (modeAmounts[m] || 0) > 0)
          .map(m => ({ mode: m, amount: modeAmounts[m] || 0 })),
      };
      const { error } = await supabase.from("patient_registrations").update(updateData).eq("id", reg.id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["patient_registrations"] });

      // Always sync registration_payment row after refund + discount applied
      {
        const newPayments = updateData.payments as Array<{ mode: string; amount: number }>;
        await syncRegistrationPaymentRow({
          registration_id: reg.id,
          invoice_number: reg.invoice_number,
          patient_name: patientName,
          payments: newPayments,
          paid_amount: discountCalc.finalAmount,
          final_amount: discountCalc.finalAmount,
          due_amount: 0,
          gross_amount: discountCalc.totalAmount,
          discount_amount: discountCalc.totalDiscount,
          change_reason: "Discount applied + overpayment refunded",
        });
      }

      // Log overpayment refund — money-out delta only.
      // Registration snapshot fields (gross/discount/final/paid/due) are zero so
      // they don't inflate Daily Report totals; sync row above already reflects new state.
      logPaymentTransaction({
        registration_id: reg.id,
        invoice_number: reg.invoice_number,
        patient_name: patientName,
        transaction_type: "refund",
        direction: "out",
        payments: [{ mode: overpaymentRefundMode, amount: discountOverpayment }],
        total_amount: discountOverpayment,
        gross_amount: 0,
        discount_amount: 0,
        final_amount: 0,
        paid_amount: 0,
        due_amount: 0,
        refund_amount: discountOverpayment,
        remarks: `Overpayment refund via ${overpaymentRefundMode}`,
      });
      toast.success(`Discount applied & ₹${discountOverpayment} refunded via ${overpaymentRefundMode}`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelTests = async () => {
    if (newlyCancelled.length === 0 && !homeVisitRefundRequested) {
      toast.error("No tests selected for cancellation and no home visit refund requested");
      return;
    }
    setShowRefundPwd(true);
  };

  const processCancelTests = async () => {
    setSaving(true);
    try {
      const allCancelled = [...cancelledTestIds].map(id => {
        const test = tests.find((t: any) => t.test_id === id);
        return { test_id: id, test_name: test?.test_name || "", refund_amount: Number(test?.discounted_price || test?.price || 0) };
      });

      const testRefundAmount = newlyCancelled.reduce((sum, id) => {
        const test = tests.find((t: any) => t.test_id === id);
        return sum + Number(test?.discounted_price || test?.price || 0);
      }, 0);
      const hvcRefund = homeVisitRefundRequested ? Number(reg.home_visit_charges || 0) : 0;
      const totalNewRefund = testRefundAmount + hvcRefund;

      const totalRefund = Number(reg.refund_amount || 0) + totalNewRefund;
      const newFinalAmount = Math.max(0, Number(reg.final_amount) - totalNewRefund);
      const newPaid = Math.max(0, Number(reg.paid_amount) - totalNewRefund);

      const updatePayload: any = {
        cancelled_tests: allCancelled,
        refund_amount: totalRefund,
        refund_mode: refundMode,
        refund_date: new Date().toISOString(),
        final_amount: newFinalAmount,
        paid_amount: newPaid,
        due_amount: Math.max(0, newFinalAmount - newPaid),
      };
      if (homeVisitRefundRequested) {
        updatePayload.home_visit_charges = 0;
      }

      const { error } = await supabase.from("patient_registrations").update(updatePayload).eq("id", reg.id);
      if (error) throw error;

      // Cascading cleanup for each newly cancelled test
      for (const testId of newlyCancelled) {
        // 1. Delete patient_results
        await supabase.from("patient_results").delete().eq("registration_id", reg.id).eq("test_id", testId);

        // 2. Delete outsourced_test_snips
        await supabase.from("outsourced_test_snips").delete().eq("registration_id", reg.id).eq("test_id", testId);

        // 2b. Update or delete sample_tubes containing this cancelled test
        const { data: regTubes } = await supabase
          .from("sample_tubes" as any)
          .select("id, test_ids, test_names")
          .eq("registration_id", reg.id);
        if (regTubes) {
          // Build a name lookup from registration tests
          const testNameById: Record<string, string> = {};
          (Array.isArray(reg.tests) ? reg.tests : []).forEach((t: any) => {
            if (t.test_id) testNameById[t.test_id] = t.test_name || "";
          });

          const affectedTubes = (regTubes as any[]).filter((t: any) =>
            (t.test_ids || []).includes(testId)
          );
          for (const tube of affectedTubes) {
            const remainingIds = (tube.test_ids || []).filter((id: string) => id !== testId);
            if (remainingIds.length === 0) {
              await supabase.from("sample_tubes" as any).delete().eq("id", tube.id);
            } else {
              const remainingNames = remainingIds.map((id: string) => testNameById[id] || "");
              await supabase.from("sample_tubes" as any)
                .update({ test_ids: remainingIds, test_names: remainingNames } as any)
                .eq("id", tube.id);
            }
          }
        }

        // 3. Clean up lims_test_orders - gather param codes and test code
        const cancelledCodes: string[] = [];

        // Get test code from tests table
        const { data: testRow } = await supabase.from("tests").select("test_code").eq("id", testId).maybeSingle();
        if (testRow?.test_code) cancelledCodes.push(testRow.test_code);

        // Get param codes via test_parameters → report_test_parameters
        const { data: tpRows } = await supabase.from("test_parameters" as any).select("parameter_id").eq("test_id", testId);
        if (tpRows && tpRows.length > 0) {
          const paramIds = (tpRows as any[]).map((r: any) => r.parameter_id);
          const { data: paramRows } = await supabase.from("report_test_parameters").select("param_code").in("id", paramIds);
          if (paramRows) {
            paramRows.forEach((p: any) => { if (p.param_code) cancelledCodes.push(p.param_code); });
          }
        }

        if (cancelledCodes.length > 0) {
          // Find interface orders matching this invoice
          const { data: orders } = await supabase.from("lims_test_orders")
            .select("id, tests")
            .like("sample_id", `${reg.invoice_number}%`)
            .in("status", ["pending", "in_progress"]);

          if (orders) {
            for (const order of orders) {
              const orderTests = Array.isArray(order.tests) ? order.tests : [];
              const filtered = (orderTests as any[]).filter((t: any) => !cancelledCodes.includes(t.code));
              if (filtered.length === 0) {
                await supabase.from("lims_test_orders").delete().eq("id", order.id);
              } else {
                await supabase.from("lims_test_orders").update({ tests: filtered } as any).eq("id", order.id);
              }
            }
          }
        }
      }

      // 4. Recalculate registration status
      await recalculateRegistrationStatus(reg.id);

      // Sync registration_payment row so Daily Report reflects reduced totals after test cancellation
      {
        const currentPayments = Array.isArray(reg.payments) ? reg.payments : [];
        // Proportionally scale existing payment modes to match new paid amount
        const origPaid = Number(reg.paid_amount || 0);
        const scaledPayments: Array<{ mode: string; amount: number }> =
          origPaid > 0 && newPaid !== origPaid
            ? currentPayments.map((p: any) => ({
                mode: p.mode,
                amount: Number(((Number(p.amount || 0) * newPaid) / origPaid).toFixed(2)),
              }))
            : currentPayments;
        await syncRegistrationPaymentRow({
          registration_id: reg.id,
          invoice_number: reg.invoice_number,
          patient_name: patientName,
          payments: scaledPayments,
          paid_amount: newPaid,
          final_amount: newFinalAmount,
          due_amount: Math.max(0, newFinalAmount - newPaid),
          gross_amount: Number(reg.gross_amount || 0),
          discount_amount: Number(reg.discount_amount || 0),
          change_reason: `${newlyCancelled.length} test(s) cancelled${homeVisitRefundRequested ? " + HV refunded" : ""}`,
        });
      }

      qc.invalidateQueries({ queryKey: ["patient_registrations"] });
      qc.invalidateQueries({ queryKey: ["sample_tubes_collection"] });
      qc.invalidateQueries({ queryKey: ["sample_collection_regs"] });
      qc.invalidateQueries({ queryKey: ["sample_tubes_acceptance_pending"] });
      qc.invalidateQueries({ queryKey: ["sample_tubes_acceptance_accepted"] });
      const parts: string[] = [];
      if (newlyCancelled.length > 0) parts.push(`${newlyCancelled.length} test(s) cancelled`);
      if (homeVisitRefundRequested) parts.push("Home visit charges refunded");
      toast.success(`${parts.join(". ")}. Refund: ₹${refundCalc} via ${refundMode}`);
      // Log cancellation refund — money-out delta only.
      // Registration snapshot fields zeroed; reduced totals already on the synced registration_payment row.
      if (refundCalc > 0) {
        logPaymentTransaction({
          registration_id: reg.id,
          invoice_number: reg.invoice_number,
          patient_name: patientName,
          transaction_type: "refund",
          direction: "out",
          payments: [{ mode: refundMode, amount: refundCalc }],
          total_amount: refundCalc,
          gross_amount: 0,
          discount_amount: 0,
          final_amount: 0,
          paid_amount: 0,
          due_amount: 0,
          refund_amount: refundCalc,
          remarks: `${newlyCancelled.length} test(s) cancelled${homeVisitRefundRequested ? " + HV charges refunded" : ""}`,
        });
      }
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const processCancelBill = async () => {
    setSaving(true);
    try {
      const totalPaid = Number(reg.paid_amount || 0);
      const origGross = Number(reg.gross_amount || 0);
      const origDiscount = Number(reg.discount_amount || 0);
      const origFinal = Number(reg.final_amount || 0);
      const regDate = reg.created_at ? new Date(reg.created_at) : new Date();
      const regDateStr = format(regDate, "dd-MM-yyyy");
      // Detect original payment modes for audit context in remarks
      const origPayments: Array<{ mode: string; amount: number }> = Array.isArray(reg.payments) ? reg.payments : [];
      const origModesLabel = origPayments.length
        ? Array.from(new Set(origPayments.map((p: any) => p.mode))).join("/")
        : "—";

      // Freeze pattern: do NOT mutate the original registration_payment audit row.
      // Update live registration state only.
      const { error } = await supabase.from("patient_registrations").update({
        bill_cancelled: true,
        status: "cancelled",
        refund_amount: totalPaid,
        refund_mode: refundMode,
        refund_date: new Date().toISOString(),
        final_amount: 0,
        paid_amount: 0,
        due_amount: 0,
      } as any).eq("id", reg.id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["patient_registrations"] });

      // Log TWO entries dated today — both audit-correct and cash-drawer-correct.
      // 1) Refund row: actual cash outflow in chosen mode (Cash or NEFT only).
      if (totalPaid > 0) {
        logPaymentTransaction({
          registration_id: reg.id,
          invoice_number: reg.invoice_number,
          patient_name: patientName,
          transaction_type: "refund",
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

      // 2) Bill cancellation marker row: negative bill snapshot for audit visibility.
      //    Mode amounts = 0 so it does NOT double-count cash impact.
      logPaymentTransaction({
        registration_id: reg.id,
        invoice_number: reg.invoice_number,
        patient_name: patientName,
        transaction_type: "bill_cancellation",
        direction: "out",
        payments: [], // no mode amounts — refund row already captured the cash movement
        total_amount: 0,
        gross_amount: -origGross,
        discount_amount: -origDiscount,
        final_amount: -origFinal,
        paid_amount: 0,
        due_amount: 0,
        refund_amount: 0,
        remarks: `Bill cancelled — original invoice ${reg.invoice_number} dated ${regDateStr}, final ₹${origFinal}`,
      });

      toast.success(`Bill cancelled. Refund ₹${totalPaid} via ${refundMode} recorded in today's Daily Report.`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const age = dob ? `${Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000))} Years` : "";

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
                <Input value={mobileNumber} onChange={e => setMobileNumber(e.target.value)} disabled={isBillCancelled} />
              </div>
              <div>
                <Label>Title</Label>
                <Select value={title} onValueChange={setTitle} disabled={isBillCancelled}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TITLES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Patient Name</Label>
                <Input value={patientName} onChange={e => setPatientName(e.target.value.toUpperCase())} disabled={isBillCancelled} />
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
                <Label>DOB {age && <span className="text-muted-foreground ml-1">({age})</span>}</Label>
                <Input type="date" value={dob} onChange={e => setDob(e.target.value)} disabled={isBillCancelled} />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={email} onChange={e => setEmail(e.target.value)} disabled={isBillCancelled} />
              </div>
            </div>
            <div>
              <Label>Doctor Name</Label>
              <Input value={doctorName} onChange={e => setDoctorName(e.target.value.toUpperCase())} disabled={isBillCancelled} />
            </div>
            <div>
              <Label>Address</Label>
              <Input value={address} onChange={e => setAddress(e.target.value.toUpperCase())} disabled={isBillCancelled} />
            </div>
            <div>
              <Label>Remarks</Label>
              <Input value={remarks} onChange={e => setRemarks(e.target.value.toUpperCase())} placeholder="Optional remarks" className="uppercase" disabled={isBillCancelled} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-destructive/30 p-3">
              <div className="flex items-center gap-2">
                {isStat && <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-destructive"></span></span>}
                <Label className="text-destructive font-semibold cursor-pointer" htmlFor="edit-stat-toggle">STAT (Urgent)</Label>
              </div>
              <Switch id="edit-stat-toggle" checked={isStat} onCheckedChange={setIsStat} className="data-[state=checked]:bg-destructive" disabled={isBillCancelled} />
            </div>

            {/* Payment Mode Redistribution — only shown when payment exists */}
            {!isBillCancelled && lockedPaidAmount > 0 && (
              <div className="space-y-2">
                <h3 className="font-semibold text-sm">Payment Mode</h3>
                <div className="text-sm text-muted-foreground mb-1">Amount Paid: <span className="font-semibold text-foreground">₹{lockedPaidAmount}</span></div>
                <div className="flex flex-wrap gap-2">
                  {PAYMENT_MODES.map(mode => (
                    <Button key={mode} type="button" size="sm"
                      variant={selectedModes.has(mode) ? "default" : "outline"}
                      onClick={() => togglePaymentMode(mode)}
                    >{mode}</Button>
                  ))}
                </div>
                {Array.from(selectedModes).map(mode => (
                  <div key={mode} className="flex items-center gap-2">
                    <Label className="w-28 text-sm">{mode}:</Label>
                    <Input type="number" min={0} className="w-32"
                      value={modeAmounts[mode] || ""}
                      onChange={e => setModeAmounts(prev => ({ ...prev, [mode]: Number(e.target.value) || 0 }))}
                      placeholder="₹ Amount"
                      readOnly={selectedModes.size === 1} />
                  </div>
                ))}
                {selectedModes.size > 1 && (
                  <div className="text-sm space-y-1 pt-1">
                    <div className="flex justify-between"><span>Allocated:</span><span className={`font-medium ${paymentModesMismatch ? "text-destructive" : ""}`}>₹{editPaidAmount} / ₹{lockedPaidAmount}</span></div>
                    {paymentModesMismatch && (
                      <div className="text-destructive text-xs font-medium">
                        ⚠ Split amounts must equal ₹{lockedPaidAmount}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {!isBillCancelled && (
              <Button onClick={handleSaveDetails} disabled={saving || paymentModesMismatch || overpaymentBlocksSave} className="w-full">
                <Save className="h-4 w-4 mr-2" />{overpaymentBlocksSave ? "Process Refund Below First" : "Save Details"}
              </Button>
            )}
          </div>

          <Separator />

          {/* Tests & Discounts */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm">Tests & Discounts ({editTests.length})</h3>

            {/* Discount unlock gate for post-accepted stages */}
            {isPastAccepted && !discountUnlocked && !isBillCancelled && (
              <div className="p-3 rounded border border-orange-300 bg-orange-50 space-y-2">
                <div className="text-sm text-orange-700 flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  Discount editing is locked after sample acceptance. Enter admin password to unlock.
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowDiscountUnlockPwd(true)}>
                  🔓 Unlock Discounts
                </Button>
              </div>
            )}

            <div className="space-y-2">
              {editTests.map((t: any, i: number) => {
                const isCancelled = alreadyCancelled.has(t.test_id);
                const isNewCancel = cancelledTestIds.has(t.test_id) && !isCancelled;
                const canEditDiscount = !isBillCancelled && !isCancelled && !isDiscountLocked && t.discount_applicable;
                return (
                  <div key={t.test_id || i} className={`p-2 rounded border ${isCancelled ? "bg-destructive/10 line-through opacity-60" : isNewCancel ? "bg-yellow-50 border-yellow-300" : ""}`}>
                    <div className="flex items-center gap-3">
                      {!isBillCancelled && !isCancelled && !isRefundBlocked && (
                        <Checkbox
                          checked={cancelledTestIds.has(t.test_id)}
                          onCheckedChange={(checked) => {
                            setCancelledTestIds(prev => {
                              const next = new Set(prev);
                              if (checked) next.add(t.test_id);
                              else next.delete(t.test_id);
                              return next;
                            });
                          }}
                        />
                      )}
                      <span className="flex-1 text-sm">{t.test_name}</span>
                      <span className="text-sm text-muted-foreground">₹{t.price}</span>
                      {!isCancelled && (
                        <span className="text-sm font-medium">₹{discountCalc.updatedTests.find((u: any) => u.test_id === t.test_id)?.discounted_price ?? t.price}</span>
                      )}
                      {isCancelled && <Badge variant="destructive" className="text-xs">Cancelled</Badge>}
                    </div>
                    {/* Individual discount controls */}
                    {canEditDiscount && (
                      <div className="flex items-center gap-2 mt-1 ml-8">
                        <span className="text-xs text-muted-foreground">Discount:</span>
                        <Select value={t.individual_discount_type || ""} onValueChange={v => updateTestDiscount(t.test_id, "individual_discount_type", v || null)}>
                          <SelectTrigger className="w-16 h-7 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent><SelectItem value="percent">%</SelectItem><SelectItem value="amount">₹</SelectItem></SelectContent>
                        </Select>
                        {t.individual_discount_type && (
                          <Input type="number" className="w-20 h-7 text-xs" min={0}
                            value={t.individual_discount_value || ""}
                            onChange={e => updateTestDiscount(t.test_id, "individual_discount_value", parseFloat(e.target.value) || 0)}
                            placeholder="Value" />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Global Discount */}
            {!isBillCancelled && !isDiscountLocked && (
              <div className="p-3 rounded border bg-muted/30 space-y-2">
                <Label className="text-sm font-medium">Global Discount</Label>
                <div className="flex gap-2 items-center">
                  <Select value={globalDiscountType} onValueChange={(v: any) => setGlobalDiscountType(v)}>
                    <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="percent">%</SelectItem><SelectItem value="amount">₹</SelectItem></SelectContent>
                  </Select>
                  <Input type="number" className="w-28" min={0}
                    value={globalDiscountValue || ""}
                    onChange={e => setGlobalDiscountValue(parseFloat(e.target.value) || 0)}
                    placeholder="Value" />
                </div>
                <p className="text-xs text-muted-foreground">Applied to tests without individual discounts</p>
              </div>
            )}

            {/* Discount change summary */}
            {discountChanged && (
              <div className={`p-3 rounded border space-y-1 text-sm ${discountOverpayment > 0 ? "border-orange-400 bg-orange-50" : "border-blue-300 bg-blue-50"}`}>
                <div className={`font-medium ${discountOverpayment > 0 ? "text-orange-700" : "text-blue-700"}`}>Discount Changed</div>
                <div className="flex justify-between"><span>New Gross:</span><span>₹{discountCalc.totalAmount}</span></div>
                <div className="flex justify-between text-green-600"><span>New Discount:</span><span>-₹{discountCalc.totalDiscount}</span></div>
                {discountCalc.hvc > 0 && <div className="flex justify-between"><span>Home Visit:</span><span>+₹{discountCalc.hvc}</span></div>}
                <div className="flex justify-between font-bold border-t pt-1"><span>New Final:</span><span>₹{discountCalc.finalAmount}</span></div>
                <div className="flex justify-between"><span>Paid:</span><span>₹{lockedPaidAmount}</span></div>

                {discountOverpayment > 0 ? (
                  <>
                    <div className="flex justify-between text-orange-700 font-bold"><span>⚠ Overpaid:</span><span>₹{discountOverpayment}</span></div>
                    <Separator className="my-2" />
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-orange-800">Refund ₹{discountOverpayment} to patient</div>
                      <div className="flex items-center gap-3">
                        <Label className="text-sm">Refund Mode:</Label>
                        <Select value={overpaymentRefundMode} onValueChange={setOverpaymentRefundMode}>
                          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Cash">Cash</SelectItem>
                            <SelectItem value="NEFT">NEFT</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button variant="destructive" size="sm" onClick={() => setShowOverpaymentRefundPwd(true)} disabled={saving}>
                        <RotateCcw className="h-4 w-4 mr-2" />Apply Discount & Process Refund
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between text-destructive"><span>New Due:</span><span>₹{Math.max(0, discountCalc.finalAmount - lockedPaidAmount)}</span></div>
                )}
              </div>
            )}

            {/* Home Visit Charges Refund */}
            {!isBillCancelled && !isRefundBlocked && Number(reg.home_visit_charges || 0) > 0 && (
              <div className="p-3 rounded border bg-muted/50 space-y-2">
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={homeVisitRefundRequested}
                    onCheckedChange={(checked) => setHomeVisitRefundRequested(!!checked)}
                  />
                  <span className="text-sm font-medium">Refund Home Visit Charges — ₹{reg.home_visit_charges}</span>
                </div>
              </div>
            )}

            {!isBillCancelled && !isRefundBlocked && (newlyCancelled.length > 0 || homeVisitRefundRequested) && (
              <div className="p-3 rounded border bg-muted/50 space-y-2">
                <div className="text-sm font-medium">
                  {newlyCancelled.length > 0 && `Cancel ${newlyCancelled.length} test(s)`}
                  {newlyCancelled.length > 0 && homeVisitRefundRequested && " + "}
                  {homeVisitRefundRequested && "Refund HVC"}
                  {" — Refund: ₹"}{refundCalc}
                </div>
                <div className="flex items-center gap-3">
                  <Label className="text-sm">Refund Mode:</Label>
                  <Select value={refundMode} onValueChange={setRefundMode}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Cash">Cash</SelectItem>
                      <SelectItem value="NEFT">NEFT</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="destructive" size="sm" onClick={handleCancelTests} disabled={saving}>
                  <RotateCcw className="h-4 w-4 mr-2" />Process Refund
                </Button>
              </div>
            )}

            {reg.refund_amount > 0 && (
              <div className="p-3 rounded border bg-muted/50 text-sm space-y-1">
                <div className="font-medium">Previous Refund</div>
                <div>Amount: ₹{reg.refund_amount} via {reg.refund_mode}</div>
                {reg.refund_date && <div>Date: {format(new Date(reg.refund_date), "dd-MM-yyyy hh:mm a")}</div>}
              </div>
            )}
            {isRefundBlocked && !isBillCancelled && (
              <div className="p-3 rounded border border-orange-300 bg-orange-50 space-y-2">
                <div className="text-sm text-orange-700">
                  Refund / cancellation is locked after sample acceptance. Enter admin password to unlock.
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowRefundUnlockPwd(true)}>
                  🔓 Unlock Refund
                </Button>
              </div>
            )}
          </div>

          <Separator />

          {/* Bill Summary */}
          <div className="space-y-2 text-sm">
            <h3 className="font-semibold">Bill Summary</h3>
            <div className="flex justify-between"><span>Gross Amount:</span><span>₹{discountChanged ? discountCalc.totalAmount : reg.gross_amount}</span></div>
            {(discountChanged ? discountCalc.totalDiscount : reg.discount_amount) > 0 && <div className="flex justify-between text-green-600"><span>Discount:</span><span>-₹{discountChanged ? discountCalc.totalDiscount : reg.discount_amount}</span></div>}
            {(discountChanged ? discountCalc.hvc : reg.home_visit_charges) > 0 && <div className="flex justify-between"><span>Home Visit Charges:</span><span>+₹{discountChanged ? discountCalc.hvc : reg.home_visit_charges}</span></div>}
            <div className="flex justify-between font-bold border-t pt-1"><span>Final Amount:</span><span>₹{discountChanged ? discountCalc.finalAmount : reg.final_amount}</span></div>
            <div className="flex justify-between"><span>Paid:</span><span>₹{reg.paid_amount}</span></div>
            {discountOverpayment > 0 ? (
              <div className="flex justify-between text-orange-600 font-bold"><span>To Refund:</span><span>₹{discountOverpayment}</span></div>
            ) : (
              (discountChanged ? Math.max(0, discountCalc.finalAmount - lockedPaidAmount) : reg.due_amount) > 0 && <div className="flex justify-between text-destructive font-bold"><span>Due:</span><span>₹{discountChanged ? Math.max(0, discountCalc.finalAmount - lockedPaidAmount) : reg.due_amount}</span></div>
            )}
            {reg.refund_amount > 0 && <div className="flex justify-between text-orange-600"><span>Refunded:</span><span>₹{reg.refund_amount}</span></div>}
          </div>

          {/* Cancel Bill */}
          {!isBillCancelled && !isRefundBlocked && (
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
                <Button variant="destructive" className="w-full" onClick={() => setShowCancelBillPwd(true)} disabled={saving}>
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
        open={showRefundPwd}
        onOpenChange={setShowRefundPwd}
        onSuccess={processCancelTests}
        description={`This will ${newlyCancelled.length > 0 ? `cancel ${newlyCancelled.length} test(s)` : ""}${newlyCancelled.length > 0 && homeVisitRefundRequested ? " and " : ""}${homeVisitRefundRequested ? "refund home visit charges" : ""} — Refund ₹${refundCalc} via ${refundMode}.`}
      />
      <DeletePasswordDialog
        open={showRefundUnlockPwd}
        onOpenChange={setShowRefundUnlockPwd}
        onSuccess={() => {
          setRefundUnlocked(true);
          toast.success("Refund unlocked for this session");
        }}
        description="Sample has passed accepted stage. Enter admin password to unlock refund/cancellation."
      />
      <DeletePasswordDialog
        open={showDiscountUnlockPwd}
        onOpenChange={setShowDiscountUnlockPwd}
        onSuccess={() => {
          setDiscountUnlocked(true);
          toast.success("Discount editing unlocked for this session");
        }}
        description="Sample has passed accepted stage. Enter admin password to unlock discount editing."
      />
      <DeletePasswordDialog
        open={showOverpaymentRefundPwd}
        onOpenChange={setShowOverpaymentRefundPwd}
        onSuccess={processOverpaymentRefund}
        description={`Applying discount will reduce the final amount to ₹${discountCalc.finalAmount}. Refund ₹${discountOverpayment} to patient via ${overpaymentRefundMode}.`}
      />
    </>
  );
};

export default EditRegistrationDialog;
