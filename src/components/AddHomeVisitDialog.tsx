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
import { X, Search, Send, AlertTriangle, MapPin, Plus } from "lucide-react";
import { getAllSelectableTests } from "@/lib/allSelectableTests";
import { useParamConflictHighlight } from "@/hooks/useParamConflictHighlight";
import SelectedTestContentsButton from "@/components/lims/SelectedTestContentsButton";
import TimeSlotPicker from "@/components/TimeSlotPicker";
import { useMessageTemplates } from "@/hooks/useMessageTemplates";
import { usePhlebotomistAvailability } from "@/hooks/usePhlebotomistAvailability";
import { buildVisitMessage, shareOnWhatsApp } from "@/lib/whatsapp";
import { logMessageSend } from "@/lib/messageLog";
import { format, addDays } from "date-fns";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { assertNoDuplicatePendingHomeVisit } from "@/lib/homeVisitDuplicates";

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

interface KnownAddress {
  address: string;
  patientName?: string;
  source: string;
}

interface AddHomeVisitDialogProps {
  open: boolean;
  onClose: () => void;
}

function normalizeAddress(raw: string | null | undefined): string {
  return String(raw || "").replace(/\s+/g, " ").trim().toUpperCase();
}

async function fetchAddressesForMobile(mobile10: string): Promise<KnownAddress[]> {
  const seen = new Set<string>();
  const out: KnownAddress[] = [];
  const add = (addr: string | null | undefined, name?: string | null, source = "") => {
    const a = normalizeAddress(addr);
    if (!a || seen.has(a)) return;
    seen.add(a);
    out.push({
      address: a,
      patientName: name ? String(name).replace(/\s+/g, " ").trim().toUpperCase() : undefined,
      source,
    });
  };

  const [pmRes, regRes, estRes] = await Promise.all([
    supabase
      .from("patient_master")
      .select("address, patient_name")
      .ilike("mobile_number", `%${mobile10}%`)
      .limit(50),
    supabase
      .from("patient_registrations")
      .select("address, patient_name")
      .ilike("mobile_number", `%${mobile10}%`)
      .eq("bill_cancelled", false)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("estimates")
      .select("patient_name, whatsapp_number, home_visits(address)")
      .ilike("whatsapp_number", `%${mobile10}%`)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  (pmRes.data || []).forEach((p: any) => add(p.address, p.patient_name, "Patient Master"));
  (regRes.data || []).forEach((r: any) => add(r.address, r.patient_name, "Registration"));
  (estRes.data || []).forEach((e: any) => {
    const visits = Array.isArray(e.home_visits) ? e.home_visits : e.home_visits ? [e.home_visits] : [];
    visits.forEach((v: any) => add(v?.address, e.patient_name, "Prior Home Visit"));
  });

  return out;
}

const AddHomeVisitDialog = ({ open, onClose }: AddHomeVisitDialogProps) => {
  const qc = useQueryClient();
  const { data: templates } = useMessageTemplates();
  const { isAvailable, getUnavailableReason } = usePhlebotomistAvailability();
  const searchRef = useRef<HTMLInputElement>(null);

  const [patientName, setPatientName] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [visitTime, setVisitTime] = useState("");
  const [address, setAddress] = useState("");
  const [knownAddresses, setKnownAddresses] = useState<KnownAddress[]>([]);
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  /** null = not chosen yet; "__new__" = typing a new address; else the selected known address */
  const [addressChoice, setAddressChoice] = useState<string | null>(null);
  const [selectedTests, setSelectedTests] = useState<SelectedTest[]>([]);
  const [globalDiscountType, setGlobalDiscountType] = useState<"percent" | "amount">("percent");
  const [globalDiscountValue, setGlobalDiscountValue] = useState(0);
  const [homeVisitCharges, setHomeVisitCharges] = useState(0);
  const [showHvcConfirm, setShowHvcConfirm] = useState(false);
  const [testSearch, setTestSearch] = useState("");
  const [testHighlightIndex, setTestHighlightIndex] = useState(-1);
  const [phlebotomistId, setPhlebotomistId] = useState("");

  const { data: phlebotomists = [] } = useQuery({
    queryKey: ["phlebotomists", "active"],
    queryFn: async () => { const { data } = await supabase.from("phlebotomists").select("*").eq("status", "Active"); return data || []; },
  });

  const { data: allTests = [] } = useQuery({
    queryKey: ["all_selectable_tests"],
    queryFn: getAllSelectableTests,
  });

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setPatientName("");
      setWhatsappNumber("");
      setVisitDate("");
      setVisitTime("");
      setAddress("");
      setKnownAddresses([]);
      setLoadingAddresses(false);
      setAddressChoice(null);
      setSelectedTests([]);
      setGlobalDiscountType("percent");
      setGlobalDiscountValue(0);
      setHomeVisitCharges(0);
      setShowHvcConfirm(false);
      setTestSearch("");
      setPhlebotomistId("");
    }
  }, [open]);

  const mobile10 = useMemo(() => whatsappNumber.replace(/\D/g, "").slice(-10), [whatsappNumber]);

  // Load known addresses once mobile is complete
  useEffect(() => {
    if (!open || mobile10.length !== 10) {
      setKnownAddresses([]);
      setAddressChoice(null);
      return;
    }
    let cancelled = false;
    setLoadingAddresses(true);
    (async () => {
      try {
        const list = await fetchAddressesForMobile(mobile10);
        if (cancelled) return;
        setKnownAddresses(list);
        if (list.length === 0) {
          setAddressChoice("__new__");
        } else {
          setAddressChoice(null);
        }
      } finally {
        if (!cancelled) setLoadingAddresses(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, mobile10]);

  const selectKnownAddress = (opt: KnownAddress) => {
    setAddressChoice(opt.address);
    setAddress(opt.address);
    if (opt.patientName && !patientName.trim()) {
      setPatientName(opt.patientName);
    }
  };

  const chooseNewAddress = () => {
    setAddressChoice("__new__");
    setAddress("");
  };

  const availableTests = allTests.filter((t: any) =>
    !selectedTests.find(s => s.test_id === t.id) &&
    (testSearch === "" || t.test_name.toLowerCase().includes(testSearch.toLowerCase()))
  );

  // Only evaluate while dialog is open so close/reopen always recomputes highlights
  const paramConflictSet = useParamConflictHighlight(
    open ? selectedTests : [],
    "home-visit-param-conflicts",
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

  const formatWhatsApp = (raw: string): string => raw.replace(/\D/g, "").slice(-10);

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
      const cleanNumber = formatWhatsApp(whatsappNumber);
      if (!cleanNumber || cleanNumber.length < 10) throw new Error("Valid WhatsApp number required");
      if (selectedTests.length === 0) throw new Error("Select at least one test");
      if (!visitDate || !visitTime || !address.trim()) throw new Error("Visit date, time, and address are required");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) throw new Error("Invalid visit date format");
      if (!/^\d{2}:\d{2}$/.test(visitTime)) throw new Error("Invalid visit time format");

      const selectedDateTime = new Date(`${visitDate}T${visitTime}:00`);
      if (Number.isNaN(selectedDateTime.getTime())) throw new Error("Invalid visit date/time");
      if (selectedDateTime.getTime() < Date.now()) throw new Error("Cannot book for date/time that has already passed");

      const cleanName = patientName.replace(/\s+/g, ' ').trim().toUpperCase();
      const cleanAddress = address.replace(/\s+/g, ' ').trim().toUpperCase();

      await assertNoDuplicatePendingHomeVisit({
        whatsappNumber: cleanNumber,
        patientName: cleanName,
        visitDate,
        visitTime,
      });

      // Create estimate
      const { data: est, error: estError } = await supabase.from("estimates").insert({
        patient_name: cleanName || null,
        whatsapp_number: cleanNumber,
        total_amount: calculations.totalAmount,
        discount_amount: calculations.totalDiscount,
        home_visit_charges: homeVisitCharges,
        final_amount: calculations.finalAmount,
        global_discount_type: globalDiscountValue > 0 ? globalDiscountType : null,
        global_discount_value: globalDiscountValue,
        status: "Home Visit Booked",
      }).select().single();
      if (estError) throw estError;

      // Insert estimate tests
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
        item_type: (t as any).item_type || "test",
      }));
      const { error: testError } = await supabase.from("estimate_tests").insert(testRows);
      if (testError) throw testError;

      // Create home visit
      const { error: visitError } = await supabase.from("home_visits").insert({
        estimate_id: est.id,
        visit_date: visitDate,
        visit_time: visitTime,
        address: cleanAddress,
        phlebotomist_id: phlebotomistId || null,
      });
      if (visitError) throw visitError;

      // Share on WhatsApp
      if (templates) {
        const tests = calculations.testDetails.map(t => ({ name: t.test_name, price: t.price, fasting: t.fasting_required }));
        const formatTime = () => {
          const [h, m] = visitTime.split(":");
          const hour = parseInt(h, 10);
          return `${hour % 12 || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`;
        };
        const msg = buildVisitMessage({
          tests,
          totalAmount: calculations.totalAmount,
          discountAmount: calculations.totalDiscount,
          homeVisitCharges,
          finalAmount: calculations.finalAmount,
          header: templates.estimate_header,
          visitHeader: templates.visit_confirmation_header,
          fastingInstructions: templates.fasting_instructions,
          noFastingMessage: templates.no_fasting_message,
          homeVisitDisclaimer: templates.home_visit_disclaimer,
          footer: templates.footer_text,
          visitDate: format(new Date(visitDate), "dd-MM-yyyy"),
          visitTime: formatTime(),
          address: cleanAddress,
          patientName: cleanName || undefined,
        });
        await logMessageSend(cleanNumber, cleanName, "Home Visit", undefined, undefined, msg);
        shareOnWhatsApp(cleanNumber, msg);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["home_visits"] });
      qc.invalidateQueries({ queryKey: ["estimates"] });
      toast.success("Home visit created & WhatsApp confirmation sent!");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add New Home Visit</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {/* Patient Info */}
          <div>
            <Label>Patient Name</Label>
            <Input value={patientName} onChange={(e) => setPatientName(e.target.value.toUpperCase())} className="uppercase" />
          </div>
          <div>
            <Label>WhatsApp Number *</Label>
            <Input type="tel" value={whatsappNumber} onChange={(e) => {
              setWhatsappNumber(e.target.value);
              // Clear address pick when number changes mid-entry
              const digits = e.target.value.replace(/\D/g, "").slice(-10);
              if (digits.length !== 10) {
                setKnownAddresses([]);
                setAddressChoice(null);
              }
            }} placeholder="Paste number (any format)" />
            {whatsappNumber && <p className="text-xs text-muted-foreground mt-1">Formatted: {formatWhatsApp(whatsappNumber) || "Need 10+ digits"}{mobile10.length === 10 ? " ✓" : ""}</p>}
          </div>

          {/* Visit Details */}
          <div className="space-y-2">
            <div>
              <Label>Visit Date *</Label>
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
              <Label>Visit Time *</Label>
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
          </div>

          {/* Address — pick from history for this mobile, or add new */}
          <div className="space-y-2">
            <Label>Address *</Label>
            {mobile10.length !== 10 && (
              <p className="text-xs text-muted-foreground">Enter a 10-digit mobile to load saved addresses.</p>
            )}
            {mobile10.length === 10 && loadingAddresses && (
              <p className="text-xs text-muted-foreground">Looking up addresses for this mobile…</p>
            )}
            {mobile10.length === 10 && !loadingAddresses && knownAddresses.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Select an address for this visit:</p>
                <div className="border rounded-md max-h-40 overflow-y-auto divide-y">
                  {knownAddresses.map((opt) => {
                    const selected = addressChoice === opt.address;
                    return (
                      <button
                        key={opt.address}
                        type="button"
                        className={`w-full text-left px-3 py-2 text-sm transition-colors flex gap-2 items-start ${
                          selected ? "bg-primary/10 ring-1 ring-inset ring-primary/30" : "hover:bg-accent"
                        }`}
                        onClick={() => selectKnownAddress(opt)}
                      >
                        <MapPin className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                        <span className="min-w-0">
                          <span className="block font-medium uppercase leading-snug">{opt.address}</span>
                          {(opt.patientName || opt.source) && (
                            <span className="text-[11px] text-muted-foreground">
                              {[opt.patientName, opt.source].filter(Boolean).join(" · ")}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={addressChoice === "__new__" ? "default" : "outline"}
                  className="h-8 text-xs gap-1"
                  onClick={chooseNewAddress}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add new address
                </Button>
              </div>
            )}
            {(addressChoice === "__new__" || (mobile10.length === 10 && !loadingAddresses && knownAddresses.length === 0) || (addressChoice && addressChoice !== "__new__")) && (
              <Textarea
                value={address}
                onChange={(e) => {
                  const v = e.target.value.toUpperCase();
                  setAddress(v);
                  // Typing over a known pick → treat as new/edited address
                  if (addressChoice && addressChoice !== "__new__" && normalizeAddress(v) !== addressChoice) {
                    setAddressChoice("__new__");
                  }
                }}
                rows={2}
                className="uppercase"
                placeholder={addressChoice === "__new__" || knownAddresses.length === 0 ? "Enter visit address" : undefined}
                readOnly={!!addressChoice && addressChoice !== "__new__"}
              />
            )}
            {addressChoice && addressChoice !== "__new__" && (
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => setAddressChoice("__new__")}
              >
                Edit this address
              </button>
            )}
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
                    {t.test_name} — ₹{t.price}{t.item_type === "package" ? " 📦" : t.item_type === "combo" ? " 🧩" : t.item_type === "profile" ? " 📋" : ""}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Selected Tests */}
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
                    className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-1.5 ${
                      conflicted
                        ? "border-destructive bg-destructive/10 ring-1 ring-destructive/40"
                        : ""
                    }`}
                  >
                    <span className={`text-sm font-medium ${conflicted ? "text-destructive" : ""}`}>
                      {t.test_name}
                    </span>
                    <span className={`text-sm ${conflicted ? "text-destructive/80" : "text-muted-foreground"}`}>₹{t.price}</span>
                    {conflicted && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-destructive shrink-0">
                        Duplicate params
                      </span>
                    )}
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
                      <SelectedTestContentsButton item={t} />
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeTest(t.test_id)}><X className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                );
              })}
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
            <Input type="number" value={homeVisitCharges || ""} onChange={(e) => setHomeVisitCharges(parseFloat(e.target.value) || 0)} placeholder="0" />
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

          <Button
            className="w-full"
            onClick={() => {
              if (!homeVisitCharges || homeVisitCharges === 0) {
                setShowHvcConfirm(true);
                return;
              }
              saveMutation.mutate();
            }}
            disabled={saveMutation.isPending}
          >
            <Send className="h-4 w-4 mr-2" />Save & Send Visit Confirmation
          </Button>
        </div>
      </DialogContent>

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
    </Dialog>
  );
};

export default AddHomeVisitDialog;
