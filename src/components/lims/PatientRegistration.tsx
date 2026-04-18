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
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Search, X, Save, Printer, Send, ChevronDown, ChevronUp } from "lucide-react";
import { getTests, TestItem } from "@/lib/tests";
import { getCurrentUser } from "@/lib/auth";
import { logPaymentTransaction } from "@/lib/paymentTransactions";
import { getAllSelectableTests } from "@/lib/allSelectableTests";
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
  const [manualAge, setManualAge] = useState("");
  const [remarks, setRemarks] = useState("");
  const [isStat, setIsStat] = useState(false);
  const [showHvcConfirm, setShowHvcConfirm] = useState(false);

  // Channel
  const [channelId, setChannelId] = useState("");
  const [reportLanguage, setReportLanguage] = useState("English");

  // Visit type
  const [visitType, setVisitType] = useState("lab_visit");
  const [pickupPointId, setPickupPointId] = useState("");

  // Tests
  const [testSearch, setTestSearch] = useState("");
  const [selectedTests, setSelectedTests] = useState<SelectedTest[]>([]);
  const [testHighlightIndex, setTestHighlightIndex] = useState(-1);
  const [globalDiscountType, setGlobalDiscountType] = useState<"percent" | "amount">("percent");
  const [globalDiscountValue, setGlobalDiscountValue] = useState(0);
  const [homeVisitCharges, setHomeVisitCharges] = useState(0);

  // Payment
  const [selectedModes, setSelectedModes] = useState<Set<string>>(new Set());
  const [modeAmounts, setModeAmounts] = useState<Record<string, number>>({});

  // Validation
  const [triedSave, setTriedSave] = useState(false);

  // Invoice preview
  const [invoiceData, setInvoiceData] = useState<any>(null);

  // Queries
  const { data: tests = [] } = useQuery({ queryKey: ["all_selectable_tests"], queryFn: getAllSelectableTests });
  const { data: pickupPoints = [] } = useQuery({
    queryKey: ["pickup_points"],
    queryFn: async () => {
      const { data } = await supabase.from("pickup_points").select("*").eq("status", "active").order("name");
      return (data || []) as any[];
    },
  });
  const { data: channels = [] } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const { data } = await supabase.from("channels").select("*").eq("status", "active").order("name");
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
  const { data: channelPrices = [] } = useQuery({
    queryKey: ["channel_prices", channelId],
    queryFn: async () => {
      if (!channelId) return [];
      const { data } = await supabase.from("channel_prices").select("*").eq("channel_id", channelId);
      return (data || []) as any[];
    },
    enabled: !!channelId,
  });

  const selectedPickup = pickupPoints.find((p: any) => p.id === pickupPointId);
  const selectedChannel = channels.find((c: any) => c.id === channelId);
  const isCreditPickup = visitType === "pickup_point" && selectedPickup?.billing_type === "credit";
  const isCreditChannel = !!channelId && selectedChannel?.billing_type === "credit";
  const isPickup = visitType === "pickup_point";

  // Auto-populate mobile from pickup point phone
  useEffect(() => {
    if (isPickup && pickupPointId && selectedPickup?.phone) {
      const cleanPhone = selectedPickup.phone.replace(/\D/g, "").slice(-10);
      if (cleanPhone.length === 10) setMobileNumber(cleanPhone);
    }
  }, [pickupPointId, isPickup, selectedPickup]);

  // Title → Gender auto-link
  useEffect(() => {
    if (["Mr.", "Master"].includes(title)) setGender("Male");
    else if (["Mrs.", "Ms.", "Miss"].includes(title)) setGender("Female");
  }, [title]);

  // Age calc - from DOB for non-pickup, manual for pickup
  const age = useMemo(() => {
    if (isPickup) return manualAge;
    if (!dob) return "";
    const diff = Date.now() - new Date(dob).getTime();
    return `${Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000))} Years`;
  }, [dob, isPickup, manualAge]);

  // Patient search — registered patients appear first
  const searchPatients = async (mobile: string) => {
    const digits = mobile.replace(/\D/g, "");
    if (digits.length < 4) { setPatientMatches([]); setShowDropdown(false); return; }

    const priority: PatientMatch[] = [];
    const others: PatientMatch[] = [];
    const seen = new Set<string>();
    const key = (name: string, mob: string) => `${(name || "").toUpperCase()}|${mob}`;

    // 1. Search patient_registrations (highest priority)
    const { data: regs } = await supabase.from("patient_registrations").select("*").ilike("mobile_number", `%${digits}%`).eq("bill_cancelled", false).order("created_at", { ascending: false }).limit(10);
    (regs || []).forEach((r: any) => {
      const k = key(r.patient_name, r.mobile_number);
      if (!seen.has(k)) {
        seen.add(k);
        priority.push({
          source: "Registered", patient_name: r.patient_name, title: r.title,
          gender: r.gender, dob: r.dob, email: r.email, doctor_name: r.doctor_name,
          umr_number: r.umr_number, mobile_number: r.mobile_number, address: r.address,
        });
      }
    });

    // 2. Search patient_master
    const { data: pm } = await supabase.from("patient_master").select("*").ilike("mobile_number", `%${digits}%`).limit(10);
    (pm || []).forEach((p: any) => {
      const k = key(p.patient_name, p.mobile_number);
      if (!seen.has(k)) {
        seen.add(k);
        others.push({
          source: "Patient Master", patient_name: p.patient_name, gender: p.gender,
          dob: p.date_of_birth, email: p.email, doctor_name: p.ref_doctor,
          umr_number: p.umr_id, mobile_number: p.mobile_number,
        });
      }
    });

    // 3. Search crm_contacts
    const { data: crm } = await supabase.from("crm_contacts").select("*").ilike("mobile_number", `%${digits}%`).order("location").limit(10);
    (crm || []).forEach((c: any) => {
      const k = key(c.patient_name, c.mobile_number);
      if (!seen.has(k)) {
        seen.add(k);
        others.push({
          source: `CRM (${c.location || "—"})`, patient_name: c.patient_name || "",
          umr_number: c.umr_number, mobile_number: c.mobile_number || "",
          doctor_name: c.doctor_name,
        });
      }
    });

    // 4. Search estimates
    const { data: est } = await supabase.from("estimates").select("*").ilike("whatsapp_number", `%${digits}%`).limit(10);
    (est || []).forEach((e: any) => {
      const k = key(e.patient_name, e.whatsapp_number);
      if (!seen.has(k)) {
        seen.add(k);
        others.push({
          source: "Estimates", patient_name: e.patient_name || "", title: e.title,
          gender: e.gender, dob: e.dob, email: e.email, doctor_name: e.doctor_name,
          umr_number: e.umr_number, mobile_number: e.whatsapp_number,
        });
      }
    });

    const results = [...priority, ...others];
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

  // Get test price (channel/pickup custom price or default)
  const getTestPrice = (test: { id: string; price: number }): number => {
    if (channelId) {
      const custom = channelPrices.find((cp: any) => cp.test_id === test.id);
      if (custom) return Number(custom.custom_price);
    }
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

  // Auto-apply channel discount when channel is selected
  const effectiveDiscountType = channelId && selectedChannel ? "percent" : globalDiscountType;
  const effectiveDiscountValue = channelId && selectedChannel ? Number(selectedChannel.default_discount_pct || 0) : globalDiscountValue;

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
      } else if (t.discount_applicable && effectiveDiscountValue > 0) {
        discount = effectiveDiscountType === "percent"
          ? (t.price * effectiveDiscountValue) / 100 : effectiveDiscountValue;
      }
      discount = Math.min(discount, t.price);
      totalDiscount += discount;
      return { ...t, discountedPrice: t.price - discount, discount };
    });
    const hvc = visitType === "home_visit" ? homeVisitCharges : 0;
    const finalAmount = totalAmount - totalDiscount + hvc;
    return { totalAmount, totalDiscount, finalAmount, testDetails, homeVisitCharges: hvc };
  }, [selectedTests, effectiveDiscountType, effectiveDiscountValue, homeVisitCharges, visitType]);

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
      if (!isPickup && !dob) throw new Error("Date of birth is required");
      if (selectedTests.length === 0) throw new Error("Select at least one test");
      if (visitType !== "pickup_point" && !address.trim()) throw new Error("Address is required");
      if (paidAmount > calculations.finalAmount) throw new Error("Payment amount cannot exceed the final amount");

      // Generate invoice number
      const { data: invoiceNum, error: invErr } = await supabase.rpc("generate_invoice_number" as any);
      if (invErr) throw new Error("Failed to generate invoice number");

      // Determine UMR: reuse existing or generate new
      let finalUmr = umrNumber;
      if (!finalUmr) {
        const { data: newUmr, error: umrErr } = await supabase.rpc("generate_umr_number" as any);
        if (umrErr) throw new Error("Failed to generate UMR number");
        finalUmr = newUmr as string;
        setUmrNumber(finalUmr);
      }

      const payments = Array.from(selectedModes)
        .filter(m => (modeAmounts[m] || 0) > 0)
        .map(m => ({ mode: m, amount: modeAmounts[m] || 0 }));

      const regData = {
        invoice_number: invoiceNum as string,
        mobile_number: cleanMobile,
        patient_name: patientName.replace(/\s+/g, ' ').trim().toUpperCase(),
        title,
        gender,
        dob: dob || null,
        email: email || null,
        address: visitType === "pickup_point" ? (selectedPickup?.address || "") : address.toUpperCase(),
        doctor_name: (doctorName || "SELF").toUpperCase(),
        umr_number: finalUmr,
        visit_type: visitType,
        pickup_point_id: visitType === "pickup_point" ? pickupPointId : null,
        channel_id: channelId || null,
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
        paid_amount: (isCreditPickup || isCreditChannel) ? 0 : paidAmount,
        due_amount: (isCreditPickup || isCreditChannel) ? calculations.finalAmount : dueAmount,
        global_discount_type: globalDiscountValue > 0 ? globalDiscountType : null,
        global_discount_value: globalDiscountValue,
        remarks: remarks.trim() || null,
        is_stat: isStat,
        report_language: visitType === "pickup_point" ? "ENGLISH" : reportLanguage.toUpperCase(),
        registered_by: getCurrentUser()?.display_name || null,
      };

      const { data: reg, error } = await supabase.from("patient_registrations").insert(regData as any).select().single();
      if (error) throw new Error(error.message);

      // Create sample_tubes for this registration
      try {
        // Fetch test sample tube info
        const testIds = calculations.testDetails.map((t: any) => t.test_id);
        const { data: testRows } = await supabase.from("tests").select("id, sample_tube, tube_color, sample_type").in("id", testIds);
        const testInfoMap: Record<string, any> = {};
        (testRows || []).forEach((t: any) => { testInfoMap[t.id] = t; });

        // Fetch suffix info
        const { data: suffixRows } = await supabase
          .from("test_parameters")
          .select("test_id, report_test_parameters!inner(custom_sample_suffix_enabled, custom_sample_suffix)")
          .in("test_id", testIds)
          .eq("report_test_parameters.custom_sample_suffix_enabled", true);
        const suffixMap: Record<string, string> = {};
        (suffixRows || []).forEach((tp: any) => {
          const suffix = tp.report_test_parameters?.custom_sample_suffix;
          if (tp.test_id && suffix) suffixMap[tp.test_id] = suffix;
        });

        // Group tests by tube_type + suffix
        const groupMap: Record<string, { tubeType: string; tubeColor: string; sampleType: string; suffix: string; testIds: string[]; testNames: string[] }> = {};
        const cancelledIds = new Set<string>();
        for (const t of calculations.testDetails) {
          if (cancelledIds.has(t.test_id)) continue;
          const info = testInfoMap[t.test_id] || {};
          const tube = info.sample_tube || "DEFAULT";
          const suffix = suffixMap[t.test_id] || "";
          const groupKey = `${tube}||${suffix}`;
          if (!groupMap[groupKey]) {
            groupMap[groupKey] = {
              tubeType: tube, tubeColor: info.tube_color || "", sampleType: info.sample_type || "",
              suffix, testIds: [], testNames: [],
            };
          }
          groupMap[groupKey].testIds.push(t.test_id);
          groupMap[groupKey].testNames.push(t.test_name);
        }

        // Generate sample_uid for each group and insert
        for (const g of Object.values(groupMap)) {
          const { data: uid } = await supabase.rpc("generate_sample_uid" as any);
          await supabase.from("sample_tubes" as any).insert({
            sample_uid: uid as string,
            registration_id: reg.id,
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
        // Non-fatal: registration was saved successfully
      }

      // Upsert patient_master
      const { data: existing } = await supabase.from("patient_master").select("id").eq("mobile_number", cleanMobile).limit(1).single();
      const pmData: any = {
        patient_name: patientName.replace(/\s+/g, ' ').trim().toUpperCase(),
        mobile_number: cleanMobile,
        gender,
        date_of_birth: dob || null,
        email: email || null,
        ref_doctor: (doctorName || "SELF").toUpperCase(),
        umr_id: finalUmr,
        last_visit_date: new Date().toISOString(),
      };
      if (existing) {
        await supabase.from("patient_master").update(pmData).eq("id", existing.id);
      } else {
        pmData.first_visit_date = new Date().toISOString();
        await supabase.from("patient_master").insert(pmData);
      }

      // Sync demographics across all previous registrations with same UMR
      if (finalUmr) {
        const demoUpdates: any = {
          patient_name: patientName.replace(/\s+/g, ' ').trim().toUpperCase(),
          title,
          gender,
          dob: dob || null,
          email: email || null,
          address: visitType === "pickup_point" ? (selectedPickup?.address || "") : address.toUpperCase(),
          doctor_name: (doctorName || "SELF").toUpperCase(),
          mobile_number: cleanMobile,
        };
        await supabase
          .from("patient_registrations")
          .update(demoUpdates)
          .eq("umr_number", finalUmr)
          .neq("id", reg.id);
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
      // Log payment transaction (fire-and-forget) — always log so due-only registrations appear in Daily Report
      const payments = Array.from(selectedModes)
        .filter(m => (modeAmounts[m] || 0) > 0)
        .map(m => ({ mode: m, amount: modeAmounts[m] || 0 }));
      logPaymentTransaction({
        registration_id: reg.id,
        invoice_number: reg.invoice_number,
        patient_name: reg.patient_name,
        transaction_type: "registration_payment",
        direction: "in",
        payments,
        total_amount: paidAmount,
        gross_amount: calculations.totalAmount,
        discount_amount: calculations.totalDiscount,
        final_amount: calculations.finalAmount,
        paid_amount: paidAmount,
        due_amount: dueAmount,
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetForm = () => {
    setMobileNumber(""); setPatientName(""); setTitle(""); setGender("");
    setDob(""); setEmail(""); setShowEmail(false); setDoctorName("SELF"); setUmrNumber("");
    setAddress(""); setChannelId(""); setVisitType("lab_visit"); setPickupPointId("");
    setSelectedTests([]); setGlobalDiscountValue(0); setHomeVisitCharges(0);
    setSelectedModes(new Set()); setModeAmounts({}); setInvoiceData(null); setTriedSave(false);
    setManualAge(""); setRemarks(""); setIsStat(false);
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
            <Label className={triedSave && (!mobileNumber || mobileNumber.replace(/\D/g, "").slice(-10).length < 10) ? "text-destructive" : ""}>Mobile Number *</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={mobileNumber}
                onChange={(e) => { setMobileNumber(e.target.value); searchPatients(e.target.value); }}
                onFocus={() => patientMatches.length > 0 && setShowDropdown(true)}
                placeholder="Paste number (any format)"
                className="pl-8"
                type="text"
                inputMode="tel"
                name="lims-mobile-search"
                autoComplete="new-password"
                data-form-type="other"
                data-lpignore="true"
                role="combobox"
                aria-autocomplete="list"
              />
            </div>
            {mobileNumber && (
              <p className="text-xs text-muted-foreground mt-1">
                Formatted: {mobileNumber.replace(/\D/g, "").slice(-10) || "Need 10+ digits"}
                {mobileNumber.replace(/\D/g, "").slice(-10).length === 10 && " ✓"}
              </p>
            )}
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
              <Label className={triedSave && !title ? "text-destructive" : ""}>Title *</Label>
              <Select value={title} onValueChange={setTitle}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{TITLES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className={triedSave && !gender ? "text-destructive" : ""}>Gender *</Label>
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
            <Label className={triedSave && !patientName.trim() ? "text-destructive" : ""}>Patient Name *</Label>
            <Input value={patientName} onChange={e => setPatientName(e.target.value.toUpperCase())} placeholder="Full name" className="uppercase" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {isPickup ? (
              <div>
                <Label>Age</Label>
                <Input value={manualAge} onChange={e => setManualAge(e.target.value)} placeholder="e.g. 35 Years" />
              </div>
            ) : (
              <div>
                <Label className={triedSave && !dob ? "text-destructive" : ""}>DOB *</Label>
                <Input type="date" value={dob} onChange={e => setDob(e.target.value)} />
                {age && <p className="text-xs text-muted-foreground mt-1">Age: {age}</p>}
              </div>
            )}
            {!isPickup && (
              <div>
                <Label>Doctor Name</Label>
                <Input value={doctorName} onChange={e => setDoctorName(e.target.value.toUpperCase())} placeholder="SELF" className="uppercase" />
              </div>
            )}
          </div>

          {/* Email toggle */}
          <div>
            <button type="button" className="text-xs text-primary flex items-center gap-1" onClick={() => setShowEmail(!showEmail)}>
              {showEmail ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {showEmail ? "Hide Email" : "Add Email (optional)"}
            </button>
            {showEmail && (
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="patient@email.com" className="mt-1" />
            )}
          </div>

          {/* Address (above visit type, hidden for pickup point) */}
          {visitType !== "pickup_point" && (
            <div>
              <Label className={triedSave && !address.trim() ? "text-destructive" : ""}>Address *</Label>
              <Input value={address} onChange={e => setAddress(e.target.value.toUpperCase())} placeholder="Patient address" className="uppercase" />
            </div>
          )}

          {/* Channel - hidden for pickup point */}
          {!isPickup && (
            <div>
              <Label>Channel (optional)</Label>
              <Select value={channelId} onValueChange={(v) => { setChannelId(v === "__none__" ? "" : v); }}>
                <SelectTrigger><SelectValue placeholder="No channel selected" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {channels.map((ch: any) => (
                    <SelectItem key={ch.id} value={ch.id}>{ch.name} ({ch.billing_type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedChannel && (
                <p className="text-xs text-muted-foreground mt-1">
                  {selectedChannel.billing_type === "credit" ? "Credit channel — no payment required now" : `Debit channel • Default discount: ${selectedChannel.default_discount_pct}%`}
                </p>
              )}
            </div>
          )}

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
                <RadioGroupItem value="pickup_point" id="pickup" disabled={!!channelId} /><Label htmlFor="pickup" className={`cursor-pointer text-sm ${channelId ? "opacity-50" : ""}`}>Pickup Point</Label>
              </div>
            </RadioGroup>
          </div>

          {/* Report Language - hidden for pickup point */}
          {visitType !== "pickup_point" && (
            <div>
              <Label>Report Language</Label>
              <Select value={reportLanguage} onValueChange={setReportLanguage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="English">English</SelectItem>
                  <SelectItem value="Hindi">Hindi</SelectItem>
                  <SelectItem value="Gujarati">Gujarati</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {visitType === "pickup_point" && !channelId && (
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


          {/* Test Selection */}
          <div>
            <Label>Select Tests *</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={testSearch}
                onChange={e => { setTestSearch(e.target.value); setTestHighlightIndex(0); }}
                placeholder="Search tests... (↑↓ to navigate, Enter to select)"
                className="pl-8"
                onKeyDown={(e) => {
                  const visible = testSearch ? availableTests.slice(0, 20) : [];
                  if (visible.length === 0) return;
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setTestHighlightIndex(prev => Math.min(prev + 1, visible.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setTestHighlightIndex(prev => Math.max(prev - 1, 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const idx = testHighlightIndex >= 0 && testHighlightIndex < visible.length ? testHighlightIndex : 0;
                    addTest(visible[idx].id);
                    setTestHighlightIndex(0);
                  }
                }}
              />
            </div>
            {testSearch && availableTests.length > 0 && (
              <div className="border rounded-md mt-1 max-h-48 overflow-y-auto">
                {availableTests.slice(0, 20).map((t, i) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${i === testHighlightIndex ? "bg-accent" : "hover:bg-accent"}`}
                    onClick={() => { addTest(t.id); setTestHighlightIndex(0); }}
                    onMouseEnter={() => setTestHighlightIndex(i)}
                  >
                    {t.test_name} — ₹{getTestPrice(t)}{t.item_type === "package" ? " 📦" : t.item_type === "profile" ? " 📋" : ""}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedTests.length > 0 && (
            <div className="space-y-1">
              {selectedTests.map(t => (
                <div key={t.test_id} className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
                  <span className="text-sm font-medium whitespace-nowrap">{t.test_name}</span>
                  <span className="text-sm text-muted-foreground">₹{t.price}</span>
                  {t.fasting_required && <span className="text-xs text-destructive">Fasting</span>}
                  <div className="ml-auto flex items-center gap-1.5">
                    {t.discount_applicable && !isCreditPickup && !(channelId && selectedChannel) && (
                      <>
                        <Select value={t.individual_discount_type || ""} onValueChange={v => updateTestDiscount(t.test_id, "individual_discount_type", v || null)}>
                          <SelectTrigger className="w-16 h-7 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent><SelectItem value="percent">%</SelectItem><SelectItem value="amount">₹</SelectItem></SelectContent>
                        </Select>
                        {t.individual_discount_type && (
                          <Input type="number" className="w-16 h-7 text-xs" value={t.individual_discount_value || ""}
                            onChange={e => updateTestDiscount(t.test_id, "individual_discount_value", parseFloat(e.target.value) || 0)} />
                        )}
                      </>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeTest(t.test_id)}><X className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Global Discount - hidden for credit pickup points */}
          {isCreditPickup ? (
            <div className="rounded-lg border border-muted bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Credit pickup point — discount not applicable</p>
            </div>
          ) : channelId && selectedChannel ? (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-1">
              <Label className="text-sm font-semibold">Channel Discount Applied</Label>
              <p className="text-xs text-muted-foreground">
                {selectedChannel.name} — {selectedChannel.default_discount_pct}% discount auto-applied to eligible tests
              </p>
              {selectedTests.some(t => !t.discount_applicable) && (
                <p className="text-xs text-destructive">
                  * {selectedTests.filter(t => !t.discount_applicable).map(t => t.test_name).join(", ")} — discount not applicable
                </p>
              )}
            </div>
          ) : (
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
          )}

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
                  {Array.from(selectedModes).map(mode => {
                    const otherModesTotal = Array.from(selectedModes)
                      .filter(m => m !== mode)
                      .reduce((sum, m) => sum + (modeAmounts[m] || 0), 0);
                    const maxForThisMode = Math.max(0, calculations.finalAmount - otherModesTotal);
                    return (
                      <div key={mode}>
                        <Label className="text-xs">{mode} Amount</Label>
                        <Input
                          type="number"
                          min={0}
                          max={maxForThisMode}
                          value={modeAmounts[mode] || ""}
                          onChange={e => {
                            const val = parseFloat(e.target.value) || 0;
                            setModeAmounts(prev => ({ ...prev, [mode]: Math.min(val, maxForThisMode) }));
                          }}
                        />
                      </div>
                    );
                  })}
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

          {/* Remarks */}
          <div>
            <Label>Remarks</Label>
            <Input value={remarks} onChange={e => setRemarks(e.target.value.toUpperCase())} placeholder="Optional remarks" className="uppercase" />
          </div>

          {/* STAT Toggle */}
          <div className="flex items-center justify-between rounded-lg border border-destructive/30 p-3">
            <div className="flex items-center gap-2">
              {isStat && <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-destructive"></span></span>}
              <Label className="text-destructive font-semibold cursor-pointer" htmlFor="stat-toggle">STAT (Urgent)</Label>
            </div>
            <Switch id="stat-toggle" checked={isStat} onCheckedChange={setIsStat} className="data-[state=checked]:bg-destructive" />
          </div>

          <Button className="w-full" onClick={() => {
            setTriedSave(true);
            if (visitType === "home_visit" && (!homeVisitCharges || homeVisitCharges === 0)) {
              setShowHvcConfirm(true);
              return;
            }
            saveMutation.mutate();
          }} disabled={saveMutation.isPending || selectedTests.length === 0}>
            <Save className="h-4 w-4 mr-2" />Save & Generate Invoice
          </Button>
        </CardContent>
      </Card>

      {/* Home Visit Charges Confirmation Dialog */}
      {showHvcConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-lg p-6 max-w-sm w-full mx-4 shadow-lg space-y-4">
            <h3 className="font-semibold text-lg">Confirm Home Visit Charges</h3>
            <p className="text-sm text-muted-foreground">
              Home Visit Charges are blank (₹0). Are you sure you want to proceed without adding charges?
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowHvcConfirm(false)}>Go Back</Button>
              <Button variant="destructive" onClick={() => { setShowHvcConfirm(false); saveMutation.mutate(); }}>
                Yes, Save Without Charges
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PatientRegistration;
