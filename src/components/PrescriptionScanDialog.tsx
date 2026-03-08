import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Camera, Upload, Loader2, Check, AlertTriangle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface MatchedTest {
  prescription_text: string;
  matched_test_id: string;
  matched_test_name: string;
  confidence: "high" | "medium" | "low";
  selected: boolean;
}

interface UnmatchedTest {
  prescription_text: string;
}

interface ScanResults {
  patient_name: string;
  matched_tests: MatchedTest[];
  unmatched_tests: UnmatchedTest[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableTests: { id: string; test_name: string; price: number; fasting_required: boolean; discount_applicable: boolean }[];
  onConfirm: (testIds: string[], patientName: string) => void;
}

const PrescriptionScanDialog = ({ open, onOpenChange, availableTests, onConfirm }: Props) => {
  const [step, setStep] = useState<"upload" | "processing" | "review">("upload");
  const [results, setResults] = useState<ScanResults | null>(null);
  const [selectedMatches, setSelectedMatches] = useState<Record<string, boolean>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep("upload");
    setResults(null);
    setSelectedMatches({});
  };

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      toast.error("Please upload an image or PDF");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large (max 10MB)");
      return;
    }

    setStep("processing");

    try {
      // Convert file to base64 data URL - no storage upload
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // Call edge function with base64 image
      const { data, error } = await supabase.functions.invoke("parse-prescription", {
        body: {
          imageUrl: base64,
          availableTests: availableTests.map(t => ({ id: t.id, test_name: t.test_name })),
        },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      // Initialize selections - high confidence auto-selected
      const selections: Record<string, boolean> = {};
      (data.matched_tests || []).forEach((m: MatchedTest) => {
        selections[m.matched_test_id] = m.confidence === "high" || m.confidence === "medium";
      });

      setResults({
        patient_name: data.patient_name || "",
        matched_tests: data.matched_tests || [],
        unmatched_tests: data.unmatched_tests || [],
      });
      setSelectedMatches(selections);
      setStep("review");

      // Cleanup not needed - no files stored
    } catch (e: any) {
      console.error("Scan error:", e);
      toast.error(e.message || "Failed to scan prescription");
      setStep("upload");
    }
  };

  const handleConfirm = () => {
    const selectedIds = Object.entries(selectedMatches)
      .filter(([, sel]) => sel)
      .map(([id]) => id);

    if (selectedIds.length === 0) {
      toast.error("Select at least one test");
      return;
    }

    onConfirm(selectedIds, results?.patient_name || "");
    onOpenChange(false);
    reset();
  };

  const confidenceConfig = {
    high: { color: "text-green-600 bg-green-50 border-green-200", icon: Check, label: "High Match" },
    medium: { color: "text-amber-600 bg-amber-50 border-amber-200", icon: AlertTriangle, label: "Possible Match" },
    low: { color: "text-red-600 bg-red-50 border-red-200", icon: AlertTriangle, label: "Low Match" },
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Scan Prescription
          </DialogTitle>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload a doctor's prescription image. AI will read the recommended tests and match them to your test list.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
            <div className="flex gap-3">
              <Button className="flex-1" variant="outline" onClick={() => {
                if (fileRef.current) {
                  fileRef.current.removeAttribute("capture");
                  fileRef.current.click();
                }
              }}>
                <Upload className="h-4 w-4 mr-2" />Upload Image
              </Button>
              <Button className="flex-1" onClick={() => {
                if (fileRef.current) {
                  fileRef.current.setAttribute("capture", "environment");
                  fileRef.current.click();
                }
              }}>
                <Camera className="h-4 w-4 mr-2" />Take Photo
              </Button>
            </div>
          </div>
        )}

        {step === "processing" && (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Reading prescription with AI...</p>
          </div>
        )}

        {step === "review" && results && (
          <div className="space-y-4">
            {results.patient_name && (
              <div className="rounded-lg border p-3 bg-muted">
                <p className="text-xs text-muted-foreground">Patient Name (from prescription)</p>
                <p className="font-medium">{results.patient_name.toUpperCase()}</p>
              </div>
            )}

            {results.matched_tests.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Matched Tests ({results.matched_tests.length})</p>
                {results.matched_tests.map((m) => {
                  const conf = confidenceConfig[m.confidence];
                  const Icon = conf.icon;
                  return (
                    <button
                      key={m.matched_test_id}
                      type="button"
                      className={cn(
                        "w-full text-left rounded-lg border p-3 transition-all",
                        selectedMatches[m.matched_test_id]
                          ? "ring-2 ring-primary border-primary"
                          : "opacity-60"
                      )}
                      onClick={() => setSelectedMatches(prev => ({
                        ...prev,
                        [m.matched_test_id]: !prev[m.matched_test_id],
                      }))}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{m.matched_test_name}</p>
                          <p className="text-xs text-muted-foreground truncate">Prescription: "{m.prescription_text}"</p>
                        </div>
                        <span className={cn("inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border", conf.color)}>
                          <Icon className="h-3 w-3" />{conf.label}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {results.unmatched_tests.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-destructive">Unmatched ({results.unmatched_tests.length})</p>
                {results.unmatched_tests.map((u, i) => (
                  <div key={i} className="rounded-lg border border-destructive/20 p-3 flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-destructive shrink-0" />
                    <p className="text-sm">"{u.prescription_text}" — not found in your test list</p>
                  </div>
                ))}
              </div>
            )}

            {results.matched_tests.length === 0 && results.unmatched_tests.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No tests could be identified from the prescription.</p>
            )}

            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => { reset(); }}>
                Re-scan
              </Button>
              <Button className="flex-1" onClick={handleConfirm} disabled={!Object.values(selectedMatches).some(Boolean)}>
                <Check className="h-4 w-4 mr-2" />
                Add Selected Tests
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default PrescriptionScanDialog;
