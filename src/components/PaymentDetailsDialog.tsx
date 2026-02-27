import { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";

interface PaymentDetailsDialogProps {
  open: boolean;
  onClose: () => void;
  finalAmount: number;
  onSave: (data: { paid_amount: number; due_amount: number; payment_mode: string; payment_remarks: string }) => void;
  isPending?: boolean;
  initialData?: { paid_amount: number; payment_mode: string; payment_remarks: string };
}

const PAYMENT_MODES = ["Cash", "GPay", "Paytm", "Credit Card"];

const PaymentDetailsDialog = ({ open, onClose, finalAmount, onSave, isPending, initialData }: PaymentDetailsDialogProps) => {
  const [selectedModes, setSelectedModes] = useState<Set<string>>(new Set());
  const [modeAmounts, setModeAmounts] = useState<Record<string, number>>({});
  const [remarks, setRemarks] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Initialize from initialData
  useEffect(() => {
    if (initialData) {
      const modes = initialData.payment_mode ? initialData.payment_mode.split(", ") : [];
      const newModes = new Set<string>();
      const newAmounts: Record<string, number> = {};

      // Parse "Cash: 500, GPay: 500" format
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

  const handleSave = () => {
    if (selectedModes.size === 0) {
      toast.error("Please select at least one payment mode");
      return;
    }
    if (paidAmount <= 0) {
      toast.error("Enter paid amount");
      return;
    }
    setConfirmOpen(true);
  };

  const confirmSave = () => {
    setConfirmOpen(false);
    // Format: "Cash: ₹500, GPay: ₹500"
    const modeStr = Array.from(selectedModes)
      .filter(m => (modeAmounts[m] || 0) > 0)
      .map(m => `${m}: ₹${modeAmounts[m] || 0}`)
      .join(", ");

    onSave({
      paid_amount: paidAmount,
      due_amount: dueAmount,
      payment_mode: modeStr,
      payment_remarks: remarks,
    });
  };

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
              Save & Mark Completed
            </Button>
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
    </>
  );
};

export default PaymentDetailsDialog;
