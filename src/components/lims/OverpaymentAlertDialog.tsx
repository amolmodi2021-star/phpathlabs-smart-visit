import { AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { OVERPAYMENT_MESSAGE } from "@/lib/billPayment";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collected?: number;
  billAmount?: number;
};

const OverpaymentAlertDialog = ({ open, onOpenChange, collected, billAmount }: Props) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent className="max-w-sm">
      <AlertDialogHeader>
        <div className="mx-auto mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <AlertDialogTitle className="text-center">{OVERPAYMENT_MESSAGE}</AlertDialogTitle>
        <AlertDialogDescription className="text-center">
          {collected != null && billAmount != null ? (
            <>
              Collected ₹{collected} is greater than the total bill of ₹{billAmount}.
              This registration was not saved. Extra payment cannot be received from the patient.
            </>
          ) : (
            <>This registration was not saved. Extra payment cannot be received from the patient.</>
          )}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter className="sm:justify-center">
        <AlertDialogAction className="mt-0">OK</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

export default OverpaymentAlertDialog;
