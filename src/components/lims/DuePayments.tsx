import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import InvoicePreview from "./InvoicePreview";

const PAYMENT_MODES = ["Cash", "GPay", "Paytm", "Credit Card", "UPI", "Online"];

const DuePayments = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [collectOpen, setCollectOpen] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [payMode, setPayMode] = useState("Cash");
  const [payAmount, setPayAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [badDebtConfirm, setBadDebtConfirm] = useState<any>(null);
  const [invoiceData, setInvoiceData] = useState<any>(null);

  const { data: patients = [], isLoading } = useQuery({
    queryKey: ["lims-due-payments", search],
    queryFn: async () => {
      let q = supabase
        .from("patient_registrations")
        .select("id, invoice_number, patient_name, mobile_number, doctor_name, created_at, net_amount, paid_amount, due_amount, payments, is_bad_debt, bill_cancelled, title, gender, dob, email, address, umr_number, visit_type, tests, gross_amount, discount_amount, home_visit_charges, final_amount, refund_amount, refund_mode, refund_date, cancelled_tests, global_discount_type, global_discount_value, remarks, registered_by")
        .gt("due_amount", 0)
        .eq("is_bad_debt", false)
        .eq("bill_cancelled", false)
        .order("created_at", { ascending: false });

      if (search.trim()) {
        q = q.or(`patient_name.ilike.%${search.trim()}%,mobile_number.ilike.%${search.trim()}%,invoice_number.ilike.%${search.trim()}%`);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const openCollect = (p: any) => {
    setSelected(p);
    setPayAmount(String(p.due_amount));
    setPayMode("Cash");
    setCollectOpen(true);
  };

  const handleCollect = async () => {
    if (!selected) return;
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0 || amount > selected.due_amount) {
      toast.error("Enter a valid amount up to the due amount");
      return;
    }
    setSaving(true);
    try {
      const existingPayments = Array.isArray(selected.payments) ? selected.payments : [];
      const newPayments = [...existingPayments, { mode: payMode, amount, date: new Date().toISOString() }];
      const newPaid = (selected.paid_amount || 0) + amount;
      const newDue = (selected.due_amount || 0) - amount;

      const { error } = await supabase
        .from("patient_registrations")
        .update({
          payments: newPayments,
          paid_amount: newPaid,
          due_amount: Math.max(0, newDue),
        })
        .eq("id", selected.id);

      if (error) throw error;
      toast.success("Payment collected successfully");
      setCollectOpen(false);
      // Show updated invoice
      setInvoiceData({
        ...selected,
        payments: newPayments,
        paid_amount: newPaid,
        due_amount: Math.max(0, newDue),
      });
      queryClient.invalidateQueries({ queryKey: ["lims-due-payments"] });
      queryClient.invalidateQueries({ queryKey: ["lims-dispatch"] });
      queryClient.invalidateQueries({ queryKey: ["lims-registrations"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to collect payment");
    } finally {
      setSaving(false);
    }
  };

  const handleMarkBadDebt = async (p: any) => {
    try {
      const { error } = await supabase
        .from("patient_registrations")
        .update({ is_bad_debt: true })
        .eq("id", p.id);
      if (error) throw error;
      toast.success("Marked as bad debt");
      setBadDebtConfirm(null);
      queryClient.invalidateQueries({ queryKey: ["lims-due-payments"] });
      queryClient.invalidateQueries({ queryKey: ["lims-bad-debts"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to mark as bad debt");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 max-w-md">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, mobile, invoice..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : patients.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">No due payments found.</p>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Patient Name</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>Doctor</TableHead>
                <TableHead>Registration Date</TableHead>
                <TableHead className="text-right">Net Amount</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Due</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {patients.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.invoice_number}</TableCell>
                  <TableCell className="font-medium">{p.patient_name}</TableCell>
                  <TableCell>{p.mobile_number}</TableCell>
                  <TableCell>{p.doctor_name || "-"}</TableCell>
                  <TableCell>{format(new Date(p.created_at), "dd/MM/yyyy HH:mm")}</TableCell>
                  <TableCell className="text-right">₹{p.net_amount}</TableCell>
                  <TableCell className="text-right">₹{p.paid_amount}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="destructive">₹{p.due_amount}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" onClick={() => openCollect(p)}>Collect</Button>
                      <Button size="sm" variant="outline" onClick={() => setBadDebtConfirm(p)}>
                        Bad Debt
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Collect Payment Dialog */}
      <Dialog open={collectOpen} onOpenChange={setCollectOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Collect Payment</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="text-sm space-y-1">
                <p><strong>{selected.patient_name}</strong></p>
                <p>Invoice: {selected.invoice_number}</p>
                <p>Due: <span className="text-destructive font-semibold">₹{selected.due_amount}</span></p>
              </div>
              <div className="space-y-2">
                <Label>Payment Mode</Label>
                <Select value={payMode} onValueChange={setPayMode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Amount (₹)</Label>
                <Input
                  type="number"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  max={selected.due_amount}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCollectOpen(false)}>Cancel</Button>
            <Button onClick={handleCollect} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Collect Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bad Debt Confirmation */}
      <Dialog open={!!badDebtConfirm} onOpenChange={() => setBadDebtConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" /> Mark as Bad Debt
            </DialogTitle>
          </DialogHeader>
          {badDebtConfirm && (
            <div className="space-y-2 text-sm">
              <p>Are you sure you want to mark this as bad debt?</p>
              <p><strong>{badDebtConfirm.patient_name}</strong> — Invoice: {badDebtConfirm.invoice_number}</p>
              <p>Due: <span className="text-destructive font-semibold">₹{badDebtConfirm.due_amount}</span></p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBadDebtConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => handleMarkBadDebt(badDebtConfirm)}>
              Confirm Bad Debt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Invoice Preview after payment */}
      <InvoicePreview
        data={invoiceData}
        open={!!invoiceData}
        onClose={() => setInvoiceData(null)}
      />
    </div>
  );
};

export default DuePayments;
