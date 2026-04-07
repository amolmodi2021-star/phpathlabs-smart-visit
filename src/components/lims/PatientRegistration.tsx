import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { Search, X, Save, Printer, Send, ChevronDown, ChevronUp } from "lucide-react";
import { getTests, TestItem } from "@/lib/tests";
import InvoicePreview from "./InvoicePreview";

const TITLES = ["Mr.", "Mrs.", "Ms.", "Master", "Miss", "Baby Of", "Dr."];
const PAYMENT_MODES = ["Cash", "GPay", "Paytm", "Credit Card", "NEFT"];

interface SelectedTest {
  test_id: string;
  test_name: string;
  price: number;
  fasting_required: boolean;
  discount_applicable: boolean;
  individual_discount_type: "percent" | "amount" | null;
  individual_discount_value: number;
}

interface PatientMatch {
  source: string;
  patient_name: string;
  title?: string;
  gender?: string;
  dob?: string;
  email?: string;
  doctor_name?: string;
  umr_number?: string;
  address?: string;
  mobile_number: string;
}

const PatientRegistration = () => {
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);

  // Patient fields
  const [mobileNumber, setMobileNumber] = useState("");
  const [patientMatches, setPatientMatches] = useState<PatientMatch[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [title, setTitle] = useState("");
  const [patientName, setPatientName] = useState("");
  const [gender, setGender] = useState("");
  const [dob, setDob] = useState("");
  const [email, setEmail] = useState("");
  const [showEmail, setShowEmail] = useState(false);
  const [doctorName, setDoctorName] = useState("SELF");
  const [umrNumber, setUmrNumber] = useState("");
  const [address, setAddress] = useState("");

  // Visit type
  const [visitType, setVisitType] = useState("lab_visit");
  const [pickupPointId, setPickupPointId] = useState("");

  // Tests
  const [testSearch, setTestSearch] = useState("");
  const [selectedTests, setSelectedTests] = useState<SelectedTest[]>([]);
  const [globalDiscountType, setGlobalDiscountType] = useState<"percent" | "amount">("percent");
  const [globalDiscountValue, setGlobalDiscountValue] = useState(0);
  const [homeVisitCharges, setHomeVisitCharges] = useState(0);

  // Payment
  const [selectedModes, setSelectedModes] = useState<Set<string>>(new Set());
  const [modeAmounts, setModeAmounts] = useState<Record<string, number>>({});

  // Invoice preview
  const [invoiceData, setInvoiceData] = useState<any>(null);

  // Queries
  const { data: tests = [] } = useQuery({ queryKey: ["tests"], queryFn: getTests });
  const { data: pickupPoints = [] } = useQuery({
    queryKey: ["pickup_points"],
    queryFn: async () => {
      const { data } = await supabase.from("pickup_points").select("*").eq("status", "active").order("name");
      return (data || []) as any[];
    },
  });
  const { data: pickupPrices = [] } = useQuery({
    queryKey: ["pickup_point_prices", pickupPointId],
    queryFn: async () => {
      if (!pickupPointId) return [];
      const { data } = await supabase.from("pickup_point_prices").select("*").eq("pickup_point_id", pickupPointId);
      return (data || []) as any[];
    },
    enabled: !!pickupPointId,
  });

  const selectedPickup = pickupPoints.find((p: any) => p.id === pickupPointId);
  const isCreditPickup = visitType === "pickup_point" && selectedPickup?.billing_type === "credit";

  // Title → Gender auto-link
  useEffect(() => {
    if (["Mr.", "Master"].includes(title)) setGender("Male");
    else if (["Mrs.", "Ms.", "Miss"].includes(title)) setGender("Female");
  }, [title]);

  // Age calc
  const age = useMemo(() => {
    if (!dob) return "";
    const diff = Date.now() - new Date(dob).getTime();
    return `${Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000))} Years`;
  }, [dob]);

  // Patient search
  const searchPatients = async (mobile: string) => {
    const digits = mobile.replace(/\D/g, "");
    if (digits.length < 4) { setPatientMatches([]); setShowDropdown(false); return; }

    const results: PatientMatch[] = [];

    // Search patient_master
    const { data: pm } = await supabase.from("patient_master").select("*").ilike("mobile_number", `%${digits}%`).limit(10);
    (pm || []).forEach((p: any) => results.push({
      source: "Patient Master", patient_name: p.patient_name, gender: p.gender,
      dob: p.date_of_birth, email: p.email, doctor_name: p.ref_doctor,
      umr_number: p.umr_id, mobile_number: p.mobile_number,
    }));

    // Search crm_contacts (prefer PH VESU)
    const { data: crm } = await supabase.from("crm_contacts").select("*").ilike("mobile_number", `%${digits}%`).order("location").limit(10);
    (crm || []).forEach((c: any) => {
      if (!results.find(r => r.mobile_number === c.mobile_number && r.patient_name === c.patient_name)) {
        results.push({
          source: `CRM (${c.location || "—"})`, patient_name: c.patient_name || "",
          umr_number: c.umr_number, mobile_number: c.mobile_number || "",
          doctor_name: c.doctor_name,
        });
      }
    });

    // Search estimates
    const { data: est } = await supabase.from("estimates").select("*").ilike("whatsapp_number", `%${digits}%`).limit(10);
    (est || []).forEach((e: any) => {
      if (!results.find(r => r.patient_name === e.patient_name && r.mobile_number === e.whatsapp_number)) {
        results.push({
          source: "Estimates", patient_name: e.patient_name || "", title: e.title,
          gender: e.gender, dob: e.dob, email: e.email, doctor_name: e.doctor_name,
          umr_number: e.umr_number, mobile_number: e.whatsapp_number,
        });
      }
    });

    setPatientMatches(results);
    setShowDropdown(results.length > 0);
  };

  const selectPatient = (p: PatientMatch) => {
    setMobileNumber(p.mobile_number);
    if (p.patient_name) setPatientName(p.patient_name);
    if (p.title) setTitle(p.title);
    if (p.gender) setGender(p.gender);
    if (p.dob) setDob(p.dob);
    if (p.email) { setEmail(p.email); setShowEmail(true); }
    if (p.doctor_name) setDoctorName(p.doctor_name);
    if (p.umr_number) setUmrNumber(p.umr_number);
    if (p.address) setAddress(p.address);
    setShowDropdown(false);
  };

  // Get test price (pickup custom price or default)
  const getTestPrice = (test: TestItem): number => {
    if (visitType === "pickup_point" && pickupPointId) {
      const custom = pickupPrices.find((pp: any) => pp.test_id === test.id);
      if (custom) return Number(custom.custom_price);
    }
    return Number(test.price);
  };

  const addTest = (testId: string) => {
    const t = tests.find((x) => x.id === testId);
    if (!t || selectedTests.find(s => s.test_id === testId)) return;
    setSelectedTests(prev => [...prev, {
      test_id: t.id, test_name: t.test_name, price: getTestPrice(t),
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

  const availableTests = tests.filter((t) =>
    !selectedTests.find(s => s.test_id === t.id) &&
    (testSearch === "" || t.test_name.toLowerCase().includes(testSearch.toLowerCase()))
  );

  // Calculations (same logic as CreateEstimate)
  const calculations = useMemo(() => {
    let totalAmount = 0;
    let totalDiscount = 0;
    const testDetails = selectedTests.map(t => {
      totalAmount += t.price;
      let discount = 0;
      const hasIndividual = t.individual_discount_type && t.individual_discount_value > 0 && t.discount_applicable;
      if (hasIndividual) {
        discount = t.individual_discount_type === "percent"
          ? (t.price * t.individual_discount_value) / 100 : t.individual_discount_value;
      } else if (t.discount_applicable && globalDiscountValue > 0) {
        discount = globalDiscountType === "percent"
          ? (t.price * globalDiscountValue) / 100 : globalDiscountValue;
      }
      discount = Math.min(discount, t.price);
      totalDiscount += discount;
      return { ...t, discountedPrice: t.price - discount, discount };
    });
    const hvc = visitType === "home_visit" ? homeVisitCharges : 0;
    const finalAmount = totalAmount - totalDiscount + hvc;
    return { totalAmount, totalDiscount, finalAmount, testDetails, homeVisitCharges: hvc };
  }, [selectedTests, globalDiscountType, globalDiscountValue, homeVisitCharges, visitType]);

  // Payment
  const toggleMode = (mode: string) => {
    setSelectedModes(prev => {
      const next = new Set(prev);
      if (next.has(mode)) { next.delete(mode); setModeAmounts(a => { const n = { ...a }; delete n[mode]; return n; }); }
      else next.add(mode);
      return next;
    });
  };

  const paidAmount = useMemo(() =>
    Array.from(selectedModes).reduce((sum, mode) => sum + (modeAmounts[mode] || 0), 0),
    [selectedModes, modeAmounts]
  );
  const dueAmount = Math.max(0, calculations.finalAmount - paidAmount);

  // Save
  const saveMutation = useMutation({
    mutationFn: async () => {
      const cleanMobile = mobileNumber.replace(/\D/g, "").slice(-10);
      if (!cleanMobile || cleanMobile.length < 10) throw new Error("Valid mobile number required");
      if (!patientName.trim()) throw new Error("Patient name is required");
      if (!title) throw new Error("Title is required");
      if (!gender) throw new Error("Gender is required");
      if (selectedTests.length === 0) throw new Error("Select at least one test");
      if (visitType !== "pickup_point" && !address.trim()) throw new Error("Address is required");

      // Generate invoice number
      const { data: invoiceNum, error: invErr } = await supabase.rpc("generate_invoice_number" as any);
      if (invErr) throw new Error("Failed to generate invoice number");

      const payments = Array.from(selectedModes)
        .filter(m => (modeAmounts[m] || 0) > 0)
        .map(m => ({ mode: m, amount: modeAmounts[m] || 0 }));

      const regData = {
        invoice_number: invoiceNum as string,
        mobile_number: cleanMobile,
        patient_name: patientName.toUpperCase(),
        title,
        gender,
        dob: dob || null,
        email: email || null,
        address: visitType === "pickup_point" ? (selectedPickup?.address || "") : address.toUpperCase(),
        doctor_name: (doctorName || "SELF").toUpperCase(),
        umr_number: umrNumber || null,
        visit_type: visitType,
        pickup_point_id: visitType === "pickup_point" ? pickupPointId : null,
        tests: calculations.testDetails.map(t => ({
          test_id: t.test_id, test_name: t.test_name, price: t.price,
          discount: t.discount, discounted_price: t.discountedPrice,
          fasting_required: t.fasting_required,
        })),
        gross_amount: calculations.totalAmount,
        discount_amount: calculations.totalDiscount,
        net_amount: calculations.totalAmount - calculations.totalDiscount,
        home_visit_charges: calculations.homeVisitCharges,
        final_amount: calculations.finalAmount,
        payments,
        paid_amount: isCreditPickup ? 0 : paidAmount,
        due_amount: isCreditPickup ? calculations.finalAmount : dueAmount,
        global_discount_type: globalDiscountValue > 0 ? globalDiscountType : null,
        global_discount_value: globalDiscountValue,
      };

      const { data: reg, error } = await supabase.from("patient_registrations").insert(regData as any).select().single();
      if (error) throw new Error(error.message);

      // Upsert patient_master
      const { data: existing } = await supabase.from("patient_master").select("id").eq("mobile_number", cleanMobile).limit(1).single();
      const pmData: any = {
        patient_name: patientName.toUpperCase(),
        mobile_number: cleanMobile,
        gender,
        date_of_birth: dob || null,
        email: email || null,
        ref_doctor: (doctorName || "SELF").toUpperCase(),
        umr_id: umrNumber || `UMR${cleanMobile}`,
        last_visit_date: new Date().toISOString(),
      };
      if (existing) {
        await supabase.from("patient_master").update(pmData).eq("id", existing.id);
      } else {
        pmData.first_visit_date = new Date().toISOString();
        await supabase.from("patient_master").insert(pmData);
      }

      return reg;
    },
    onSuccess: (reg: any) => {
      qc.invalidateQueries({ queryKey: ["patient_registrations"] });
      toast.success(`Registration saved! Invoice: ${reg.invoice_number}`);
      setInvoiceData({
        ...reg,
        tests: calculations.testDetails,
        calculations,
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetForm = () => {
    setMobileNumber(""); setPatientName(""); setTitle(""); setGender("");
    setDob(""); setEmail(""); setDoctorName("SELF"); setUmrNumber("");
    setAddress(""); setVisitType("lab_visit"); setPickupPointId("");
    setSelectedTests([]); setGlobalDiscountValue(0); setHomeVisitCharges(0);
    setSelectedModes(new Set()); setModeAmounts({}); setInvoiceData(null);
  };

  return (
    <div className="space-y-4 max-w-2xl">
      {invoiceData && (
        <InvoicePreview
          data={invoiceData}
          open={!!invoiceData}
          onClose={() => { setInvoiceData(null); resetForm(); }}
        />
      )}

      <Card>
        <CardContent className="p-4 space-y-4">
          {/* Mobile Number + Patient Search */}
          <div className="relative">
            <Label className={!mobileNumber ? "text-destructive" : ""}>Mobile Number *</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={mobileNumber}
                onChange={(e) => { setMobileNumber(e.target.value); searchPatients(e.target.value); }}
                onFocus={() => patientMatches.length > 0 && setShowDropdown(true)}
                placeholder="Enter mobile number to search..."
                className="pl-8"
                type="tel"
              />
            </div>
            {showDropdown && patientMatches.length > 0 && (
              <div className="absolute z-50 w-full border rounded-md bg-popover shadow-lg mt-1 max-h-48 overflow-y-auto">
                {patientMatches.map((p, i) => (
                  <button key={i} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors border-b last:border-0"
                    onClick={() => selectPatient(p)}>
                    <div className="font-medium">{p.title} {p.patient_name || "(No name)"}</div>
                    <div className="text-xs text-muted-foreground">{p.mobile_number} {p.umr_number ? `• ${p.umr_number}` : ""} • {p.source}</div>
                  </button>
                ))}
                <button type="button" className="w-full text-left px-3 py-2 text-xs text-muted-foreground hover:bg-accent"
                  onClick={() => setShowDropdown(false)}>
                  Continue with new patient →
                </button>
              </div>
            )}
          </div>

          {/* Demographics */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={!title ? "text-destructive" : ""}>Title *</Label>
              <Select value={title} onValueChange={setTitle}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{TITLES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className={!gender ? "text-destructive" : ""}>Gender *</Label>
              <Select value={gender} onValueChange={setGender}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                  <SelectItem value="Unspecified">Unspecified</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className={!patientName.trim() ? "text-destructive" : ""}>Patient Name *</Label>
            <Input value={patientName} onChange={e => setPatientName(e.target.value)} placeholder="Full name" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>DOB</Label>
              <Input type="date" value={dob} onChange={e => setDob(e.target.value)} />
              {age && <p className="text-xs text-muted-foreground mt-1">Age: {age}</p>}
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Doctor Name</Label>
              <Input value={doctorName} onChange={e => setDoctorName(e.target.value)} placeholder="SELF" />
            </div>
            <div>
              <Label>UMR Number</Label>
              <Input value={umrNumber} onChange={e => setUmrNumber(e.target.value)} placeholder="UMR0000000" />
            </div>
          </div>

          {/* Visit Type */}
          <div>
            <Label>Visit Type</Label>
            <RadioGroup value={visitType} onValueChange={(v) => { setVisitType(v); if (v !== "pickup_point") setPickupPointId(""); }} className="flex gap-4 mt-1">
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="lab_visit" id="lab" /><Label htmlFor="lab" className="cursor-pointer text-sm">Lab Visit</Label>
              </div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="home_visit" id="home" /><Label htmlFor="home" className="cursor-pointer text-sm">Home Visit</Label>
              </div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="pickup_point" id="pickup" /><Label htmlFor="pickup" className="cursor-pointer text-sm">Pickup Point</Label>
              </div>
            </RadioGroup>
          </div>

          {visitType === "pickup_point" && (
            <div>
              <Label>Select Pickup Point *</Label>
              <Select value={pickupPointId} onValueChange={setPickupPointId}>
                <SelectTrigger><SelectValue placeholder="Choose pickup point" /></SelectTrigger>
                <SelectContent>
                  {pickupPoints.map((pp: any) => (
                    <SelectItem key={pp.id} value={pp.id}>{pp.name} ({pp.billing_type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPickup && (
                <p className="text-xs text-muted-foreground mt-1">
                  {selectedPickup.billing_type === "credit" ? "Credit billing — no payment required now" : `Debit billing • Default discount: ${selectedPickup.default_discount_pct}%`}
                </p>
              )}
            </div>
          )}

          {visitType !== "pickup_point" && (
            <div>
              <Label className={!address.trim() ? "text-destructive" : ""}>Address *</Label>
              <Input value={address} onChange={e => setAddress(e.target.value)} placeholder="Patient address" />
            </div>
          )}

          {/* Test Selection */}
          <div>
            <Label>Select Tests *</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input ref={searchRef} value={testSearch} onChange={e => setTestSearch(e.target.value)} placeholder="Search tests..." className="pl-8" />
            </div>
            {testSearch && availableTests.length > 0 && (
              <div className="border rounded-md mt-1 max-h-48 overflow-y-auto">
                {availableTests.slice(0, 20).map((t) => (
                  <button key={t.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors" onClick={() => addTest(t.id)}>
                    {t.test_name} — ₹{getTestPrice(t)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedTests.length > 0 && (
            <div className="space-y-2">
              {selectedTests.map(t => (
                <div key={t.test_id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">{t.test_name}</span>
                      <span className="text-sm text-muted-foreground ml-2">₹{t.price}</span>
                      {t.fasting_required && <span className="text-xs text-destructive ml-2">Fasting</span>}
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => removeTest(t.test_id)}><X className="h-3.5 w-3.5" /></Button>
                  </div>
                  {t.discount_applicable && (
                    <div className="flex items-center gap-2 text-sm">
                      <Label className="text-xs">Individual Discount:</Label>
                      <Select value={t.individual_discount_type || ""} onValueChange={v => updateTestDiscount(t.test_id, "individual_discount_type", v || null)}>
                        <SelectTrigger className="w-20 h-8 text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent><SelectItem value="percent">%</SelectItem><SelectItem value="amount">₹</SelectItem></SelectContent>
                      </Select>
                      {t.individual_discount_type && (
                        <Input type="number" className="w-20 h-8 text-xs" value={t.individual_discount_value || ""}
                          onChange={e => updateTestDiscount(t.test_id, "individual_discount_value", parseFloat(e.target.value) || 0)} />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Global Discount */}
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Label>Global Discount</Label>
              <div className="flex gap-2">
                <Select value={globalDiscountType} onValueChange={(v: any) => setGlobalDiscountType(v)}>
                  <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="percent">%</SelectItem><SelectItem value="amount">₹</SelectItem></SelectContent>
                </Select>
                <Input type="number" value={globalDiscountValue || ""} onChange={e => setGlobalDiscountValue(parseFloat(e.target.value) || 0)} />
              </div>
            </div>
          </div>

          {/* Home Visit Charges */}
          {visitType === "home_visit" && (
            <div>
              <Label>Home Visit Charges (₹)</Label>
              <Input type="number" value={homeVisitCharges || ""} onChange={e => setHomeVisitCharges(parseFloat(e.target.value) || 0)} />
            </div>
          )}

          {/* Summary */}
          {selectedTests.length > 0 && (
            <div className="rounded-lg bg-muted p-4 space-y-1 text-sm">
              <div className="flex justify-between"><span>Gross Amount</span><span className="font-medium">₹{calculations.totalAmount}</span></div>
              {calculations.totalDiscount > 0 && <div className="flex justify-between text-primary"><span>Discount</span><span>-₹{calculations.totalDiscount}</span></div>}
              {calculations.homeVisitCharges > 0 && <div className="flex justify-between"><span>Home Visit</span><span>+₹{calculations.homeVisitCharges}</span></div>}
              <div className="flex justify-between border-t pt-1 font-bold"><span>Final Amount</span><span>₹{calculations.finalAmount}</span></div>
            </div>
          )}

          {/* Payment Section */}
          {!isCreditPickup && selectedTests.length > 0 && (
            <div className="space-y-3">
              <Label className="text-base font-semibold">Payment</Label>
              <div className="grid grid-cols-3 gap-2">
                {PAYMENT_MODES.map(mode => (
                  <label key={mode} className={`flex items-center gap-2 rounded-lg border p-2 cursor-pointer transition-colors text-sm ${selectedModes.has(mode) ? "border-primary bg-primary/5" : "border-border"}`}>
                    <Checkbox checked={selectedModes.has(mode)} onCheckedChange={() => toggleMode(mode)} />
                    {mode}
                  </label>
                ))}
              </div>
              {selectedModes.size > 0 && (
                <div className="space-y-2">
                  {Array.from(selectedModes).map(mode => (
                    <div key={mode}>
                      <Label className="text-xs">{mode} Amount</Label>
                      <Input type="number" value={modeAmounts[mode] || ""} onChange={e => setModeAmounts(prev => ({ ...prev, [mode]: parseFloat(e.target.value) || 0 }))} />
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-4 text-sm">
                <span>Paid: <strong>₹{paidAmount}</strong></span>
                {dueAmount > 0 && <span className="text-destructive">Due: <strong>₹{dueAmount}</strong></span>}
              </div>
            </div>
          )}

          {isCreditPickup && selectedTests.length > 0 && (
            <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
              Credit billing — Payment will be collected in monthly billing cycle from <strong>{selectedPickup?.name}</strong>
            </div>
          )}

          <Button className="w-full" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || selectedTests.length === 0}>
            <Save className="h-4 w-4 mr-2" />Save & Generate Invoice
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default PatientRegistration;
