import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { X, Search } from "lucide-react";
import { getAllSelectableTests } from "@/lib/allSelectableTests";
import { format, parse, isValid, differenceInYears } from "date-fns";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";

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

interface AddPatientToVisitDialogProps {
  open: boolean;
  onClose: () => void;
  /** Auto-populated from primary visit */
  visitDate: string;
  visitTime: string;
  address: string;
  phlebotomistId: string | null;
  /** Called with the new home_visit id after successful save */
  onSaved: (newVisitId: string) => void;
}

const AddPatientToVisitDialog = ({ open, onClose, visitDate, visitTime, address, phlebotomistId, onSaved }: AddPatientToVisitDialogProps) => {
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [patientName, setPatientName] = useState("");
  const [gender, setGender] = useState("");
  const [email, setEmail] = useState("");
  const [doctorName, setDoctorName] = useState("SELF");
  const [umrInput, setUmrInput] = useState("");
  const [dob, setDob] = useState("");
  const [dobDisplay, setDobDisplay] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [selectedTests, setSelectedTests] = useState<EditTest[]>([]);
  const [globalDiscountType, setGlobalDiscountType] = useState<"percent" | "amount">("percent");
  const [globalDiscountValue, setGlobalDiscountValue] = useState(0);
  const [testSearch, setTestSearch] = useState("");
  const [testHighlightIndex, setTestHighlightIndex] = useState(-1);
  const [genderConfirmOpen, setGenderConfirmOpen] = useState(false);
  const [pendingGender, setPendingGender] = useState<"Male" | "Female" | "">("");
  const [attempted, setAttempted] = useState(false);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setTitle(""); setPatientName(""); setGender(""); setEmail(""); setDoctorName("SELF");
      setUmrInput(""); setDob(""); setDobDisplay(""); setWhatsappNumber("");
      setSelectedTests([]); setGlobalDiscountType("percent"); setGlobalDiscountValue(0);
      setTestSearch(""); setAttempted(false);
    }
  }, [open]);

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (val === "Mr." || val === "Master.") setGender("Male");
    else if (val === "Mrs." || val === "Ms." || val === "Miss.") setGender("Female");
    else if (val === "Dr." || val === "Baby Of.") { setGenderConfirmOpen(true); setPendingGender(""); }
  };

  const { data: allTests = [] } = useQuery({
    queryKey: ["all_selectable_tests"],
    queryFn: getAllSelectableTests,
  });

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
    if (!isValid(d)) return "";
    return String(differenceInYears(new Date(), d));
  }, [dob]);

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
    const finalAmount = totalAmount - totalDiscount; // No home visit charges for additional patients
    return { totalAmount, totalDiscount, finalAmount, testDetails };
  }, [selectedTests, globalDiscountType, globalDiscountValue]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!title) throw new Error("Title is required");
      if (!patientName.trim()) throw new Error("Patient name is required");
      if (!whatsappNumber || whatsappNumber.replace(/\D/g, "").length < 10) throw new Error("Valid WhatsApp number required");
      if (selectedTests.length === 0) throw new Error("Select at least one test");
      if (!dob) throw new Error("Date of birth is required");

      const cleanNumber = whatsappNumber.replace(/\D/g, "").slice(-10);
      const formattedUmr = umrInput ? `UMR${String(parseInt(umrInput) || 0).padStart(7, "0")}` : null;

      // Create estimate
      const { data: estData, error: estError } = await supabase.from("estimates").insert({
        title: title || null,
        patient_name: patientName.toUpperCase(),
        gender: gender || null,
        email: email || null,
        doctor_name: doctorName ? doctorName.toUpperCase() : "SELF",
        umr_number: formattedUmr,
        dob: dob || null,
        whatsapp_number: cleanNumber,
        total_amount: calculations.totalAmount,
        discount_amount: calculations.totalDiscount,
        home_visit_charges: 0, // No HV charges for additional patients
        final_amount: calculations.finalAmount,
        global_discount_type: globalDiscountValue > 0 ? globalDiscountType : null,
        global_discount_value: globalDiscountValue,
        status: "Home Visit Booked",
      }).select("id").single();
      if (estError) throw estError;

      // Create estimate_tests
      const testRows = calculations.testDetails.map(t => ({
        estimate_id: estData.id,
        test_id: t.test_id,
        test_name: t.test_name,
        price: t.price,
        fasting_required: t.fasting_required,
        discount_applicable: t.discount_applicable,
        individual_discount_type: t.individual_discount_type,
        individual_discount_value: t.individual_discount_value,
        discounted_price: t.discountedPrice,
        item_type: (t as any).item_type || "test",
      }));
      const { error: testError } = await supabase.from("estimate_tests").insert(testRows);
      if (testError) throw testError;

      // Create home_visit
      const { data: hvData, error: hvError } = await supabase.from("home_visits").insert({
        estimate_id: estData.id,
        visit_date: visitDate,
        visit_time: visitTime,
        address: address,
        phlebotomist_id: phlebotomistId || null,
      }).select("id").single();
      if (hvError) throw hvError;

      return hvData.id;
    },
    onSuccess: (newVisitId) => {
      qc.invalidateQueries({ queryKey: ["home_visits"] });
      qc.invalidateQueries({ queryKey: ["estimates"] });
      toast.success("Patient added to visit!");
      onSaved(newVisitId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Patient to Visit</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {/* Auto-populated visit info (read-only) */}
            <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-xs">
              <p><span className="text-muted-foreground">Date:</span> <span className="font-medium">{visitDate ? format(new Date(visitDate), "dd-MM-yyyy") : "—"}</span></p>
              <p><span className="text-muted-foreground">Time:</span> <span className="font-medium">{visitTime ? (() => { const [h, m] = visitTime.split(":"); const hour = parseInt(h); return `${hour % 12 || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`; })() : "—"}</span></p>
              <p><span className="text-muted-foreground">Address:</span> <span className="font-medium">{address || "—"}</span></p>
              <p className="text-muted-foreground italic">Home visit charges: ₹0 (charged to primary patient only)</p>
            </div>

            {/* Patient demographics */}
            <div className="grid grid-cols-[120px_1fr] gap-2">
              <div>
                <Label className={attempted && !title ? "text-destructive" : ""}>Title *</Label>
                <Select value={title} onValueChange={handleTitleChange}>
                  <SelectTrigger className="h-10"><SelectValue placeholder="Title *" /></SelectTrigger>
                  <SelectContent>
                    {["Mr.", "Mrs.", "Ms.", "Miss.", "Master.", "Baby Of.", "Dr."].map(t => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className={attempted && !patientName.trim() ? "text-destructive" : ""}>Patient Name *</Label>
                <Input value={patientName} onChange={(e) => setPatientName(e.target.value.toUpperCase())} placeholder="Enter patient name" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Gender</Label>
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
                <Label className={attempted && (!whatsappNumber || whatsappNumber.replace(/\D/g, "").length < 10) ? "text-destructive" : ""}>WhatsApp Number *</Label>
                <Input type="tel" value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Email ID</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="patient@example.com" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Doctor's Name</Label>
                <Input value={doctorName} onChange={(e) => setDoctorName(e.target.value.toUpperCase())} />
              </div>
              <div>
                <Label>UMR Number</Label>
                <Input value={umrInput} onChange={(e) => setUmrInput(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 123 → UMR0000123" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className={attempted && !dob ? "text-destructive" : ""}>DOB * (dd-mm-yyyy)</Label>
                <Input type="text" inputMode="numeric" value={dobDisplay} onChange={(e) => handleDobDisplayChange(e.target.value)} placeholder="dd-mm-yyyy" maxLength={10} />
              </div>
              <div>
                <Label>Age (Years)</Label>
                <Input readOnly value={calculatedAge} className="bg-muted" />
              </div>
            </div>

            {/* Test Search */}
            <div>
              <Label>Tests *</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input ref={searchRef} value={testSearch} onChange={(e) => { setTestSearch(e.target.value); setTestHighlightIndex(0); }} placeholder="Search tests... (↑↓ to navigate, Enter to select)" className="pl-8"
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

            {/* Selected Tests */}
            {selectedTests.length > 0 && (
              <div className="space-y-1">
                {selectedTests.map(t => (
                  <div key={t.test_id} className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
                    <span className="text-sm font-medium whitespace-nowrap">{t.test_name}</span>
                    <span className="text-sm text-muted-foreground">₹{t.price}</span>
                    {t.fasting_required && <span className="text-xs text-destructive">Fasting</span>}
                    <div className="ml-auto flex items-center gap-1.5">
                      {t.discount_applicable && (
                        <>
                          <Select value={t.individual_discount_type || ""} onValueChange={(v) => updateTestDiscount(t.test_id, "individual_discount_type", v || null)}>
                            <SelectTrigger className="w-16 h-7 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent><SelectItem value="percent">%</SelectItem><SelectItem value="amount">₹</SelectItem></SelectContent>
                          </Select>
                          {t.individual_discount_type && (
                            <Input type="number" className="w-16 h-7 text-xs" value={t.individual_discount_value || ""} onChange={(e) => updateTestDiscount(t.test_id, "individual_discount_value", parseFloat(e.target.value) || 0)} />
                          )}
                        </>
                      )}
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeTest(t.test_id)}><X className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Global Discount */}
            <div>
              <Label>Global Discount</Label>
              <div className="flex gap-2">
                <Select value={globalDiscountType} onValueChange={(v: any) => setGlobalDiscountType(v)}>
                  <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="percent">%</SelectItem><SelectItem value="amount">₹</SelectItem></SelectContent>
                </Select>
                <Input type="number" value={globalDiscountValue || ""} onChange={(e) => setGlobalDiscountValue(parseFloat(e.target.value) || 0)} />
              </div>
            </div>

            {/* Summary */}
            {selectedTests.length > 0 && (
              <div className="rounded-lg bg-muted p-4 space-y-1 text-sm">
                <div className="flex justify-between"><span>Total Amount</span><span className="font-medium">₹{calculations.totalAmount}</span></div>
                {calculations.totalDiscount > 0 && <div className="flex justify-between text-success"><span>Discount</span><span>-₹{calculations.totalDiscount}</span></div>}
                <div className="flex justify-between"><span>Home Visit Charges</span><span className="text-muted-foreground">₹0</span></div>
                <div className="flex justify-between border-t pt-1 font-bold"><span>Final Amount</span><span>₹{calculations.finalAmount}</span></div>
              </div>
            )}

            <Button className="w-full" onClick={() => { setAttempted(true); saveMutation.mutate(); }} disabled={saveMutation.isPending}>
              Save Patient
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={genderConfirmOpen} onOpenChange={setGenderConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Gender</AlertDialogTitle>
            <AlertDialogDescription>Please select the gender for this patient.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-2 py-2">
            {["Male", "Female", "Unspecified"].map(g => (
              <Button key={g} variant={pendingGender === g ? "default" : "outline"} size="sm" onClick={() => setPendingGender(g as any)}>{g}</Button>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={!pendingGender} onClick={() => { setGender(pendingGender); setGenderConfirmOpen(false); }}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default AddPatientToVisitDialog;
