import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, parseISO } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format any date string or Date to dd-MM-yyyy. Use this everywhere for consistent date display. */
export function formatDateDDMMYYYY(date: string | Date | null | undefined): string {
  if (!date) return "";
  try {
    const d = typeof date === "string" ? parseISO(date) : date;
    return format(d, "dd-MM-yyyy");
  } catch {
    return String(date);
  }
}

/** Format date short (dd-MM) for compact display like report delivery */
export function formatDateShort(date: string | Date | null | undefined): string {
  if (!date) return "";
  try {
    const d = typeof date === "string" ? parseISO(date) : date;
    return format(d, "dd-MM");
  } catch {
    return String(date);
  }
}
