import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useMessageTemplates } from "@/hooks/useMessageTemplates";
import { buildEstimateMessage, shareOnWhatsApp } from "@/lib/whatsapp";
import { logMessageSend } from "@/lib/messageLog";
import { Send, X, Search, ScanLine } from "lucide-react";
import { getAllSelectableTests } from "@/lib/allSelectableTests";
import PrescriptionScanDialog from "@/components/PrescriptionScanDialog";

interface SelectedTest {
  test_id: string;
  test_name: string;
  price: number;
  fasting_required: boolean;
  discount_applicable: boolean;
  individual_discount_type: "percent" | "amount" | null;
  individual_discount_value: number;
}

const CreateEstimate = () => {
  useRealtimeSync("tests", ["tests"]);
  const qc = useQueryClient();
  const { data: templates } = useMessageTemplates();
  const [patientName, setPatientName] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [selectedTests, setSelectedTests] = useState<SelectedTest[]>([]);
  const [globalDiscountType, setGlobalDiscountType] = useState<"percent" | "amount">("percent");
  const [globalDiscountValue, setGlobalDiscountValue] = useState(0);
  const [homeVisitCharges, setHomeVisitCharges] = useState(0);
  const [testSearch, setTestSearch] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const { data: tests = [] } = useQuery({
    queryKey: ["all_selectable_tests"],
    queryFn: getAllSelectableTests,
  });

  const addTest = (testId: string) => {
    const t = tests.find((x: any) => x.id === testId);
    if (!t || selectedTests.find(s => s.test_id === testId)) return;
    setSelectedTests(prev => [...prev, {
      test_id: t.id, test_name: t.test_name, price: Number(t.price),
      fasting_required: t.fasting_required, discount_applicable: t.discount_applicable,
      individual_discount_type: null, individual_discount_value: 0,
    }]);
    setTestSearch("");
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const handleScanConfirm = (testIds: string[], scannedName: string) => {
    const newTests: SelectedTest[] = [];
    for (const id of testIds) {
      if (selectedTests.find(s => s.test_id === id)) continue;
      const t = tests.find((x: any) => x.id === id);
      if (!t) continue;
      newTests.push({
        test_id: t.id, test_name: t.test_name, price: Number(t.price),
        fasting_required: t.fasting_required, discount_applicable: t.discount_applicable,
        individual_discount_type: null, individual_discount_value: 0,
      });
    }
    if (newTests.length > 0) setSelectedTests(prev => [...prev, ...newTests]);
    if (scannedName && !patientName) setPatientName(scannedName.toUpperCase());
    toast.success(`${newTests.length} test(s) added from prescription`);
  };


  const formatWhatsApp = (raw: string): string => {
    const digits = raw.replace(/\D/g, "");
    return digits.slice(-10);
  };

  const availableTests = tests.filter((t: any) =>
    !selectedTests.find(s => s.test_id === t.id) &&
    (testSearch === "" || t.test_name.toLowerCase().includes(testSearch.toLowerCase()))
  );

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
      const cleanNumber = formatWhatsApp(whatsappNumber);
      if (!cleanNumber || cleanNumber.length < 10) throw new Error("Valid WhatsApp number required");
      if (selectedTests.length === 0) throw new Error("Select at least one test");

      // Build and share WhatsApp message FIRST
      if (templates) {
        const msg = buildEstimateMessage({
          tests: calculations.testDetails.map(t => ({ name: t.test_name, price: t.price, fasting: t.fasting_required })),
          totalAmount: calculations.totalAmount,
          discountAmount: calculations.totalDiscount,
          homeVisitCharges,
          finalAmount: calculations.finalAmount,
          header: templates.estimate_header,
          fastingInstructions: templates.fasting_instructions,
          noFastingMessage: templates.no_fasting_message,
          homeVisitDisclaimer: templates.home_visit_disclaimer,
          footer: templates.footer_text,
          patientName: patientName || undefined,
        });
        shareOnWhatsApp(cleanNumber, msg);
        logMessageSend(cleanNumber, patientName, "Estimate");
      }

      try {
      const { data: est, error } = await supabase.from("estimates").insert({
          patient_name: patientName ? patientName.toUpperCase() : null,
          whatsapp_number: cleanNumber,
          total_amount: calculations.totalAmount,
          discount_amount: calculations.totalDiscount,
          home_visit_charges: homeVisitCharges,
          final_amount: calculations.finalAmount,
          global_discount_type: globalDiscountValue > 0 ? globalDiscountType : null,
          global_discount_value: globalDiscountValue,
          status: "Estimate Created",
        }).select().single();

        if (error) throw error;

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
      } catch (dbError) {
        console.error("DB save failed:", dbError);
        toast.warning("WhatsApp opened but estimate could not be saved to database");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["estimates"] });
      qc.invalidateQueries({ queryKey: ["abnormal_history"] });
      toast.success("Estimate shared on WhatsApp!");
      setPatientName(""); setWhatsappNumber(""); setSelectedTests([]);
      setGlobalDiscountValue(0); setHomeVisitCharges(0);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4 animate-fade-in max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Create Estimate</h1>
        <Button variant="outline" onClick={() => setScanOpen(true)}>
          <ScanLine className="h-4 w-4 mr-2" />Scan Prescription
        </Button>
      </div>

      <PrescriptionScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        availableTests={tests}
        onConfirm={handleScanConfirm}
      />
      <Card className="glass-card">
        <CardContent className="p-4 space-y-4">
          <div><Label>Patient Name (Optional)</Label><Input value={patientName} onChange={(e) => setPatientName(e.target.value)} /></div>
          <div>
            <Label>WhatsApp Number *</Label>
            <Input type="tel" value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} placeholder="Paste number (any format)" />
            {whatsappNumber && <p className="text-xs text-muted-foreground mt-1">Formatted: {formatWhatsApp(whatsappNumber) || "Need 10+ digits"}</p>}
          </div>

          {/* Test selection */}
          <div>
            <Label>Select Tests *</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={testSearch}
                onChange={(e) => setTestSearch(e.target.value)}
                placeholder="Search tests..."
                className="pl-8"
              />
            </div>
            {testSearch && availableTests.length > 0 && (
              <div className="border rounded-md mt-1 max-h-48 overflow-y-auto">
                {availableTests.map((t: any) => (
                  <button
                    key={t.id}
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                    onClick={() => addTest(t.id)}
                  >
                    {t.test_name} - ₹{t.price}{t.item_type === "package" ? " 📦" : t.item_type === "profile" ? " 📋" : ""}
                  </button>
                ))}
              </div>
            )}
            {testSearch && availableTests.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">No matching tests</p>
            )}
          </div>

          {/* Selected tests */}
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
                      <Label className="text-xs">Individual Discount:</Label>
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

          {/* Global discount */}
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
            </div>
          </div>

          {/* Home visit charges */}
          <div><Label>Home Visit Charges (₹)</Label><Input type="number" value={homeVisitCharges || ""} onChange={(e) => setHomeVisitCharges(parseFloat(e.target.value) || 0)} /></div>

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
            <Send className="h-4 w-4 mr-2" />Create & Share on WhatsApp
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default CreateEstimate;
