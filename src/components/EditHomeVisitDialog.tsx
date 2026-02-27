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
import { getTests } from "@/lib/tests";

interface EditTest {
  id?: string;
  test_id: string;
  test_name: string;
  price: number;
  fasting_required: boolean;
  discount_applicable: boolean;
  individual_discount_type: "percent" | "amount" | null;
  individual_discount_value: number;
}

interface EditHomeVisitDialogProps {
  visit: any;
  open: boolean;
  onClose: () => void;
}

const EditHomeVisitDialog = ({ visit, open, onClose }: EditHomeVisitDialogProps) => {
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);

  const est = visit?.estimates;

  const [title, setTitle] = useState("");
  const [patientName, setPatientName] = useState("");
  const [gender, setGender] = useState("");
  const [email, setEmail] = useState("");
  const [doctorName, setDoctorName] = useState("SELF");
  const [umrInput, setUmrInput] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [visitTime, setVisitTime] = useState("");
  const [address, setAddress] = useState("");
  const [selectedTests, setSelectedTests] = useState<EditTest[]>([]);
  const [globalDiscountType, setGlobalDiscountType] = useState<"percent" | "amount">("percent");
  const [globalDiscountValue, setGlobalDiscountValue] = useState(0);
  const [homeVisitCharges, setHomeVisitCharges] = useState(0);
  const [testSearch, setTestSearch] = useState("");

  // Load all available tests
  const { data: allTests = [] } = useQuery({
    queryKey: ["tests"],
    queryFn: async () => await getTests(),
  });

  // Populate form when visit changes
  useEffect(() => {
    if (!visit || !est) return;
    setTitle(est.title || "");
    setPatientName(est.patient_name || "");
    setGender(est.gender || "");
    setEmail(est.email || "");
    setDoctorName(est.doctor_name || "SELF");
    // Parse UMR number - strip "UMR" prefix for editing
    const rawUmr = est.umr_number || "";
    setUmrInput(rawUmr.startsWith("UMR") ? String(parseInt(rawUmr.slice(3)) || "") : rawUmr);
    setWhatsappNumber(est.whatsapp_number || "");
    setVisitDate(visit.visit_date || "");
    setVisitTime(visit.visit_time || "");
    setAddress(visit.address || "");
    setGlobalDiscountType((est.global_discount_type as "percent" | "amount") || "percent");
    setGlobalDiscountValue(Number(est.global_discount_value) || 0);
    setHomeVisitCharges(Number(est.home_visit_charges) || 0);

    const existingTests: EditTest[] = (est.estimate_tests || []).map((t: any) => ({
      id: t.id,
      test_id: t.test_id,
      test_name: t.test_name,
      price: Number(t.price),
      fasting_required: t.fasting_required,
      discount_applicable: t.discount_applicable,
      individual_discount_type: t.individual_discount_type || null,
      individual_discount_value: Number(t.individual_discount_value) || 0,
    }));
    setSelectedTests(existingTests);
    setTestSearch("");
  }, [visit, est]);

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
        discount = t.individual_discount_type === "percent"
          ? (t.price * t.individual_discount_value) / 100
          : t.individual_discount_value;
      } else if (t.discount_applicable && globalDiscountValue > 0) {
        discount = globalDiscountType === "percent"
          ? (t.price * globalDiscountValue) / 100
          : globalDiscountValue;
      }

      discount = Math.min(discount, t.price);
      totalDiscount += discount;

      return { ...t, discountedPrice: t.price - discount, discount };
    });

    const finalAmount = totalAmount - totalDiscount + homeVisitCharges;
    return { totalAmount, totalDiscount, finalAmount, testDetails };
  }, [selectedTests, globalDiscountType, globalDiscountValue, homeVisitCharges]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!whatsappNumber || whatsappNumber.replace(/\D/g, "").length < 10) throw new Error("Valid WhatsApp number required");
      if (selectedTests.length === 0) throw new Error("Select at least one test");
      if (!visitDate || !visitTime || !address.trim()) throw new Error("Visit date, time, and address are required");

      const cleanNumber = whatsappNumber.replace(/\D/g, "").slice(-10);

      // Format UMR number
      const formattedUmr = umrInput ? `UMR${String(parseInt(umrInput) || 0).padStart(7, "0")}` : null;

      // Update estimate
      const { error: estError } = await supabase.from("estimates").update({
        title: title || null,
        patient_name: patientName || null,
        gender: gender || null,
        email: email || null,
        doctor_name: doctorName || "SELF",
        umr_number: formattedUmr,
        whatsapp_number: cleanNumber,
        total_amount: calculations.totalAmount,
        discount_amount: calculations.totalDiscount,
        home_visit_charges: homeVisitCharges,
        final_amount: calculations.finalAmount,
        global_discount_type: globalDiscountValue > 0 ? globalDiscountType : null,
        global_discount_value: globalDiscountValue,
      }).eq("id", est.id);
      if (estError) throw estError;

      // Delete old estimate_tests and re-insert
      const { error: delError } = await supabase.from("estimate_tests").delete().eq("estimate_id", est.id);
      if (delError) throw delError;

      const testRows = calculations.testDetails.map(t => ({
        estimate_id: est.id,
        test_id: t.test_id,
        test_name: t.test_name,
        price: t.price,
        fasting_required: t.fasting_required,
        discount_applicable: t.discount_applicable,
        individual_discount_type: t.individual_discount_type,
        individual_discount_value: t.individual_discount_value,
        discounted_price: t.discountedPrice,
      }));

      const { error: insertError } = await supabase.from("estimate_tests").insert(testRows);
      if (insertError) throw insertError;

      // Update home visit
      const { error: visitError } = await supabase.from("home_visits").update({
        visit_date: visitDate,
        visit_time: visitTime,
        address: address,
      }).eq("id", visit.id);
      if (visitError) throw visitError;

    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["home_visits"] });
      qc.invalidateQueries({ queryKey: ["estimates"] });
      toast.success("Home visit updated successfully!");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!visit) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Home Visit Record</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {/* Patient Info */}
          <div className="grid grid-cols-[120px_1fr] gap-2">
            <div>
              <Label>Title</Label>
              <Select value={title} onValueChange={setTitle}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Title" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Mr.">Mr.</SelectItem>
                  <SelectItem value="Mrs.">Mrs.</SelectItem>
                  <SelectItem value="Ms.">Ms.</SelectItem>
                  <SelectItem value="Miss.">Miss.</SelectItem>
                  <SelectItem value="Master.">Master.</SelectItem>
                  <SelectItem value="Baby Of.">Baby Of.</SelectItem>
                  <SelectItem value="Dr.">Dr.</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Patient Name</Label>
              <Input value={patientName} onChange={(e) => setPatientName(e.target.value.toUpperCase())} />
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
              <Label>WhatsApp Number *</Label>
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

          {/* Visit Details */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Visit Date *</Label>
              <Input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
            </div>
            <div>
              <Label>Visit Time *</Label>
              <Input type="time" value={visitTime} onChange={(e) => setVisitTime(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Address *</Label>
            <Textarea value={address} onChange={(e) => setAddress(e.target.value.toUpperCase())} rows={2} />
          </div>

          {/* Test Search & Add */}
          <div>
            <Label>Tests *</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={testSearch}
                onChange={(e) => setTestSearch(e.target.value)}
                placeholder="Search & add tests..."
                className="pl-8"
              />
            </div>
            {testSearch && availableTests.length > 0 && (
              <div className="border rounded-md mt-1 max-h-36 overflow-y-auto">
                {availableTests.map((t: any) => (
                  <button
                    key={t.id}
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                    onClick={() => addTest(t.id)}
                  >
                    {t.test_name} - ₹{t.price}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Selected Tests */}
          {selectedTests.length > 0 && (
            <div className="space-y-2">
              {selectedTests.map(t => (
                <div key={t.test_id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">{t.test_name}</span>
                      <span className="text-sm text-muted-foreground ml-2">₹{t.price}</span>
                      {t.fasting_required && <span className="text-xs text-warning ml-2">Fasting</span>}
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => removeTest(t.test_id)}><X className="h-3.5 w-3.5" /></Button>
                  </div>
                  {t.discount_applicable && (
                    <div className="flex items-center gap-2 text-sm">
                      <Label className="text-xs">Discount:</Label>
                      <Select value={t.individual_discount_type || ""} onValueChange={(v) => updateTestDiscount(t.test_id, "individual_discount_type", v || null)}>
                        <SelectTrigger className="w-20 h-8 text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent><SelectItem value="percent">%</SelectItem><SelectItem value="amount">₹</SelectItem></SelectContent>
                      </Select>
                      {t.individual_discount_type && (
                        <Input type="number" className="w-20 h-8 text-xs" value={t.individual_discount_value || ""} onChange={(e) => updateTestDiscount(t.test_id, "individual_discount_value", parseFloat(e.target.value) || 0)} />
                      )}
                    </div>
                  )}
                  {!t.discount_applicable && <p className="text-xs text-destructive">No discount allowed</p>}
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

          {/* Home Visit Charges */}
          <div>
            <Label>Home Visit Charges (₹)</Label>
            <Input type="number" value={homeVisitCharges || ""} onChange={(e) => setHomeVisitCharges(parseFloat(e.target.value) || 0)} />
          </div>

          {/* Summary */}
          {selectedTests.length > 0 && (
            <div className="rounded-lg bg-muted p-4 space-y-1 text-sm">
              <div className="flex justify-between"><span>Total Amount</span><span className="font-medium">₹{calculations.totalAmount}</span></div>
              {calculations.totalDiscount > 0 && <div className="flex justify-between text-success"><span>Discount</span><span>-₹{calculations.totalDiscount}</span></div>}
              {homeVisitCharges > 0 && <div className="flex justify-between"><span>Home Visit</span><span>+₹{homeVisitCharges}</span></div>}
              <div className="flex justify-between border-t pt-1 font-bold"><span>Final Amount</span><span>₹{calculations.finalAmount}</span></div>
            </div>
          )}

          <Button className="w-full" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EditHomeVisitDialog;
