/**
 * Invoice layout switcher.
 * Flip to "legacy" and redeploy to restore the previous receipt immediately.
 */
import InvoicePreviewLegacy from "./InvoicePreviewLegacy";
import InvoicePreviewV2 from "./InvoicePreviewV2";

const INVOICE_LAYOUT: "v2" | "legacy" = "legacy";

const InvoicePreview = INVOICE_LAYOUT === "legacy" ? InvoicePreviewLegacy : InvoicePreviewV2;

export default InvoicePreview;