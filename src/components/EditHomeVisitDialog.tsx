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
import { X, Search, Send } from "lucide-react";
import { getAllSelectableTests } from "@/lib/allSelectableTests";
import TimeSlotPicker from "@/components/TimeSlotPicker";
import { usePhlebotomistAvailability } from "@/hooks/usePhlebotomistAvailability";
import { useMessageTemplates } from "@/hooks/useMessageTemplates";
import { buildVisitMessage, shareOnWhatsApp } from "@/lib/whatsapp";
import { logMessageSend } from "@/lib/messageLog";
import { format, addDays, parse, isValid, differenceInYears } from "date-fns";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";

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
  /** When true, date/time/phleb are disabled and save triggers onCompletionSave */
  completionMode?: boolean;
  onCompletionSave?: () => void;
}

const EditHomeVisitDialog = ({ visit, open, onClose, completionMode, onCompletionSave }: EditHomeVisitDialogProps) => {
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const { isAvailable, getUnavailableReason } = usePhlebotomistAvailability();
  const { data: templates } = useMessageTemplates();

  const est = visit?.estimates;

  // Patient demographic fields - only used in completionMode
  const [title, setTitle] = useState("");
  const [patientName, setPatientName] = useState("");
  const [gender, setGender] = useState("");
  const [email, setEmail] = useState("");
  const [doctorName, setDoctorName] = useState("SELF");
  const [umrInput, setUmrInput] = useState("");
  const [dob, setDob] = useState("");
  const [dobDisplay, setDobDisplay] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [visitTime, setVisitTime] = useState("");
  const [address, setAddress] = useState("");
  const [selectedTests, setSelectedTests] = useState<EditTest[]>([]);
  const [globalDiscountType, setGlobalDiscountType] = useState<"percent" | "amount">("percent");
  const [globalDiscountValue, setGlobalDiscountValue] = useState(0);
  const [homeVisitCharges, setHomeVisitCharges] = useState<string>("0");
  const [testSearch, setTestSearch] = useState("");
  const [testHighlightIndex, setTestHighlightIndex] = useState(-1);
  const [genderConfirmOpen, setGenderConfirmOpen] = useState(false);
  const [pendingGender, setPendingGender] = useState<"Male" | "Female" | "">("");
  const [attempted, setAttempted] = useState(false);
  const [phlebotomistId, setPhlebotomistId] = useState("");

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (val === "Mr." || val === "Master.") {
      setGender("Male");
    } else if (val === "Mrs." || val === "Ms." || val === "Miss.") {
      setGender("Female");
    } else if (val === "Dr." || val === "Baby Of.") {
      setGenderConfirmOpen(true);
      setPendingGender("");
    }
  };

  // Load all available tests
  const { data: allTests = [] } = useQuery({
    queryKey: ["all_selectable_tests"],
    queryFn: getAllSelectableTests,
  });

  const { data: phlebotomists = [] } = useQuery({
    queryKey: ["phlebotomists", "active"],
    queryFn: async () => { const { data } = await supabase.from("phlebotomists").select("*").eq("status", "Active"); return data || []; },
  });

  // DOB helpers
  const dobToDisplay = (isoDate: string) => {
    if (!isoDate) return "";
    const d = new Date(isoDate);
    if (!isValid(d)) return "";
    return format(d, "dd-MM-yyyy");
  };

  const handleDobDisplayChange = (val: string) => {
    let cleaned = val.replace(/[^\d-]/g, "");
    const digits = cleaned.replace(/-/g, "");
    if (digits.length >= 4) {
      cleaned = `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 8)}`;
    } else if (digits.length >= 2) {
      cleaned = `${digits.slice(0, 2)}-${digits.slice(2)}`;
    }
    setDobDisplay(cleaned);
    if (/^\d{2}-\d{2}-\d{4}$/.test(cleaned)) {
      const parsed = parse(cleaned, "dd-MM-yyyy", new Date());
      if (isValid(parsed) && parsed <= new Date()) {
        setDob(format(parsed, "yyyy-MM-dd"));
      } else {
        setDob("");
      }
    } else {
      setDob("");
    }
  };

  const calculatedAge = useMemo(() => {
    if (!dob) return "";
    const d = new Date(dob);
    if (!isValid(d)) return "";
    return String(differenceInYears(new Date(), d));
  }, [dob]);

  const handleVisitDateBlur = () => {
    const today = format(new Date(), "yyyy-MM-dd");
    if (visitDate && /^\d{4}-\d{2}-\d{2}$/.test(visitDate) && visitDate < today) {
      setVisitDate(today);
      toast.error("Past dates are not allowed");
    }
    if (visitDate === today && visitTime && visitTime < format(new Date(), "HH:mm")) {
      setVisitTime("");
      toast.error("Selected time has already passed");
    }
  };

  const handleVisitTimeBlur = () => {
    const today = format(new Date(), "yyyy-MM-dd");
    if (visitDate === today && visitTime && visitTime < format(new Date(), "HH:mm")) {
      setVisitTime("");
      toast.error("Past time is not allowed for today");
    }
  };

  // Populate form when visit changes
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
    setVisitDate(visit.visit_date || "");
    setVisitTime(visit.visit_time || "");
    setAddress(visit.address || "");
    setPhlebotomistId(visit.phlebotomist_id || "");
    setGlobalDiscountType((est.global_discount_type as "percent" | "amount") || "percent");
    setGlobalDiscountValue(Number(est.global_discount_value) || 0);
    setHomeVisitCharges(String(Number(est.home_visit_charges) || 0));

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

    const hvCharges = parseFloat(homeVisitCharges) || 0;
    const finalAmount = totalAmount - totalDiscount + hvCharges;
    return { totalAmount, totalDiscount, finalAmount, testDetails, hvCharges };
  }, [selectedTests, globalDiscountType, globalDiscountValue, homeVisitCharges]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      // In completion mode, validate patient demographics
      if (completionMode) {
        if (!title) throw new Error("Title is required");
        if (!dob) throw new Error("Date of birth is required");
      }
      if (!patientName.trim()) throw new Error("Patient name is required");
      if (!whatsappNumber || whatsappNumber.replace(/\D/g, "").length < 10) throw new Error("Valid WhatsApp number required");
      if (selectedTests.length === 0) throw new Error("Select at least one test");
      if (!visitDate || !visitTime || !address.trim()) throw new Error("Visit date, time, and address are required");
      if (homeVisitCharges === "" || homeVisitCharges === null || homeVisitCharges === undefined) throw new Error("Home visit charges is required (can be 0)");

      const cleanNumber = whatsappNumber.replace(/\D/g, "").slice(-10);
      const formattedUmr = umrInput ? `UMR${String(parseInt(umrInput) || 0).padStart(7, "0")}` : null;

      // Update estimate
      const { error: estError } = await supabase.from("estimates").update({
        title: title || null,
        patient_name: patientName ? patientName.toUpperCase() : null,
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
        address: address.toUpperCase(),
        phlebotomist_id: phlebotomistId || null,
      }).eq("id", visit.id);
      if (visitError) throw visitError;

      return cleanNumber;
    },
    onSuccess: (cleanNumber) => {
      qc.invalidateQueries({ queryKey: ["home_visits"] });
      qc.invalidateQueries({ queryKey: ["estimates"] });

      if (completionMode) {
        toast.success("Home visit updated successfully!");
        onClose();
        if (onCompletionSave) {
          setTimeout(() => onCompletionSave(), 300);
        }
      } else {
        // Non-completion mode: Save & Share via WhatsApp
        toast.success("Home visit updated! Opening WhatsApp...");
        onClose();

        if (templates && cleanNumber) {
          const tests = selectedTests.map(t => ({ name: t.test_name, price: t.price, fasting: t.fasting_required }));
          const formatTime = (t: string) => {
            const [h, m] = t.split(":");
            const hour = parseInt(h);
            return `${hour % 12 || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`;
          };
          const msg = buildVisitMessage({
            tests,
            totalAmount: calculations.totalAmount,
            discountAmount: calculations.totalDiscount,
            homeVisitCharges: calculations.hvCharges,
            finalAmount: calculations.finalAmount,
            header: templates.estimate_header,
            fastingInstructions: templates.fasting_instructions,
            noFastingMessage: templates.no_fasting_message,
            homeVisitDisclaimer: templates.home_visit_disclaimer,
            footer: templates.footer_text,
            visitDate: format(new Date(visitDate), "dd-MM-yyyy"),
            visitTime: formatTime(visitTime),
            visitHeader: templates.visit_confirmation_header,
            address: address.toUpperCase(),
            patientName: patientName ? patientName.toUpperCase() : undefined,
          });
          shareOnWhatsApp(cleanNumber, msg);
          logMessageSend(cleanNumber, patientName, "Home Visit");
        }
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!visit) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{completionMode ? "Complete Missing Details" : "Edit Home Visit Record"}</DialogTitle></DialogHeader>
        <div className="space-y-4">

          {/* Patient demographics - only shown in completionMode */}
          {completionMode && (
            <>
              <div className="grid grid-cols-[120px_1fr] gap-2">
                <div>
                  <Label className={attempted && !title ? "text-destructive" : ""}>Title *</Label>
                  <Select value={title} onValueChange={handleTitleChange}>
                    <SelectTrigger className="h-10"><SelectValue placeholder="Title *" /></SelectTrigger>
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
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={dobDisplay}
                    onChange={(e) => handleDobDisplayChange(e.target.value)}
                    placeholder="dd-mm-yyyy"
                    maxLength={10}
                  />
                </div>
                <div>
                  <Label>Age (Years)</Label>
                  <Input readOnly value={calculatedAge} className="bg-muted" />
                </div>
              </div>
            </>
          )}

          {/* In non-completion mode, show patient name and WhatsApp (needed for sharing) */}
          {!completionMode && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className={attempted && !patientName.trim() ? "text-destructive" : ""}>Patient Name *</Label>
                <Input value={patientName} onChange={(e) => setPatientName(e.target.value.toUpperCase())} placeholder="Enter patient name" />
              </div>
              <div>
                <Label className={attempted && (!whatsappNumber || whatsappNumber.replace(/\D/g, "").length < 10) ? "text-destructive" : ""}>WhatsApp Number *</Label>
                <Input type="tel" value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} />
              </div>
            </div>
          )}

          {/* Visit Details */}
          <div className="space-y-2">
            {completionMode ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Visit Date</Label>
                    <Input type="date" value={visitDate} disabled className="bg-muted" />
                  </div>
                  <div>
                    <Label>Visit Time</Label>
                    <Input type="time" value={visitTime} disabled className="bg-muted" />
                  </div>
                </div>
                <div>
                  <Label>Phlebotomist</Label>
                  <Input value={phlebotomists.find((p: any) => p.id === phlebotomistId)?.name || "Not assigned"} disabled className="bg-muted" />
                </div>
              </>
            ) : (
              <>
                <div>
                  <Label className={attempted && !visitDate ? "text-destructive" : ""}>Visit Date *</Label>
                  <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
                    {[0, 1, 2].map(offset => {
                      const d = addDays(new Date(), offset);
                      const dateStr = format(d, "yyyy-MM-dd");
                      const dayName = format(d, "EEEE");
                      const dateLabel = format(d, "dd MMM");
                      const label = offset === 0 ? `Today (${dayName}, ${dateLabel})` : offset === 1 ? `Tomorrow (${dayName}, ${dateLabel})` : `Day After (${dayName}, ${dateLabel})`;
                      return (
                        <Button key={offset} type="button" size="sm" variant={visitDate === dateStr ? "default" : "outline"} className="h-7 text-xs" onClick={() => setVisitDate(dateStr)}>
                          {label}
                        </Button>
                      );
                    })}
                  </div>
                  <Input
                    type="date"
                    value={visitDate}
                    onChange={(e) => setVisitDate(e.target.value)}
                    onBlur={handleVisitDateBlur}
                    min={format(new Date(), "yyyy-MM-dd")}
                  />
                </div>

                {/* Assign Phlebotomist - before time so slots show */}
                <div>
                  <Label>Assign Phlebotomist</Label>
                  <Select value={phlebotomistId} onValueChange={setPhlebotomistId}>
                    <SelectTrigger><SelectValue placeholder="Select phlebotomist..." /></SelectTrigger>
                    <SelectContent>
                      {phlebotomists.map((p: any) => {
                        const reason = getUnavailableReason(p, visitDate);
                        return (
                          <SelectItem key={p.id} value={p.id} disabled={!!reason}>
                            {p.name}{reason ? ` (${reason})` : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className={attempted && !visitTime ? "text-destructive" : ""}>Visit Time *</Label>
                  <Input
                    type="time"
                    value={visitTime}
                    onChange={(e) => setVisitTime(e.target.value)}
                    onBlur={handleVisitTimeBlur}
                  />
                  <TimeSlotPicker
                    date={visitDate}
                    phlebotomistId={phlebotomistId}
                    selectedTime={visitTime}
                    onSelectTime={setVisitTime}
                  />
                </div>
              </>
            )}
          </div>
          <div>
            <Label className={attempted && !address.trim() ? "text-destructive" : ""}>Address *</Label>
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
                onChange={(e) => { setTestSearch(e.target.value); setTestHighlightIndex(0); }}
                placeholder="Search tests... (↑↓ to navigate, Enter to select)"
                className="pl-8"
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
                  <button
                    key={t.id}
                    type="button"
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${i === testHighlightIndex ? "bg-accent" : "hover:bg-accent"}`}
                    onClick={() => { addTest(t.id); setTestHighlightIndex(0); }}
                    onMouseEnter={() => setTestHighlightIndex(i)}
                  >
                    {t.test_name} — ₹{t.price}{t.item_type === "package" ? " 📦" : t.item_type === "profile" ? " 📋" : ""}
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

          {/* Home Visit Charges */}
          <div>
            <Label className={attempted && (homeVisitCharges === "" || homeVisitCharges === null || homeVisitCharges === undefined) ? "text-destructive" : ""}>Home Visit Charges (₹) *</Label>
            <Input type="number" value={homeVisitCharges} onChange={(e) => setHomeVisitCharges(e.target.value)} placeholder="Enter charges (can be 0)" />
          </div>

          {/* Summary */}
          {selectedTests.length > 0 && (
            <div className="rounded-lg bg-muted p-4 space-y-1 text-sm">
              <div className="flex justify-between"><span>Total Amount</span><span className="font-medium">₹{calculations.totalAmount}</span></div>
              {calculations.totalDiscount > 0 && <div className="flex justify-between text-success"><span>Discount</span><span>-₹{calculations.totalDiscount}</span></div>}
              {calculations.hvCharges > 0 && <div className="flex justify-between"><span>Home Visit</span><span>+₹{calculations.hvCharges}</span></div>}
              <div className="flex justify-between border-t pt-1 font-bold"><span>Final Amount</span><span>₹{calculations.finalAmount}</span></div>
            </div>
          )}

          <Button className="w-full" onClick={() => { setAttempted(true); saveMutation.mutate(); }} disabled={saveMutation.isPending}>
            {completionMode ? "Save & Proceed to Payment" : (
              <><Send className="h-4 w-4 mr-1" /> Save & Share</>
            )}
          </Button>
        </div>

        {/* Gender confirmation dialog for Dr. / Baby Of. */}
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
      </DialogContent>
    </Dialog>
  );
};

export default EditHomeVisitDialog;
