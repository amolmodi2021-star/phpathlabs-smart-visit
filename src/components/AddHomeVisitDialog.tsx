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
import { getTests } from "@/lib/tests";
import { useMessageTemplates } from "@/hooks/useMessageTemplates";
import { buildVisitMessage, shareOnWhatsApp } from "@/lib/whatsapp";
import { format, addDays } from "date-fns";

interface SelectedTest {
  test_id: string;
  test_name: string;
  price: number;
  fasting_required: boolean;
  discount_applicable: boolean;
  individual_discount_type: "percent" | "amount" | null;
  individual_discount_value: number;
}

interface AddHomeVisitDialogProps {
  open: boolean;
  onClose: () => void;
}

const AddHomeVisitDialog = ({ open, onClose }: AddHomeVisitDialogProps) => {
  const qc = useQueryClient();
  const { data: templates } = useMessageTemplates();
  const searchRef = useRef<HTMLInputElement>(null);

  const [patientName, setPatientName] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [visitTime, setVisitTime] = useState("");
  const [address, setAddress] = useState("");
  const [selectedTests, setSelectedTests] = useState<SelectedTest[]>([]);
  const [globalDiscountType, setGlobalDiscountType] = useState<"percent" | "amount">("percent");
  const [globalDiscountValue, setGlobalDiscountValue] = useState(0);
  const [homeVisitCharges, setHomeVisitCharges] = useState(0);
  const [testSearch, setTestSearch] = useState("");
  const [phlebotomistId, setPhlebotomistId] = useState("");

  const { data: phlebotomists = [] } = useQuery({
    queryKey: ["phlebotomists", "active"],
    queryFn: async () => { const { data } = await supabase.from("phlebotomists").select("*").eq("status", "Active"); return data || []; },
  });

  const { data: allTests = [] } = useQuery({
    queryKey: ["tests"],
    queryFn: async () => await getTests(),
  });

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setPatientName("");
      setWhatsappNumber("");
      setVisitDate("");
      setVisitTime("");
      setAddress("");
      setSelectedTests([]);
      setGlobalDiscountType("percent");
      setGlobalDiscountValue(0);
      setHomeVisitCharges(0);
      setTestSearch("");
      setPhlebotomistId("");
    }
  }, [open]);

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

      // Create estimate
      const { data: est, error: estError } = await supabase.from("estimates").insert({
        patient_name: patientName || null,
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
      }));
      const { error: testError } = await supabase.from("estimate_tests").insert(testRows);
      if (testError) throw testError;

      // Create home visit
      const { error: visitError } = await supabase.from("home_visits").insert({
        estimate_id: est.id,
        visit_date: visitDate,
        visit_time: visitTime,
        address: address,
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
          address: address,
        });
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
            <Input value={patientName} onChange={(e) => setPatientName(e.target.value)} />
          </div>
          <div>
            <Label>WhatsApp Number *</Label>
            <Input type="tel" value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} placeholder="Paste number (any format)" />
            {whatsappNumber && <p className="text-xs text-muted-foreground mt-1">Formatted: {formatWhatsApp(whatsappNumber) || "Need 10+ digits"}</p>}
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
            <div>
              <Label>Visit Time *</Label>
              <Input
                type="time"
                value={visitTime}
                onChange={(e) => setVisitTime(e.target.value)}
                onBlur={handleVisitTimeBlur}
              />
            </div>
          </div>
          <div>
            <Label>Address *</Label>
            <Textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
          </div>

          {/* Assign Phlebotomist */}
          <div>
            <Label>Assign Phlebotomist</Label>
            <Select value={phlebotomistId} onValueChange={setPhlebotomistId}>
              <SelectTrigger><SelectValue placeholder="Select phlebotomist..." /></SelectTrigger>
              <SelectContent>
                {phlebotomists.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <Send className="h-4 w-4 mr-2" />Save & Send Visit Confirmation
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AddHomeVisitDialog;
