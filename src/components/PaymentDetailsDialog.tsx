import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";

interface PaymentDetailsDialogProps {
  open: boolean;
  onClose: () => void;
  finalAmount: number;
  onSave: (data: { paid_amount: number; due_amount: number; payment_mode: string; payment_remarks: string }) => void;
  isPending?: boolean;
  /** If provided, dialog is in edit mode with pre-filled values */
  initialData?: { paid_amount: number; payment_mode: string; payment_remarks: string };
}

const PAYMENT_MODES = ["Cash", "GPay", "Paytm", "Credit Card"];

const PaymentDetailsDialog = ({ open, onClose, finalAmount, onSave, isPending, initialData }: PaymentDetailsDialogProps) => {
  const [paidAmount, setPaidAmount] = useState(initialData?.paid_amount ?? 0);
  const [paymentMode, setPaymentMode] = useState(initialData?.payment_mode ?? "");
  const [remarks, setRemarks] = useState(initialData?.payment_remarks ?? "");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const dueAmount = useMemo(() => Math.max(0, finalAmount - paidAmount), [finalAmount, paidAmount]);

  const handleSave = () => {
    if (!paymentMode) {
      toast.error("Please select a payment mode");
      return;
    }
    setConfirmOpen(true);
  };

  const confirmSave = () => {
    setConfirmOpen(false);
    onSave({
      paid_amount: paidAmount,
      due_amount: dueAmount,
      payment_mode: paymentMode,
      payment_remarks: remarks,
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{initialData ? "Edit Payment Details" : "Payment Details"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Final Amount</Label>
              <Input value={`₹${finalAmount}`} disabled className="font-semibold" />
            </div>
            <div>
              <Label>Paid Amount *</Label>
              <Input
                type="number"
                value={paidAmount || ""}
                onChange={(e) => setPaidAmount(parseFloat(e.target.value) || 0)}
                placeholder="Enter paid amount"
                min={0}
              />
            </div>
            <div>
              <Label>Due Amount</Label>
              <Input value={`₹${dueAmount}`} disabled className={dueAmount > 0 ? "text-destructive font-semibold" : "text-success font-semibold"} />
            </div>
            <div>
              <Label>Payment Mode *</Label>
              <Select value={paymentMode} onValueChange={setPaymentMode}>
                <SelectTrigger><SelectValue placeholder="Select payment mode" /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>{mode}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
