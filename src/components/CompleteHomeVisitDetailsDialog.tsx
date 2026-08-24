import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Search, X, Save, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { getAllSelectableTests } from "@/lib/allSelectableTests";
import { useParamConflictHighlight } from "@/hooks/useParamConflictHighlight";
import SelectedTestContentsButton from "@/components/lims/SelectedTestContentsButton";
import { findPatientMasterByMobile } from "@/lib/findPatientUmr";
import {
  isoToDmy,
  maskDmyDob,
  normalizeGender,
  normalizeTitle,
  genderFromTitle,
  PATIENT_TITLES,
  toDateInputValue,
} from "@/lib/normalizePatientFields";
import PatientSelectDialog, { type PatientPick } from "@/components/lims/PatientSelectDialog";
import InvoicePreview from "@/components/lims/InvoicePreview";
import DoctorAutocomplete, { ensureDoctor } from "@/components/lims/DoctorAutocomplete";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const TITLES = [...PATIENT_TITLES];
const PAYMENT_MODES = ["Cash", "GPay", "Paytm", "Credit Card"];

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

interface Props {
  visit: any;
  open: boolean;
  onClose: () => void;
  /** Called after successful complete (status=Completed). Invoice may still be open. */
  onCompleted?: () => void;
}

const formatTime12hr = (time: string) => {
  if (!time) return "";
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
};

async function generateReceiptNumber(): Promise<string> {
  const now = new Date();
  const datePrefix = format(now, "ddMMyy");
  const todayStart = format(now, "yyyy-MM-dd");
  const { count } = await supabase
    .from("home_visits")
    .select("*", { count: "exact", head: true })
    .eq("status", "Completed")
    .gte("updated_at", `${todayStart}T00:00:00`);
  const seq = ((count || 0) + 1).toString().padStart(4, "0");
  return `HVR${datePrefix}${seq}`;
}

