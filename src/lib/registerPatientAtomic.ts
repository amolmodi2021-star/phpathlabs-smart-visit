import { supabase } from "@/integrations/supabase/client";
import { splitPaymentModes } from "@/lib/paymentTransactions";
import { getCurrentUser } from "@/lib/auth";
import type { TubeGroup } from "@/lib/sampleTubeGrouping";
import {
  assertCollectedDoesNotExceedBill,
  sumPaymentEntries,
} from "@/lib/billPayment";

export interface AtomicRegistrationInput {
  registration: Record<string, any>;
  tubes: TubeGroup[];
  payment?: {
    payments?: Array<{ mode: string; amount: number }>;
    total_amount?: number;
    gross_amount?: number;
    discount_amount?: number;
    final_amount?: number;
    paid_amount?: number;
    due_amount?: number;
    transaction_type?: string;
    direction?: "in" | "out";
    remarks?: string;
  } | null;
  homeVisitId?: string | null;
  homeVisitPatch?: Record<string, any> | null;
}

function tubesToJson(tubes: TubeGroup[]) {
  return (tubes || []).map((g) => ({
    tube_type: g.tubeType,
    tube_color: g.tubeColor,
    sample_type: g.sampleType,
    suffix: g.suffix || "",
    test_ids: g.testIds,
    test_names: g.testNames,
    status: "pending",
  }));
}

function paymentToJson(
  registration: Record<string, any>,
  payment: AtomicRegistrationInput["payment"],
) {
  if (!payment) return null;
  const user = getCurrentUser();
  const modes = splitPaymentModes(payment.payments);
  return {
    invoice_number: registration.invoice_number,
    patient_name: registration.patient_name,
    transaction_type: payment.transaction_type || "registration_payment",
    direction: payment.direction || "in",
    performed_by: user?.display_name || user?.username || "Unknown",
    cash_amount: modes.cash,
    gpay_amount: modes.gpay,
    paytm_amount: modes.paytm,
    credit_card_amount: modes.credit_card,
    neft_amount: modes.neft,
    total_amount: payment.total_amount ?? payment.paid_amount ?? 0,
    gross_amount: payment.gross_amount ?? registration.gross_amount ?? 0,
    discount_amount: payment.discount_amount ?? registration.discount_amount ?? 0,
    final_amount: payment.final_amount ?? registration.final_amount ?? 0,
    paid_amount: payment.paid_amount ?? registration.paid_amount ?? 0,
    due_amount: payment.due_amount ?? registration.due_amount ?? 0,
    remarks: payment.remarks || null,
  };
}

/**
 * Atomically create registration + sample tubes + payment (+ optional home visit update).
 * Invoice number is always assigned inside the DB function. For new patients (no UMR),
 * UMR is also assigned there in the same transaction so concurrent receptionists get
 * unique numbers. Existing patients keep the UMR supplied by the client.
 * Rolls back all writes if any step fails.
 */
export async function registerPatientAtomic(input: AtomicRegistrationInput): Promise<any> {
  const finalAmt = Number(input.payment?.final_amount ?? input.registration?.final_amount ?? 0);
  const paidAmt = Number(input.payment?.paid_amount ?? input.registration?.paid_amount ?? 0);
  assertCollectedDoesNotExceedBill(paidAmt, finalAmt);
  assertCollectedDoesNotExceedBill(
    sumPaymentEntries(input.payment?.payments ?? input.registration?.payments),
    finalAmt,
  );

  const { data, error } = await (supabase as any).rpc("register_patient_atomic", {
    p_registration: input.registration,
    p_tubes: tubesToJson(input.tubes),
    p_payment: paymentToJson(input.registration, input.payment),
    p_home_visit_id: input.homeVisitId || null,
    p_home_visit_patch: input.homeVisitPatch || null,
  });
  if (error) throw new Error(error.message || "Registration failed");
  return data;
}
