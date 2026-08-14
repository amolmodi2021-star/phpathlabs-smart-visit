interface ReportInvoiceBarcodeProps {
  invoiceNumber: string | null | undefined;
  barcodePng: string | null;
}

/**
 * Invoice-number CODE128 for the report footer.
 * Must be an img (PNG data URL), never a live canvas — WhatsApp/PDF
 * capture uses html-to-image which cannot clone canvas pixels.
 */
const ReportInvoiceBarcode = ({ invoiceNumber, barcodePng }: ReportInvoiceBarcodeProps) => {
  const label = String(invoiceNumber || "").trim();
  if (!barcodePng && !label) return null;
  return (
    <div className="flex-shrink-0" style={{ minWidth: 0, textAlign: "left" }}>
      {barcodePng && (
        <img
          src={barcodePng}
          alt={label ? `Invoice ${label}` : "Invoice barcode"}
          style={{
            height: 28,
            maxWidth: 170,
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
            lineHeight: 1.2,
            marginTop: 1,
            color: "#111",
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
};

export default ReportInvoiceBarcode;
