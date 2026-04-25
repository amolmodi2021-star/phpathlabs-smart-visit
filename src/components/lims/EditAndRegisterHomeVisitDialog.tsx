import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { X, Search } from "lucide-react";
import { getAllSelectableTests } from "@/lib/allSelectableTests";
import { buildSampleTubeGroups } from "@/lib/sampleTubeGrouping";
import { format, parse, isValid, differenceInYears } from "date-fns";
import { logPaymentTransaction } from "@/lib/paymentTransactions";
import { getCurrentUser } from "@/lib/auth";

interface EditTest {
  test_id: string;
  test_name: string;
  price: number;
  fasting_required: boolean;
  discount_applicable: boolean;
  individual_discount_type: "percent" | "amount" | null;
  individual_discount_value: number;
  item_type?: "test" | "profile" | "package" | "combo";
}

interface Props {
  visit: any;
  open: boolean;
  onClose: () => void;
}

const PAYMENT_MODES = ["Cash", "Card", "GPay", "Paytm", "NEFT", "Credit"];

const EditAndRegisterHomeVisitDialog = ({ visit, open, onClose }: Props) => {
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const est = visit?.estimates;

  const [title, setTitle] = useState("");
  const [patientName, setPatientName] = useState("");
  const [gender, setGender] = useState("");
  const [email, setEmail] = useState("");
  const [doctorName, setDoctorName] = useState("SELF");
  const [umrInput, setUmrInput] = useState("");
  const [dob, setDob] = useState("");
  const [dobDisplay, setDobDisplay] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [address, setAddress] = useState("");
  const [selectedTests, setSelectedTests] = useState<EditTest[]>([]);
  const [globalDiscountType, setGlobalDiscountType] = useState<"percent" | "amount">("percent");
  const [globalDiscountValue, setGlobalDiscountValue] = useState(0);
  const [homeVisitCharges, setHomeVisitCharges] = useState("0");
  const [testSearch, setTestSearch] = useState("");
  const [testHighlightIndex, setTestHighlightIndex] = useState(-1);
  const [attempted, setAttempted] = useState(false);
  const [genderConfirmOpen, setGenderConfirmOpen] = useState(false);
  const [pendingGender, setPendingGender] = useState<"Male" | "Female" | "">("");

  // Payment fields
  const [paymentModes, setPaymentModes] = useState<{ mode: string; amount: string }[]>([{ mode: "Cash", amount: "" }]);

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (val === "Mr." || val === "Master.") setGender("Male");
    else if (val === "Mrs." || val === "Ms." || val === "Miss.") setGender("Female");
    else if (val === "Dr." || val === "Baby Of.") { setGenderConfirmOpen(true); setPendingGender(""); }
  };

  const { data: allTests = [] } = useQuery({ queryKey: ["all_selectable_tests"], queryFn: getAllSelectableTests });
  const { data: phlebotomists = [] } = useQuery({
    queryKey: ["phlebotomists", "active"],
    queryFn: async () => { const { data } = await supabase.from("phlebotomists").select("*").eq("status", "Active"); return data || []; },
  });

  const dobToDisplay = (isoDate: string) => {
    if (!isoDate) return "";
    const d = new Date(isoDate);
    return isValid(d) ? format(d, "dd-MM-yyyy") : "";
  };

  const handleDobDisplayChange = (val: string) => {
    let cleaned = val.replace(/[^\d-]/g, "");
    const digits = cleaned.replace(/-/g, "");
    if (digits.length >= 4) cleaned = `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 8)}`;
    else if (digits.length >= 2) cleaned = `${digits.slice(0, 2)}-${digits.slice(2)}`;
    setDobDisplay(cleaned);
    if (/^\d{2}-\d{2}-\d{4}$/.test(cleaned)) {
      const parsed = parse(cleaned, "dd-MM-yyyy", new Date());
      if (isValid(parsed) && parsed <= new Date()) setDob(format(parsed, "yyyy-MM-dd"));
      else setDob("");
    } else setDob("");
  };

  const calculatedAge = useMemo(() => {
    if (!dob) return "";
    const d = new Date(dob);
    return isValid(d) ? String(differenceInYears(new Date(), d)) : "";
  }, [dob]);

  // Populate form
  useEffect(() => {
    if (!visit || !est) return;
    setTitle(est.title || "");
    setPatientName(est.patient_name || "");
    setGender(est.gender || "");
    setEmail(est.email || "");
    setDoctorName(est.doctor_name || "SELF");
    const rawUmr = est.umr_number || "";
    setUmrInput(rawUmr.startsWith("UMR") ? String(parseInt(rawUmr.slice(3)) || "") : rawUmr);
    setDob(est.dob || "");
    setDobDisplay(dobToDisplay(est.dob || ""));
    setWhatsappNumber(est.whatsapp_number || "");
    setAddress(visit.address || "");
    setGlobalDiscountType((est.global_discount_type as "percent" | "amount") || "percent");
    setGlobalDiscountValue(Number(est.global_discount_value) || 0);
    setHomeVisitCharges(String(Number(est.home_visit_charges) || 0));
    setAttempted(false);

    // Load tests from estimate_tests
    const existingTests: EditTest[] = (est.estimate_tests || []).map((t: any) => ({
      test_id: t.test_id,
      test_name: t.test_name,
      price: Number(t.price),
      fasting_required: t.fasting_required,
      discount_applicable: t.discount_applicable,
      individual_discount_type: t.individual_discount_type || null,
      individual_discount_value: Number(t.individual_discount_value) || 0,
      item_type: t.item_type || "test",
    }));
    setSelectedTests(existingTests);
    setTestSearch("");

    // Parse payment modes from visit
    const payments: { mode: string; amount: string }[] = [];
    if (visit.payment_mode) {
      const parts = visit.payment_mode.split(",").map((p: string) => p.trim());
      for (const part of parts) {
        const match = part.match(/^(.+?):\s*₹?(\d+(?:\.\d+)?)$/);
        if (match) payments.push({ mode: match[1].trim(), amount: match[2] });
      }
    }
    if (payments.length === 0 && Number(visit.paid_amount) > 0) {
      payments.push({ mode: "Cash", amount: String(visit.paid_amount) });
    }
    if (payments.length === 0) payments.push({ mode: "Cash", amount: "" });
    setPaymentModes(payments);
  }, [visit, est]);

  // Fetch estimate_tests if not embedded
  const { data: fetchedEstTests = [] } = useQuery({
    queryKey: ["estimate_tests_for_edit", est?.id],
    enabled: !!est?.id && (!est?.estimate_tests || est.estimate_tests.length === 0),
    queryFn: async () => {
      const { data } = await supabase.from("estimate_tests").select("*").eq("estimate_id", est.id);
      return data || [];
    },
  });

  useEffect(() => {
    if (fetchedEstTests.length > 0 && selectedTests.length === 0) {
      setSelectedTests(fetchedEstTests.map((t: any) => ({
        test_id: t.test_id, test_name: t.test_name, price: Number(t.price),
        fasting_required: t.fasting_required, discount_applicable: t.discount_applicable,
        individual_discount_type: t.individual_discount_type || null,
        individual_discount_value: Number(t.individual_discount_value) || 0,
        item_type: t.item_type || "test",
      })));
    }
  }, [fetchedEstTests]);

  const availableTests = allTests.filter((t: any) =>
    !selectedTests.find(s => s.test_id === t.id) &&
    (testSearch === "" || t.test_name.toLowerCase().includes(testSearch.toLowerCase()))
  );

  const addTest = (testId: string) => {
    const t = allTests.find((x: any) => x.id === testId);
    if (!t || selectedTests.find(s => s.test_id === testId)) return;
    setSelectedTests(prev => [...prev, {
      test_id: t.id, test_name: t.test_name, price: Number(t.price),
      fasting_required: t.fasting_required, discount_applicable: t.discount_applicable,
      individual_discount_type: null, individual_discount_value: 0,
      item_type: (t as any).item_type || "test",
    }]);
    setTestSearch("");
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const removeTest = (testId: string) => setSelectedTests(prev => prev.filter(t => t.test_id !== testId));

  const updateTestDiscount = (testId: string, field: string, value: any) => {
    setSelectedTests(prev => prev.map(t => t.test_id === testId ? { ...t, [field]: value } : t));
  };

  const calculations = useMemo(() => {
    let totalAmount = 0;
    let totalDiscount = 0;
    const testDetails = selectedTests.map(t => {
      totalAmount += t.price;
      let discount = 0;
      const hasIndividual = t.individual_discount_type && t.individual_discount_value > 0 && t.discount_applicable;
      if (hasIndividual) {
        discount = t.individual_discount_type === "percent" ? (t.price * t.individual_discount_value) / 100 : t.individual_discount_value;
      } else if (t.discount_applicable && globalDiscountValue > 0) {
        discount = globalDiscountType === "percent" ? (t.price * globalDiscountValue) / 100 : globalDiscountValue;
      }
      discount = Math.min(discount, t.price);
      totalDiscount += discount;
      return { ...t, discountedPrice: t.price - discount, discount };
    });
    const hvCharges = parseFloat(homeVisitCharges) || 0;
    const finalAmount = totalAmount - totalDiscount + hvCharges;
    return { totalAmount, totalDiscount, finalAmount, testDetails, hvCharges };
  }, [selectedTests, globalDiscountType, globalDiscountValue, homeVisitCharges]);

  const totalPaid = paymentModes.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const dueAmount = Math.max(0, calculations.finalAmount - totalPaid);

  const addPaymentMode = () => setPaymentModes(prev => [...prev, { mode: "Cash", amount: "" }]);
  const removePaymentMode = (idx: number) => setPaymentModes(prev => prev.filter((_, i) => i !== idx));
  const updatePaymentMode = (idx: number, field: "mode" | "amount", value: string) => {
    setPaymentModes(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };

  const registerMutation = useMutation({
    mutationFn: async () => {
      setAttempted(true);
      if (!title) throw new Error("Title is required");
      if (!patientName.trim()) throw new Error("Patient name is required");
      if (!whatsappNumber || whatsappNumber.replace(/\D/g, "").length < 10) throw new Error("Valid mobile number required");
      if (!dob) throw new Error("Date of birth is required");
      if (!gender) throw new Error("Gender is required");
      if (selectedTests.length === 0) throw new Error("Select at least one test");
      if (!address.trim()) throw new Error("Address is required");

      const cleanNumber = whatsappNumber.replace(/\D/g, "").slice(-10);
      const formattedUmr = umrInput ? `UMR${String(parseInt(umrInput) || 0).padStart(7, "0")}` : null;

      // Update estimate
      await supabase.from("estimates").update({
        title: title || null,
        patient_name: patientName.replace(/\s+/g, ' ').trim().toUpperCase(),
        gender: gender || null,
        email: email || null,
        doctor_name: doctorName ? doctorName.toUpperCase() : "SELF",
        umr_number: formattedUmr,
        dob: dob || null,
        whatsapp_number: cleanNumber,
        total_amount: calculations.totalAmount,
        discount_amount: calculations.totalDiscount,
        home_visit_charges: calculations.hvCharges,
        final_amount: calculations.finalAmount,
        global_discount_type: globalDiscountValue > 0 ? globalDiscountType : null,
        global_discount_value: globalDiscountValue,
      }).eq("id", est.id);

      // Delete old estimate_tests and re-insert
      await supabase.from("estimate_tests").delete().eq("estimate_id", est.id);
      const testRows = calculations.testDetails.map(t => ({
        estimate_id: est.id,
        test_id: t.test_id, test_name: t.test_name, price: t.price,
        fasting_required: t.fasting_required, discount_applicable: t.discount_applicable,
        individual_discount_type: t.individual_discount_type,
        individual_discount_value: t.individual_discount_value,
        discounted_price: t.discountedPrice,
        item_type: (t as any).item_type || "test",
      }));
      await supabase.from("estimate_tests").insert(testRows);

      // Build test list for registration
      const regTests = calculations.testDetails.map(t => ({
        test_id: t.test_id, test_name: t.test_name, price: t.price,
        discounted_price: t.discountedPrice,
        discount_applicable: t.discount_applicable, fasting_required: t.fasting_required,
      }));

      // Build payments
      const payments = paymentModes
        .filter(p => parseFloat(p.amount) > 0)
        .map(p => ({ mode: p.mode, amount: parseFloat(p.amount) }));

      // Payment mode string for home_visits table
      const paymentModeStr = payments.map(p => `${p.mode}: ₹${p.amount}`).join(", ");

      // Generate invoice & UMR
      const { data: invNum } = await supabase.rpc("generate_invoice_number");
      let umrNumber = formattedUmr;
      if (!umrNumber) {
        const { data: umr } = await supabase.rpc("generate_umr_number");
        umrNumber = umr;
      }

      const { data: insertedReg, error } = await supabase.from("patient_registrations").insert({
        invoice_number: invNum,
        patient_name: patientName.replace(/\s+/g, ' ').trim().toUpperCase(),
        mobile_number: cleanNumber,
        title: title || null,
        gender: gender || null,
        dob: dob || null,
        email: email || null,
        doctor_name: doctorName ? doctorName.toUpperCase() : "SELF",
        umr_number: umrNumber,
        address: address.toUpperCase(),
        visit_type: "home_visit",
        tests: regTests,
        gross_amount: calculations.totalAmount,
        discount_amount: calculations.totalDiscount,
        net_amount: calculations.totalAmount - calculations.totalDiscount,
        home_visit_charges: calculations.hvCharges,
        final_amount: calculations.finalAmount,
        paid_amount: totalPaid,
        due_amount: dueAmount,
        payments: payments,
        status: "registered",
        home_visit_id: visit.id,
        global_discount_type: globalDiscountValue > 0 ? globalDiscountType : null,
        global_discount_value: globalDiscountValue,
        registered_by: getCurrentUser()?.display_name || getCurrentUser()?.username || null,
      } as any).select().single();
      if (error) throw error;

      // Create sample_tubes for this registration (expands profiles/checkups to leaf tests)
      try {
        const groups = await buildSampleTubeGroups(
          calculations.testDetails.map((t: any) => ({
            test_id: t.test_id,
            test_name: t.test_name,
            item_type: (t as any).item_type || "test",
          })),
        );

        for (const g of groups) {
          const { data: uid } = await supabase.rpc("generate_sample_uid" as any);
          await supabase.from("sample_tubes" as any).insert({
            sample_uid: uid as string,
            registration_id: (insertedReg as any).id,
            tube_type: g.tubeType,
            tube_color: g.tubeColor,
            sample_type: g.sampleType,
            suffix: g.suffix,
            test_ids: g.testIds,
            test_names: g.testNames,
            status: "pending",
          });
        }
      } catch (tubeErr: any) {
        console.error("Failed to create sample_tubes:", tubeErr);
        // Non-fatal
      }

      // Log payment transaction (always, even when totalPaid = 0)
      if (insertedReg) {
        logPaymentTransaction({
          registration_id: (insertedReg as any).id,
          invoice_number: (insertedReg as any).invoice_number,
          patient_name: (insertedReg as any).patient_name,
          transaction_type: "registration_payment",
          direction: "in",
          payments,
          total_amount: totalPaid,
          gross_amount: calculations.totalAmount,
          discount_amount: calculations.totalDiscount,
          final_amount: calculations.finalAmount,
          paid_amount: totalPaid,
          due_amount: dueAmount,
        });
      }

      // Update home_visits status and payment
      await supabase.from("home_visits").update({
        status: "Registered",
        address: address.toUpperCase(),
        payment_mode: paymentModeStr || null,
        paid_amount: totalPaid,
        due_amount: dueAmount,
      }).eq("id", visit.id);
    },
    onSuccess: () => {
      toast.success("Home visit edited & registered successfully!");
      qc.invalidateQueries({ queryKey: ["completed_home_visits"] });
      qc.invalidateQueries({ queryKey: ["home_visits"] });
      qc.invalidateQueries({ queryKey: ["registered_home_visit_ids"] });
      qc.invalidateQueries({ queryKey: ["patient_registrations"] });
      qc.invalidateQueries({ queryKey: ["patient_registrations_count"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (!visit) return null;

  const phleboName = phlebotomists.find((p: any) => p.id === visit.phlebotomist_id)?.name || "Not assigned";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit & Register Home Visit</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Read-only visit info */}
          <div className="rounded-lg bg-muted p-3 grid grid-cols-3 gap-2 text-sm">
            <div><span className="font-medium text-muted-foreground">Visit Date:</span> {visit.visit_date ? format(new Date(visit.visit_date), "dd-MM-yyyy") : "—"}</div>
            <div><span className="font-medium text-muted-foreground">Time:</span> {visit.visit_time || "—"}</div>
            <div><span className="font-medium text-muted-foreground">Phlebotomist:</span> {phleboName}</div>
          </div>

          {/* Demographics */}
          <div className="grid grid-cols-[120px_1fr] gap-2">
            <div>
              <Label className={attempted && !title ? "text-destructive" : ""}>Title *</Label>
              <Select value={title} onValueChange={handleTitleChange}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Title" /></SelectTrigger>
                <SelectContent>
                  {["Mr.", "Mrs.", "Ms.", "Miss.", "Master.", "Baby Of.", "Dr."].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className={attempted && !patientName.trim() ? "text-destructive" : ""}>Patient Name *</Label>
              <Input value={patientName} onChange={e => setPatientName(e.target.value.toUpperCase())} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className={attempted && !gender ? "text-destructive" : ""}>Gender *</Label>
              <Select value={gender} onValueChange={setGender}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                  <SelectItem value="Unspecified">Unspecified</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className={attempted && (!whatsappNumber || whatsappNumber.replace(/\D/g, "").length < 10) ? "text-destructive" : ""}>Mobile *</Label>
              <Input type="tel" value={whatsappNumber} onChange={e => setWhatsappNumber(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className={attempted && !dob ? "text-destructive" : ""}>DOB * (dd-mm-yyyy)</Label>
              <Input type="text" inputMode="numeric" value={dobDisplay} onChange={e => handleDobDisplayChange(e.target.value)} placeholder="dd-mm-yyyy" maxLength={10} />
            </div>
            <div>
              <Label>Age</Label>
              <Input readOnly value={calculatedAge} className="bg-muted" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Doctor</Label>
              <Input value={doctorName} onChange={e => setDoctorName(e.target.value.toUpperCase())} />
            </div>
            <div>
              <Label>UMR Number</Label>
              <Input value={umrInput} onChange={e => setUmrInput(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 123 → UMR0000123" />
            </div>
          </div>

          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} />
          </div>

          <div>
            <Label className={attempted && !address.trim() ? "text-destructive" : ""}>Address *</Label>
            <Textarea value={address} onChange={e => setAddress(e.target.value.toUpperCase())} rows={2} />
          </div>

          {/* Tests */}
          <div>
            <Label>Tests *</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input ref={searchRef} value={testSearch} onChange={e => { setTestSearch(e.target.value); setTestHighlightIndex(0); }} placeholder="Search tests... (↑↓ to navigate, Enter to select)" className="pl-8"
                onKeyDown={(e) => {
                  const visible = testSearch ? availableTests.slice(0, 20) : [];
                  if (visible.length === 0) return;
                  if (e.key === "ArrowDown") { e.preventDefault(); setTestHighlightIndex(prev => Math.min(prev + 1, visible.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setTestHighlightIndex(prev => Math.max(prev - 1, 0)); }
                  else if (e.key === "Enter") { e.preventDefault(); const idx = testHighlightIndex >= 0 && testHighlightIndex < visible.length ? testHighlightIndex : 0; addTest(visible[idx].id); setTestHighlightIndex(0); }
                }}
              />
            </div>
            {testSearch && availableTests.length > 0 && (
              <div className="border rounded-md mt-1 max-h-48 overflow-y-auto">
                {availableTests.slice(0, 20).map((t: any, i: number) => (
                  <button key={t.id} type="button" className={`w-full text-left px-3 py-2 text-sm transition-colors ${i === testHighlightIndex ? "bg-accent" : "hover:bg-accent"}`} onClick={() => { addTest(t.id); setTestHighlightIndex(0); }} onMouseEnter={() => setTestHighlightIndex(i)}>
                    {t.test_name} — ₹{t.price}{t.item_type === "package" ? " 📦" : t.item_type === "combo" ? " 🧩" : t.item_type === "profile" ? " 📋" : ""}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedTests.length > 0 && (
            <div className="space-y-1">
              {selectedTests.map(t => (
                <div key={t.test_id} className="flex items-center gap-2 text-sm border rounded px-2 py-1">
                  <span className="flex-1 font-medium truncate">{t.test_name}</span>
                  <span className="text-muted-foreground">₹{t.price}</span>
                  {t.discount_applicable && (
                    <>
                      <Select value={t.individual_discount_type || ""} onValueChange={v => updateTestDiscount(t.test_id, "individual_discount_type", v || null)}>
                        <SelectTrigger className="w-16 h-7 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent><SelectItem value="percent">%</SelectItem><SelectItem value="amount">₹</SelectItem></SelectContent>
                      </Select>
                      {t.individual_discount_type && (
                        <Input type="number" className="w-16 h-7 text-xs" value={t.individual_discount_value || ""} onChange={e => updateTestDiscount(t.test_id, "individual_discount_value", parseFloat(e.target.value) || 0)} />
                      )}
                    </>
                  )}
                  {!t.discount_applicable && <span className="text-xs text-destructive">No disc.</span>}
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeTest(t.test_id)}><X className="h-3 w-3" /></Button>
                </div>
              ))}
            </div>
          )}

          {/* Global Discount */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Global Discount</Label>
              <div className="flex gap-1">
                <Select value={globalDiscountType} onValueChange={(v: any) => setGlobalDiscountType(v)}>
                  <SelectTrigger className="w-16"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="percent">%</SelectItem><SelectItem value="amount">₹</SelectItem></SelectContent>
                </Select>
                <Input type="number" value={globalDiscountValue || ""} onChange={e => setGlobalDiscountValue(parseFloat(e.target.value) || 0)} />
              </div>
            </div>
            <div>
              <Label>Home Visit Charges (₹)</Label>
              <Input type="number" value={homeVisitCharges} onChange={e => setHomeVisitCharges(e.target.value)} />
            </div>
          </div>

          {/* Payment */}
          <div>
            <Label>Payment Details</Label>
            <div className="space-y-1 mt-1">
              {paymentModes.map((p, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Select value={p.mode} onValueChange={v => updatePaymentMode(idx, "mode", v)}>
                    <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{PAYMENT_MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input type="number" className="h-8 text-xs flex-1" placeholder="Amount" value={p.amount} onChange={e => updatePaymentMode(idx, "amount", e.target.value)} />
                  {paymentModes.length > 1 && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removePaymentMode(idx)}><X className="h-3 w-3" /></Button>
                  )}
                </div>
              ))}
              <Button variant="outline" size="sm" className="text-xs h-7" onClick={addPaymentMode}>+ Add Payment Mode</Button>
            </div>
          </div>

          {/* Summary */}
          {selectedTests.length > 0 && (
            <div className="rounded-lg bg-muted p-3 space-y-1 text-sm">
              <div className="flex justify-between"><span>Gross Amount</span><span>₹{calculations.totalAmount}</span></div>
              {calculations.totalDiscount > 0 && <div className="flex justify-between text-green-600"><span>Discount</span><span>-₹{calculations.totalDiscount.toFixed(2)}</span></div>}
              {calculations.hvCharges > 0 && <div className="flex justify-between"><span>Home Visit Charges</span><span>+₹{calculations.hvCharges}</span></div>}
              <div className="flex justify-between border-t pt-1 font-bold"><span>Final Amount</span><span>₹{calculations.finalAmount.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>Paid</span><span>₹{totalPaid}</span></div>
              {dueAmount > 0 && <div className="flex justify-between text-destructive"><span>Due</span><span>₹{dueAmount.toFixed(2)}</span></div>}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => registerMutation.mutate()} disabled={registerMutation.isPending}>
            {registerMutation.isPending ? "Registering..." : "Save & Register"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={genderConfirmOpen} onOpenChange={setGenderConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Gender</AlertDialogTitle>
            <AlertDialogDescription>Please select the gender for this patient.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-2 py-2">
            {(["Male", "Female", "Unspecified"] as const).map(g => (
              <Button key={g} variant={pendingGender === g ? "default" : "outline"} size="sm" onClick={() => setPendingGender(g as any)}>{g}</Button>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={!pendingGender} onClick={() => { setGender(pendingGender); setGenderConfirmOpen(false); }}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
};

export default EditAndRegisterHomeVisitDialog;
