import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { X, Search, Send } from "lucide-react";
import { getAllSelectableTests } from "@/lib/allSelectableTests";
import { useMessageTemplates } from "@/hooks/useMessageTemplates";
import { buildEstimateMessage, shareOnWhatsApp } from "@/lib/whatsapp";

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

interface EditEstimateDialogProps {
  estimate: any;
  open: boolean;
  onClose: () => void;
}

const EditEstimateDialog = ({ estimate, open, onClose }: EditEstimateDialogProps) => {
  const qc = useQueryClient();
  const { data: templates } = useMessageTemplates();
  const searchRef = useRef<HTMLInputElement>(null);

  const [patientName, setPatientName] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [selectedTests, setSelectedTests] = useState<EditTest[]>([]);
  const [globalDiscountType, setGlobalDiscountType] = useState<"percent" | "amount">("percent");
  const [globalDiscountValue, setGlobalDiscountValue] = useState(0);
  const [homeVisitCharges, setHomeVisitCharges] = useState(0);
  const [testSearch, setTestSearch] = useState("");

  const { data: allTests = [] } = useQuery({
    queryKey: ["all_selectable_tests"],
    queryFn: getAllSelectableTests,
  });

  useEffect(() => {
    if (!estimate) return;
    setPatientName(estimate.patient_name || "");
    setWhatsappNumber(estimate.whatsapp_number || "");
    setGlobalDiscountType((estimate.global_discount_type as "percent" | "amount") || "percent");
    setGlobalDiscountValue(Number(estimate.global_discount_value) || 0);
    setHomeVisitCharges(Number(estimate.home_visit_charges) || 0);

    const existingTests: EditTest[] = (estimate.estimate_tests || []).map((t: any) => ({
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
  }, [estimate]);

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

      const cleanNumber = whatsappNumber.replace(/\D/g, "").slice(-10);

      // Update estimate
      const { error: estError } = await supabase.from("estimates").update({
        patient_name: patientName ? patientName.toUpperCase() : null,
        whatsapp_number: cleanNumber,
        total_amount: calculations.totalAmount,
        discount_amount: calculations.totalDiscount,
        home_visit_charges: homeVisitCharges,
        final_amount: calculations.finalAmount,
        global_discount_type: globalDiscountValue > 0 ? globalDiscountType : null,
        global_discount_value: globalDiscountValue,
      }).eq("id", estimate.id);
      if (estError) throw estError;

      // Delete old estimate_tests and re-insert
      const { error: delError } = await supabase.from("estimate_tests").delete().eq("estimate_id", estimate.id);
      if (delError) throw delError;

      const testRows = calculations.testDetails.map(t => ({
        estimate_id: estimate.id,
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

      // Share on WhatsApp
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
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["estimates"] });
      toast.success("Updated & shared on WhatsApp!");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!estimate) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Estimate</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Patient Name</Label>
            <Input value={patientName} onChange={(e) => setPatientName(e.target.value)} />
          </div>
          <div>
            <Label>WhatsApp Number *</Label>
            <Input type="tel" value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} />
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
                    {t.test_name} - ₹{t.price}{t.item_type === "package" ? " 📦" : t.item_type === "profile" ? " 📋" : ""}
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
            <Send className="h-4 w-4 mr-2" />Save & Share on WhatsApp
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EditEstimateDialog;
