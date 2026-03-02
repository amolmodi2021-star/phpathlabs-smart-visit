import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle, AlertTriangle, XCircle, Loader2 } from "lucide-react";

interface MatchedTest {
  test_id: string;
  test_name: string;
  confidence: "high" | "low";
}

interface PrescriptionResult {
  patient_name: string;
  whatsapp_number: string;
  matched_tests: MatchedTest[];
  unrecognized_tests: string[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: PrescriptionResult | null;
  isLoading: boolean;
  onConfirm: (data: {
    patientName: string;
    whatsappNumber: string;
    selectedTestIds: string[];
  }) => void;
}

const PrescriptionScanDialog = ({ open, onOpenChange, result, isLoading, onConfirm }: Props) => {
  const [patientName, setPatientName] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastResultRef, setLastResultRef] = useState<PrescriptionResult | null>(null);

  // Sync state when result changes
  if (result && result !== lastResultRef) {
    setLastResultRef(result);
    setPatientName(result.patient_name || "");
    setWhatsappNumber(result.whatsapp_number || "");
    setSelectedIds(new Set(result.matched_tests.map(t => t.test_id)));
  }

  const toggleTest = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Prescription Scan Results</DialogTitle>
          <DialogDescription>Review AI-extracted data before adding to estimate</DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Reading prescription...</p>
          </div>
        )}

        {!isLoading && result && (
          <div className="space-y-4">
            {/* Patient info */}
            <div className="space-y-2">
              <div>
                <Label>Patient Name</Label>
                <Input value={patientName} onChange={e => setPatientName(e.target.value)} />
              </div>
              <div>
                <Label>WhatsApp Number</Label>
                <Input value={whatsappNumber} onChange={e => setWhatsappNumber(e.target.value)} />
              </div>
            </div>

            {/* Matched tests */}
            {result.matched_tests.length > 0 && (
              <div>
                <Label className="text-sm font-medium">Matched Tests</Label>
                <div className="space-y-1 mt-1">
                  {result.matched_tests.map(t => (
                    <label
                      key={t.test_id}
                      className={`flex items-center gap-2 rounded-md border p-2 cursor-pointer transition-colors ${
                        t.confidence === "low" ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20" : "border-green-400 bg-green-50 dark:bg-green-950/20"
                      }`}
                    >
                      <Checkbox
                        checked={selectedIds.has(t.test_id)}
                        onCheckedChange={() => toggleTest(t.test_id)}
                      />
                      {t.confidence === "high" ? (
                        <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                      )}
                      <span className="text-sm flex-1">{t.test_name}</span>
                      {t.confidence === "low" && (
                        <span className="text-xs text-amber-600 font-medium">Doubtful</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Unrecognized tests */}
            {result.unrecognized_tests.length > 0 && (
              <div>
                <Label className="text-sm font-medium">Unrecognized Tests</Label>
                <div className="space-y-1 mt-1">
                  {result.unrecognized_tests.map((name, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2">
                      <XCircle className="h-4 w-4 text-destructive shrink-0" />
                      <span className="text-sm">{name}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">These tests were not found in your test list. Add them manually if needed.</p>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => {
                onConfirm({
                  patientName,
                  whatsappNumber,
                  selectedTestIds: Array.from(selectedIds),
                });
                onOpenChange(false);
              }}>
                Confirm & Add Tests
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default PrescriptionScanDialog;
