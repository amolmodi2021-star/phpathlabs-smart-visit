import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { recordPayment } from "@/lib/pickupBilling";
import { getCurrentUser } from "@/lib/auth";
import { toast } from "sonner";
import { format } from "date-fns";

const MODES = ["Cash", "GPay", "Paytm", "Credit Card", "NEFT", "Cheque"];

interface Props {
  open: boolean;
  onClose: () => void;
  invoiceId: string | null;
  invoiceNumber?: string;
  dueAmount?: number;
}

const PickupPaymentDialog = ({ open, onClose, invoiceId, invoiceNumber, dueAmount }: Props) => {
  const qc = useQueryClient();
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("NEFT");
  const [reference, setReference] = useState("");
  const [remarks, setRemarks] = useState("");

  useEffect(() => {
    if (open) {
      setDate(format(new Date(), "yyyy-MM-dd"));
      setAmount(dueAmount ? String(dueAmount) : "");
      setMode("NEFT");
      setReference("");
      setRemarks("");
    }
  }, [open, dueAmount]);

  const save = useMutation({
    mutationFn: async () => {
      if (!invoiceId) throw new Error("No invoice");
      const amt = parseFloat(amount);
      if (!amt || amt <= 0) throw new Error("Enter a valid amount");
      await recordPayment({
        invoice_id: invoiceId,
        payment_date: date,
        amount: amt,
        payment_mode: mode,
        reference_no: reference.trim() || undefined,
        remarks: remarks.trim() || undefined,
        recorded_by: getCurrentUser()?.display_name || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pickup_invoices"] });
      qc.invalidateQueries({ queryKey: ["pickup_invoice_payments"] });
      toast.success("Payment recorded");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Payment {invoiceNumber ? `— ${invoiceNumber}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label>Amount (₹)</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
              {dueAmount !== undefined && (
                <p className="text-xs text-muted-foreground mt-1">Due: ₹{dueAmount.toFixed(2)}</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Mode</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reference / UTR / Cheque #</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Remarks</Label>
            <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
          <Button className="w-full" onClick={() => save.mutate()} disabled={save.isPending}>
            Save Payment
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PickupPaymentDialog;
