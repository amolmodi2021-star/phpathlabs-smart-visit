import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Loader2, AlertTriangle } from "lucide-react";

export interface ApproverChoice {
  pathologistName: string;
  qualification: string | null;
  designation: string | null;
  signatureUrl: string | null;
}

interface ActiveDoctor {
  id: string;
  pathologist_name: string;
  qualification: string | null;
  designation: string | null;
  signature_image_path: string | null;
  mapped_user_id: string | null;
}

interface SelectApproverDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (choice: ApproverChoice) => void;
}

const SelectApproverDialog = ({ open, onOpenChange, onConfirm }: SelectApproverDialogProps) => {
  const [doctors, setDoctors] = useState<ActiveDoctor[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Get pathologists mapped to active app_users
        const { data: sigs } = await supabase
          .from("pathologist_signatures")
          .select("id, pathologist_name, qualification, designation, signature_image_path, mapped_user_id")
          .order("pathologist_name");
        const list = (sigs || []) as ActiveDoctor[];
        // Keep only ones whose mapped user is active (or unmapped, in case lab keeps signature without login user)
        const userIds = list.map(d => d.mapped_user_id).filter(Boolean) as string[];
        let activeIds = new Set<string>();
        if (userIds.length > 0) {
          const { data: users } = await supabase
            .from("app_users")
            .select("id, is_active")
            .in("id", userIds);
          (users || []).forEach((u: any) => { if (u.is_active) activeIds.add(u.id); });
        }
        const filtered = list.filter(d => !d.mapped_user_id || activeIds.has(d.mapped_user_id));
        if (!cancelled) {
          setDoctors(filtered);
          setSelectedId(filtered[0]?.id || "");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const handleConfirm = () => {
    const doc = doctors.find(d => d.id === selectedId);
    if (!doc) return;
    let signatureUrl: string | null = null;
    if (doc.signature_image_path) {
      const { data } = supabase.storage.from("signatures").getPublicUrl(doc.signature_image_path);
      signatureUrl = data.publicUrl;
    }
    onConfirm({
      pathologistName: doc.pathologist_name,
      qualification: doc.qualification,
      designation: doc.designation,
      signatureUrl,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Select Approver Signature
          </DialogTitle>
          <DialogDescription>
            You are not a registered pathologist. Select which doctor's signature to use for this approval. Audit trail will record the chosen doctor.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading doctors…
            </div>
          ) : doctors.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No active doctor signatures available.
            </div>
          ) : (
            <RadioGroup value={selectedId} onValueChange={setSelectedId} className="gap-3">
              {doctors.map(d => (
                <Label
                  key={d.id}
                  htmlFor={`doc-${d.id}`}
                  className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/40"
                >
                  <RadioGroupItem value={d.id} id={`doc-${d.id}`} className="mt-1" />
                  <div className="flex-1">
                    <div className="font-medium">{d.pathologist_name}</div>
                    {(d.qualification || d.designation) && (
                      <div className="text-xs text-muted-foreground">
                        {[d.qualification, d.designation].filter(Boolean).join(" • ")}
                      </div>
                    )}
                  </div>
                </Label>
              ))}
            </RadioGroup>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!selectedId || loading}>Confirm Approval</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SelectApproverDialog;
