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
import { Search, X, Save, Printer, Send, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { getTests, TestItem } from "@/lib/tests";
import { getCurrentUserName } from "@/lib/auth";
import { getAllSelectableTests } from "@/lib/allSelectableTests";
import { buildSampleTubeGroups } from "@/lib/sampleTubeGrouping";
import { registerPatientAtomic } from "@/lib/registerPatientAtomic";
import { useParamConflictHighlight } from "@/hooks/useParamConflictHighlight";
import InvoicePreview from "./InvoicePreview";
import PatientSelectDialog, { type PatientPick } from "./PatientSelectDialog";
import DoctorAutocomplete, { ensureDoctor } from "./DoctorAutocomplete";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

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
  item_type?: "test" | "profile" | "package" | "combo";
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
  const [showPatientPicker, setShowPatientPicker] = useState(false);
  const [pickerMobile, setPickerMobile] = useState("");
  const [patientLocked, setPatientLocked] = useState(false);
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
  const [duplicateRegInfo, setDuplicateRegInfo] = useState<{ umr: string; invoices: string[] } | null>(null);

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
    else if (["Baby Of", "Dr."].includes(title)) setGender("");
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

    // 1. Search patient_master (canonical source — includes legacy imports)
    const { data: pm } = await supabase.from("patient_master").select("*").ilike("mobile_number", `%${digits}%`).limit(10);
    (pm || []).forEach((p: any) => {
      const k = key(p.patient_name, p.mobile_number);
      if (!seen.has(k)) {
        seen.add(k);
        priority.push({
          source: p.source === "legacy" ? "Legacy" : "Patient Master",
          patient_name: p.patient_name, title: p.title, gender: p.gender,
          dob: p.date_of_birth, email: p.email,
          umr_number: p.umr_id, mobile_number: p.mobile_number, address: p.address,
        });
      }
    });

    // 2. Search patient_registrations (fallback for any UMR not yet in master)
    const { data: regs } = await supabase.from("patient_registrations").select("*").ilike("mobile_number", `%${digits}%`).eq("bill_cancelled", false).order("created_at", { ascending: false }).limit(10);
    (regs || []).forEach((r: any) => {
      const k = key(r.patient_name, r.mobile_number);
      if (!seen.has(k)) {
        seen.add(k);
        others.push({
          source: "Registered", patient_name: r.patient_name, title: r.title,
          gender: r.gender, dob: r.dob, email: r.email, doctor_name: r.doctor_name,
          umr_number: r.umr_number, mobile_number: r.mobile_number, address: r.address,
        });
      }
    });

    // 3. crm_contacts lookup removed — CRM module disabled (cost optimization 2026-04-28)

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

  const checkSameDayDuplicate = async (umr: string | null | undefined) => {
    const u = (umr || "").trim();
    if (!u) return;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const { data } = await supabase
      .from("patient_registrations")
      .select("invoice_number")
      .eq("umr_number", u)
      .eq("bill_cancelled", false)
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString());
    if (data && data.length > 0) {
      setDuplicateRegInfo({ umr: u, invoices: data.map((r: any) => r.invoice_number).filter(Boolean) });
    }
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
    checkSameDayDuplicate(p.umr_number);
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
      item_type: (t as any).item_type || "test",
    }]);
    setTestSearch("");
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const removeTest = (testId: string) => setSelectedTests(prev => prev.filter(t => t.test_id !== testId));

  const updateTestDiscount = (testId: string, field: string, value: any) => {
    setSelectedTests(prev => prev.map(t => t.test_id === testId ? { ...t, [field]: value } : t));
  };

  // Pickup-point eligibility filter: when a pickup point is selected and it does NOT
  // allow all tests, restrict the catalog to tests that have a configured custom price.
  const restrictToPickupPrices =
    visitType === "pickup_point" && !!pickupPointId && !selectedPickup?.allow_all_tests;
  const eligiblePickupTestIds = restrictToPickupPrices
    ? new Set(pickupPrices.map((pp: any) => pp.test_id))
    : null;

  const availableTests = tests.filter((t) =>
    !selectedTests.find(s => s.test_id === t.id) &&
    (testSearch === "" || t.test_name.toLowerCase().includes(testSearch.toLowerCase())) &&
    (!eligiblePickupTestIds || eligiblePickupTestIds.has(t.id))
  );

  // Highlight tests that share parameters with a larger selected test (fewer params → red).
  // Does not auto-remove; save remains allowed.
  const paramConflictSet = useParamConflictHighlight(selectedTests, "reg-param-conflicts");

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
      if (isPickup && !manualAge.trim()) throw new Error("Age is required for pickup point registrations");
      if (selectedTests.length === 0) throw new Error("Select at least one test");
      if (visitType !== "pickup_point" && !address.trim()) throw new Error("Address is required");
      if (paidAmount > calculations.finalAmount) throw new Error("Payment amount cannot exceed the final amount");

      const stampedBy = getCurrentUserName();
      if (!stampedBy) throw new Error("Please sign in again before saving the registration");

      // Invoice + new-patient UMR are allocated server-side inside
      // register_patient_atomic (same DB transaction) so concurrent
      // receptionists never clash. Existing patients keep their UMR.

      // Pickup point registrations skip UMR entirely.
      const finalUmr: string | null =
        visitType === "pickup_point" ? null : (umrNumber || null);

      const payments = Array.from(selectedModes)
        .filter(m => (modeAmounts[m] || 0) > 0)
        .map(m => ({ mode: m, amount: modeAmounts[m] || 0 }));

      const regData = {
        mobile_number: cleanMobile,
        patient_name: patientName.replace(/\s+/g, ' ').trim().toUpperCase(),
        title,
        gender,
        dob: dob || null,
        email: email || null,
        address: visitType === "pickup_point" ? (selectedPickup?.address || "") : address.replace(/\s+/g, ' ').trim().toUpperCase(),
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
        remarks: remarks.replace(/\s+/g, ' ').trim().toUpperCase() || null,
        is_stat: isStat,
        report_language: visitType === "pickup_point" ? "ENGLISH" : reportLanguage.toUpperCase(),
        registered_by: stampedBy,
      };

      const tubeGroups = await buildSampleTubeGroups(
        calculations.testDetails.map((t: any) => ({
          test_id: t.test_id,
          test_name: t.test_name,
          item_type: t.item_type || "test",
        })),
      );

      const reg = await registerPatientAtomic({
        registration: regData,
        tubes: tubeGroups,
        payment: {
          payments,
          total_amount: regData.paid_amount,
          gross_amount: calculations.totalAmount,
          discount_amount: calculations.totalDiscount,
          final_amount: calculations.finalAmount,
          paid_amount: regData.paid_amount,
          due_amount: regData.due_amount,
        },
      });

      // Add doctor to master list (history) — non-fatal
      ensureDoctor(doctorName);

      // Upsert patient_master keyed by UMR — skip for pickup_point (no UMR, B2B aggregator)
      const assignedUmr = (reg?.umr_number as string | null | undefined) || finalUmr;
      if (assignedUmr && !umrNumber) setUmrNumber(assignedUmr);
      if (visitType !== "pickup_point" && assignedUmr) {
        const { data: existing } = await supabase.from("patient_master").select("id").eq("umr_id", assignedUmr).limit(1).maybeSingle();
        const cleanName = patientName.replace(/\s+/g, ' ').trim().toUpperCase();
        const cleanAddr = address ? address.replace(/\s+/g, ' ').trim().toUpperCase() : "";
        if (existing) {
          const upd: any = { last_visit_date: new Date().toISOString() };
          if (cleanName) upd.patient_name = cleanName;
          if (title) upd.title = title;
          if (cleanMobile) upd.mobile_number = cleanMobile;
          if (gender) upd.gender = gender;
          if (dob) upd.date_of_birth = dob;
          if (email) upd.email = email;
          if (cleanAddr) upd.address = cleanAddr;
          await supabase.from("patient_master").update(upd).eq("id", existing.id);
        } else {
          await supabase.from("patient_master").insert({
            patient_name: cleanName,
            title: title || null,
            mobile_number: cleanMobile,
            gender,
            date_of_birth: dob || null,
            email: email || null,
            address: cleanAddr || null,
            umr_id: assignedUmr,
            source: "lims",
            last_visit_date: new Date().toISOString(),
            first_visit_date: new Date().toISOString(),
          } as any);
        }

        // Sync demographics across all previous registrations with same UMR
        const demoUpdates: any = {
          patient_name: patientName.replace(/\s+/g, ' ').trim().toUpperCase(),
          title,
          gender,
          dob: dob || null,
          email: email || null,
          address: cleanAddr,
          doctor_name: (doctorName || "SELF").toUpperCase(),
          mobile_number: cleanMobile,
        };
        await supabase
          .from("patient_registrations")
          .update(demoUpdates)
          .eq("umr_number", assignedUmr)
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
    setPatientLocked(false); setShowPatientPicker(false); setPickerMobile("");
  };

  const handlePatientPicked = (p: PatientPick) => {
    setMobileNumber(p.mobile_number);
    setPatientName(p.patient_name || "");
    setTitle(p.title || "");
    setGender(p.gender || "");
    setDob(p.dob || "");
    setAddress(p.address || "");
    setUmrNumber(p.umr_number || "");
    if (p.email) { setEmail(p.email); setShowEmail(true); }
    if (p.doctor_name) setDoctorName(p.doctor_name);
    setPatientLocked(true);
    setShowPatientPicker(false);
    checkSameDayDuplicate(p.umr_number);
  };

  const handleNewPatient = (mobile10: string) => {
    setMobileNumber(mobile10);
    setUmrNumber("");
    setPatientLocked(false);
    setShowPatientPicker(false);
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

      <PatientSelectDialog
        open={showPatientPicker}
        mobile10={pickerMobile}
        onClose={() => setShowPatientPicker(false)}
        onSelect={handlePatientPicked}
        onNewPatient={handleNewPatient}
      />

      <AlertDialog open={!!duplicateRegInfo} onOpenChange={(o) => { if (!o) setDuplicateRegInfo(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Duplicate Registration Today</AlertDialogTitle>
            <AlertDialogDescription>
              This patient (UMR <span className="font-mono">{duplicateRegInfo?.umr}</span>) has already been registered today
              {duplicateRegInfo && duplicateRegInfo.invoices.length > 0 && (
                <> under invoice <span className="font-mono">{duplicateRegInfo.invoices.join(", ")}</span></>
              )}
              . Do you still want to continue with a new registration?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setDuplicateRegInfo(null); resetForm(); }}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => setDuplicateRegInfo(null)}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card>
        <CardContent className="p-4 space-y-4">
          {/* Mobile Number + Pickup Point (side-by-side) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="relative">
              <Label className={triedSave && (!mobileNumber || mobileNumber.replace(/\D/g, "").slice(-10).length < 10) ? "text-destructive" : ""}>Mobile Number *</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={mobileNumber}
                  onChange={(e) => {
                    if (patientLocked) return;
                    const v = e.target.value;
                    setMobileNumber(v);
                    const digits = v.replace(/\D/g, "").slice(-10);
                    if (digits.length === 10) {
                      setPickerMobile(digits);
                      setShowPatientPicker(true);
                    }
                  }}
                  placeholder="Paste number (any format)"
                  className="pl-8"
                  type="text"
                  inputMode="tel"
                  name="lims-mobile-search"
                  autoComplete="new-password"
                  data-form-type="other"
                  data-lpignore="true"
                  readOnly={patientLocked}
                />
              </div>
              {mobileNumber && (
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                  <span>
                    Formatted: {mobileNumber.replace(/\D/g, "").slice(-10) || "Need 10+ digits"}
                    {mobileNumber.replace(/\D/g, "").slice(-10).length === 10 && " ✓"}
                  </span>
                  {patientLocked && (
                    <button
                      type="button"
                      className="text-primary underline"
                      onClick={() => {
                        // Keep current patient locked until user actually picks
                        // a different patient or chooses "New Patient" in the dialog.
                        // If they cancel the dialog, the form stays locked to the
                        // previously selected patient.
                        const digits = mobileNumber.replace(/\D/g, "").slice(-10);
                        if (digits.length === 10) {
                          setPickerMobile(digits);
                          setShowPatientPicker(true);
                        }
                      }}
                    >
                      Change Patient
                    </button>
                  )}
                </p>
              )}
            </div>
            <div>
              <Label>Pickup Point</Label>
              <Select
                value={pickupPointId || "__none__"}
                onValueChange={(v) => {
                  if (v === "__none__") {
                    setPickupPointId("");
                    if (visitType === "pickup_point") setVisitType("lab_visit");
                  } else {
                    setPickupPointId(v);
                    setVisitType("pickup_point");
                    setChannelId("");
                  }
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select pickup point (optional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {pickupPoints.map((pp: any) => (
                    <SelectItem key={pp.id} value={pp.id}>{pp.name} ({pp.billing_type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPickup && visitType === "pickup_point" && (
                <p className="text-xs text-muted-foreground mt-1">
                  {selectedPickup.billing_type === "credit" ? "Credit billing — no payment now" : `Debit • ${selectedPickup.default_discount_pct}% disc`}
                </p>
              )}
            </div>
          </div>

          {/* Demographics */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={triedSave && !title ? "text-destructive" : ""}>Title *</Label>
              <Select value={title} onValueChange={setTitle} disabled={patientLocked}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{TITLES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className={triedSave && !gender ? "text-destructive" : ""}>Gender *</Label>
              <Select key={gender || "empty"} value={gender} onValueChange={setGender} disabled={patientLocked}>
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
            <Input value={patientName} onChange={e => setPatientName(e.target.value.toUpperCase())} placeholder="Full name" className="uppercase" disabled={patientLocked} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {isPickup ? (
              <div>
                <Label className={triedSave && !manualAge.trim() ? "text-destructive" : ""}>Age *</Label>
                <Input value={manualAge} onChange={e => setManualAge(e.target.value)} placeholder="e.g. 35 Years" />
              </div>
            ) : (
              <div>
                <Label className={triedSave && !dob ? "text-destructive" : ""}>DOB *</Label>
                <Input type="date" value={dob} onChange={e => setDob(e.target.value)} disabled={patientLocked} />
                {age && <p className="text-xs text-muted-foreground mt-1">Age: {age}</p>}
              </div>
            )}
            {!isPickup && (
              <div>
                <Label>Doctor Name</Label>
                <DoctorAutocomplete value={doctorName} onChange={setDoctorName} placeholder="SELF" />
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
              <Input value={address} onChange={e => setAddress(e.target.value.toUpperCase())} placeholder="Patient address" className="uppercase" disabled={patientLocked} />
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
            {restrictToPickupPrices && pickupPrices.length === 0 && (
              <p className="text-xs text-destructive mt-1">
                No tests configured for this pickup point. Add prices in Settings → Pickup Points → Custom Pricing, or enable "Allow all tests during registration".
              </p>
            )}
            {restrictToPickupPrices && pickupPrices.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Showing only tests configured for this pickup point ({pickupPrices.length} eligible).
              </p>
            )}
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
                    {t.test_name} — ₹{getTestPrice(t)}{t.item_type === "package" ? " 📦" : t.item_type === "combo" ? " 🧩" : t.item_type === "profile" ? " 📋" : ""}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedTests.length > 0 && (
            <div className="space-y-1">
              {paramConflictSet.size > 0 && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Red tests share parameters with a larger test — prefer removing them (saving without removal is allowed).
                </p>
              )}
              {selectedTests.map(t => {
                const conflicted = paramConflictSet.has(t.test_id);
                return (
                  <div
                    key={t.test_id}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${
                      conflicted ? "border-destructive bg-destructive/10" : ""
                    }`}
                  >
                    <span className={`text-sm font-medium whitespace-nowrap ${conflicted ? "text-destructive" : ""}`}>
                      {t.test_name}
                    </span>
                    <span className={`text-sm ${conflicted ? "text-destructive/80" : "text-muted-foreground"}`}>₹{t.price}</span>
                    {conflicted && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-destructive">
                        Duplicate params
                      </span>
                    )}
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
                );
              })}
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
      <AlertDialog open={showHvcConfirm} onOpenChange={setShowHvcConfirm}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <div className="mx-auto mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <AlertDialogTitle className="text-center">Home Visit Charges Missing</AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              Home Visit Charges are blank (₹0). Do you want to save without adding charges?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-center gap-2">
            <AlertDialogCancel className="mt-0">Go Back</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setShowHvcConfirm(false); saveMutation.mutate(); }}
            >
              Save Without Charges
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default PatientRegistration;
