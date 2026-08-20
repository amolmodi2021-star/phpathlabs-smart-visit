import { useState, type Dispatch, type SetStateAction } from "react";
import { billAmountChanged, paymentSelectionIsSet } from "@/lib/billPayment";

/**
 * When the payable bill changes (discount, tests, round-up, HV charges),
 * clear every selected payment mode and amount so a stale collection cannot
 * exceed the new total.
 */
export function useResetPaymentsWhenBillChanges(
  billAmount: number,
  selectedModes: Set<string>,
  modeAmounts: Record<string, number>,
  setSelectedModes: Dispatch<SetStateAction<Set<string>>>,
  setModeAmounts: Dispatch<SetStateAction<Record<string, number>>>,
) {
  const [syncedBill, setSyncedBill] = useState(billAmount);
  if (billAmountChanged(syncedBill, billAmount)) {
    setSyncedBill(billAmount);
    if (paymentSelectionIsSet(selectedModes, modeAmounts)) {
      setSelectedModes(new Set());
      setModeAmounts({});
    }
  }
}
