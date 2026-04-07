import { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Save, Ban, RotateCcw } from "lucide-react";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";

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

  // Cancel / Refund
  const [cancelledTestIds, setCancelledTestIds] = useState<Set<string>>(new Set());
  const [refundMode, setRefundMode] = useState<string>("Cash");
  const [showCancelBillPwd, setShowCancelBillPwd] = useState(false);
  const [showRefundPwd, setShowRefundPwd] = useState(false);
  const [saving, setSaving] = useState(false);

  // Populate on open
  useEffect(() => {
    if (reg && open) {
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
      const existing = Array.isArray(reg.cancelled_tests) ? reg.cancelled_tests : [];
      setCancelledTestIds(new Set(existing.map((t: any) => t.test_id || t)));
      setRefundMode("Cash");
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

  if (!reg) return null;

  const handleSaveDetails = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from("patient_registrations").update({
        patient_name: patientName.toUpperCase(),
        title,
        gender,
        dob: dob || null,
        email: email || null,
        doctor_name: (doctorName || "SELF").toUpperCase(),
        umr_number: umrNumber || null,
        address: address.toUpperCase(),
        mobile_number: mobileNumber.replace(/\D/g, "").slice(-10),
        status,
      } as any).eq("id", reg.id);
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
                <Input value={patientName} onChange={e => setPatientName(e.target.value)} disabled={isBillCancelled} />
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Doctor Name</Label>
                <Input value={doctorName} onChange={e => setDoctorName(e.target.value)} disabled={isBillCancelled} />
              </div>
              <div>
                <Label>UMR Number</Label>
                <Input value={umrNumber} onChange={e => setUmrNumber(e.target.value)} disabled={isBillCancelled} />
              </div>
            </div>
            <div>
              <Label>Address</Label>
              <Input value={address} onChange={e => setAddress(e.target.value)} disabled={isBillCancelled} />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus} disabled={isBillCancelled}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="registered">Registered</SelectItem>
                  <SelectItem value="sample_collected">Sample Collected</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {!isBillCancelled && (
              <Button onClick={handleSaveDetails} disabled={saving} className="w-full">
                <Save className="h-4 w-4 mr-2" />Save Details
              </Button>
            )}
          </div>

          <Separator />

          {/* Tests & Cancellation */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm">Tests ({tests.length})</h3>
            <div className="space-y-2">
              {tests.map((t: any, i: number) => {
                const isCancelled = alreadyCancelled.has(t.test_id);
                const isNewCancel = cancelledTestIds.has(t.test_id) && !isCancelled;
                return (
                  <div key={t.test_id || i} className={`flex items-center gap-3 p-2 rounded border ${isCancelled ? "bg-destructive/10 line-through opacity-60" : isNewCancel ? "bg-yellow-50 border-yellow-300" : ""}`}>
                    {!isBillCancelled && !isCancelled && (
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
                    <span className="text-sm font-medium">₹{t.discounted_price || t.price}</span>
                    {isCancelled && <Badge variant="destructive" className="text-xs">Cancelled</Badge>}
                  </div>
                );
              })}
            </div>

            {!isBillCancelled && newlyCancelled.length > 0 && (
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
          </div>

          <Separator />

          {/* Bill Summary */}
          <div className="space-y-2 text-sm">
            <h3 className="font-semibold">Bill Summary</h3>
            <div className="flex justify-between"><span>Gross Amount:</span><span>₹{reg.gross_amount}</span></div>
            {reg.discount_amount > 0 && <div className="flex justify-between text-green-600"><span>Discount:</span><span>-₹{reg.discount_amount}</span></div>}
            {reg.home_visit_charges > 0 && <div className="flex justify-between"><span>Home Visit Charges:</span><span>+₹{reg.home_visit_charges}</span></div>}
            <div className="flex justify-between font-bold border-t pt-1"><span>Final Amount:</span><span>₹{reg.final_amount}</span></div>
            <div className="flex justify-between"><span>Paid:</span><span>₹{reg.paid_amount}</span></div>
            {reg.due_amount > 0 && <div className="flex justify-between text-destructive font-bold"><span>Due:</span><span>₹{reg.due_amount}</span></div>}
            {reg.refund_amount > 0 && <div className="flex justify-between text-orange-600"><span>Refunded:</span><span>₹{reg.refund_amount}</span></div>}
          </div>

          {/* Cancel Bill */}
          {!isBillCancelled && (
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
    </>
  );
};

export default EditRegistrationDialog;
