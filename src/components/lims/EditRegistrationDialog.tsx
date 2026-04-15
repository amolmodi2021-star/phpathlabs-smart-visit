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
    return refundAmount;
  }, [newlyCancelled, tests]);

  const PAYMENT_MODES = ["Cash", "GPay", "Paytm", "Credit Card", "NEFT"];

  const togglePaymentMode = (mode: string) => {
    setSelectedModes(prev => {
      const next = new Set(prev);
      if (next.has(mode)) { next.delete(mode); setModeAmounts(a => { const n = { ...a }; delete n[mode]; return n; }); }
      else next.add(mode);
      return next;
    });
  };

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
  // Use recalculated final amount for zero-due check
  const effectiveFinalAmount = discountChanged ? discountCalc.finalAmount : Number(reg?.final_amount || 0);
  const isZeroDue = reg ? Number(reg.due_amount || 0) <= 0 : false;
  const editDueAmount = isZeroDue && !discountChanged ? 0 : Math.max(0, effectiveFinalAmount - editPaidAmount);
  const zeroDueMismatch = isZeroDue && !discountChanged && Math.abs(editPaidAmount - Number(reg?.final_amount || 0)) > 0.01;

  if (!reg) return null;

  const handleSaveDetails = async () => {
    setSaving(true);
    try {
      const payments = Array.from(selectedModes)
        .filter(m => (modeAmounts[m] || 0) > 0)
        .map(m => ({ mode: m, amount: modeAmounts[m] || 0 }));

      const saveFinalAmount = discountChanged ? discountCalc.finalAmount : Number(reg.final_amount);
      const savePaidAmount = isZeroDue && !discountChanged ? saveFinalAmount : editPaidAmount;
      const saveDueAmount = isZeroDue && !discountChanged ? 0 : Math.max(0, saveFinalAmount - savePaidAmount);

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
        paid_amount: savePaidAmount,
        due_amount: saveDueAmount,
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
      }

      const { error } = await supabase.from("patient_registrations").update(updateData).eq("id", reg.id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["patient_registrations"] });
      toast.success("Registration updated");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelTests = async () => {
    if (newlyCancelled.length === 0) {
      toast.error("No new tests selected for cancellation");
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

      const totalRefund = Number(reg.refund_amount || 0) + refundCalc;
      const newFinalAmount = Math.max(0, Number(reg.final_amount) - refundCalc);
      const newPaid = Math.max(0, Number(reg.paid_amount) - refundCalc);

      const { error } = await supabase.from("patient_registrations").update({
        cancelled_tests: allCancelled,
        refund_amount: totalRefund,
        refund_mode: refundMode,
        refund_date: new Date().toISOString(),
        final_amount: newFinalAmount,
        paid_amount: newPaid,
        due_amount: Math.max(0, newFinalAmount - newPaid),
      } as any).eq("id", reg.id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["patient_registrations"] });
      toast.success(`${newlyCancelled.length} test(s) cancelled. Refund: ₹${refundCalc} via ${refundMode}`);
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
      toast.success(`Bill cancelled. Full refund: ₹${totalPaid} via ${refundMode}`);
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

            {/* Payment Details */}
            {!isBillCancelled && (
              <div className="space-y-2">
                <h3 className="font-semibold text-sm">Payment Details</h3>
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
                      placeholder="₹ Amount" />
                  </div>
                ))}
                {selectedModes.size > 0 && (
                  <div className="text-sm space-y-1 pt-1">
                    <div className="flex justify-between"><span>Total Paid:</span><span className="font-medium">₹{editPaidAmount}</span></div>
                    <div className="flex justify-between"><span>Final Amount:</span><span className="font-medium">₹{effectiveFinalAmount}</span></div>
                    {!isZeroDue && editDueAmount > 0 && <div className="flex justify-between text-destructive font-medium"><span>Due:</span><span>₹{editDueAmount}</span></div>}
                    {isZeroDue && !discountChanged && zeroDueMismatch && (
                      <div className="text-destructive text-xs font-medium mt-1">
                        ⚠ Total must equal ₹{reg.final_amount} — no additional payment allowed, only mode change permitted.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {!isBillCancelled && (
              <Button onClick={handleSaveDetails} disabled={saving || (zeroDueMismatch && !discountChanged)} className="w-full">
                <Save className="h-4 w-4 mr-2" />Save Details
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
              <div className="p-3 rounded border border-blue-300 bg-blue-50 space-y-1 text-sm">
                <div className="font-medium text-blue-700">Discount Changed</div>
                <div className="flex justify-between"><span>New Gross:</span><span>₹{discountCalc.totalAmount}</span></div>
                <div className="flex justify-between text-green-600"><span>New Discount:</span><span>-₹{discountCalc.totalDiscount}</span></div>
                {discountCalc.hvc > 0 && <div className="flex justify-between"><span>Home Visit:</span><span>+₹{discountCalc.hvc}</span></div>}
                <div className="flex justify-between font-bold border-t pt-1"><span>New Final:</span><span>₹{discountCalc.finalAmount}</span></div>
                <div className="flex justify-between"><span>Paid:</span><span>₹{editPaidAmount}</span></div>
                <div className="flex justify-between text-destructive"><span>New Due:</span><span>₹{Math.max(0, discountCalc.finalAmount - editPaidAmount)}</span></div>
              </div>
            )}

            {!isBillCancelled && !isRefundBlocked && newlyCancelled.length > 0 && (
              <div className="p-3 rounded border bg-muted/50 space-y-2">
                <div className="text-sm font-medium">Cancel {newlyCancelled.length} test(s) — Refund: ₹{refundCalc}</div>
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
            {(discountChanged ? Math.max(0, discountCalc.finalAmount - editPaidAmount) : reg.due_amount) > 0 && <div className="flex justify-between text-destructive font-bold"><span>Due:</span><span>₹{discountChanged ? Math.max(0, discountCalc.finalAmount - editPaidAmount) : reg.due_amount}</span></div>}
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
        description={`This will cancel the entire bill and refund ₹${reg.paid_amount} via ${refundMode}.`}
      />
      <DeletePasswordDialog
        open={showRefundPwd}
        onOpenChange={setShowRefundPwd}
        onSuccess={processCancelTests}
        description={`This will cancel ${newlyCancelled.length} test(s) and refund ₹${refundCalc} via ${refundMode}.`}
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
    </>
  );
};

export default EditRegistrationDialog;
