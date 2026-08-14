interface ReportInvoiceBarcodeProps {
  invoiceNumber: string | null | undefined;
  barcodePng: string | null;
}

/**
 * Invoice-number CODE128 for the report footer, left of signatures.
 * One HTML block (PNG bars + invoice text) is captured as-is for PDF/WhatsApp
 * so preview and download match. No second overlay.
 */
const ReportInvoiceBarcode = ({ invoiceNumber, barcodePng }: ReportInvoiceBarcodeProps) => {
  const label = String(invoiceNumber || "").trim();
  if (!barcodePng && !label) return null;
  return (
    <div
      data-report-barcode="1"
      className="flex-shrink-0"
      style={{
        textAlign: "left",
        background: "#ffffff",
        padding: "1px 2px 0 0",
        lineHeight: 1.15,
      }}
    >
      {barcodePng && (
        <img
          src={barcodePng}
          alt={label ? `Invoice ${label}` : "Invoice barcode"}
          style={{
            height: 28,
            width: "auto",
            maxWidth: 150,
            display: "block",
            background: "#ffffff",
          }}
        />
      )}
      {label && (
        <div
          style={{
            fontSize: "8px",
            fontWeight: 700,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            letterSpacing: "0.04em",
            color: "#111",
            marginTop: 1,
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
};

export default ReportInvoiceBarcode;
