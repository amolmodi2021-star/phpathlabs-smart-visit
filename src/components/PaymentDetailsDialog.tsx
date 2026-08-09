import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { format, addDays } from "date-fns";
import html2canvas from "html2canvas";
import { shareOnWhatsApp } from "@/lib/whatsapp";
import { logMessageSend } from "@/lib/messageLog";
import { formatDateDDMMYYYY, formatDateShort } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { patientDisplayName } from "@/lib/patientDisplayName";

interface VisitData {
  visit_date: string;
  visit_time: string;
  address: string;
  estimates?: {
    title?: string;
    patient_name?: string;
    gender?: string;
    email?: string;
    doctor_name?: string;
    umr_number?: string;
    dob?: string;
    whatsapp_number?: string;
    total_amount?: number;
    discount_amount?: number;
    home_visit_charges?: number;
    final_amount?: number;
    global_discount_type?: string;
    global_discount_value?: number;
    estimate_tests?: { test_name: string; price: number; discounted_price: number; fasting_required: boolean; individual_discount_type?: string; individual_discount_value?: number; discount_applicable?: boolean }[];
  };
  phlebotomists?: { name: string };
}

interface PaymentDetailsDialogProps {
  open: boolean;
  onClose: () => void;
  finalAmount: number;
  onSave: (data: { paid_amount: number; due_amount: number; payment_mode: string; payment_remarks: string }) => void;
  isPending?: boolean;
  initialData?: { paid_amount: number; payment_mode: string; payment_remarks: string };
  visitData?: VisitData;
  /** Multiple visits for consolidated multi-patient payment */
  consolidatedVisits?: VisitData[];
}

const PAYMENT_MODES = ["Cash", "GPay", "Paytm", "Credit Card"];

const formatTime12hr = (time: string) => {
  if (!time) return "";
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
};

