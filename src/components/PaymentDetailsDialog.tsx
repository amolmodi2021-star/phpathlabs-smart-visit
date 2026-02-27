import { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

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

const PaymentDetailsDialog = ({ open, onClose, finalAmount, onSave, isPending, initialData, visitData }: PaymentDetailsDialogProps) => {
  const [selectedModes, setSelectedModes] = useState<Set<string>>(new Set());
  const [modeAmounts, setModeAmounts] = useState<Record<string, number>>({});
  const [remarks, setRemarks] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dueConfirmOpen, setDueConfirmOpen] = useState(false);
  const [dueConfirmText, setDueConfirmText] = useState("");

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
    setConfirmOpen(true);
  };

  const confirmSave = () => {
    setConfirmOpen(false);
    onSave({
      paid_amount: paidAmount,
      due_amount: dueAmount,
      payment_mode: modeStr,
      payment_remarks: remarks,
    });
  };

  const est = visitData?.estimates;
  const tests = est?.estimate_tests || [];

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
                {Array.from(selectedModes).map((mode) => (
                  <div key={mode}>
                    <Label className="text-xs">{mode} Amount</Label>
                    <Input
                      type="number"
                      value={modeAmounts[mode] || ""}
                      onChange={(e) => setModeAmounts(prev => ({ ...prev, [mode]: parseFloat(e.target.value) || 0 }))}
                      placeholder={`Enter ${mode} amount`}
                      min={0}
                    />
                  </div>
                ))}
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
           {/* Patient Info */}
            <div className="space-y-1">
              <h4 className="font-semibold text-xs text-muted-foreground uppercase tracking-wide">Patient Information</h4>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <span className="text-muted-foreground">Name:</span>
                <span className="font-medium">{[est?.title, est?.patient_name].filter(Boolean).join(" ") || "—"}</span>
                <span className="text-muted-foreground">Gender:</span>
                <span className="font-medium">{est?.gender || "—"}</span>
                <span className="text-muted-foreground">DOB:</span>
                <span className="font-medium">{est?.dob ? new Date(est.dob).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</span>
                <span className="text-muted-foreground">Age:</span>
                <span className="font-medium">{est?.dob ? `${Math.floor((Date.now() - new Date(est.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000))} years` : "—"}</span>
                <span className="text-muted-foreground">Mobile:</span>
                <span className="font-medium">{est?.whatsapp_number || "—"}</span>
                {est?.email && (
                  <>
                    <span className="text-muted-foreground">Email:</span>
                    <span className="font-medium">{est.email}</span>
                  </>
                )}
                <span className="text-muted-foreground">Doctor:</span>
                <span className="font-medium">{est?.doctor_name || "SELF"}</span>
                {est?.umr_number && (
                  <>
                    <span className="text-muted-foreground">UMR No:</span>
                    <span className="font-medium">{est.umr_number}</span>
                  </>
                )}
              </div>
            </div>

            <Separator />

            {/* Visit Info */}
            <div className="space-y-1">
              <h4 className="font-semibold text-xs text-muted-foreground uppercase tracking-wide">Visit Details</h4>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <span className="text-muted-foreground">Date:</span>
                <span className="font-medium">{visitData?.visit_date ? new Date(visitData.visit_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</span>
                <span className="text-muted-foreground">Time:</span>
                <span className="font-medium">{visitData?.visit_time ? formatTime12hr(visitData.visit_time) : "—"}</span>
                <span className="text-muted-foreground">Address:</span>
                <span className="font-medium">{visitData?.address || "—"}</span>
                <span className="text-muted-foreground">Phlebotomist:</span>
                <span className="font-medium">{visitData?.phlebotomists?.name || "Not assigned"}</span>
              </div>
            </div>

            <Separator />

            {/* Tests */}
            <div className="space-y-1">
              <h4 className="font-semibold text-xs text-muted-foreground uppercase tracking-wide">Tests ({tests.length})</h4>
              <div className="bg-muted/30 rounded p-2 space-y-1.5">
                {tests.map((t, i) => (
                  <div key={i} className="text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">{i + 1}.</span>
                        <span>{t.test_name}</span>
                        {t.fasting_required && <Badge variant="outline" className="text-[10px] px-1 py-0">Fasting</Badge>}
                      </div>
                      <div className="flex items-center gap-2">
                        {t.price !== t.discounted_price && (
                          <span className="line-through text-muted-foreground">₹{t.price}</span>
                        )}
                        <span className="font-medium">₹{t.discounted_price}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Financials */}
            <div className="space-y-1">
              <h4 className="font-semibold text-xs text-muted-foreground uppercase tracking-wide">Amount Details</h4>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <span className="text-muted-foreground">Total Amount:</span>
                <span className="font-medium">₹{est?.total_amount || 0}</span>
                {(est?.discount_amount || 0) > 0 && (
                  <>
                    <span className="text-muted-foreground">Discount:</span>
                    <span className="font-medium text-emerald-600 dark:text-emerald-400">
                      -₹{est?.discount_amount}
                    </span>
                  </>
                )}
                <span className="text-muted-foreground">Home Visit Charges:</span>
                <span className="font-medium">₹{est?.home_visit_charges || 0}</span>
                <span className="text-muted-foreground font-semibold">Final Amount:</span>
                <span className="font-bold text-primary">₹{est?.final_amount || 0}</span>
              </div>
            </div>

            <Separator />

            {/* Payment */}
            <div className="space-y-1">
              <h4 className="font-semibold text-xs text-muted-foreground uppercase tracking-wide">Payment Details</h4>
              <div className="grid grid-cols-2 gap-1">
                <span className="text-muted-foreground">Paid Amount:</span>
                <span className="font-medium">₹{paidAmount}</span>
                <span className="text-muted-foreground">Due Amount:</span>
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

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setReviewOpen(false)}>
                Go Back & Edit
              </Button>
              <Button className="flex-1" onClick={handleReviewConfirm}>
                Confirm & Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Completion</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The visit will be marked as Completed with the payment details you entered. Are you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSave}>Yes, Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
