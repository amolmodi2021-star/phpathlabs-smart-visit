import { format, isValid } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { UserPlus } from "lucide-react";
import { patientDisplayName } from "@/lib/patientDisplayName";
import type { MasterPatientMatch } from "@/lib/findPatientUmr";

function formatDob(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return isValid(d) ? format(d, "dd-MM-yyyy") : iso;
  } catch {
    return iso;
  }
}

interface Props {
  open: boolean;
  mobile: string;
  matches: MasterPatientMatch[];
  onSelectExisting: (patient: MasterPatientMatch) => void;
  onSelectNew: () => void;
}

/** Choose an existing patient_master row on this mobile, or register as a new patient. */
export function PatientOnMobileDialog({ open, mobile, matches, onSelectExisting, onSelectNew }: Props) {
  return (
    <Dialog open={open} onOpenChange={() => { /* must pick an option */ }}>
      <DialogContent className="max-w-md" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Select patient</DialogTitle>
          <DialogDescription>
            Several patients may share mobile <span className="font-mono">{mobile}</span>. Choose who this
            home visit is for, or add a new patient. A new UMR is assigned only when the patient is saved
            in LIMS.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {matches.map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left rounded-md border bg-background hover:bg-muted/60 px-3 py-2.5 transition-colors"
              onClick={() => onSelectExisting(p)}
            >
              <div className="text-sm font-medium">{patientDisplayName(p)}</div>
              <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                <span className="font-mono">{p.umr_id}</span>
                {p.gender && <span>{p.gender}</span>}
                <span>DOB {formatDob(p.date_of_birth)}</span>
              </div>
            </button>
          ))}
        </div>
        <Button type="button" variant="secondary" className="w-full gap-1.5" onClick={onSelectNew}>
          <UserPlus className="h-4 w-4" />
          Add new patient on this mobile
        </Button>
      </DialogContent>
    </Dialog>
  );
}