const PaymentDetailsDialog = ({ open, onClose, finalAmount, onSave, isPending, initialData, visitData, consolidatedVisits }: PaymentDetailsDialogProps) => {
  const [selectedModes, setSelectedModes] = useState<Set<string>>(new Set());
  const [modeAmounts, setModeAmounts] = useState<Record<string, number>>({});
  const [remarks, setRemarks] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [finalReviewOpen, setFinalReviewOpen] = useState(false);
  const [dueConfirmOpen, setDueConfirmOpen] = useState(false);
  const [dueConfirmText, setDueConfirmText] = useState("");
  // Keys are "patientIdx:testIdx" for multi-patient, or just testIdx for single
  const [reportDates, setReportDates] = useState<Record<string, string>>({});
  const [reportTimes, setReportTimes] = useState<Record<string, string>>({});
  const [receiptNumber, setReceiptNumber] = useState("");

  const est = visitData?.estimates;
  const tests = est?.estimate_tests || [];

  // Build a unified list of all patients for review
  const allPatients = useMemo(() => {
    if (consolidatedVisits && consolidatedVisits.length > 1) {
      return consolidatedVisits.map((cv: any, idx: number) => {
        const cEst = cv.estimates || cv;
        return { idx, est: cEst, tests: cEst?.estimate_tests || [], visitData: cv };
      });
    }
    return [{ idx: 0, est, tests, visitData }];
  }, [consolidatedVisits, est, tests, visitData]);

  // Auto-fill report delivery date/time per test when review opens
  useEffect(() => {
    if (reviewOpen && Object.keys(reportDates).length === 0) {
      const now = new Date();
      const todayStr = format(now, "yyyy-MM-dd");
      const currentHour = now.getHours();
      const defaultTime = currentHour < 13 ? "15:30" : "19:30";
      const dates: Record<string, string> = {};
      const times: Record<string, string> = {};
      allPatients.forEach(p => {
        p.tests.forEach((_: any, ti: number) => {
          const key = `${p.idx}:${ti}`;
          dates[key] = todayStr;
          times[key] = defaultTime;
        });
      });
      setReportDates(dates);
      setReportTimes(times);
    }
  }, [reviewOpen, allPatients]);

  // Generate receipt number when final review opens.
  // Uses head:true with estimated count so we don't pull row data — same accuracy
  // for receipt sequencing (today's daily count) but no full-table scan cost.
  useEffect(() => {
    if (finalReviewOpen && !receiptNumber) {
      const generateReceiptNumber = async () => {
        const now = new Date();
        const datePrefix = format(now, "ddMMyy");
        const todayStart = format(now, "yyyy-MM-dd");
        const { count } = await supabase
          .from("home_visits")
          .select("*", { count: "exact", head: true })
          .eq("status", "Completed")
          .gte("updated_at", `${todayStart}T00:00:00`);
        const seq = ((count || 0) + 1).toString().padStart(4, "0");
        setReceiptNumber(`HVR${datePrefix}${seq}`);
      };
      generateReceiptNumber();
    }
  }, [finalReviewOpen]);

  // Initialize from initialData
  useEffect(() => {
    if (initialData) {
      const modes = initialData.payment_mode ? initialData.payment_mode.split(", ") : [];
      const newModes = new Set<string>();
      const newAmounts: Record<string, number> = {};

      for (const part of modes) {
        const colonIdx = part.indexOf(": ₹");
        if (colonIdx !== -1) {
          const mode = part.substring(0, colonIdx).trim();
          const amount = parseFloat(part.substring(colonIdx + 3)) || 0;
          if (PAYMENT_MODES.includes(mode)) {
            newModes.add(mode);
            newAmounts[mode] = amount;
          }
        } else if (PAYMENT_MODES.includes(part.trim())) {
          newModes.add(part.trim());
          newAmounts[part.trim()] = initialData.paid_amount;
        }
      }

      setSelectedModes(newModes);
      setModeAmounts(newAmounts);
      setRemarks(initialData.payment_remarks || "");
    } else {
      setSelectedModes(new Set());
      setModeAmounts({});
      setRemarks("");
    }
  }, [initialData, open]);

  const toggleMode = (mode: string) => {
    setSelectedModes(prev => {
      const next = new Set(prev);
      if (next.has(mode)) {
        next.delete(mode);
        setModeAmounts(a => { const n = { ...a }; delete n[mode]; return n; });
      } else {
        next.add(mode);
      }
      return next;
    });
  };

  const paidAmount = useMemo(() => {
    return Array.from(selectedModes).reduce((sum, mode) => sum + (modeAmounts[mode] || 0), 0);
  }, [selectedModes, modeAmounts]);

  const dueAmount = useMemo(() => Math.max(0, finalAmount - paidAmount), [finalAmount, paidAmount]);

  // Per-patient payment mode distribution (proportional to final_amount)
  const perPatientModes = useMemo(() => {
    const n = allPatients.length;
    const modes = Array.from(selectedModes).filter(m => (modeAmounts[m] || 0) > 0);
    if (n <= 1) {
      const modeMap: Record<string, number> = {};
      modes.forEach(m => { modeMap[m] = modeAmounts[m] || 0; });
      return [modeMap];
    }
    const finals = allPatients.map(p => Number(p.est?.final_amount || 0));
    const grandTotal = finals.reduce((s, f) => s + f, 0);
    return allPatients.map((_, i) => {
      const modeMap: Record<string, number> = {};
      modes.forEach(m => {
        const total = modeAmounts[m] || 0;
        const rawAmts = finals.map(f => grandTotal > 0 ? Math.floor((total * f) / grandTotal) : 0);
        const rawSum = rawAmts.reduce((s, v) => s + v, 0);
        rawAmts[0] += total - rawSum;
        modeMap[m] = rawAmts[i];
      });
      return modeMap;
    });
  }, [selectedModes, modeAmounts, allPatients]);

  // Per-patient payment distribution (proportional to final_amount)
  const perPatientPayment = useMemo(() => {
    const n = allPatients.length;
    if (n <= 1) {
      const patientFinal = Number(allPatients[0]?.est?.final_amount || finalAmount);
      return [{ paid: paidAmount, due: Math.max(0, patientFinal - paidAmount) }];
    }
    const finals = allPatients.map(p => Number(p.est?.final_amount || 0));
    const grandTotal = finals.reduce((s, f) => s + f, 0);
    const rawPaid = finals.map(f => grandTotal > 0 ? Math.floor((paidAmount * f) / grandTotal) : 0);
    const rawSum = rawPaid.reduce((s, v) => s + v, 0);
    rawPaid[0] += paidAmount - rawSum;
    return allPatients.map((_, i) => {
      const pp = Math.min(rawPaid[i], finals[i]);
      return { paid: pp, due: Math.max(0, finals[i] - pp) };
    });
  }, [paidAmount, allPatients, finalAmount]);

  const modeStr = useMemo(() => {
    return Array.from(selectedModes)
      .filter(m => (modeAmounts[m] || 0) > 0)
      .map(m => `${m}: ₹${modeAmounts[m] || 0}`)
      .join(", ");
  }, [selectedModes, modeAmounts]);

  const handleSave = () => {
    if (selectedModes.size === 0 && paidAmount <= 0) {
      // Entire amount is due - ask for DUE confirmation
      setDueConfirmText("");
      setDueConfirmOpen(true);
      return;
    }
    if (selectedModes.size === 0) {
      toast.error("Please select at least one payment mode");
      return;
    }
    if (paidAmount <= 0) {
      toast.error("Enter paid amount");
      return;
    }
    setReviewOpen(true);
  };

  const handleDueConfirm = () => {
    if (dueConfirmText.trim().toUpperCase() !== "DUE") {
      toast.error("Please type DUE to confirm");
      return;
    }
    setDueConfirmOpen(false);
    setDueConfirmText("");
    // Show review dialog after DUE confirmation
    setReviewOpen(true);
  };

  const handleReviewConfirm = () => {
    setReviewOpen(false);
    setFinalReviewOpen(true);
  };

  const receiptRef = useRef<HTMLDivElement>(null);

  const handleSaveAndShare = useCallback(async () => {
    // First save payment
    onSave({
      paid_amount: paidAmount,
      due_amount: dueAmount,
      payment_mode: modeStr,
      payment_remarks: remarks,
    });

    // Save report delivery dates/times to estimate_tests for all patients
    try {
      for (const p of allPatients) {
        for (let ti = 0; ti < p.tests.length; ti++) {
          const t = p.tests[ti] as any;
          const key = `${p.idx}:${ti}`;
          if (t.id && (reportDates[key] || reportTimes[key])) {
            await supabase.from("estimate_tests").update({
              report_date: reportDates[key] || null,
              report_time: reportTimes[key] || null,
            }).eq("id", t.id);
          }
        }
      }
    } catch (e) {
      console.error("Failed to save report dates", e);
    }

    // Generate JPEG from receipt
    if (receiptRef.current) {
      try {
        const canvas = await html2canvas(receiptRef.current, {
          backgroundColor: "#ffffff",
          scale: 2,
          useCORS: true,
        });
        canvas.toBlob((blob) => {
          if (!blob) return;
          const file = new File([blob], "visit-receipt.jpg", { type: "image/jpeg" });
          // Try native share with image
          if (navigator.share && navigator.canShare?.({ files: [file] })) {
            navigator.share({
              files: [file],
              title: "Visit Receipt",
              text: `Visit receipt for ${patientDisplayName(est) === "—" ? "Patient" : patientDisplayName(est)}`,
            }).catch(() => {
              // Fallback: download
              downloadImage(canvas);
            });
          } else {
            // Fallback: download image + open WhatsApp with text
            downloadImage(canvas);
            const phone = est?.whatsapp_number || "";
            if (phone) {
              const textMsg = buildReceiptText();
              shareOnWhatsApp(phone, textMsg);
              logMessageSend(phone, est?.patient_name, "Receipt", undefined, undefined, textMsg);
            }
          }
        }, "image/jpeg", 0.95);
      } catch {
        toast.error("Could not generate receipt image");
      }
    }
    setFinalReviewOpen(false);
  }, [paidAmount, dueAmount, modeStr, remarks, onSave, est, tests, reportDates, reportTimes, allPatients, perPatientPayment, consolidatedVisits]);

  const downloadImage = (canvas: HTMLCanvasElement) => {
    const link = document.createElement("a");
    link.download = `receipt-${(patientDisplayName(est) === "—" ? "patient" : patientDisplayName(est)).replace(/\s+/g, "_")}-${format(new Date(), "dd-MM-yyyy")}.jpg`;
    link.href = canvas.toDataURL("image/jpeg", 0.95);
    link.click();
    toast.success("Receipt image downloaded — share it on WhatsApp");
  };

  const buildReceiptText = () => {
    let msg = `📋 *PH PathLabs — Home Visit Receipt*\n`;
    if (receiptNumber) msg += `*Receipt No:* ${receiptNumber}\n`;
    msg += `*Visit:* ${formatDateDDMMYYYY(visitData?.visit_date) || "—"} | ${visitData?.visit_time ? formatTime12hr(visitData.visit_time) : "—"}\n`;
    msg += `*Address:* ${visitData?.address || "—"}\n\n`;

    allPatients.forEach((p, pIdx) => {
      const pEst = p.est;
      const pTests = p.tests;
      if (allPatients.length > 1) msg += `--- *Patient ${pIdx + 1} of ${allPatients.length}* ---\n`;
      msg += `*Patient:* ${patientDisplayName(pEst)}\n`;
      msg += `*Mobile:* ${pEst?.whatsapp_number || "—"}\n`;
      if (pEst?.gender) msg += `*Gender:* ${pEst.gender}\n`;
      if (pEst?.dob) msg += `*DOB:* ${formatDateDDMMYYYY(pEst.dob)} | *Age:* ${Math.floor((Date.now() - new Date(pEst.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000))} Years\n`;
      if (pEst?.doctor_name) msg += `*Doctor:* ${pEst.doctor_name}\n`;
      if (pEst?.umr_number) msg += `*UMR:* ${pEst.umr_number}\n`;
      msg += `\n*Tests & Report Delivery:*\n`;
      pTests.forEach((t: any, ti: number) => {
        const key = `${p.idx}:${ti}`;
        const rd = formatDateShort(reportDates[key]);
        const rt = reportTimes[key] ? formatTime12hr(reportTimes[key]) : "";
        msg += `• ${t.test_name} — ₹${t.discounted_price}${rd ? ` (Report by: ${rd} at ${rt})` : ""}\n`;
      });
      msg += `*Total:* ₹${pEst?.total_amount || 0}`;
      if ((pEst?.discount_amount || 0) > 0) msg += ` | *Discount:* -₹${pEst?.discount_amount}`;
      msg += ` | *Home Visit:* ₹${pEst?.home_visit_charges || 0}\n`;
      const pModes = perPatientModes[pIdx] || {};
      const modeLines = Object.entries(pModes).filter(([, a]) => a > 0).map(([m, a]) => `  ${m}: ₹${a}`).join("\n");
      if (modeLines) msg += modeLines + "\n";
      msg += `*Total Paid:* ₹${perPatientPayment[pIdx]?.paid ?? 0} | *Due:* ₹${perPatientPayment[pIdx]?.due ?? 0}\n\n`;
    });

    if (allPatients.length > 1) msg += `*Grand Total (${allPatients.length} patients):* ₹${finalAmount}\n`;
    msg += `*Total Paid:* ₹${paidAmount} | *Total Due:* ₹${dueAmount}\n`;
    return msg;
  };

  // est and tests declared above near hooks

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{initialData ? "Edit Payment Details" : "Payment Details"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Final Amount</Label>
              <Input value={`₹${finalAmount}`} disabled className="font-semibold" />
            </div>

            <div>
              <Label>Payment Mode(s) *</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {PAYMENT_MODES.map((mode) => (
                  <label key={mode} className={`flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer transition-colors ${selectedModes.has(mode) ? 'border-primary bg-primary/5' : 'border-border'}`}>
                    <Checkbox checked={selectedModes.has(mode)} onCheckedChange={() => toggleMode(mode)} />
                    <span className="text-sm font-medium">{mode}</span>
                  </label>
                ))}
              </div>
            </div>

            {selectedModes.size > 0 && (
              <div className="space-y-2">
                {Array.from(selectedModes).map((mode) => {
                  const otherModesTotal = Array.from(selectedModes)
                    .filter(m => m !== mode)
                    .reduce((sum, m) => sum + (modeAmounts[m] || 0), 0);
                  const maxForThisMode = Math.max(0, finalAmount - otherModesTotal);
                  return (
                    <div key={mode}>
                      <Label className="text-xs">{mode} Amount</Label>
                      <Input
                        type="number"
                        value={modeAmounts[mode] || ""}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          setModeAmounts(prev => ({ ...prev, [mode]: Math.min(val, maxForThisMode) }));
                        }}
                        placeholder={`Enter ${mode} amount`}
                        min={0}
                        max={maxForThisMode}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            <div>
              <Label>Total Paid</Label>
              <Input value={`₹${paidAmount}`} disabled className="font-semibold" />
            </div>
            <div>
              <Label>Due Amount</Label>
              <Input value={`₹${dueAmount}`} disabled className={dueAmount > 0 ? "text-destructive font-semibold" : "text-success font-semibold"} />
            </div>

            <div>
              <Label>Remarks</Label>
              <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} placeholder="Any notes..." />
            </div>
            <Button className="w-full" onClick={handleSave} disabled={isPending}>
              Review & Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Review Dialog - shows all patient + payment details */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review All Details</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {/* Visit Info - shared across all patients */}
            <div className="space-y-1">
              <h4 className="font-semibold text-xs text-muted-foreground uppercase tracking-wide">Visit Details</h4>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <span className="text-muted-foreground">Date:</span>
                <span className="font-medium">{formatDateDDMMYYYY(visitData?.visit_date) || "—"}</span>
                <span className="text-muted-foreground">Time:</span>
                <span className="font-medium">{visitData?.visit_time ? formatTime12hr(visitData.visit_time) : "—"}</span>
                <span className="text-muted-foreground">Address:</span>
                <span className="font-medium">{visitData?.address || "—"}</span>
                <span className="text-muted-foreground">Phlebotomist:</span>
                <span className="font-medium">{visitData?.phlebotomists?.name || "Not assigned"}</span>
              </div>
            </div>

            <Separator />

            {/* Each patient's full details */}
            {allPatients.map((p, pIdx) => {
              const pEst = p.est;
              const pTests = p.tests;
              return (
                <div key={pIdx} className="space-y-2">
                  {allPatients.length > 1 && (
                    <div className="bg-primary/10 rounded px-2 py-1">
                      <span className="text-xs font-bold text-primary">Patient {pIdx + 1} of {allPatients.length}</span>
                    </div>
                  )}

                  {/* Patient Info */}
                  <div className="space-y-1">
                    <h4 className="font-semibold text-xs text-muted-foreground uppercase tracking-wide">Patient Information</h4>
                    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                      <span className="text-muted-foreground">Name:</span>
                      <span className="font-medium">{patientDisplayName(pEst)}</span>
                      <span className="text-muted-foreground">Gender:</span>
                      <span className="font-medium">{pEst?.gender || "—"}</span>
                      <span className="text-muted-foreground">DOB:</span>
                      <span className="font-medium">{formatDateDDMMYYYY(pEst?.dob) || "—"}</span>
                      <span className="text-muted-foreground">Age:</span>
                      <span className="font-medium">{pEst?.dob ? `${Math.floor((Date.now() - new Date(pEst.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000))} years` : "—"}</span>
                      <span className="text-muted-foreground">Mobile:</span>
                      <span className="font-medium">{pEst?.whatsapp_number || "—"}</span>
                      {pEst?.email && (
                        <>
                          <span className="text-muted-foreground">Email:</span>
                          <span className="font-medium">{pEst.email}</span>
                        </>
                      )}
                      <span className="text-muted-foreground">Doctor:</span>
                      <span className="font-medium">{pEst?.doctor_name || "SELF"}</span>
                      {pEst?.umr_number && (
                        <>
                          <span className="text-muted-foreground">UMR No:</span>
                          <span className="font-medium">{pEst.umr_number}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Tests with Report Delivery */}
                  <div className="space-y-1">
                    <h4 className="font-semibold text-xs text-muted-foreground uppercase tracking-wide">Tests & Report Delivery ({pTests.length})</h4>
                    <div className="bg-muted/30 rounded p-2 space-y-3">
                      {pTests.map((t: any, ti: number) => {
                        const key = `${p.idx}:${ti}`;
                        return (
                          <div key={ti} className="text-xs space-y-1.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <span className="text-muted-foreground">{ti + 1}.</span>
                                <span className="font-medium">{t.test_name}</span>
                                {t.fasting_required && <Badge variant="outline" className="text-[10px] px-1 py-0">Fasting</Badge>}
                              </div>
                              <div className="flex items-center gap-2">
                                {t.price !== t.discounted_price && (
                                  <span className="line-through text-muted-foreground">₹{t.price}</span>
                                )}
                                <span className="font-medium">₹{t.discounted_price}</span>
                              </div>
                            </div>
                            <div className="ml-4 space-y-1 border-l-2 border-primary/20 pl-2">
                              <span className="text-[10px] text-muted-foreground uppercase font-semibold">Report by:</span>
                              <div className="flex flex-wrap gap-1">
                                {[0, 1, 2].map(offset => {
                                  const d = addDays(new Date(), offset);
                                  const dateStr = format(d, "yyyy-MM-dd");
                                  const lbl = offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : "Day After";
                                  return (
                                    <Button key={offset} type="button" size="sm"
                                      variant={reportDates[key] === dateStr ? "default" : "outline"}
                                      className="h-6 text-[10px] px-2"
                                      onClick={() => setReportDates(prev => ({ ...prev, [key]: dateStr }))}>
                                      {lbl}
                                    </Button>
                                  );
                                })}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <Input type="date" value={reportDates[key] || ""} onChange={e => setReportDates(prev => ({ ...prev, [key]: e.target.value }))} className="flex-1 h-7 text-[10px]" />
                                <Select value={reportTimes[key] || ""} onValueChange={v => setReportTimes(prev => ({ ...prev, [key]: v }))}>
                                  <SelectTrigger className="w-24 h-7 text-[10px]"><SelectValue placeholder="Time" /></SelectTrigger>
                                  <SelectContent>
                                    {(() => {
                                      const slots: { val: string; lbl: string }[] = [];
                                      for (let h = 8; h <= 20; h++) {
                                        slots.push({ val: `${h.toString().padStart(2, "0")}:00`, lbl: `${h % 12 || 12}:00 ${h >= 12 ? "PM" : "AM"}` });
                                      }
                                      slots.push({ val: "15:30", lbl: "3:30 PM" });
                                      slots.push({ val: "19:30", lbl: "7:30 PM" });
                                      slots.sort((a, b) => a.val.localeCompare(b.val));
                                      return slots.map(s => <SelectItem key={s.val} value={s.val}>{s.lbl}</SelectItem>);
                                    })()}
                                  </SelectContent>
                                </Select>
                              </div>
                              {reportDates[key] && reportTimes[key] && (
                                <p className="text-[10px] font-medium text-primary">
                                  📋 {formatDateShort(reportDates[key])} at {formatTime12hr(reportTimes[key])}
                                </p>
                              )}
                            </div>
                            {ti < pTests.length - 1 && <Separator className="mt-2" />}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {pIdx < allPatients.length - 1 && <Separator className="my-2" />}
                </div>
              );
            })}

            <Separator />
            <div className="space-y-1">
              <h4 className="font-semibold text-xs text-muted-foreground uppercase tracking-wide">Amount Details</h4>
              {consolidatedVisits && consolidatedVisits.length > 1 ? (
                <div className="space-y-2">
                  {consolidatedVisits.map((cv: any, idx: number) => {
                    const cEst = cv.estimates || cv;
                    return (
                      <div key={idx} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                        <span className="text-muted-foreground font-medium col-span-2">{cEst ? (patientDisplayName(cEst) === "—" ? `Patient ${idx + 1}` : patientDisplayName(cEst)) : `Patient ${idx + 1}`}:</span>
                        <span className="text-muted-foreground pl-2">Tests:</span>
                        <span>₹{cEst?.total_amount || 0}</span>
                        {Number(cEst?.discount_amount) > 0 && (<><span className="text-muted-foreground pl-2">Discount:</span><span className="text-success">-₹{cEst?.discount_amount}</span></>)}
                        {idx === 0 && Number(cEst?.home_visit_charges) > 0 && (<><span className="text-muted-foreground pl-2">Home Visit:</span><span>₹{cEst?.home_visit_charges}</span></>)}
                        <span className="text-muted-foreground pl-2 font-medium">Subtotal:</span>
                        <span className="font-medium">₹{cEst?.final_amount || 0}</span>
                      </div>
                    );
                  })}
                  <div className="border-t pt-1 flex justify-between font-bold">
                    <span>Grand Total</span>
                    <span className="text-primary">₹{finalAmount}</span>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <span className="text-muted-foreground">Total Amount:</span>
                  <span className="font-medium">₹{est?.total_amount || 0}</span>
                  {(est?.discount_amount || 0) > 0 && (
                    <>
                      <span className="text-muted-foreground">Discount:</span>
                      <span className="font-medium text-success">-₹{est?.discount_amount}</span>
                    </>
                  )}
                  <span className="text-muted-foreground">Home Visit Charges:</span>
                  <span className="font-medium">₹{est?.home_visit_charges || 0}</span>
                  <span className="text-muted-foreground font-semibold">Final Amount:</span>
                  <span className="font-bold text-primary">₹{est?.final_amount || 0}</span>
                </div>
              )}
            </div>

            <Separator />

            {/* Payment */}
            <div className="space-y-1">
              <h4 className="font-semibold text-xs text-muted-foreground uppercase tracking-wide">Payment Details</h4>
              {allPatients.length > 1 && (
                <div className="space-y-1 mb-2">
                  {allPatients.map((p, i) => (
                    <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-x-3 text-xs items-center">
                      <span className="text-muted-foreground truncate">{p.est ? (patientDisplayName(p.est) === "—" ? `Patient ${i + 1}` : patientDisplayName(p.est)) : `Patient ${i + 1}`}</span>
                      <span className="text-success font-medium">Paid: ₹{perPatientPayment[i]?.paid ?? 0}</span>
                      <span className={`font-medium ${(perPatientPayment[i]?.due ?? 0) > 0 ? 'text-destructive' : 'text-success'}`}>Due: ₹{perPatientPayment[i]?.due ?? 0}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-1">
                <span className="text-muted-foreground">Total Paid:</span>
                <span className="font-medium">₹{paidAmount}</span>
                <span className="text-muted-foreground">Total Due:</span>
                <span className={`font-medium ${dueAmount > 0 ? 'text-destructive' : 'text-success'}`}>₹{dueAmount}</span>
                <span className="text-muted-foreground">Payment Mode:</span>
                <span className="font-medium">{modeStr || "—"}</span>
                {remarks && (
                  <>
                    <span className="text-muted-foreground">Remarks:</span>
                    <span className="font-medium">{remarks}</span>
                  </>
                )}
              </div>
            </div>

            {(() => {
              const missing: string[] = [];
              if (!est?.title) missing.push("Title");
              if (!est?.gender) missing.push("Gender");
              if (!est?.dob) missing.push("DOB / Age");
              if (missing.length > 0) {
                return (
                  <div className="space-y-2 pt-2">
                    <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                      <p className="font-semibold">⚠️ Missing mandatory fields:</p>
                      <p>{missing.join(", ")}</p>
                      <p className="mt-1 text-xs">Please go back and update patient details before saving.</p>
                    </div>
                    <Button variant="outline" className="w-full" onClick={() => setReviewOpen(false)}>
                      Go Back & Modify
                    </Button>
                  </div>
                );
              }
              return (
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" className="flex-1" onClick={() => setReviewOpen(false)}>
                    Go Back & Edit
                  </Button>
                  <Button className="flex-1" onClick={handleReviewConfirm}>
                    Review Once Again & Save
                  </Button>
                </div>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* Final Review Dialog with Receipt Card */}
      <Dialog open={finalReviewOpen} onOpenChange={setFinalReviewOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Final Review — Save & Share</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Receipt card for JPEG generation */}
            <div ref={receiptRef} className="bg-white text-black p-4 rounded-lg space-y-3" style={{ fontFamily: "Arial, sans-serif" }}>
              {/* Header */}
              <div className="text-center border-b-2 border-gray-800 pb-2">
                <h2 className="text-base font-bold tracking-wide">PH PathLabs</h2>
                <p className="text-[10px] text-gray-500">LabLine : 6356 55 66 99</p>
                <p className="text-[10px] text-gray-500">Home Visit Receipt</p>
                {receiptNumber && <p className="text-[10px] font-semibold text-gray-700">Receipt No: {receiptNumber}</p>}
                <p className="text-[10px] text-gray-500">{format(new Date(), "dd-MM-yyyy | hh:mm a")}</p>
              </div>

              {/* Visit Info - shared */}
              <div className="space-y-0.5 text-xs">
                <div className="flex justify-between"><span className="text-gray-600">Visit Date:</span><span className="font-semibold">{formatDateDDMMYYYY(visitData?.visit_date) || "—"}</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Visit Time:</span><span className="font-semibold">{visitData?.visit_time ? formatTime12hr(visitData.visit_time) : "—"}</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Address:</span><span className="font-semibold text-right max-w-[60%]">{visitData?.address || "—"}</span></div>
              </div>

              {/* Per-patient sections — same format for single & multi */}
              {allPatients.map((p, pIdx) => {
                const pEst = p.est;
                const pTests = p.tests;
                const isMulti = allPatients.length > 1;
                return (
                  <div key={pIdx} className="space-y-1">
                    {/* Patient header */}
                    {isMulti && (
                      <div className="border-t-2 border-gray-400 pt-1">
                        <p className="text-[10px] font-bold text-gray-500 uppercase">Patient {pIdx + 1} of {allPatients.length}</p>
                      </div>
                    )}
                    {!isMulti && <div className="border-t border-gray-200 pt-1" />}

                    {/* Patient Info */}
                    <div className="space-y-0.5 text-xs">
                      <div className="flex justify-between"><span className="text-gray-600">Patient:</span><span className="font-semibold">{patientDisplayName(pEst)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-600">Mobile:</span><span className="font-semibold">{pEst?.whatsapp_number || "—"}</span></div>
                      {pEst?.gender && <div className="flex justify-between"><span className="text-gray-600">Gender:</span><span className="font-semibold">{pEst.gender}</span></div>}
                      {pEst?.dob && <div className="flex justify-between"><span className="text-gray-600">DOB:</span><span className="font-semibold">{formatDateDDMMYYYY(pEst.dob)}</span></div>}
                      {pEst?.dob && <div className="flex justify-between"><span className="text-gray-600">Age:</span><span className="font-semibold">{Math.floor((Date.now() - new Date(pEst.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000))} Years</span></div>}
                      {pEst?.doctor_name && <div className="flex justify-between"><span className="text-gray-600">Doctor:</span><span className="font-semibold">{pEst.doctor_name}</span></div>}
                      {pEst?.umr_number && <div className="flex justify-between"><span className="text-gray-600">UMR No:</span><span className="font-semibold">{pEst.umr_number}</span></div>}
                    </div>

                    {/* Tests & Report Delivery */}
                    <div className="border-t border-gray-200 pt-1">
                      <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Tests & Report Delivery</p>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-300">
                            <th className="text-left py-0.5 text-gray-600 font-medium">Test</th>
                            <th className="text-right py-0.5 text-gray-600 font-medium">Amount</th>
                            <th className="text-right py-0.5 text-gray-600 font-medium">Report By</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pTests.map((t: any, ti: number) => {
                            const key = `${p.idx}:${ti}`;
                            const rd = formatDateShort(reportDates[key]);
                            const rt = reportTimes[key] ? formatTime12hr(reportTimes[key]) : "";
                            return (
                              <tr key={ti} className="border-b border-gray-100">
                                <td className="py-1 pr-1">
                                  {t.test_name}
                                  {t.fasting_required && <span className="text-[9px] text-red-500 ml-1">(F)</span>}
                                </td>
                                <td className="py-1 text-right font-semibold">₹{t.discounted_price}</td>
                                <td className="py-1 text-right text-[10px]">{rd} {rt}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Individual Financials */}
                    <div className="border-t border-gray-300 pt-1 space-y-0.5 text-xs">
                      <div className="flex justify-between"><span className="text-gray-600">Total Amount:</span><span className="font-semibold">₹{pEst?.total_amount || 0}</span></div>
                      {(pEst?.discount_amount || 0) > 0 && (
                        <div className="flex justify-between"><span className="text-gray-600">Discount:</span><span className="font-semibold text-green-600">-₹{pEst?.discount_amount}</span></div>
                      )}
                      <div className="flex justify-between"><span className="text-gray-600">Home Visit:</span><span className="font-semibold">₹{pEst?.home_visit_charges || 0}</span></div>
                      <div className="flex justify-between font-bold"><span>Final Amount:</span><span>₹{pEst?.final_amount || 0}</span></div>
                      {/* Per-patient payment mode bifurcation */}
                      {Object.entries(perPatientModes[pIdx] || {}).map(([mode, amt]) => (
                        amt > 0 ? <div key={mode} className="flex justify-between"><span className="text-gray-600 pl-2">{mode}:</span><span className="font-semibold">₹{amt}</span></div> : null
                      ))}
                      <div className="flex justify-between"><span className="text-gray-600">Total Paid:</span><span className="font-semibold text-green-700">₹{perPatientPayment[pIdx]?.paid ?? 0}</span></div>
                      <div className="flex justify-between"><span className="text-gray-600">Due:</span><span className={`font-semibold ${(perPatientPayment[pIdx]?.due ?? 0) > 0 ? 'text-red-600' : 'text-green-700'}`}>₹{perPatientPayment[pIdx]?.due ?? 0}</span></div>
                    </div>
                  </div>
                );
              })}

              {/* Grand Total & Payment Summary */}
              <div className="border-t-2 border-gray-800 pt-1 space-y-0.5 text-xs">
                {allPatients.length > 1 && (
                  <div className="flex justify-between text-sm font-bold"><span>Grand Total ({allPatients.length} patients):</span><span>₹{finalAmount}</span></div>
                )}
                <div className="flex justify-between"><span className="text-gray-600">Total Paid:</span><span className="font-semibold text-green-700">₹{paidAmount}</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Total Due:</span><span className={`font-semibold ${dueAmount > 0 ? 'text-red-600' : 'text-green-700'}`}>₹{dueAmount}</span></div>
                {modeStr && <div className="flex justify-between"><span className="text-gray-600">Mode:</span><span className="font-semibold">{modeStr}</span></div>}
              </div>

              {/* Footer */}
              <div className="text-center border-t border-gray-300 pt-1">
                <p className="text-[9px] text-gray-400">Thank you for choosing PH PathLabs</p>
                <p className="text-[9px] text-gray-400">(F) = Fasting Required</p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => { setFinalReviewOpen(false); setReviewOpen(true); }}>
                Go Back
              </Button>
              <Button className="flex-1 gap-1.5" onClick={handleSaveAndShare} disabled={isPending}>
                💾 Save & Share
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* DUE Confirmation Dialog */}
      <Dialog open={dueConfirmOpen} onOpenChange={(o) => { if (!o) { setDueConfirmOpen(false); setDueConfirmText(""); } }}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Entire Amount Due</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The entire amount of <span className="font-semibold text-destructive">₹{finalAmount}</span> will be marked as due. Type <span className="font-bold">DUE</span> below to confirm.
            </p>
            <Input
              value={dueConfirmText}
              onChange={(e) => setDueConfirmText(e.target.value.toUpperCase())}
              placeholder='Type "DUE" to confirm'
              className="text-center font-semibold tracking-widest"
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setDueConfirmOpen(false); setDueConfirmText(""); }}>
                Cancel
              </Button>
              <Button variant="destructive" className="flex-1" onClick={handleDueConfirm} disabled={dueConfirmText.trim() !== "DUE"}>
                Confirm Due
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default PaymentDetailsDialog;
