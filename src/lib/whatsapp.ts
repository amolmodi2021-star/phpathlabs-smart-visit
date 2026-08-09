import { format } from "date-fns";

export interface EstimateMessageData {
  tests: { name: string; price: number; fasting: boolean }[];
  totalAmount: number;
  discountAmount: number;
  homeVisitCharges: number;
  finalAmount: number;
  header: string;
  fastingInstructions: string;
  noFastingMessage: string;
  homeVisitDisclaimer: string;
  footer: string;
  patientName?: string;
}

export function buildEstimateMessage(data: EstimateMessageData): string {
  const dateStr = format(new Date(), "EEE - dd-MM-yyyy");
  const fastingTests = data.tests.filter((t) => t.fasting).map((t) => t.name);

  let msg = `${data.header}\n${dateStr}\n`;
  if (data.patientName) {
    msg += `\nPatient Name:\n${data.patientName.toUpperCase()}\n`;
  }
  msg += `\nTest Details:\n`;
  data.tests.forEach((t) => { msg += `• ${t.name} – ₹${t.price}\n`; });
  msg += `\n`;
  if (data.discountAmount > 0) {
    msg += `Amount: ₹${data.totalAmount}`;
    msg += `\nDiscount Amount: (₹${data.discountAmount})`;
    if (data.homeVisitCharges > 0) msg += `\nHome Visit Charges: ₹${data.homeVisitCharges}`;
    msg += `\n*Final Amount: ₹${data.finalAmount}*`;
  } else {
    // No discount — only show final amount (and home visit charges if any)
    if (data.homeVisitCharges > 0) msg += `Home Visit Charges: ₹${data.homeVisitCharges}\n`;
    msg += `*Final Amount: ₹${data.finalAmount}*`;
  }
  if (fastingTests.length > 0) {
    msg += `\n\nFasting required for: ${fastingTests.join(", ")}\n${data.fastingInstructions}`;
  } else if (data.tests.length > 0) {
    msg += `\n\n${data.noFastingMessage}`;
  }
  if (data.homeVisitCharges === 0) {
    msg += `\n\n${data.homeVisitDisclaimer}`;
  }
  msg += `\n\n${data.footer}`;
  return msg;
}

export interface VisitMessageData extends EstimateMessageData {
  visitDate: string;
  visitTime: string;
  address: string;
  visitHeader: string;
  patientName?: string;
}

export function buildVisitMessage(data: VisitMessageData): string {
  const fastingTests = data.tests.filter((t) => t.fasting).map((t) => t.name);
  const hasTestAmount = data.totalAmount > 0;

  let msg = `${data.visitHeader}\n`;
  if (data.patientName) {
    msg += `\nPatient Name:\n${data.patientName.toUpperCase()}\n`;
  }
  msg += `\nVisit Date & Time:\n${data.visitDate} | ${data.visitTime}\n\nAddress:\n${data.address.toUpperCase()}\n`;

  if (hasTestAmount) {
    msg += `\nTest Details:\n`;
    data.tests.forEach((t) => { msg += `• ${t.name} – ₹${t.price}\n`; });
    msg += `\n`;
    if (data.discountAmount > 0) {
      msg += `Amount: ₹${data.totalAmount}`;
      msg += `\nDiscount Amount: (₹${data.discountAmount})`;
      if (data.homeVisitCharges > 0) msg += `\nHome Visit Charges: ₹${data.homeVisitCharges}`;
      msg += `\n*Final Amount: ₹${data.finalAmount}*`;
    } else {
      if (data.homeVisitCharges > 0) msg += `Home Visit Charges: ₹${data.homeVisitCharges}\n`;
      msg += `*Final Amount: ₹${data.finalAmount}*`;
    }
    if (fastingTests.length > 0) {
      msg += `\n\nFasting required for: ${fastingTests.join(", ")}\n${data.fastingInstructions}`;
    } else if (data.tests.length > 0) {
      msg += `\n\n${data.noFastingMessage}`;
    }
  } else if (data.homeVisitCharges > 0) {
    msg += `\nHome Visit Charges: ₹${data.homeVisitCharges}`;
  }

  msg += `\n\nThank you for choosing us.\n${data.footer}`;
  return msg;
}

export function shareOnWhatsApp(phone: string, message: string) {
  const url = `https://wa.me/91${phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank");
}
