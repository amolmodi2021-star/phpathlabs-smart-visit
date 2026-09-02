/**
 * Session + IndexedDB cache for invoice header brand (settings + logo).
 * Prevents repeat Supabase REST/storage egress on every invoice open / WhatsApp send.
 */
import { supabase } from "@/integrations/supabase/client";
import { getOrFetchUrlAsDataUrl, reportAssetCacheKey } from "@/lib/reportAssetCache";

export const INVOICE_BRAND_SETTING_KEYS = [
  "invoice_lab_name",
  "invoice_address",
  "invoice_contact",
  "invoice_tagline",
  "invoice_logo_url",
  "invoice_logo_align",
  "invoice_lab_name_align",
  "invoice_lab_name_visible",
  "invoice_tagline_align",
  "invoice_address_align",
  "invoice_lab_name_size",
  "invoice_lab_name_bold",
  "invoice_lab_name_color",
  "invoice_contact_size",
  "invoice_contact_bold",
  "invoice_contact_color",
  "invoice_address_size",
  "invoice_address_bold",
  "invoice_address_color",
  "invoice_tagline_size",
  "invoice_tagline_bold",
  "invoice_tagline_color",
] as const;

export const INVOICE_BRAND_DEFAULTS: Record<string, string> = {
  invoice_lab_name: "PH PathLabs",
  invoice_address: "",
  invoice_contact: "LabLine: 6356 55 66 99",
  invoice_tagline: "Invoice / Sample Receipt",
  invoice_logo_url: "",
  invoice_logo_align: "center",
  invoice_lab_name_align: "center",
  invoice_lab_name_visible: "true",
  invoice_tagline_align: "center",
  invoice_address_align: "center",
  invoice_lab_name_size: "16",
  invoice_lab_name_bold: "true",
  invoice_lab_name_color: "#2E3192",
  invoice_contact_size: "10",
  invoice_contact_bold: "false",
  invoice_contact_color: "#6b7280",
  invoice_address_size: "9",
  invoice_address_bold: "false",
  invoice_address_color: "#6b7280",
  invoice_tagline_size: "9",
  invoice_tagline_bold: "false",
  invoice_tagline_color: "#6b7280",
};

export type InvoiceBrandBundle = {
  brand: Record<string, string>;
  /** Prefer for <img>/print/capture — data URL after first fetch (no repeat storage egress). */
  logoSrc: string;
};

let memoryBundle: InvoiceBrandBundle | null = null;
let inflight: Promise<InvoiceBrandBundle> | null = null;

function logoCacheKey(url: string): string {
  return reportAssetCacheKey("invoice-logo", url);
}

async function resolveLogoSrc(remoteUrl: string): Promise<string> {
  const url = String(remoteUrl || "").trim();
  if (!url) return "";
  if (url.startsWith("data:")) return url;
  const dataUrl = await getOrFetchUrlAsDataUrl(url, logoCacheKey(url));
  return dataUrl || url;
}

async function fetchBrandFromDb(): Promise<InvoiceBrandBundle> {
  const { data: rows } = await supabase
    .from("app_settings")
    .select("setting_key, setting_value")
    .in("setting_key", [...INVOICE_BRAND_SETTING_KEYS]);

  const brand = { ...INVOICE_BRAND_DEFAULTS };
  (rows || []).forEach((r: { setting_key: string; setting_value: string }) => {
    brand[r.setting_key] = r.setting_value;
  });

  const logoSrc = await resolveLogoSrc(brand.invoice_logo_url || "");
  return { brand, logoSrc };
}

/** One REST + logo download per browser session (shared across concurrent opens). */
export async function getInvoiceBrandCached(): Promise<InvoiceBrandBundle> {
  if (memoryBundle) return memoryBundle;
  if (!inflight) {
    inflight = fetchBrandFromDb()
      .then((bundle) => {
        memoryBundle = bundle;
        return bundle;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Call after Invoice Designer save so the next open picks up new logo/address. */
export function invalidateInvoiceBrandCache(): void {
  memoryBundle = null;
  inflight = null;
}