const CompleteHomeVisitDetailsDialog = ({ visit, open, onClose, onCompleted }: Props) => {
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const lastPopulatedVisitId = useRef<string | null>(null);
  const suppressPickerRef = useRef(false);

  const est = visit?.estimates;

  const { data: estimateTestsFresh } = useQuery({
    queryKey: ["estimate_tests_complete_hv", est?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("estimate_tests")
        .select("id, test_id, test_name, price, fasting_required, discount_applicable, individual_discount_type, individual_discount_value, item_type")
        .eq("estimate_id", est.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!est?.id && open,
  });

  const { data: estimateMeta } = useQuery({
    queryKey: ["estimate_meta_complete_hv", est?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("estimates")
        .select("id, title, patient_name, gender, email, doctor_name, umr_number, dob, whatsapp_number, total_amount, discount_amount, home_visit_charges, final_amount, global_discount_type, global_discount_value, status")
        .eq("id", est.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!est?.id && open,
  });

  const { data: tests = [] } = useQuery({ queryKey: ["all_selectable_tests"], queryFn: getAllSelectableTests });
  const { data: phlebotomists = [] } = useQuery({
    queryKey: ["phlebotomists", "active"],
    queryFn: async () => {
      const { data } = await supabase.from("phlebotomists").select("*").eq("status", "Active");
      return data || [];
    },
  });

  const [mobileNumber, setMobileNumber] = useState("");
  const [showPatientPicker, setShowPatientPicker] = useState(false);
  const [pickerMobile, setPickerMobile] = useState("");
  const [patientLocked, setPatientLocked] = useState(false);
  const [filledOnLock, setFilledOnLock] = useState({
    title: false,
    gender: false,
    dob: false,
    address: false,
  });
  const [patientChoiceResolved, setPatientChoiceResolved] = useState(false);
  const [registerAsNewPatient, setRegisterAsNewPatient] = useState(false);
  const [linkedUmrNumber, setLinkedUmrNumber] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [patientName, setPatientName] = useState("");
  const [gender, setGender] = useState("");
  const [dob, setDob] = useState("");
  const [dobDisplay, setDobDisplay] = useState("");
  const [email, setEmail] = useState("");
  const [showEmail, setShowEmail] = useState(false);
  const [doctorName, setDoctorName] = useState("SELF");
  const [address, setAddress] = useState("");

  const [isStat, setIsStat] = useState(false);
  const [reportLanguage, setReportLanguage] = useState("English");

  const [testSearch, setTestSearch] = useState("");
  const [selectedTests, setSelectedTests] = useState<SelectedTest[]>([]);
  const [testHighlightIndex, setTestHighlightIndex] = useState(-1);
  const [globalDiscountType, setGlobalDiscountType] = useState<"percent" | "amount">("percent");
  const [globalDiscountValue, setGlobalDiscountValue] = useState(0);
  const [allowIneligibleDiscount, setAllowIneligibleDiscount] = useState(false);
  const [homeVisitCharges, setHomeVisitCharges] = useState(0);

  const [selectedModes, setSelectedModes] = useState<Set<string>>(new Set());
  const [modeAmounts, setModeAmounts] = useState<Record<string, number>>({});

  const [triedSave, setTriedSave] = useState(false);
  const [showHvcConfirm, setShowHvcConfirm] = useState(false);
  const [invoiceData, setInvoiceData] = useState<any>(null);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    setFormOpen(open);
  }, [open]);

  useEffect(() => {
    const g = genderFromTitle(title);
    if (g) setGender(g);
    else if (["Baby Of", "Dr."].includes(title)) setGender("");
  }, [title]);

  const age = useMemo(() => {
    if (!dob) return "";
    const diff = Date.now() - new Date(dob).getTime();
    return `${Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000))} Years`;
  }, [dob]);

  useEffect(() => {
    if (!open) {
      lastPopulatedVisitId.current = null;
      return;
    }
    if (!visit?.id || !est?.id) return;
    if (estimateTestsFresh === undefined || estimateMeta === undefined) return;
    if (lastPopulatedVisitId.current === visit.id) return;
    lastPopulatedVisitId.current = visit.id;

    suppressPickerRef.current = true;

    const meta = estimateMeta || est;
    setTitle(normalizeTitle(meta.title));
    setPatientName(meta.patient_name || "");
    setGender(normalizeGender(meta.gender));
    const nextDob = toDateInputValue(meta.dob);
    setDob(nextDob);
    setDobDisplay(isoToDmy(nextDob));
    setEmail(meta.email || "");
    setShowEmail(!!meta.email);
    setDoctorName(meta.doctor_name || "SELF");
    setAddress(String(visit.address || "").replace(/\s+/g, " ").trim().toUpperCase());
    setGlobalDiscountType((meta.global_discount_type as "percent" | "amount") || "percent");
    setGlobalDiscountValue(Number(meta.global_discount_value) || 0);
    setHomeVisitCharges(Number(meta.home_visit_charges) || 0);
    setAllowIneligibleDiscount(false);
    setIsStat(!!visit.is_stat);
    setReportLanguage(
      visit.report_language
        ? visit.report_language.charAt(0) + visit.report_language.slice(1).toLowerCase()
        : "English",
    );

    const mobile = String(meta.whatsapp_number || "").replace(/\D/g, "").slice(-10);
    setMobileNumber(mobile);

    if (visit.register_as_new_patient) {
      setRegisterAsNewPatient(true);
      setLinkedUmrNumber(null);
      setPatientChoiceResolved(true);
      setPatientLocked(false);
      setFilledOnLock({ title: false, gender: false, dob: false, address: false });
    } else if (visit.linked_umr_number) {
      setLinkedUmrNumber(visit.linked_umr_number);
      setRegisterAsNewPatient(false);
      setPatientChoiceResolved(true);
      setPatientLocked(true);
      setFilledOnLock({
        title: !!normalizeTitle(meta.title),
        gender: !!normalizeGender(meta.gender),
        dob: !!nextDob,
        address: !!String(visit.address || "").trim(),
      });
    } else {
      setRegisterAsNewPatient(false);
      setLinkedUmrNumber(null);
      setPatientChoiceResolved(false);
      setPatientLocked(false);
      setFilledOnLock({ title: false, gender: false, dob: false, address: false });
    }

    const existingTests: SelectedTest[] = (estimateTestsFresh || [])
      .filter((t: any) => !!t.test_id)
      .map((t: any) => ({
        test_id: t.test_id,
        test_name: t.test_name,
        price: Number(t.price),
        fasting_required: !!t.fasting_required,
        discount_applicable: t.discount_applicable !== false,
        individual_discount_type: t.individual_discount_type || null,
        individual_discount_value: Number(t.individual_discount_value) || 0,
        item_type: (t.item_type as any) || "test",
      }));
    setSelectedTests(existingTests);
    setTestSearch("");
    setSelectedModes(new Set());
    setModeAmounts({});
    setTriedSave(false);
    setShowHvcConfirm(false);
    setInvoiceData(null);

    window.setTimeout(() => {
      suppressPickerRef.current = false;
      if (
        mobile.length === 10 &&
        !visit.register_as_new_patient &&
        !visit.linked_umr_number
      ) {
        setPickerMobile(mobile);
        setShowPatientPicker(true);
      }
    }, 100);
  }, [open, visit, est, estimateMeta, estimateTestsFresh]);

  const applyPickedDemographics = (p: {
    mobile_number?: string | null;
    patient_name?: string | null;
    title?: string | null;
    gender?: string | null;
    dob?: string | null;
    email?: string | null;
    doctor_name?: string | null;
    umr_number?: string | null;
    address?: string | null;
  }) => {
    if (p.mobile_number) setMobileNumber(p.mobile_number.replace(/\D/g, "").slice(-10) || p.mobile_number);
    if (p.patient_name) setPatientName(String(p.patient_name).toUpperCase());
    setTitle(normalizeTitle(p.title));
    setGender(normalizeGender(p.gender));
    const nextDob = toDateInputValue(p.dob);
    setDob(nextDob);
    setDobDisplay(isoToDmy(nextDob));
    setAddress(String(p.address || address || "").replace(/\s+/g, " ").trim().toUpperCase());
    if (p.email) {
      setEmail(p.email);
      setShowEmail(true);
    }
    if (p.doctor_name) setDoctorName(p.doctor_name);
  };

  const handlePatientPicked = (p: PatientPick) => {
    applyPickedDemographics(p);
    setFilledOnLock({
      title: !!normalizeTitle(p.title),
      gender: !!normalizeGender(p.gender),
      dob: !!toDateInputValue(p.dob),
      address: !!String(p.address || "").trim(),
    });
    setPatientLocked(true);
    setRegisterAsNewPatient(false);
    setLinkedUmrNumber(p.umr_number || null);
    setPatientChoiceResolved(true);
    setShowPatientPicker(false);
  };

  const handleNewPatient = (mobile10: string) => {
    setMobileNumber(mobile10);
    setLinkedUmrNumber(null);
    setRegisterAsNewPatient(true);
    setPatientChoiceResolved(true);
    setPatientLocked(false);
    setFilledOnLock({ title: false, gender: false, dob: false, address: false });
    setShowPatientPicker(false);
  };

  const addTest = (testId: string) => {
    const t = tests.find((x) => x.id === testId);
    if (!t || selectedTests.find((s) => s.test_id === testId)) return;
    setSelectedTests((prev) => [
      ...prev,
      {
        test_id: t.id,
        test_name: t.test_name,
        price: Number(t.price),
        fasting_required: t.fasting_required,
        discount_applicable: t.discount_applicable,
        individual_discount_type: null,
        individual_discount_value: 0,
        item_type: (t as any).item_type || "test",
      },
    ]);
    setTestSearch("");
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const removeTest = (testId: string) => setSelectedTests((prev) => prev.filter((t) => t.test_id !== testId));

  const updateTestDiscount = (testId: string, field: string, value: any) => {
    setSelectedTests((prev) => prev.map((t) => (t.test_id === testId ? { ...t, [field]: value } : t)));
  };

  const availableTests = tests.filter(
    (t) =>
      !selectedTests.find((s) => s.test_id === t.id) &&
      (testSearch === "" || t.test_name.toLowerCase().includes(testSearch.toLowerCase())),
  );

  const paramConflictSet = useParamConflictHighlight(open ? selectedTests : [], "complete-hv-param-conflicts");

  const isDiscountAllowed = (t: { discount_applicable?: boolean }) =>
    !!t.discount_applicable || allowIneligibleDiscount;

  const calculations = useMemo(() => {
    let totalAmount = 0;
    let totalDiscount = 0;
    const testDetails = selectedTests.map((t) => {
      totalAmount += t.price;
      let discount = 0;
      const discountOk = isDiscountAllowed(t);
      const hasIndividual = t.individual_discount_type && t.individual_discount_value > 0 && discountOk;
      if (hasIndividual) {
        discount =
          t.individual_discount_type === "percent"
            ? (t.price * t.individual_discount_value) / 100
            : t.individual_discount_value;
      } else if (discountOk && globalDiscountValue > 0) {
        discount =
          globalDiscountType === "percent"
            ? (t.price * globalDiscountValue) / 100
            : globalDiscountValue;
      }
      discount = Math.min(discount, t.price);
      totalDiscount += discount;
      return { ...t, discountedPrice: t.price - discount, discount, discounted_price: t.price - discount };
    });
    const hvc = homeVisitCharges;
    const finalAmount = totalAmount - totalDiscount + hvc;
    return { totalAmount, totalDiscount, finalAmount, testDetails, homeVisitCharges: hvc };
  }, [selectedTests, globalDiscountType, globalDiscountValue, homeVisitCharges, allowIneligibleDiscount]);

  const toggleMode = (mode: string) => {
    setSelectedModes((prev) => {
      const next = new Set(prev);
      if (next.has(mode)) {
        next.delete(mode);
        setModeAmounts((a) => {
          const n = { ...a };
          delete n[mode];
          return n;
        });
      } else next.add(mode);
      return next;
    });
  };

  const paidAmount = useMemo(
    () => Array.from(selectedModes).reduce((sum, mode) => sum + (modeAmounts[mode] || 0), 0),
    [selectedModes, modeAmounts],
  );
  const dueAmount = Math.max(0, calculations.finalAmount - paidAmount);

  const modeStr = useMemo(
    () =>
      Array.from(selectedModes)
        .filter((m) => (modeAmounts[m] || 0) > 0)
        .map((m) => `${m}: ₹${modeAmounts[m] || 0}`)
        .join(", "),
    [selectedModes, modeAmounts],
  );

  const payments = useMemo(
    () =>
      Array.from(selectedModes)
        .filter((m) => (modeAmounts[m] || 0) > 0)
        .map((m) => ({ mode: m, amount: modeAmounts[m] || 0 })),
    [selectedModes, modeAmounts],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const cleanMobile = mobileNumber.replace(/\D/g, "").slice(-10);
      if (!cleanMobile || cleanMobile.length < 10) throw new Error("Valid mobile number required");
      if (!patientName.trim()) throw new Error("Patient name is required");
      if (!title) throw new Error("Title is required");
      if (!gender) throw new Error("Gender is required");
      if (!dob) throw new Error("Date of birth is required");
      if (!address.trim()) throw new Error("Address is required");
      if (selectedTests.length === 0) throw new Error("Select at least one test");
      if (paidAmount > calculations.finalAmount) throw new Error("Payment amount cannot exceed the final amount");

      const masterRows = await findPatientMasterByMobile(cleanMobile);
      if (masterRows.length > 0 && !patientChoiceResolved) {
        setPickerMobile(cleanMobile);
        setShowPatientPicker(true);
        throw new Error("Select which patient this visit is for");
      }

      const isNewPatient = registerAsNewPatient || masterRows.length === 0;
      const linkedUmr = isNewPatient ? null : linkedUmrNumber;
      if (!isNewPatient && !linkedUmr) {
        setPickerMobile(cleanMobile);
        setShowPatientPicker(true);
        throw new Error("Select which patient this visit is for");
      }

      const cleanName = patientName.replace(/\s+/g, " ").trim().toUpperCase();
      const cleanAddress = address.replace(/\s+/g, " ").trim().toUpperCase();
      const receiptNumber = await generateReceiptNumber();

      const { error: estError } = await supabase
        .from("estimates")
        .update({
          title: title || null,
          patient_name: cleanName,
          gender: gender || null,
          email: email || null,
          doctor_name: (doctorName || "SELF").toUpperCase(),
          umr_number: linkedUmr,
          dob: dob || null,
          whatsapp_number: cleanMobile,
          total_amount: calculations.totalAmount,
          discount_amount: calculations.totalDiscount,
          home_visit_charges: calculations.homeVisitCharges,
          final_amount: calculations.finalAmount,
          global_discount_type: globalDiscountValue > 0 ? globalDiscountType : null,
          global_discount_value: globalDiscountValue,
        })
        .eq("id", est.id);
      if (estError) throw estError;

      const { error: delError } = await supabase.from("estimate_tests").delete().eq("estimate_id", est.id);
      if (delError) throw delError;

      const testRows = calculations.testDetails.map((t) => ({
        estimate_id: est.id,
        test_id: t.test_id,
        test_name: t.test_name,
        price: t.price,
        fasting_required: t.fasting_required,
        discount_applicable: t.discount_applicable,
        individual_discount_type: t.individual_discount_type,
        individual_discount_value: t.individual_discount_value,
        discounted_price: t.discountedPrice,
        item_type: t.item_type || "test",
      }));
      const { error: insertError } = await supabase.from("estimate_tests").insert(testRows);
      if (insertError) throw insertError;

      const { error: visitError } = await supabase
        .from("home_visits")
        .update({
          status: "Completed",
          address: cleanAddress,
          paid_amount: paidAmount,
          due_amount: dueAmount,
          payment_mode: modeStr || null,
          payment_remarks: null,
          linked_umr_number: linkedUmr,
          register_as_new_patient: isNewPatient,
          is_stat: isStat,
          report_language: reportLanguage,
          completion_receipt_number: receiptNumber,
        } as any)
        .eq("id", visit.id);
      if (visitError) throw visitError;

      await ensureDoctor(doctorName);

      return {
        receiptNumber,
        cleanMobile,
        cleanName,
        linkedUmr,
        isNewPatient,
      };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["home_visits"] });
      qc.invalidateQueries({ queryKey: ["estimates"] });
      toast.success(`Home visit completed! Receipt: ${result.receiptNumber}`);

      setInvoiceData({
        invoice_number: result.receiptNumber,
        patient_name: result.cleanName,
        title,
        gender,
        dob,
        mobile_number: result.cleanMobile,
        umr_number: result.linkedUmr,
        address: address.replace(/\s+/g, " ").trim().toUpperCase(),
        doctor_name: (doctorName || "SELF").toUpperCase(),
        visit_type: "home_visit",
        is_stat: isStat,
        report_language: reportLanguage,
        tests: calculations.testDetails,
        calculations,
        paid_amount: paidAmount,
        due_amount: dueAmount,
        payments,
        home_visit_charges: calculations.homeVisitCharges,
        final_amount: calculations.finalAmount,
        created_at: new Date().toISOString(),
      });

      setFormOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSave = () => {
    setTriedSave(true);
    if (!homeVisitCharges || homeVisitCharges === 0) {
      setShowHvcConfirm(true);
      return;
    }
    saveMutation.mutate();
  };

  const phleboName = phlebotomists.find((p: any) => p.id === visit?.phlebotomist_id)?.name || "Not assigned";

  return (
    <>
      {invoiceData && (
        <InvoicePreview
          data={invoiceData}
          open={!!invoiceData}
          onClose={() => {
            setInvoiceData(null);
            onCompleted?.();
          }}
          hidePrint
          autoQueueWhatsApp
        />
      )}

      {visit && (
      <>
      <PatientSelectDialog
        open={showPatientPicker}
        mobile10={pickerMobile}
        onClose={() => setShowPatientPicker(false)}
        onSelect={handlePatientPicked}
        onNewPatient={handleNewPatient}
      />

      <Dialog open={formOpen} onOpenChange={(o) => { if (!o && !invoiceData) onClose(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Complete Home Visit Details</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Label>Visit Type</Label>
              <Badge variant="secondary">Home Visit</Badge>
            </div>

            <div>
              <Label className={triedSave && (!mobileNumber || mobileNumber.replace(/\D/g, "").slice(-10).length < 10) ? "text-destructive" : ""}>
                Mobile Number *
              </Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={mobileNumber}
                  onChange={(e) => {
                    if (patientLocked) return;
                    const v = e.target.value;
                    setMobileNumber(v);
                    if (suppressPickerRef.current) return;
                    const digits = v.replace(/\D/g, "").slice(-10);
                    if (digits.length === 10) {
                      setPickerMobile(digits);
                      setShowPatientPicker(true);
                      setPatientChoiceResolved(false);
                    }
                  }}
                  placeholder="Paste number (any format)"
                  className="pl-8"
                  type="text"
                  inputMode="tel"
                  autoComplete="new-password"
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
                  {registerAsNewPatient && (
                    <Badge variant="outline" className="text-xs">New patient</Badge>
                  )}
                  {linkedUmrNumber && (
                    <Badge variant="outline" className="text-xs font-mono">{linkedUmrNumber}</Badge>
                  )}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className={triedSave && !title ? "text-destructive" : ""}>Title *</Label>
                <Select value={title || undefined} onValueChange={setTitle} disabled={patientLocked && filledOnLock.title}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{TITLES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className={triedSave && !gender ? "text-destructive" : ""}>Gender *</Label>
                <Select key={gender || "empty"} value={gender || undefined} onValueChange={setGender} disabled={patientLocked && filledOnLock.gender}>
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
              <Input
                value={patientName}
                onChange={(e) => setPatientName(e.target.value.toUpperCase())}
                placeholder="Full name"
                className="uppercase"
                disabled={patientLocked}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className={triedSave && !dob ? "text-destructive" : ""}>DOB * (dd-mm-yyyy)</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={dobDisplay}
                  maxLength={10}
                  placeholder="dd-mm-yyyy"
                  autoComplete="off"
                  disabled={patientLocked && filledOnLock.dob}
                  onChange={(e) => {
                    const next = maskDmyDob(e.target.value);
                    setDobDisplay(next.display);
                    setDob(next.iso);
                  }}
                />
                {age && <p className="text-xs text-muted-foreground mt-1">Age: {age}</p>}
              </div>
              <div>
                <Label>Doctor Name</Label>
                <DoctorAutocomplete value={doctorName} onChange={setDoctorName} placeholder="SELF" />
              </div>
            </div>

            <div>
              <button type="button" className="text-xs text-primary flex items-center gap-1" onClick={() => setShowEmail(!showEmail)}>
                {showEmail ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showEmail ? "Hide Email" : "Add Email (optional)"}
              </button>
              {showEmail && (
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="patient@email.com" className="mt-1" />
              )}
            </div>

            <div>
              <Label className={triedSave && !address.trim() ? "text-destructive" : ""}>Address *</Label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value.toUpperCase())}
                placeholder="Patient address"
                className="uppercase"
                disabled={patientLocked && filledOnLock.address}
              />
            </div>

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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Visit Date</Label>
                <Input
                  type="text"
                  readOnly
                  disabled
                  className="bg-muted"
                  value={visit.visit_date ? visit.visit_date.split("-").reverse().join("-") : ""}
                />
              </div>
              <div>
                <Label>Visit Time</Label>
                <Input type="text" readOnly disabled className="bg-muted" value={formatTime12hr(visit.visit_time || "")} />
              </div>
            </div>

            <div>
              <Label>Phlebotomist</Label>
              <Input type="text" readOnly disabled className="bg-muted" value={phleboName} />
            </div>

            <div>
              <Label>Select Tests *</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  ref={searchRef}
                  value={testSearch}
                  onChange={(e) => { setTestSearch(e.target.value); setTestHighlightIndex(0); }}
                  placeholder="Search tests... (↑↓ to navigate, Enter to select)"
                  className="pl-8"
                  onKeyDown={(e) => {
                    const visible = testSearch ? availableTests.slice(0, 20) : [];
                    if (visible.length === 0) return;
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setTestHighlightIndex((prev) => Math.min(prev + 1, visible.length - 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setTestHighlightIndex((prev) => Math.max(prev - 1, 0));
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
                      {t.test_name} — ₹{t.price}
                      {t.item_type === "package" ? " 📦" : t.item_type === "combo" ? " 🧩" : t.item_type === "profile" ? " 📋" : ""}
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
                {selectedTests.map((t) => {
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
                        {isDiscountAllowed(t) && (
                          <>
                            <Select value={t.individual_discount_type || ""} onValueChange={(v) => updateTestDiscount(t.test_id, "individual_discount_type", v || null)}>
                              <SelectTrigger className="w-16 h-7 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                              <SelectContent><SelectItem value="percent">%</SelectItem><SelectItem value="amount">₹</SelectItem></SelectContent>
                            </Select>
                            {t.individual_discount_type && (
                              <Input
                                type="number"
                                className="w-16 h-7 text-xs"
                                value={t.individual_discount_value || ""}
                                onChange={(e) => updateTestDiscount(t.test_id, "individual_discount_value", parseFloat(e.target.value) || 0)}
                              />
                            )}
                          </>
                        )}
                        {!t.discount_applicable && !allowIneligibleDiscount && (
                          <span className="text-[10px] text-destructive whitespace-nowrap">No disc.</span>
                        )}
                        <SelectedTestContentsButton item={t} />
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeTest(t.test_id)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-lg border p-3 bg-muted/20">
                <Switch
                  checked={allowIneligibleDiscount}
                  onCheckedChange={setAllowIneligibleDiscount}
                  id="complete-hv-allow-ineligible-discount"
                />
                <div className="space-y-0.5">
                  <Label htmlFor="complete-hv-allow-ineligible-discount" className="cursor-pointer">
                    Allow discount on non-eligible items
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    When on, global and per-item discounts apply to tests marked as not discount-eligible.
                  </p>
                </div>
              </div>

              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <Label>Global Discount</Label>
                  <div className="flex gap-2">
                    <Select value={globalDiscountType} onValueChange={(v: any) => setGlobalDiscountType(v)}>
                      <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="percent">%</SelectItem><SelectItem value="amount">₹</SelectItem></SelectContent>
                    </Select>
                    <Input type="number" value={globalDiscountValue || ""} onChange={(e) => setGlobalDiscountValue(parseFloat(e.target.value) || 0)} />
                  </div>
                  {!allowIneligibleDiscount && selectedTests.some((t) => !t.discount_applicable) && (
                    <p className="text-xs text-destructive mt-1">
                      * {selectedTests.filter((t) => !t.discount_applicable).map((t) => t.test_name).join(", ")} — discount not applicable
                      (turn on the toggle above to include them)
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div>
              <Label>Home Visit Charges (₹)</Label>
              <Input type="number" value={homeVisitCharges || ""} onChange={(e) => setHomeVisitCharges(parseFloat(e.target.value) || 0)} />
            </div>

            {selectedTests.length > 0 && (
              <div className="rounded-lg bg-muted p-4 space-y-1 text-sm">
                <div className="flex justify-between"><span>Gross Amount</span><span className="font-medium">₹{calculations.totalAmount}</span></div>
                {calculations.totalDiscount > 0 && (
                  <div className="flex justify-between text-primary"><span>Discount</span><span>-₹{calculations.totalDiscount}</span></div>
                )}
                {calculations.homeVisitCharges > 0 && (
                  <div className="flex justify-between"><span>Home Visit</span><span>+₹{calculations.homeVisitCharges}</span></div>
                )}
                <div className="flex justify-between border-t pt-1 font-bold"><span>Final Amount</span><span>₹{calculations.finalAmount}</span></div>
              </div>
            )}

            {selectedTests.length > 0 && (
              <div className="space-y-3">
                <Label className="text-base font-semibold">Payment</Label>
                <div className="grid grid-cols-2 gap-2">
                  {PAYMENT_MODES.map((mode) => (
                    <label
                      key={mode}
                      className={`flex items-center gap-2 rounded-lg border p-2 cursor-pointer transition-colors text-sm ${
                        selectedModes.has(mode) ? "border-primary bg-primary/5" : "border-border"
                      }`}
                    >
                      <Checkbox checked={selectedModes.has(mode)} onCheckedChange={() => toggleMode(mode)} />
                      {mode}
                    </label>
                  ))}
                </div>
                {selectedModes.size > 0 && (
                  <div className="space-y-2">
                    {Array.from(selectedModes).map((mode) => {
                      const otherModesTotal = Array.from(selectedModes)
                        .filter((m) => m !== mode)
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
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              setModeAmounts((prev) => ({ ...prev, [mode]: Math.min(val, maxForThisMode) }));
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

            <div className="flex items-center justify-between rounded-lg border border-destructive/30 p-3">
              <div className="flex items-center gap-2">
                {isStat && (
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-destructive" />
                  </span>
                )}
                <Label className="text-destructive font-semibold cursor-pointer" htmlFor="complete-hv-stat-toggle">
                  STAT (Urgent)
                </Label>
              </div>
              <Switch id="complete-hv-stat-toggle" checked={isStat} onCheckedChange={setIsStat} className="data-[state=checked]:bg-destructive" />
            </div>

            <Button className="w-full" onClick={handleSave} disabled={saveMutation.isPending || selectedTests.length === 0}>
              <Save className="h-4 w-4 mr-2" />Save & Generate Invoice
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
      </>
      )}
    </>
  );
};

export default CompleteHomeVisitDetailsDialog;
