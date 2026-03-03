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
}

export function buildEstimateMessage(data: EstimateMessageData): string {
  const dateStr = format(new Date(), "EEE - dd-MM-yyyy");
  const fastingTests = data.tests.filter((t) => t.fasting).map((t) => t.name);

  let msg = `${data.header}\n${dateStr}\n\nTest Details:\n`;
  data.tests.forEach((t) => { msg += `• ${t.name} – ₹${t.price}\n`; });
  msg += `\nAmount: ₹${data.totalAmount}`;
  if (data.discountAmount > 0) msg += `\nDiscount Amount: (₹${data.discountAmount})`;
  if (data.homeVisitCharges > 0) msg += `\nHome Visit Charges: ₹${data.homeVisitCharges}`;
  msg += `\nFinal Amount: ₹${data.finalAmount}`;
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

  let msg = `${data.visitHeader}\n`;
  if (data.patientName) {
    msg += `\nPatient Name:\n${data.patientName}\n`;
  }
  msg += `\nVisit Date & Time:\n${data.visitDate} | ${data.visitTime}\n\nAddress:\n${data.address}\n\nTest Details:\n`;
  data.tests.forEach((t) => { msg += `• ${t.name} – ₹${t.price}\n`; });
  msg += `\nAmount: ₹${data.totalAmount}`;
  if (data.discountAmount > 0) msg += `\nDiscount Amount: (₹${data.discountAmount})`;
  if (data.homeVisitCharges > 0) msg += `\nHome Visit Charges: ₹${data.homeVisitCharges}`;
  msg += `\nFinal Amount: ₹${data.finalAmount}`;
  if (fastingTests.length > 0) {
    msg += `\n\nFasting required for: ${fastingTests.join(", ")}\n${data.fastingInstructions}`;
  } else if (data.tests.length > 0) {
    msg += `\n\n${data.noFastingMessage}`;
  }
  msg += `\n\nThank you for choosing us.\n${data.footer}`;
  return msg;
}

export function shareOnWhatsApp(phone: string, message: string) {
  const url = `https://wa.me/91${phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank");
}
